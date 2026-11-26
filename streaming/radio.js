// Internet radio via radio-browser.info (free, no key needed).
const { net } = require('electron');
const API = 'https://de1.api.radio-browser.info/json';

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

async function get(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const key = url.href;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;
  const res = await net.fetch(url.href, { headers: { 'User-Agent': 'Kaleido/1.0' } });
  if (!res.ok) throw new Error(`Radio API ${res.status}`);
  const data = await res.json();
  cache.set(key, { data, time: Date.now() });
  return data;
}

function normalize(s) {
  return {
    id: s.stationuuid,
    name: s.name || 'Unknown',
    url: s.url_resolved || s.url,
    homepage: s.homepage || '',
    favicon: s.favicon || null,
    country: s.country || '',
    countryCode: s.countrycode || '',
    language: s.language || '',
    tags: s.tags ? s.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    codec: s.codec || '',
    bitrate: s.bitrate || 0,
    votes: s.votes || 0,
    clickCount: s.clickcount || 0,
  };
}

async function topStations(limit = 50, offset = 0) {
  const data = await get('/stations/topvote', { limit, offset, hidebroken: true });
  return data.map(normalize);
}

async function popularStations(limit = 50, offset = 0) {
  const data = await get('/stations/topclick', { limit, offset, hidebroken: true });
  return data.map(normalize);
}

async function searchStations(query, { limit = 50, offset = 0, country, tag, order = 'votes' } = {}) {
  const params = { name: query, limit, offset, hidebroken: true, order, reverse: true };
  if (country) params.country = country;
  if (tag) params.tag = tag;
  const data = await get('/stations/search', params);
  return data.map(normalize);
}

async function stationsByCountry(countryCode, limit = 50, offset = 0) {
  const data = await get(`/stations/bycountrycodeexact/${countryCode}`, { limit, offset, hidebroken: true, order: 'votes', reverse: true });
  return data.map(normalize);
}

async function stationsByTag(tag, limit = 50, offset = 0) {
  const data = await get(`/stations/bytagexact/${encodeURIComponent(tag)}`, { limit, offset, hidebroken: true, order: 'votes', reverse: true });
  return data.map(normalize);
}

async function topTags(limit = 30) {
  const data = await get('/tags', { limit, order: 'stationcount', reverse: true, hidebroken: true });
  return data.filter(t => t.name && t.stationcount > 10).map(t => ({ name: t.name, count: t.stationcount }));
}

async function topCountries(limit = 30) {
  const data = await get('/countries', { limit, order: 'stationcount', reverse: true });
  return data.filter(c => c.name && c.stationcount > 5).map(c => ({ name: c.name, code: c.iso_3166_1 || '', count: c.stationcount }));
}

module.exports = { topStations, popularStations, searchStations, stationsByCountry, stationsByTag, topTags, topCountries };
