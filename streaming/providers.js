// Embed sources that resolve a TMDB id to a web player. Hosts come and go, and some are blocked
// by ISPs, so check() probes them from this machine and the theater plays the healthy ones first.
const { net } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const PROVIDERS = [
  {
    // vlc: the order Kaleido's own player tries sources in (their streams can be found and played
    // by VLC); sources without it only play in their web player.
    id: 'vidlink', name: 'VidLink', vlc: 1,
    movie: id => `https://vidlink.pro/movie/${id}?primaryColor=ffb547&autoplay=true`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}?primaryColor=ffb547&autoplay=true&nextbutton=true`,
  },
  {
    id: 'vidfast', name: 'VidFast', vlc: 2,
    movie: id => `https://vidfast.pro/movie/${id}?autoPlay=true`,
    tv: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}?autoPlay=true`,
  },
  {
    id: 'vidzee', name: 'VidZee', vlc: 3,
    movie: id => `https://player.vidzee.wtf/embed/movie/${id}`,
    tv: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'autoembed', name: 'AutoEmbed',
    movie: id => `https://autoembed.co/movie/tmdb/${id}`,
    tv: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    // Plays only inside an iframe: at the top it leaves for another site (see guest.framePage).
    id: '2embed', name: '2Embed', framed: true,
    movie: id => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
  },
  {
    id: 'vidsrc', name: 'VidSrc', vlc: 4,
    movie: id => `https://vidsrc.xyz/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidsrc-cc', name: 'VidSrc.cc', vlc: 5,
    movie: id => `https://vidsrc.cc/v2/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`,
  },
];

function urlFor(p, type, tmdbId, season, episode) {
  return type === 'movie' ? p.movie(tmdbId) : p.tv(tmdbId, season || 1, episode || 1);
}

function list() { return PROVIDERS.map(p => ({ id: p.id, name: p.name })); }

function getEmbed(providerId, type, tmdbId, season, episode) {
  return urlFor(PROVIDERS.find(x => x.id === providerId) || PROVIDERS[0], type, tmdbId, season, episode);
}

function getAll(type, tmdbId, season, episode) {
  return PROVIDERS.map(p => ({ id: p.id, name: p.name, url: urlFor(p, type, tmdbId, season, episode), framed: !!p.framed, vlc: p.vlc || 0 }));
}

// Host health is cached briefly: a host that is blocked or down stays that way for a while.
const health = new Map();
const HEALTH_TTL = 10 * 60 * 1000;

async function probe(url) {
  const host = new URL(url).host;
  const hit = health.get(host);
  if (hit && Date.now() - hit.at < HEALTH_TTL) return hit;
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  let result;
  try {
    const res = await net.fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctl.signal });
    const body = await res.text();
    const ok = res.ok && body.length > 600;
    result = { ok, ms: Date.now() - started, reason: ok ? '' : !res.ok ? `HTTP ${res.status}` : 'empty page' };
  } catch (err) {
    result = { ok: false, ms: Date.now() - started, reason: err.name === 'AbortError' ? 'timed out' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
  result.at = Date.now();
  health.set(host, result);
  return result;
}

// Every source with its URL and health, healthy and fastest first. Waits at most `wait` ms so a
// blocked host cannot hold up playback; those still being probed come back with ok: null.
async function check(type, tmdbId, season, episode, wait = 3000) {
  const out = getAll(type, tmdbId, season, episode).map(s => ({ ...s, ok: null, ms: 0, reason: 'still checking' }));
  const probes = out.map(s => probe(s.url).then(h => Object.assign(s, { ok: h.ok, ms: h.ms, reason: h.reason })));
  await Promise.race([Promise.all(probes), new Promise(r => setTimeout(r, wait))]);
  const rank = s => (s.ok === true ? 2 : s.ok === null ? 1 : 0);
  return out.map(s => ({ ...s })).sort((a, b) => rank(b) - rank(a) || (a.ok ? a.ms - b.ms : 0));
}

module.exports = { list, getEmbed, getAll, check, PROVIDERS };
