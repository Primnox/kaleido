// IPTV playlist parser and channel browser. Loads public m3u/m3u8 playlists
// from iptv-org and resolves them into playable channel lists.
const { net } = require('electron');

const SOURCES = {
  all: 'https://iptv-org.github.io/iptv/index.m3u',
  countries: 'https://iptv-org.github.io/iptv/index.country.m3u',
  categories: 'https://iptv-org.github.io/iptv/index.category.m3u',
  languages: 'https://iptv-org.github.io/iptv/index.language.m3u',
};

const CATEGORY_PLAYLISTS = {
  general: 'https://iptv-org.github.io/iptv/categories/general.m3u',
  news: 'https://iptv-org.github.io/iptv/categories/news.m3u',
  sports: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
  entertainment: 'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
  music: 'https://iptv-org.github.io/iptv/categories/music.m3u',
  movies: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
  kids: 'https://iptv-org.github.io/iptv/categories/kids.m3u',
  documentary: 'https://iptv-org.github.io/iptv/categories/documentary.m3u',
  animation: 'https://iptv-org.github.io/iptv/categories/animation.m3u',
  education: 'https://iptv-org.github.io/iptv/categories/education.m3u',
  lifestyle: 'https://iptv-org.github.io/iptv/categories/lifestyle.m3u',
  cooking: 'https://iptv-org.github.io/iptv/categories/cooking.m3u',
  science: 'https://iptv-org.github.io/iptv/categories/science.m3u',
  travel: 'https://iptv-org.github.io/iptv/categories/travel.m3u',
  religious: 'https://iptv-org.github.io/iptv/categories/religious.m3u',
  weather: 'https://iptv-org.github.io/iptv/categories/weather.m3u',
};

const COUNTRY_PLAYLISTS = {
  us: 'https://iptv-org.github.io/iptv/countries/us.m3u',
  gb: 'https://iptv-org.github.io/iptv/countries/gb.m3u',
  in: 'https://iptv-org.github.io/iptv/countries/in.m3u',
  ca: 'https://iptv-org.github.io/iptv/countries/ca.m3u',
  au: 'https://iptv-org.github.io/iptv/countries/au.m3u',
  de: 'https://iptv-org.github.io/iptv/countries/de.m3u',
  fr: 'https://iptv-org.github.io/iptv/countries/fr.m3u',
  jp: 'https://iptv-org.github.io/iptv/countries/jp.m3u',
  kr: 'https://iptv-org.github.io/iptv/countries/kr.m3u',
  br: 'https://iptv-org.github.io/iptv/countries/br.m3u',
  mx: 'https://iptv-org.github.io/iptv/countries/mx.m3u',
  es: 'https://iptv-org.github.io/iptv/countries/es.m3u',
  it: 'https://iptv-org.github.io/iptv/countries/it.m3u',
  ru: 'https://iptv-org.github.io/iptv/countries/ru.m3u',
  tr: 'https://iptv-org.github.io/iptv/countries/tr.m3u',
  ar: 'https://iptv-org.github.io/iptv/countries/ar.m3u',
};

// Cache fetched playlists for 30 minutes.
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const attrs = {};
      const attrMatch = line.matchAll(/([a-z-]+)="([^"]*)"/gi);
      for (const m of attrMatch) attrs[m[1].toLowerCase()] = m[2];
      // Attribute values (user agents especially) can contain commas, so find the name after them.
      const nameMatch = /,(.+)$/.exec(line.replace(/"[^"]*"/g, '""'));
      current = {
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        logo: attrs['tvg-logo'] || null,
        group: attrs['group-title'] || 'Other',
        language: attrs['tvg-language'] || '',
        country: attrs['tvg-country'] || '',
        id: attrs['tvg-id'] || '',
      };
    } else if (line && !line.startsWith('#') && current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

async function fetchPlaylist(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`IPTV fetch failed: ${res.status}`);
  const text = await res.text();
  const data = parseM3U(text);
  cache.set(url, { data, time: Date.now() });
  return data;
}

async function categoryChannels(category) {
  const url = CATEGORY_PLAYLISTS[category];
  if (!url) throw new Error(`Unknown category: ${category}`);
  return fetchPlaylist(url);
}

async function countryChannels(country) {
  const url = COUNTRY_PLAYLISTS[country.toLowerCase()];
  if (!url) throw new Error(`Unknown country: ${country}`);
  return fetchPlaylist(url);
}

// Search every public channel by name (the full index is large, so it is fetched once and cached).
async function search(query, limit = 40) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const all = await fetchPlaylist(SOURCES.all);
  const seen = new Set();
  const starts = [], contains = [];
  for (const ch of all) {
    const name = ch.name.toLowerCase();
    if (seen.has(ch.url) || !name.includes(q)) continue;
    seen.add(ch.url);
    (name.startsWith(q) ? starts : contains).push(ch);
    if (starts.length >= limit) break;
  }
  return starts.concat(contains).slice(0, limit);
}

function listCategories() {
  return Object.keys(CATEGORY_PLAYLISTS).map(k => ({ id: k, name: k.charAt(0).toUpperCase() + k.slice(1) }));
}

function listCountries() {
  const names = { us: 'United States', gb: 'United Kingdom', in: 'India', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', jp: 'Japan', kr: 'South Korea', br: 'Brazil', mx: 'Mexico', es: 'Spain', it: 'Italy', ru: 'Russia', tr: 'Turkey', ar: 'Argentina' };
  return Object.keys(COUNTRY_PLAYLISTS).map(k => ({ id: k, name: names[k] || k.toUpperCase() }));
}

module.exports = { fetchPlaylist, categoryChannels, countryChannels, search, listCategories, listCountries, parseM3U, SOURCES, CATEGORY_PLAYLISTS, COUNTRY_PLAYLISTS };
