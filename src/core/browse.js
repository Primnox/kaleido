// Streaming hub: films and series from TMDB, live TV from iptv-org, radio from radio-browser.
// Films and series play in an in-app theater (embed sources); live TV and radio play in VLC.
import { h, icon, windowButtons } from './ui.js';

const S = () => window.host.streaming;
const HERO_MS = 9000;
const PAGE_TILES = 120;

const TABS = [['home', 'Home'], ['movies', 'Movies'], ['tv', 'Shows'], ['anime', 'Anime'], ['live', 'Live TV'], ['radio', 'Radio']];
const NEEDS_KEY = new Set(['home', 'movies', 'tv', 'anime', 'detail']);
const ANIME = { with_genres: 16, with_original_language: 'ja' };

// ---------- data ----------
const memo = new Map();
function cached(key, fn) {
  if (!memo.has(key)) memo.set(key, fn().catch(err => { memo.delete(key); throw err; }));
  return memo.get(key);
}
const detailsOf = item => cached(`d:${item.type}:${item.id}`, () => (item.type === 'tv' ? S().tmdb.tvDetails(item.id) : S().tmdb.movieDetails(item.id)));

const pref = {
  get(k, d) { try { return localStorage.getItem(`kb:${k}`) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`kb:${k}`, v); } catch {} },
  list(k) { try { return JSON.parse(localStorage.getItem(`kb:${k}`)) || []; } catch { return []; } },
  setList(k, v) { try { localStorage.setItem(`kb:${k}`, JSON.stringify(v)); } catch {} },
};
const slim = it => ({ id: it.id, type: it.type, title: it.title, poster: it.poster, backdrop: it.backdrop, year: it.year, rating: it.rating, overview: it.overview });
const same = (a, b) => a.id === b.id && a.type === b.type;
const myList = {
  all: () => pref.list('list'),
  has: it => myList.all().some(x => same(x, it)),
  toggle(it) {
    const l = myList.all();
    const i = l.findIndex(x => same(x, it));
    if (i >= 0) l.splice(i, 1); else l.unshift(slim(it));
    pref.setList('list', l.slice(0, 200));
    return i < 0;
  },
};
const watched = {
  all: () => pref.list('watched'),
  of: it => watched.all().find(x => same(x.item, it)),
  add(it, season, episode) {
    const l = watched.all().filter(x => !same(x.item, it));
    l.unshift({ item: slim(it), season, episode, at: Date.now() });
    pref.setList('watched', l.slice(0, 30));
  },
  remove: it => pref.setList('watched', watched.all().filter(x => !same(x.item, it))),
};

// ---------- dynamic colour: the hub takes on the palette of whatever is on screen ----------
// Pixels are bucketed by hue and weighted by how vivid they are; the strongest bucket becomes the
// main glow and the accent, the strongest clearly different bucket becomes the second glow.
const paletteMemo = new Map();
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [hue, s, l];
}
const hsl = (hue, s, l) => `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
// Video edge colour -> a glow colour: richer and never so dark it disappears or so bright it glares.
const glow = rgb => { const [hue, s, l] = rgbToHsl(...rgb); return hsl(hue, clamp(s * 1.5, 0, 0.95), clamp(l * 1.35, 0.2, 0.62)); };

function paletteOf(url) {
  if (!url) return Promise.resolve(null);
  const src = sized(url, 'w300');
  if (!paletteMemo.has(src)) {
    paletteMemo.set(src, new Promise(resolve => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const W = 48, H = 27;
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const g = cv.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0, W, H);
          const d = g.getImageData(0, 0, W, H).data;
          const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
          let total = 0;
          for (let i = 0; i < d.length; i += 4) {
            const [hue, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
            const wt = s * (1 - Math.abs(l - 0.5) * 1.6);
            if (wt <= 0.04) continue;
            const bk = buckets[Math.floor(hue / 20) % 18];
            bk.w += wt; bk.r += d[i] * wt; bk.g += d[i + 1] * wt; bk.b += d[i + 2] * wt;
            total += wt;
          }
          if (total < 8) return resolve(null);
          const avg = bk => rgbToHsl(bk.r / bk.w, bk.g / bk.w, bk.b / bk.w);
          const ranked = buckets.filter(bk => bk.w > 0).sort((a, b) => b.w - a.w);
          const [h1, s1] = avg(ranked[0]);
          const second = ranked.slice(1).find(bk => bk.w > ranked[0].w * 0.12 && hueGap(avg(bk)[0], h1) >= 45);
          const [h2, s2] = second ? avg(second) : [(h1 + 40) % 360, s1];
          resolve({
            a: hsl(h1, clamp(s1, 0.55, 0.9), 0.46),
            b: hsl(h2, clamp(s2, 0.5, 0.9), 0.42),
            acc: hsl(h1, clamp(s1 + 0.15, 0.7, 0.95), 0.68),
            accFg: hsl(h1, 0.5, 0.09),
          });
        } catch { resolve(null); }
      };
      im.onerror = () => resolve(null);
      im.src = src;
    }));
  }
  return paletteMemo.get(src);
}

// Fixed palettes for pages that have no artwork of their own.
const PAGE_PALETTES = {
  live: { a: 'hsl(345 85% 48%)', b: 'hsl(275 70% 42%)', acc: 'hsl(350 95% 72%)', accFg: 'hsl(350 50% 9%)' },
  radio: { a: 'hsl(258 75% 52%)', b: 'hsl(195 85% 40%)', acc: 'hsl(252 95% 80%)', accFg: 'hsl(252 50% 10%)' },
};

// Cards report hover so the hub can preview their colours and pop out a preview; mountBrowse
// installs both handlers.
let onCardHover = () => {};
let onCardPreview = () => {};
function hoverCard(el, item, { preview = true, anchor = el } = {}) {
  const url = item.backdrop || item.poster;
  el.addEventListener('pointerenter', () => { if (url) onCardHover(url); if (preview) onCardPreview(anchor, item); });
  el.addEventListener('pointerleave', () => { if (url) onCardHover(null); if (preview) onCardPreview(null); });
  // Keyboard focus previews the same way, so arrow-key browsing feels like a TV app.
  el.addEventListener('focus', () => { if (!el.matches(':focus-visible')) return; if (url) onCardHover(url); if (preview) onCardPreview(anchor, item); });
  el.addEventListener('blur', () => { if (url) onCardHover(null); if (preview) onCardPreview(null); });
}

// Tilt toward the pointer, with a glare that follows it.
function tilt(el, target = el, strength = 1) {
  el.addEventListener('pointermove', e => {
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    target.style.setProperty('--rx', `${((0.5 - y) * 14 * strength).toFixed(2)}deg`);
    target.style.setProperty('--ry', `${((x - 0.5) * 16 * strength).toFixed(2)}deg`);
    target.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    target.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  });
  el.addEventListener('pointerleave', () => ['--rx', '--ry'].forEach(p => target.style.removeProperty(p)));
}
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

// ---------- small pieces ----------
function img(src, cls, { alt = '', lazy = true, fade = true } = {}) {
  const el = h(`img${fade ? '.kb-fade' : ''}.${cls}`, { alt, draggable: 'false', decoding: 'async', loading: lazy ? 'lazy' : null });
  el.addEventListener('load', () => el.classList.add('kb-in'));
  el.addEventListener('error', () => el.classList.add('kb-broken'));
  if (src) el.src = src;
  return el;
}
const sized = (url, size) => (url ? url.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`) : null);

// ---------- ambient trailers ----------
// A silent YouTube trailer behind the art, faded in only once frames are actually moving. Only the
// newest one plays: the hero pauses while a hover card previews, and picks up when it closes.
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const previewsOn = () => !reducedMotion() && pref.get('previews', '1') === '1';
const sound = {
  get on() { return pref.get('sound', '') === '1'; },
  toggle() { pref.set('sound', this.on ? '0' : '1'); ambients.forEach(a => a.applySound()); soundListeners.forEach(f => f(this.on)); },
};
const soundListeners = new Set();
const ambients = [];
const ambientHolds = new Set();
function syncAmbients() {
  const top = [...ambients].reverse().find(a => !a.holds.size);
  ambients.forEach(a => a.setActive(!ambientHolds.size && a === top));
}
function holdAmbients(reason, on) {
  if (on) ambientHolds.add(reason); else ambientHolds.delete(reason);
  syncAmbients();
}
// Only the picture: YouTube's embed markup keeps changing, so hide everything but the video itself.
const YT_CSS = `html,body{background:#000!important;cursor:none!important;overflow:hidden!important}
body *:not(video){visibility:hidden!important;animation:none!important}video{visibility:visible!important}`;
const YT_STATE = `(() => { const v = document.querySelector('video'); const p = document.getElementById('movie_player');
  return { has: !!v, t: v ? v.currentTime : 0, d: v ? v.duration || 0 : 0, playing: !!v && !v.paused && v.readyState > 2,
    ended: !!v && v.ended, ad: !!p && p.classList.contains('ad-showing'), err: !!document.querySelector('.ytp-error') }; })()`;

function ambient(key, { onPlay, onProgress, onEnd, onFail, cap = 150 } = {}) {
  const view = document.createElement('webview');
  view.className = 'kb-amb-frame';
  view.setAttribute('partition', 'persist:kaleido-stream');
  view.setAttribute('httpreferrer', 'https://www.themoviedb.org/');
  const q = new URLSearchParams({ autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, modestbranding: 1 });
  view.setAttribute('src', `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?${q}`);
  let ready = false, dead = false, playing = false, active = false, ended = false, giveUp = null;
  const run = code => (ready && !dead ? view.executeJavaScript(code).catch(() => null) : Promise.resolve(null));
  const a = {
    el: view,
    holds: new Set(),
    applySound() {
      if (!active) return;
      const on = sound.on;
      run(`(() => { const p = document.getElementById('movie_player'); const v = document.querySelector('video');
        if (p && p.unMute) { if (${on}) { p.unMute(); p.setVolume(70); } else p.mute(); } else if (v) v.muted = ${!on}; })()`);
    },
    setActive(on) {
      active = on;
      // Only count load time while it is allowed to play.
      clearTimeout(giveUp);
      if (on && !playing) giveUp = setTimeout(() => { if (!playing) fail(); }, 12000);
      if (!ready) return;
      run(`(() => { const v = document.querySelector('video'); if (v) { ${on ? 'v.play().catch(() => {})' : 'v.pause()'}; } })()`);
      if (on) a.applySound();
    },
    hold(reason, on) { if (on) a.holds.add(reason); else a.holds.delete(reason); syncAmbients(); },
    destroy() {
      if (dead) return;
      dead = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      view.remove();
      const i = ambients.indexOf(a);
      if (i >= 0) ambients.splice(i, 1);
      syncAmbients();
    },
  };
  const fail = () => { if (dead) return; const cb = onFail; a.destroy(); if (cb) cb(); };
  a.stop = fail;
  view.addEventListener('dom-ready', () => {
    if (dead) return;
    ready = true;
    view.insertCSS(YT_CSS).catch(() => {});
    a.setActive(active);
  });
  view.addEventListener('did-fail-load', e => { if (e.isMainFrame && e.errorCode !== -3) fail(); });
  const poll = setInterval(async () => {
    const s = await run(YT_STATE);
    if (dead || !s) return;
    if (s.err) return fail();
    if (!active && s.playing) { a.setActive(false); return; }
    if (!playing && s.playing && s.t > 0.3 && !s.ad) {
      playing = true;
      clearTimeout(giveUp);
      view.classList.add('kb-on');
      a.applySound();
      if (onPlay) onPlay();
    }
    if (playing && s.d && onProgress) onProgress(Math.min(1, s.t / Math.min(s.d, cap)));
    if (playing && !ended && (s.ended || (s.d && s.t >= s.d - 0.8) || s.t >= cap)) {
      ended = true;
      view.classList.remove('kb-on');
      if (onEnd) setTimeout(() => { if (!dead) onEnd(); }, 700);
    }
  }, 400);
  ambients.push(a);
  syncAmbients();
  return a;
}
// A round mute toggle that follows the shared sound preference.
function soundButton(cls = '') {
  const b = h(`button.kb-round.kb-sound${cls}`, { type: 'button' });
  const paint = on => { b.replaceChildren(icon(on ? 'volume' : 'mute', { size: 18 })); b.title = on ? 'Mute previews (M)' : 'Unmute previews (M)'; };
  paint(sound.on);
  soundListeners.add(paint);
  b.addEventListener('click', e => { e.stopPropagation(); sound.toggle(); });
  return { el: b, dispose: () => soundListeners.delete(paint) };
}
const typeLabel = t => (t === 'tv' ? 'Series' : 'Film');
const star = r => (r ? h('span.kb-star', {}, '★ ', r.toFixed(1)) : null);
const runtime = m => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`) : null);
const initials = s => (s || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
function meta(...parts) {
  return h('div.kb-meta', {}, parts.filter(Boolean).map((p, i) => [i ? h('i.kb-dot') : null, h('span', {}, p)]));
}
function chip(label, on, onClick) {
  return h('button.kb-chip', { type: 'button', class: on ? 'kb-on' : '', onClick }, label);
}
function state(ic, title, text, ...actions) {
  return h('div.kb-state', {}, h('div.kb-state-icon', {}, icon(ic, { size: 28 })), h('h2', {}, title), text ? h('p', {}, text) : null, actions.length ? h('div.kb-actions', {}, actions) : null);
}
function btn(kind, label, ic, onClick) {
  return h(`button.kb-btn.kb-btn-${kind}`, { type: 'button', onClick }, ic ? icon(ic, { size: 20 }) : null, label);
}

// ---------- cards ----------
function posterCard(item, open, { rank } = {}) {
  const art = h('div.kb-card-art', {},
    item.poster ? img(item.poster, 'kb-card-img') : h('div.kb-card-blank', {}, item.title),
    h('div.kb-card-shade'),
    h('div.kb-glare'),
    item.rating ? h('span.kb-card-score', {}, h('b', {}, '★'), item.rating.toFixed(1)) : null,
    h('span.kb-card-play', {}, icon('play', { size: 16 })));
  const card = h(`button.kb-card${rank ? '.kb-ranked' : ''}`, { type: 'button', title: item.title },
    rank ? h('span.kb-rank', {}, String(rank)) : null,
    art,
    h('div.kb-card-title', {}, item.title),
    h('div.kb-card-sub', {}, [item.year, typeLabel(item.type)].filter(Boolean).join(' · ')));
  card.addEventListener('click', () => open(item, art, 'poster'));
  hoverCard(card, item, { anchor: art });
  tilt(card, art);
  return card;
}

function wideCard(item, open) {
  const card = h('button.kb-wide', { type: 'button', title: item.title },
    item.backdrop ? img(sized(item.backdrop, 'w780'), 'kb-wide-img') : null,
    h('div.kb-wide-shade'),
    h('div.kb-glare'),
    h('div.kb-wide-text', {},
      h('div.kb-wide-title', {}, item.title),
      h('div.kb-wide-sub', {}, star(item.rating), item.year ? ` ${item.year}` : '')));
  card.addEventListener('click', () => open(item, card, 'backdrop'));
  hoverCard(card, item);
  tilt(card, card, 0.5);
  return card;
}

function resumeCard(entry, resume, remove) {
  const it = entry.item;
  const card = h('div.kb-wide.kb-resume', { role: 'button', tabindex: '0', title: it.title },
    it.backdrop ? img(sized(it.backdrop, 'w780'), 'kb-wide-img') : null,
    h('div.kb-wide-shade'),
    h('span.kb-resume-play', {}, icon('play', { size: 22 })),
    h('button.kb-resume-x', { type: 'button', title: 'Remove from Continue watching', onClick: e => { e.stopPropagation(); remove(it); card.remove(); } }, icon('close', { size: 14 })),
    h('div.kb-wide-text', {},
      h('div.kb-resume-label', {}, it.type === 'tv' ? `S${entry.season} · E${entry.episode}` : 'Film', h('i.kb-dot'), ago(entry.at)),
      h('div.kb-wide-title', {}, it.title)));
  card.addEventListener('click', () => resume(it));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') resume(it); });
  hoverCard(card, it, { preview: false });
  tilt(card, card, 0.5);
  return card;
}

const GENRE_HUES = [12, 210, 280, 340, 160, 35, 250, 190, 300, 95, 0, 225, 45, 265, 175, 320, 140, 20, 200];
function genreTile(g, i, open) {
  const tile = h('button.kb-genre', { type: 'button', onClick: () => open(g) },
    h('span.kb-genre-orb'), h('span.kb-genre-name', {}, g.name), icon('chevronRight', { size: 18 }));
  tile.style.setProperty('--h', GENRE_HUES[i % GENRE_HUES.length]);
  return tile;
}

function shelf(title, items, render, { sub, cls = '' } = {}) {
  if (!items || !items.length) return null;
  const track = h(`div.kb-track${cls ? '.' + cls : ''}`, {}, items.map(render));
  const move = dir => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
  const el = h('section.kb-shelf.kb-at-start', {},
    h('header.kb-shelf-head', {}, h('h2', {}, title), sub ? h('span', {}, sub) : null),
    h('div.kb-track-wrap', {},
      h('button.kb-arrow.kb-arrow-l', { type: 'button', 'aria-label': 'Scroll left', onClick: () => move(-1) }, icon('chevronLeft', { size: 26 })),
      track,
      h('button.kb-arrow.kb-arrow-r', { type: 'button', 'aria-label': 'Scroll right', onClick: () => move(1) }, icon('chevronRight', { size: 26 }))));
  const sync = () => {
    el.classList.toggle('kb-at-start', track.scrollLeft < 8);
    el.classList.toggle('kb-at-end', track.scrollLeft + track.clientWidth > track.scrollWidth - 8);
  };
  track.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  return el;
}

// ---------- skeletons ----------
const skel = cls => h(`div.kb-skel.${cls}`);
const skelShelf = (n = 9, kind = 'kb-skel-card') => h('section.kb-shelf', {}, skel('kb-skel-title'), h('div.kb-track', {}, Array.from({ length: n }, () => skel(kind))));
const skelHero = () => h('section.kb-hero.kb-hero-skel', {}, h('div.kb-hero-text', {}, skel('kb-skel-logo'), skel('kb-skel-line'), skel('kb-skel-line.kb-short'), h('div.kb-actions', {}, skel('kb-skel-btn'), skel('kb-skel-btn'))));
const skelGrid = (n = 18) => h('div.kb-grid', {}, Array.from({ length: n }, () => skel('kb-skel-card')));
const skelTiles = (n = 18) => h('div.kb-tiles', {}, Array.from({ length: n }, () => skel('kb-skel-tile')));

// ---------- hero carousel ----------
function hero(items, ctx, kicker = 'Trending this week', extra = null) {
  const slides = items.filter(i => i.backdrop).slice(0, 6);
  if (!slides.length) return null;
  let index = -1;
  let timer = null;
  let trailerTimer = null;
  let amb = null;
  const layers = h('div.kb-hero-layers');
  const reel = h('div.kb-hero-reel');
  const text = h('div.kb-hero-text');
  const dots = h('div.kb-hero-dots');
  const mute = soundButton('.kb-hero-sound');
  const el = h('section.kb-hero', {}, h('div.kb-visual', {}, layers, reel, h('div.kb-hero-fade')), text, h('div.kb-hero-side', {}, mute.el, dots));

  function stopTrailer() {
    clearTimeout(trailerTimer);
    pending = null;
    if (amb) { amb.destroy(); amb = null; }
    el.classList.remove('kb-playing');
  }
  // After a beat on a slide, its trailer takes over the backdrop and the carousel waits for it.
  let pending = null;
  function startTrailer(item, key) {
    if (!previewsOn() || !ctx.alive() || slides[index] !== item) return;
    if (offscreen) { pending = [item, key]; return; }
    pending = null;
    const mine = amb = ambient(key, {
      onPlay: () => {
        clearTimeout(timer);
        el.classList.add('kb-playing');
      },
      onProgress: f => dots.style.setProperty('--kb-prog', `${(f * 100).toFixed(1)}%`),
      onEnd: () => { if (amb === mine) show(index + 1); },
      onFail: () => {
        if (amb !== mine) return;
        amb = null;
        el.classList.remove('kb-playing');
        clearTimeout(timer);
        timer = setTimeout(() => show(index + 1), 4000);
      },
    });
    reel.replaceChildren(mine.el);
    if (offscreen) mine.hold('offscreen', true);
    // The trailer decides when to move on now; a failed one hands back to the timer.
    clearTimeout(timer);
  }
  let offscreen = false;
  const io = new IntersectionObserver(([e]) => {
    offscreen = e.intersectionRatio < 0.4;
    if (amb) amb.hold('offscreen', offscreen);
    else if (!offscreen && pending) startTrailer(...pending);
  }, { threshold: [0, 0.4, 1] });
  io.observe(el);

  function show(i) {
    stopTrailer();
    dots.style.removeProperty('--kb-prog');
    index = (i + slides.length) % slides.length;
    const item = slides[index];
    const pic = img(item.backdrop, 'kb-hero-img', { lazy: false });
    const layer = h('div.kb-hero-layer', {}, pic);
    const reveal = () => requestAnimationFrame(() => layer.classList.add('kb-on'));
    pic.addEventListener('load', reveal);
    pic.addEventListener('error', reveal);
    layers.append(layer);
    setTimeout(() => [...layers.children].slice(0, -1).forEach(l => l.remove()), 1400);

    const title = h('h1.kb-hero-title', {}, item.title);
    const facts = meta(star(item.rating), item.year, typeLabel(item.type));
    text.replaceChildren(
      h('div.kb-kicker', {}, h('span.kb-badge', {}, `#${index + 1}`), kicker),
      h('div.kb-hero-name', {}, title),
      facts,
      h('p.kb-hero-overview', {}, item.overview),
      h('div.kb-actions', {}, btn('primary', watched.of(item) && item.type === 'tv' ? 'Resume' : 'Play', 'play', () => ctx.resume(item)), btn('glass', 'More info', 'info', () => ctx.open(item)), extra ? extra() : null));
    paletteOf(item.backdrop).then(p => { if (slides[index] === item && ctx.alive()) ctx.palette(p); });
    text.classList.remove('kb-enter');
    void text.offsetWidth;
    text.classList.add('kb-enter');

    detailsOf(item).then(d => {
      if (slides[index] !== item) return;
      facts.replaceWith(meta(star(d.rating), d.year, d.type === 'tv' ? (d.totalSeasons ? `${d.totalSeasons} season${d.totalSeasons > 1 ? 's' : ''}` : 'Series') : runtime(d.runtime), (d.genres || []).slice(0, 2).join(', ')));
      if (d.logo) {
        const logo = img(d.logo, 'kb-hero-logo', { alt: d.title, lazy: false });
        logo.addEventListener('load', () => { if (title.isConnected) title.replaceWith(logo); });
      }
      if (d.trailer) trailerTimer = setTimeout(() => startTrailer(item, d.trailer), 2600);
    }).catch(() => {});

    dots.replaceChildren(...slides.map((s, j) => h('button.kb-hero-dot', { type: 'button', class: j === index ? 'kb-on' : '', 'aria-label': s.title, onClick: () => show(j) }, h('span', {}, h('i')))));
    clearTimeout(timer);
    timer = setTimeout(() => show(index + 1), HERO_MS);
  }
  show(0);
  ctx.cleanup(() => { clearTimeout(timer); stopTrailer(); io.disconnect(); mute.dispose(); });
  return el;
}

// ---------- channel and station tiles ----------
function logoBox(src, name, cls) {
  const box = h(`div.${cls}`);
  const fallback = () => box.replaceChildren(h('span.kb-initials', {}, initials(name)));
  if (src) {
    const pic = img(src.replace(/^http:\/\//, 'https://'), 'kb-logo');
    pic.addEventListener('error', fallback);
    box.append(pic);
  } else fallback();
  return box;
}

function channelTile(ch, play) {
  return h('button.kb-chan', { type: 'button', title: ch.name, onClick: () => play(ch) },
    logoBox(ch.logo, ch.name, 'kb-chan-logo'),
    h('div.kb-chan-text', {}, h('div.kb-chan-name', {}, ch.name), h('div.kb-chan-sub', {}, ch.group || ch.country || 'Channel')),
    h('span.kb-live', {}, 'LIVE'));
}

function stationTile(st, play, playing) {
  const art = logoBox(st.favicon, st.name, 'kb-station-art');
  art.append(h('span.kb-eq', {}, h('i'), h('i'), h('i'), h('i')));
  return h('button.kb-station', { type: 'button', title: st.name, class: playing ? 'kb-on' : '', dataset: { id: st.id }, onClick: () => play(st) },
    art,
    h('div.kb-chan-text', {},
      h('div.kb-chan-name', {}, st.name),
      h('div.kb-chan-sub', {}, [st.country, st.codec, st.bitrate ? `${st.bitrate} kbps` : ''].filter(Boolean).join(' · ')),
      st.tags.length ? h('div.kb-station-tags', {}, st.tags.slice(0, 3).map(t => h('span', {}, t))) : null));
}

// ---------- main mount ----------
export function mountBrowse(engine, shell) {
  let route = { name: 'home' };
  const stack = [];
  let token = 0;
  let cleanups = [];
  let rendered = false;
  let theater = null;
  let radioNow = null;

  const page = h('div.kb-page');
  const scroller = h('main.kb-main', {}, page);

  // ----- top bar -----
  const pill = h('span.kb-tab-pill');
  const tabEls = TABS.map(([id, label]) => h('button.kb-tab', { type: 'button', dataset: { tab: id }, onClick: () => { stack.length = 0; route = { name: id }; transition(() => render()); } }, label));
  const tabBar = h('nav.kb-tabs', {}, pill, tabEls);
  const backBtn = h('button.kb-icon-btn.kb-back', { type: 'button', title: 'Back', onClick: () => back() }, icon('chevronLeft', { size: 20 }));
  const search = h('input.kb-search-input', { type: 'search', placeholder: 'Search films, series, channels, radio', spellcheck: 'false' });
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = search.value.trim();
      if (q.length >= 2) go({ name: 'search', q, tab: 'home' }, { replace: route.name === 'search' });
      else if (!q && route.name === 'search') back();
    }, 350);
  });
  search.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { if (search.value) { search.value = ''; if (route.name === 'search') back(); } else search.blur(); }
    if (e.key === 'Enter') { clearTimeout(searchTimer); const q = search.value.trim(); if (q) go({ name: 'search', q, tab: 'home' }, { replace: route.name === 'search' }); }
  });
  // ----- settings popover -----
  const settingsBtn = h('button.kb-icon-btn', { type: 'button', title: 'Hub settings', 'aria-haspopup': 'true' }, icon('settings', { size: 18 }));
  const toggleRow = (label, desc, get, set) => {
    const row = h('button.kb-set-row', { type: 'button', role: 'switch' },
      h('span.kb-set-text', {}, h('b', {}, label), h('small', {}, desc)),
      h('span.kb-switch', {}, h('i')));
    const paint = () => row.setAttribute('aria-checked', String(get()));
    paint();
    row.addEventListener('click', () => { set(!get()); paint(); });
    return { row, paint };
  };
  const rows = [
    toggleRow('Autoplay previews', 'Trailers play silently behind titles', () => pref.get('previews', '1') === '1', on => {
      pref.set('previews', on ? '1' : '0');
      if (!on) [...ambients].forEach(a => a.stop());
    }),
    toggleRow('Preview sound', 'Start previews with sound (M)', () => sound.on, () => sound.toggle()),
    toggleRow('Ambient theater', 'The room glows with the film', () => pref.get('ambient', '1') === '1', on => {
      pref.set('ambient', on ? '1' : '0');
      if (theater) theater.classList.toggle('kb-ambient', on);
    }),
    toggleRow('Film grain & light', 'Grain texture and a glow that follows the cursor', () => pref.get('grain', '1') === '1', on => {
      pref.set('grain', on ? '1' : '0');
      el.classList.toggle('kb-plain', !on);
    }),
  ];
  soundListeners.add(() => rows[1].paint());
  const menu = h('div.kb-menu', { role: 'menu' },
    h('div.kb-menu-head', {}, 'Hub settings'),
    rows.map(r => r.row),
    h('div.kb-menu-sep'),
    h('button.kb-set-row.kb-set-link', { type: 'button', onClick: () => { closeMenu(); go({ name: 'key', tab: route.tab || route.name }); } },
      h('span.kb-set-text', {}, h('b', {}, 'TMDB key'), h('small', {}, 'Posters, titles and episode lists')), icon('chevronRight', { size: 16 })));
  const closeMenu = () => { menu.classList.remove('kb-show'); settingsBtn.classList.remove('kb-on'); };
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !menu.classList.contains('kb-show');
    rows.forEach(r => r.paint());
    const r = settingsBtn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 10)}px`;
    menu.style.right = `${Math.max(12, Math.round(innerWidth - r.right - 8))}px`;
    menu.classList.toggle('kb-show', open);
    settingsBtn.classList.toggle('kb-on', open);
  });
  menu.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', closeMenu);

  const top = h('header.kb-top', {},
    backBtn,
    h('div.kb-brand', {}, h('img', { src: '../assets/logo.svg', alt: '' }), h('span', {}, 'Kaleido'), h('em', {}, 'Stream')),
    tabBar,
    h('div.kb-top-right', {},
      h('label.kb-search', {}, icon('search', { size: 17 }), search),
      settingsBtn,
      h('button.kb-icon-btn', { type: 'button', title: 'Back to the player (Esc)', onClick: () => shell.toggleStreaming(false) }, icon('mini', { size: 18 })),
      windowButtons(engine)));

  // ----- radio dock -----
  const dockPlay = h('button.kb-dock-play', { type: 'button', title: 'Play or pause', onClick: () => engine.toggle() }, icon('pause', { size: 20 }));
  const dockArt = h('div.kb-dock-art');
  const dockName = h('div.kb-dock-name');
  const dockSub = h('div.kb-dock-sub');
  const dock = h('div.kb-dock', {},
    dockArt,
    h('div.kb-dock-text', {}, dockName, dockSub),
    h('div.kb-dock-btns', {},
      dockPlay,
      h('button.kb-icon-btn', { type: 'button', title: 'Stop', onClick: () => { engine.stop(); setRadio(null); } }, icon('stop', { size: 18 })),
      h('button.kb-icon-btn', { type: 'button', title: 'Open the player', onClick: () => shell.toggleStreaming(false) }, icon('expand', { size: 18 }))));

  let radioPending = false;
  function setRadio(st) {
    radioNow = st;
    radioPending = !!st;
    dock.classList.toggle('kb-show', !!st);
    page.querySelectorAll('.kb-station').forEach(t => t.classList.toggle('kb-on', !!st && t.dataset.id === st.id));
    if (!st) return;
    dockArt.replaceChildren(logoBox(st.favicon, st.name, 'kb-dock-logo'));
    dockName.textContent = st.name;
    dockSub.replaceChildren(h('span.kb-live', {}, 'LIVE'), [st.country, st.bitrate ? `${st.bitrate} kbps` : ''].filter(Boolean).join(' · '));
  }
  const playChannel = ch => { setRadio(null); engine.openUrl(ch.url); shell.toggleStreaming(false); };
  const playStation = st => { engine.openUrl(st.url); setRadio(st); };
  const offEngine = engine.on('change', (s, keys) => {
    if (radioNow) {
      // VLC opens the stream asynchronously, so the old item is still current for a moment.
      if (s.item && s.item.path === radioNow.url) radioPending = false;
      else if (!radioPending) return setRadio(null);
    }
    if (keys && !keys.has('playing')) return;
    dockPlay.replaceChildren(icon(s.playing ? 'pause' : 'play', { size: 20 }));
    dock.classList.toggle('kb-paused', !s.playing);
  });

  const aurora = h('div.kb-aurora', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const spot = h('div.kb-spot', { 'aria-hidden': 'true' });
  const grain = h('div.kb-grain', { 'aria-hidden': 'true' });
  const pop = h('div.kb-pop');
  const el = h('div.kb-root', { 'data-k-hold': '', class: pref.get('grain', '1') === '1' ? '' : 'kb-plain' }, aurora, spot, scroller, grain, top, menu, dock, pop);
  // A soft light in the current accent follows the pointer across the page.
  let spotFrame = 0;
  let spotX = 0, spotY = 0;
  el.addEventListener('pointermove', e => {
    spotX = e.clientX; spotY = e.clientY;
    if (spotFrame) return;
    spotFrame = requestAnimationFrame(() => {
      spotFrame = 0;
      el.style.setProperty('--mx', `${spotX}px`);
      el.style.setProperty('--my', `${spotY}px`);
    });
  }, { passive: true });
  el.addEventListener('pointerleave', () => el.style.setProperty('--mx', '-999px'));
  let scrollFrame = 0;
  scroller.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const y = scroller.scrollTop;
      el.classList.toggle('kb-scrolled', y > 24);
      if (y < 1200) el.style.setProperty('--kb-scroll', String(y));
    });
  }, { passive: true });

  // ----- hover preview: a resting pointer lifts the card into a bigger, richer card -----
  let popItem = null;
  let popTimer = null;
  let popHideTimer = null;
  let popTrailerTimer = null;
  let popAmb = null;
  let popMute = null;
  function stopPopTrailer() {
    clearTimeout(popTrailerTimer);
    if (popAmb) { popAmb.destroy(); popAmb = null; }
    if (popMute) { popMute.dispose(); popMute = null; }
  }
  function hidePop(instant = false) {
    clearTimeout(popTimer);
    clearTimeout(popHideTimer);
    stopPopTrailer();
    if (!pop.classList.contains('kb-show')) return;
    popItem = null;
    if (instant) { pop.classList.remove('kb-show'); return; }
    const anim = pop.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 160, easing: 'ease-in' });
    anim.onfinish = () => { if (!popItem) pop.classList.remove('kb-show'); };
  }
  function showPop(anchor, item) {
    if (!anchor.isConnected || theater || !visible) return;
    clearTimeout(popHideTimer);
    stopPopTrailer();
    popItem = item;
    const r = anchor.getBoundingClientRect();
    const w = Math.round(clamp(r.width * 1.75, 340, 430));
    const art = h('div.kb-pop-art', { title: 'More info' },
      item.backdrop ? img(sized(item.backdrop, 'w780'), 'kb-pop-img', { lazy: false }) : item.poster ? img(item.poster, 'kb-pop-img.kb-pop-poster', { lazy: false }) : null,
      h('div.kb-pop-shade'));
    const name = h('div.kb-pop-name', {}, item.title);
    art.append(name);
    const facts = meta(star(item.rating), item.year, typeLabel(item.type));
    const genres = h('div.kb-pop-genres');
    const listBtn = h('button.kb-round', { type: 'button' });
    const paintList = on => { listBtn.replaceChildren(icon(on ? 'check' : 'plus', { size: 18 })); listBtn.title = on ? 'Remove from My List' : 'Add to My List'; listBtn.classList.toggle('kb-on', on); };
    paintList(myList.has(item));
    listBtn.addEventListener('click', () => paintList(myList.toggle(item)));
    const more = () => go({ name: 'detail', item }, { from: art, morph: 'backdrop' });
    art.addEventListener('click', more);
    const last = item.type === 'tv' && watched.of(item);
    pop.replaceChildren(art, h('div.kb-pop-body', {},
      h('div.kb-pop-actions', {},
        h('button.kb-round.kb-round-primary', { type: 'button', title: last ? `Resume S${last.season} E${last.episode}` : 'Play', onClick: () => { hidePop(true); resume(item); } }, icon('play', { size: 18 })),
        listBtn,
        last ? h('span.kb-pop-resume', {}, `S${last.season} · E${last.episode}`) : null,
        h('span.kb-pop-spacer'),
        h('button.kb-round', { type: 'button', title: 'More info', onClick: more }, icon('chevronDown', { size: 18 }))),
      facts, genres,
      item.overview ? h('p.kb-pop-overview', {}, item.overview) : null));
    pop.style.width = `${w}px`;
    pop.classList.add('kb-show');
    const ph = pop.offsetHeight;
    const left = clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12);
    const top = clamp(r.top + r.height / 2 - ph / 2, 72, innerHeight - ph - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    // Grow out of the card it came from.
    const dx = r.left + r.width / 2 - (left + w / 2), dy = r.top + r.height / 2 - (top + ph / 2);
    pop.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${(r.width / w).toFixed(3)})` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    detailsOf(item).then(d => {
      if (popItem !== item) return;
      if (d.logo) { const logo = img(d.logo, 'kb-pop-logo', { alt: d.title, lazy: false }); logo.addEventListener('load', () => name.replaceChildren(logo)); }
      facts.replaceWith(meta(star(d.rating), d.year, d.type === 'tv' ? (d.totalSeasons ? `${d.totalSeasons} season${d.totalSeasons > 1 ? 's' : ''}` : 'Series') : runtime(d.runtime)));
      genres.replaceChildren(...(d.genres || []).slice(0, 3).map((g, i) => [i ? h('i.kb-dot') : null, h('span', {}, g)]).flat().filter(Boolean));
      // Rest a moment longer and the card starts playing its trailer.
      if (d.trailer && previewsOn()) {
        stopPopTrailer();
        popTrailerTimer = setTimeout(() => {
          if (popItem !== item) return;
          const mine = popAmb = ambient(d.trailer, {
            onPlay: () => art.classList.add('kb-playing'),
            onProgress: f => art.style.setProperty('--kb-prog', `${(f * 100).toFixed(1)}%`),
            onEnd: () => { if (popAmb === mine) { art.classList.remove('kb-playing'); stopPopTrailer(); } },
            onFail: () => { if (popAmb === mine) { popAmb = null; art.classList.remove('kb-playing'); } },
          });
          popMute = soundButton('.kb-pop-sound');
          art.insertBefore(h('div.kb-pop-reel', {}, mine.el), art.querySelector('.kb-pop-shade'));
          art.append(popMute.el, h('div.kb-pop-prog'));
        }, 650);
      }
    }).catch(() => {});
  }
  onCardPreview = (anchor, item) => {
    clearTimeout(popTimer);
    if (!anchor) { popHideTimer = setTimeout(() => hidePop(), 140); return; }
    // Moving straight onto another card cancels the pending close, or it would cancel this preview.
    clearTimeout(popHideTimer);
    if (popItem && popItem !== item) hidePop();
    popTimer = setTimeout(() => showPop(anchor, item), 750);
  };
  pop.addEventListener('pointerenter', () => { clearTimeout(popHideTimer); if (popItem) onCardHover(popItem.backdrop || popItem.poster); });
  pop.addEventListener('pointerleave', () => { onCardHover(null); popHideTimer = setTimeout(() => hidePop(), 140); });
  // Scrolling closes an open preview; a pending one survives, so arrow-key focus can scroll into place.
  scroller.addEventListener('scroll', () => { if (pop.classList.contains('kb-show')) hidePop(); }, { capture: true, passive: true });
  // The page sets a base palette; hovering a card previews that card's palette over it.
  let basePalette = null;
  let hoverUrl = null;
  let hoverTimer = null;
  const PROPS = [['--kb-amb', 'a'], ['--kb-amb2', 'b'], ['--kb-acc', 'acc'], ['--kb-acc-fg', 'accFg']];
  const paint = p => PROPS.forEach(([prop, k]) => (p ? el.style.setProperty(prop, p[k]) : el.style.removeProperty(prop)));
  const setPalette = p => { basePalette = p; if (!hoverUrl) paint(p); };
  onCardHover = url => {
    clearTimeout(hoverTimer);
    if (!url) {
      hoverTimer = setTimeout(() => { hoverUrl = null; paint(basePalette); }, 260);
      return;
    }
    hoverTimer = setTimeout(() => {
      hoverUrl = url;
      paletteOf(url).then(p => { if (hoverUrl === url && p) paint(p); });
    }, 380);
  };

  let visible = false;
  const onKey = e => {
    if (!visible || theater || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape' && menu.classList.contains('kb-show')) { e.preventDefault(); e.stopPropagation(); closeMenu(); settingsBtn.focus(); return; }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === '/') { e.preventDefault(); e.stopPropagation(); search.focus(); }
    else if (e.key.startsWith('Arrow') && !menu.classList.contains('kb-show')) { if (spatial(e.key.slice(5).toLowerCase())) { e.preventDefault(); e.stopPropagation(); } }
    // M toggles preview sound while a trailer preview is on screen.
    else if ((e.key === 'm' || e.key === 'M') && ambients.length) { e.preventDefault(); e.stopPropagation(); sound.toggle(); }
  };
  document.addEventListener('keydown', onKey, true);

  // ----- arrow keys: move focus to the nearest card, chip or button in that direction -----
  const NAV = '.kb-card, .kb-wide, .kb-genre, .kb-chan, .kb-station, .kb-ep, .kb-chip, .kb-btn, .kb-round:not(.kb-sound), .kb-tab, .kb-seg button';
  function spatial(dir) {
    const cur = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches(NAV) ? document.activeElement : null;
    const all = [...el.querySelectorAll(NAV)].filter(n => !n.closest('.kb-pop, .kb-theater, .kb-menu') && n.offsetParent);
    if (!all.length) return false;
    let best = null;
    if (!cur) {
      // Nothing focused yet: start with the first thing on screen.
      best = all.find(n => { const r = n.getBoundingClientRect(); return r.top >= 60 && r.bottom <= innerHeight && r.left >= 0; }) || all[0];
    } else {
      const a = cur.getBoundingClientRect();
      const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      let score = Infinity;
      for (const n of all) {
        if (n === cur) continue;
        const r = n.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        let main, cross;
        if (dir === 'right' || dir === 'left') {
          main = dir === 'right' ? r.left - a.right + 1 : a.left - r.right + 1;
          // Same row only: the boxes must overlap vertically.
          if (r.bottom <= a.top + 4 || r.top >= a.bottom - 4) continue;
          cross = Math.abs(y - ay);
        } else {
          main = dir === 'down' ? r.top - a.bottom + 1 : a.top - r.bottom + 1;
          if (r.right < 0 || r.left > innerWidth) continue;
          cross = Math.abs(x - ax);
        }
        if (main < -2) continue;
        const sc = main + cross * (dir === 'up' || dir === 'down' ? 0.6 : 2);
        if (sc < score) { score = sc; best = n; }
      }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: best.closest('.kb-top') ? 'nearest' : 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    return true;
  }
  const onVis = () => holdAmbients('hidden', document.hidden);
  document.addEventListener('visibilitychange', onVis);

  // ----- routing -----
  // Page changes cross-fade; opening a title morphs the card it came from into the detail page.
  let firstPaint = null;
  function transition(run, from = null, name = 'kb-morph') {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced || !visible) { hidePop(true); run(); return; }
    if (from) from.style.viewTransitionName = name;
    const vt = document.startViewTransition(() => new Promise(resolve => {
      firstPaint = resolve;
      setTimeout(resolve, 350);
      hidePop(true);
      run();
    }));
    vt.finished.finally(() => {
      firstPaint = null;
      el.querySelectorAll('[style*="view-transition-name"]').forEach(n => { n.style.viewTransitionName = ''; });
    });
  }
  function go(next, { replace = false, from = null, morph = null } = {}) {
    if (!replace) stack.push({ ...route, scroll: scroller.scrollTop });
    route = { tab: route.tab || route.name, ...next, morph: from ? { kind: morph, src: (from.tagName === 'IMG' ? from : from.querySelector('img') || {}).currentSrc || '' } : null };
    transition(() => render(), from, morph === 'backdrop' ? 'kb-morph-bd' : 'kb-morph');
  }
  function back() {
    if (theater) { closeTheater(); return true; }
    if (!stack.length) return false;
    route = stack.pop();
    transition(() => render(route.scroll || 0));
    return true;
  }
  function syncNav() {
    const tab = TABS.some(([id]) => id === route.name) ? route.name : route.tab || 'home';
    let on = null;
    tabEls.forEach(t => { const yes = t.dataset.tab === tab; t.classList.toggle('kb-on', yes); if (yes) on = t; });
    requestAnimationFrame(() => {
      if (!on) return;
      pill.style.width = `${on.offsetWidth}px`;
      pill.style.transform = `translateX(${on.offsetLeft}px)`;
    });
    backBtn.classList.toggle('kb-show', stack.length > 0);
    if (route.name !== 'search' && document.activeElement !== search) search.value = '';
  }

  async function ensureKey() {
    if (await S().tmdb.getKey()) return true;
    const saved = engine.state.settings.tmdbKey;
    if (saved) { await S().tmdb.setKey(saved); return true; }
    return false;
  }

  async function render(scroll = 0) {
    const my = ++token;
    rendered = true;
    cleanups.forEach(f => f());
    cleanups = [];
    syncNav();
    page.className = `kb-page kb-page-${route.name}`;
    scroller.scrollTop = 0;
    el.style.setProperty('--kb-scroll', '0');
    const ctx = {
      alive: () => my === token,
      set: (...nodes) => {
        if (my !== token) return;
        page.replaceChildren(...nodes.flat().filter(Boolean));
        if (firstPaint) { const done = firstPaint; firstPaint = null; done(); }
      },
      cleanup: fn => cleanups.push(fn),
      open: (item, from, morph) => go({ name: 'detail', item }, { from, morph }),
      watch,
      resume,
      palette: p => { if (my === token) setPalette(p); },
      restore: () => { if (my === token && scroll) requestAnimationFrame(() => { scroller.scrollTop = scroll; }); },
    };
    clearTimeout(hoverTimer);
    hoverUrl = null;
    const hasArt = ['home', 'detail', 'anime'].includes(route.name) || (['movies', 'tv'].includes(route.name) && !route.genre);
    if (!hasArt) setPalette(PAGE_PALETTES[route.name] || null);
    if (NEEDS_KEY.has(route.name) && !(await ensureKey())) { if (ctx.alive()) viewKey(ctx, true); return; }
    try { await (VIEWS[route.name] || viewHome)(ctx); }
    catch (err) { if (ctx.alive()) ctx.set(errorState(err)); }
    ctx.restore();
  }

  function errorState(err) {
    const msg = String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const keyProblem = /401|key/i.test(msg);
    return state(keyProblem ? 'settings' : 'info', keyProblem ? 'TMDB did not accept the key' : 'Could not load this', msg,
      btn('primary', 'Try again', null, () => render()),
      keyProblem ? btn('glass', 'Change key', null, () => go({ name: 'key' })) : null);
  }

  // ----- theater: embed sources for films and series -----
  const theaterWin = windowButtons(engine);
  function resume(item) {
    const last = item.type === 'tv' && watched.of(item);
    watch(item, last ? last.season : 1, last ? last.episode : 1);
  }
  async function watch(item, season = 1, episode = 1, count = 0) {
    const isTv = item.type === 'tv';
    watched.add(item, isTv ? season : null, isTv ? episode : null);
    if (isTv && !count) {
      count = await cached(`s:${item.id}:${season}`, () => S().tmdb.seasonDetails(item.id, season)).then(sd => sd.episodes.length, () => 0);
    }
    openTheater({
      title: item.title,
      label: isTv ? `Season ${season} · Episode ${episode}` : [item.year, typeLabel(item.type)].filter(Boolean).join(' · '),
      backdrop: item.backdrop,
      sources: S().providers.check(isTv ? 'tv' : 'movie', item.id, season, episode),
      next: isTv && count && episode < count ? () => watch(item, season, episode + 1, count) : null,
    });
  }
  function trailer(d) {
    openTheater({
      title: d.title, label: 'Trailer', backdrop: d.backdrop, referrer: 'https://www.themoviedb.org/',
      sources: [{ id: 'yt', name: 'YouTube', ok: true, url: `https://www.youtube-nocookie.com/embed/${d.trailer}?autoplay=1&rel=0&modestbranding=1` }],
    });
  }

  // Sources arrive health-checked and ranked; if the one playing fails, fall through to the next.
  function openTheater({ title, label, backdrop, sources: pending, next, referrer }) {
    closeTheater();
    if (engine.state.playing) engine.pause();
    let sources = [];
    let current = -1;
    let watchdog = null;
    let view = null;
    const tried = new Set();
    const stage = h('div.kb-theater-stage');
    const statusText = h('span', {}, 'Finding a source that works on your network');
    const statusSub = h('small');
    const status = h('div.kb-theater-loading.kb-show', {},
      backdrop ? img(sized(backdrop, 'w1280'), 'kb-theater-bg', { lazy: false }) : null,
      h('span.kb-spin'), statusText, statusSub);
    const srcs = h('div.kb-srcs');
    const paint = () => srcs.replaceChildren(...(sources.length < 2 ? [] : [
      h('span.kb-srcs-label', {}, 'Source'),
      ...sources.map((s, j) => h('button.kb-src', {
        type: 'button',
        class: [j === current ? 'kb-on' : '', s.ok === false ? 'kb-down' : s.ok === null ? 'kb-unknown' : ''].filter(Boolean).join(' '),
        title: s.ok === false ? `${s.name}: ${s.reason || 'not working'}` : s.ok === null ? `${s.name}: still checking` : s.ms ? `${s.name}, answered in ${s.ms} ms` : s.name,
        onClick: () => pick(j, true),
      }, h('i.kb-src-dot'), s.name))]));

    const showStatus = (text, sub = '') => { statusText.textContent = text; statusSub.textContent = sub; status.classList.add('kb-show'); };
    function pick(j, manual = false) {
      current = j;
      tried.add(j);
      paint();
      clearTimeout(watchdog);
      showStatus(`Connecting to ${sources[j].name}`, manual ? '' : sources[j].ms ? `Fastest working source, ${sources[j].ms} ms` : '');
      if (manual && sources.length > 1) pref.set('source', sources[j].id);
      if (view) view.remove();
      // A fresh guest per source: src must be set before it attaches (the main process checks it).
      view = document.createElement('webview');
      view.className = 'kb-frame';
      view.setAttribute('partition', 'persist:kaleido-stream');
      if (referrer) view.setAttribute('httpreferrer', referrer);
      view.setAttribute('src', sources[j].url);
      const mineView = view;
      view.addEventListener('did-finish-load', () => { if (mineView !== view) return; clearTimeout(watchdog); setTimeout(() => status.classList.remove('kb-show'), 350); });
      view.addEventListener('did-fail-load', e => { if (mineView === view && e.isMainFrame && e.errorCode !== -3) fail(`${sources[j].name} could not load`); });
      stage.prepend(view);
      watchdog = setTimeout(() => fail(`${sources[j].name} is not responding`), 20000);
    }
    function fail(why) {
      clearTimeout(watchdog);
      if (!theater || current < 0) return;
      sources[current].ok = false;
      sources[current].reason = why;
      const nextIdx = sources.findIndex((s, k) => !tried.has(k) && s.ok !== false);
      if (nextIdx >= 0) { pick(nextIdx); showStatus(`Trying ${sources[nextIdx].name}`, why); return; }
      paint();
      status.classList.add('kb-show');
      status.replaceChildren(
        backdrop ? img(sized(backdrop, 'w1280'), 'kb-theater-bg', { lazy: false }) : null,
        h('div.kb-state-icon', {}, icon('info', { size: 26 })),
        h('span.kb-theater-fail', {}, 'No source could play this right now'),
        h('small', {}, 'They may be blocked on your network or down. Try again later, or a VPN.'),
        h('div.kb-actions', {}, btn('glass', 'Try all again', null, () => { tried.clear(); sources.forEach(s => { s.ok = true; }); status.replaceChildren(h('span.kb-spin'), statusText, statusSub); pick(0); })));
    }

    stage.append(status);
    // Ambient mode: the picture sits inset and the room around it glows with whatever is on screen.
    const ambi = h('div.kb-ambi', { 'aria-hidden': 'true' }, ['t', 'b', 'l', 'r', 'c'].map(k => h(`i.kb-ambi-${k}`)));
    stage.prepend(ambi);
    const ambiBtn = h('button.kb-icon-btn.kb-ambi-btn', { type: 'button' }, icon('sun', { size: 18 }));
    const setAmbient = on => {
      pref.set('ambient', on ? '1' : '0');
      theater.classList.toggle('kb-ambient', on);
      ambiBtn.classList.toggle('kb-on', on);
      ambiBtn.title = on ? 'Ambient mode on' : 'Ambient mode off';
    };
    ambiBtn.addEventListener('click', () => setAmbient(!theater.classList.contains('kb-ambient')));
    let sampling = false;
    const sampler = setInterval(async () => {
      if (sampling || !view || !theater || !theater.classList.contains('kb-ambient') || status.classList.contains('kb-show') || document.hidden) return;
      let id;
      try { id = view.getWebContentsId(); } catch { return; }
      sampling = true;
      const c = await S().sample(id).catch(() => null);
      sampling = false;
      if (!c) return;
      ambi.classList.toggle('kb-dim', !!c.dark);
      if (c.dark) return;
      for (const k of ['t', 'b', 'l', 'r', 'c']) ambi.querySelector(`.kb-ambi-${k}`).style.backgroundColor = glow(c[k]);
    }, 240);
    theater = h('div.kb-theater', {},
      h('header.kb-theater-bar', {},
        h('button.kb-icon-btn', { type: 'button', title: 'Close (Esc)', onClick: closeTheater }, icon('chevronLeft', { size: 20 })),
        h('div.kb-theater-title', {}, h('strong', {}, title), h('span', {}, label)),
        srcs,
        next ? h('button.kb-btn.kb-btn-glass.kb-btn-sm', { type: 'button', onClick: next }, 'Next episode', icon('next', { size: 16 })) : null,
        ambiBtn,
        theaterWin),
      stage);
    theater.stopSampling = () => clearInterval(sampler);
    setAmbient(pref.get('ambient', '1') === '1');
    el.append(theater);
    holdAmbients('theater', true);
    hidePop(true);
    const mine = theater;

    Promise.resolve(pending).then(list => {
      if (theater !== mine) return;
      sources = list;
      const saved = pref.get('source', '');
      let j = sources.findIndex(s => s.id === saved && s.ok !== false);
      if (j < 0) j = sources.findIndex(s => s.ok !== false);
      pick(j < 0 ? 0 : j);
    }).catch(err => { if (theater === mine) showStatus('Could not check sources', String(err.message || err)); });
  }
  function closeTheater() {
    if (!theater) return;
    if (theater.stopSampling) theater.stopSampling();
    theater.querySelectorAll('webview').forEach(v => v.remove());
    theater.remove();
    theater = null;
    holdAmbients('theater', false);
  }
  S().onEscape(() => { if (theater) closeTheater(); });

  // ----- views -----
  async function viewHome(c) {
    c.set(skelHero(), h('div.kb-shelves', {}, skelShelf(), skelShelf()));
    const [trending, movies, shows, top, genres] = await Promise.all([
      cached('trending', () => S().tmdb.trending('all', 'week', 1)),
      cached('pop:movie', () => S().tmdb.popular('movie', 1)),
      cached('pop:tv', () => S().tmdb.popular('tv', 1)),
      cached('top:movie', () => S().tmdb.topRated('movie', 1)),
      cached('g:movie', () => S().tmdb.genres('movie')).catch(() => []),
    ]);
    if (!c.alive()) return;
    const t = trending.results;
    const recent = watched.all();
    const list = myList.all();
    const surprise = () => {
      const b = h('button.kb-round.kb-round-lg.kb-dice', { type: 'button', title: 'Surprise me' }, icon('shuffle', { size: 20 }));
      b.addEventListener('click', () => {
        const seen = new Set(recent.map(e => `${e.item.type}:${e.item.id}`));
        const pool = [...t, ...movies.results, ...shows.results, ...top.results].filter(it => it.backdrop && !seen.has(`${it.type}:${it.id}`));
        const pick = pool[Math.floor(Math.random() * pool.length)];
        b.classList.add('kb-rolling');
        if (pick) setTimeout(() => c.open(pick), 420);
      });
      return b;
    };
    c.set(hero(t, c, 'Trending this week', surprise),
      h('div.kb-shelves', {},
        shelf('Continue watching', recent, e => resumeCard(e, c.resume, it => watched.remove(it)), { sub: 'Pick up where you left off' }),
        shelf('Top 10 this week', t.slice(0, 10), (it, i) => posterCard(it, c.open, { rank: i + 1 }), { cls: 'kb-track-ranked' }),
        shelf('My List', list, it => posterCard(it, c.open)),
        shelf('Popular films', movies.results, it => posterCard(it, c.open)),
        shelf('Binge-worthy series', shows.results, it => wideCard(it, c.open)),
        shelf('Browse by genre', genres, (g, i) => genreTile(g, i, x => go({ name: 'movies', genre: x.id })), { cls: 'kb-track-genres' }),
        shelf('Critically acclaimed', top.results, it => posterCard(it, c.open)),
        shelf('Also trending', t.slice(10), it => wideCard(it, c.open))));
  }

  async function viewCatalog(c, type) {
    const isTv = type === 'tv';
    const name = isTv ? 'tv' : 'movies';
    const genre = route.genre || null;
    const head = h('div.kb-head', {}, h('h1', {}, isTv ? 'Shows' : 'Movies'), h('p', {}, isTv ? 'Series airing now, all-time favourites and everything in between.' : 'New releases, crowd favourites and the classics.'));
    const chips = h('div.kb-chiprow');
    c.set(head, h('div.kb-toolbar', {}, chips), genre ? skelGrid() : [skelShelf(), skelShelf()]);
    const genres = await cached(`g:${type}`, () => S().tmdb.genres(type));
    if (!c.alive()) return;
    chips.replaceChildren(chip('Everything', !genre, () => go({ name }, { replace: true })),
      ...genres.map(g => chip(g.name, genre === g.id, () => go({ name, genre: g.id }, { replace: true }))));
    const toolbar = h('div.kb-toolbar', {}, chips);

    if (!genre) {
      const [a, b, top] = await Promise.all(isTv
        ? [cached('air:tv', () => S().tmdb.airingToday(1)), cached('pop:tv', () => S().tmdb.popular('tv', 1)), cached('top:tv', () => S().tmdb.topRated('tv', 1))]
        : [cached('now:movie', () => S().tmdb.nowPlaying(1)), cached('pop:movie', () => S().tmdb.popular('movie', 1)), cached('top:movie', () => S().tmdb.topRated('movie', 1))]);
      if (!c.alive()) return;
      c.set(hero(b.results, c, isTv ? 'Popular series' : 'Popular films'), h('div.kb-shelves', {}, toolbar,
        shelf(isTv ? 'Airing today' : 'In cinemas now', a.results, it => wideCard(it, c.open)),
        shelf(isTv ? 'Popular series' : 'Popular films', b.results, it => posterCard(it, c.open)),
        shelf('Top rated', top.results, it => posterCard(it, c.open))));
      return;
    }

    const grid = h('div.kb-grid');
    const sentinel = h('div.kb-sentinel', {}, h('span.kb-spin'));
    c.set(head, toolbar, grid, sentinel);
    let pageNo = 0;
    let total = 1;
    let busy = false;
    const more = async () => {
      if (busy || pageNo >= total) return;
      busy = true;
      const data = await S().tmdb.discover(type, { with_genres: genre, page: pageNo + 1, 'vote_count.gte': 50 });
      busy = false;
      if (!c.alive()) return;
      pageNo = data.page;
      total = Math.min(data.totalPages, 30);
      grid.append(...data.results.map(it => posterCard(it, c.open)));
      if (pageNo >= total) sentinel.remove();
    };
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more().catch(() => {}); }, { root: scroller, rootMargin: '600px' });
    io.observe(sentinel);
    c.cleanup(() => io.disconnect());
    await more();
  }

  async function viewAnime(c) {
    c.set(skelHero(), h('div.kb-shelves', {}, skelShelf(), skelShelf('kb-skel-wide')));
    const d = S().tmdb.discover;
    const recent = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const [popular, top, films, fresh] = await Promise.all([
      cached('anime:pop', () => d('tv', { ...ANIME, sort_by: 'popularity.desc' })),
      cached('anime:top', () => d('tv', { ...ANIME, sort_by: 'vote_average.desc', 'vote_count.gte': 300 })),
      cached('anime:films', () => d('movie', { ...ANIME, sort_by: 'popularity.desc' })),
      cached('anime:new', () => d('tv', { ...ANIME, sort_by: 'popularity.desc', 'first_air_date.gte': recent })),
    ]);
    if (!c.alive()) return;
    c.set(hero(popular.results, c, 'Popular anime'), h('div.kb-shelves', {},
      shelf('New this season', fresh.results, it => wideCard(it, c.open)),
      shelf('Top 10 anime', popular.results.slice(0, 10), (it, i) => posterCard(it, c.open, { rank: i + 1 }), { cls: 'kb-track-ranked' }),
      shelf('All-time greats', top.results, it => posterCard(it, c.open)),
      shelf('Anime films', films.results, it => posterCard(it, c.open))));
  }

  async function viewSearch(c) {
    const q = route.q;
    const summary = h('p', {}, 'Searching films, series, live channels and radio...');
    const section = (title, skeleton) => {
      const body = h('div.kb-search-body', {}, skeleton);
      const el = h('section.kb-search-sec', {}, h('header.kb-section-head', {}, h('h2', {}, title), h('span.kb-count')), body);
      return { el, body, count: el.querySelector('.kb-count') };
    };
    const media = section('Films & series', skelGrid(6));
    const live = section('Live channels', skelTiles(4));
    const radio = section('Radio stations', skelTiles(4));
    c.set(h('div.kb-head', {}, h('h1', {}, `“${q}”`), summary), media.el, live.el, radio.el);

    const fill = (sec, items, render, wrap) => {
      if (!c.alive()) return 0;
      if (!items.length) { sec.el.remove(); return 0; }
      sec.count.textContent = String(items.length);
      sec.body.replaceChildren(wrap(items.map(render)));
      return items.length;
    };
    const hasKey = await ensureKey();
    const jobs = [
      (hasKey ? S().tmdb.search(q, 1).then(d => d.results) : Promise.resolve([])).then(items => {
        if (items[0] && c.alive()) paletteOf(items[0].backdrop || items[0].poster).then(c.palette);
        return fill(media, items, it => posterCard(it, c.open), cards => h('div.kb-grid', {}, cards));
      }),
      S().iptv.search(q, 24).then(items => fill(live, items, ch => channelTile(ch, playChannel), tiles => h('div.kb-tiles', {}, tiles))),
      S().radio.search(q, { limit: 24 }).then(items => fill(radio, items, st => stationTile(st, playStation, radioNow && radioNow.id === st.id), tiles => h('div.kb-tiles', {}, tiles))),
    ].map(p => p.catch(() => 0));
    const counts = await Promise.all(jobs);
    if (!c.alive()) return;
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) { c.set(state('search', `Nothing found for “${q}”`, 'Try a different spelling, the original title, or a channel or station name.')); return; }
    summary.textContent = [counts[0] && `${counts[0]} titles`, counts[1] && `${counts[1]} channels`, counts[2] && `${counts[2]} stations`].filter(Boolean).join(' · ');
  }

  async function viewDetail(c) {
    const item = route.item;
    // When arriving from a card, start from the exact (already cached) image that card showed so the
    // morph has something to land on, then swap in the full-size art.
    const morph = route.morph;
    route.morph = null;
    const upgrade = (node, full) => { if (!node || !full || node.src === full) return; const pre = new Image(); pre.onload = () => { node.src = full; }; pre.src = full; };
    const bgFrom = morph && morph.kind === 'backdrop' && morph.src;
    const bg = item.backdrop ? img(bgFrom || item.backdrop, 'kb-detail-bg', { lazy: false, fade: !bgFrom }) : null;
    // The faded container morphs, not the bare image, so the backdrop keeps its soft edge in flight.
    const reel = h('div.kb-hero-reel');
    const visual = h('div.kb-visual', {}, bg, reel, h('div.kb-detail-fade'));
    if (bg && bgFrom) { visual.style.viewTransitionName = 'kb-morph-bd'; upgrade(bg, item.backdrop); }
    const posterFrom = morph && morph.kind === 'poster' && morph.src;
    const posterEl = item.poster ? img(posterFrom || item.poster, 'kb-detail-poster', { lazy: false, fade: !posterFrom }) : null;
    if (posterEl && posterFrom) posterEl.style.viewTransitionName = 'kb-morph';
    c.set(h('section.kb-detail-hero', {},
      visual,
      h('div.kb-detail-body', {}, posterEl, h('div.kb-detail-info', {}, skel('kb-skel-logo'), skel('kb-skel-line'), skel('kb-skel-line'), skel('kb-skel-line.kb-short')))));
    paletteOf(item.backdrop || item.poster).then(p => c.palette(p));
    const d = await detailsOf(item);
    if (!c.alive()) return;
    const isTv = d.type === 'tv';
    const seasons = isTv ? d.seasons.filter(s => s.number > 0 && s.episodes > 0) : [];
    const last = isTv ? watched.of(d) : null;
    let season = route.season || (last && last.season) || (seasons[0] && seasons[0].number) || 1;

    const title = h('h1.kb-detail-title', {}, d.title);
    let heading = title;
    if (d.logo) {
      heading = img(d.logo, 'kb-detail-logo', { alt: d.title, lazy: false });
      heading.addEventListener('error', () => heading.replaceWith(title));
    }
    const director = (d.crew || []).find(p => p.job === 'Director');
    const credits = [
      director && ['Director', director.name],
      isTv && d.networks && d.networks.length && ['Network', d.networks.slice(0, 2).join(', ')],
      d.cast && d.cast.length && ['Starring', d.cast.slice(0, 3).map(p => p.name).join(', ')],
    ].filter(Boolean);

    let playEp = last && last.season === season ? last.episode : 1;
    const epLabel = () => `${last && last.season === season && last.episode === playEp ? 'Resume' : 'Play'} S${season} E${playEp}`;
    const playBtn = btn('primary', isTv ? epLabel() : 'Play', 'play', () => watch(d, season, playEp, (seasons.find(s => s.number === season) || {}).episodes || 0));
    const listBtn = btn('glass', '', null, () => paintList(myList.toggle(d)));
    const paintList = on => { listBtn.replaceChildren(icon(on ? 'check' : 'plus', { size: 20 }), on ? 'In My List' : 'My List'); listBtn.classList.toggle('kb-on', on); };
    paintList(myList.has(d));
    // Keep the same backdrop node: it may still be mid-morph.
    if (!bg && d.backdrop) visual.prepend(img(d.backdrop, 'kb-detail-bg', { lazy: false }));
    const mute = soundButton('.kb-detail-sound');
    const body = h('section.kb-detail-hero', {},
      visual,
      h('div.kb-detail-body', {},
        posterEl || (d.poster ? img(d.poster, 'kb-detail-poster', { lazy: false }) : null),
        h('div.kb-detail-info.kb-enter', {},
          h('div.kb-kicker', {}, typeLabel(d.type), d.status && d.status !== 'Released' ? h('span.kb-badge.kb-badge-dim', {}, d.status) : null),
          heading,
          d.tagline ? h('p.kb-tagline', {}, d.tagline) : null,
          meta(star(d.rating), d.year, isTv ? `${d.totalSeasons} season${d.totalSeasons === 1 ? '' : 's'}` : runtime(d.runtime), d.language ? d.language.toUpperCase() : null),
          d.genres && d.genres.length ? h('div.kb-tags', {}, d.genres.map(g => h('span.kb-tag', {}, g))) : null,
          d.overview ? h('p.kb-overview', {}, d.overview) : null,
          h('div.kb-actions', {}, playBtn, d.trailer ? btn('glass', 'Trailer', 'frame', () => trailer(d)) : null, listBtn, mute.el),
          credits.length ? h('dl.kb-credits', {}, credits.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null)));

    const parts = [body];
    // The trailer quietly takes over the backdrop after a moment, pausing whenever it scrolls away.
    let amb = null;
    const trailerTimer = d.trailer && previewsOn() ? setTimeout(() => {
      if (!c.alive()) return;
      amb = ambient(d.trailer, {
        onPlay: () => body.classList.add('kb-playing'),
        onEnd: () => body.classList.remove('kb-playing'),
        onFail: () => { amb = null; body.classList.remove('kb-playing'); },
      });
      reel.replaceChildren(amb.el);
      amb.hold('offscreen', offscreen);
    }, 3200) : null;
    let offscreen = false;
    const io = new IntersectionObserver(([e]) => { offscreen = e.intersectionRatio < 0.35; if (amb) amb.hold('offscreen', offscreen); }, { threshold: [0, 0.35, 1] });
    io.observe(body);
    c.cleanup(() => { clearTimeout(trailerTimer); if (amb) amb.destroy(); io.disconnect(); mute.dispose(); });

    if (isTv && seasons.length) {
      const eps = h('div.kb-eps');
      const select = h('div.kb-chiprow');
      const loadSeason = async n => {
        season = n;
        route.season = n;
        playEp = last && last.season === n ? last.episode : 1;
        playBtn.lastChild.textContent = epLabel();
        select.querySelectorAll('.kb-chip').forEach(b => b.classList.toggle('kb-on', Number(b.dataset.n) === n));
        eps.replaceChildren(...Array.from({ length: 6 }, () => skel('kb-skel-ep')));
        const sd = await cached(`s:${d.id}:${n}`, () => S().tmdb.seasonDetails(d.id, n));
        if (!c.alive() || season !== n) return;
        eps.replaceChildren(...sd.episodes.map(ep => h('button.kb-ep', { type: 'button', class: last && last.season === n && last.episode === ep.number ? 'kb-ep-last' : '', onClick: () => watch(d, n, ep.number, sd.episodes.length) },
          h('div.kb-ep-art', {},
            last && last.season === n && last.episode === ep.number ? h('span.kb-ep-badge', {}, 'Last watched') : null,
            ep.still ? img(ep.still, 'kb-ep-img') : d.backdrop ? img(sized(d.backdrop, 'w780'), 'kb-ep-img.kb-ep-dim') : null,
            h('span.kb-ep-num', {}, String(ep.number)),
            h('span.kb-ep-play', {}, icon('play', { size: 22 })),
            ep.runtime ? h('span.kb-ep-time', {}, runtime(ep.runtime)) : null),
          h('div.kb-ep-title', {}, ep.name),
          h('div.kb-ep-meta', {}, [ep.date ? new Date(ep.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '', ep.rating ? `★ ${ep.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')),
          ep.overview ? h('p.kb-ep-desc', {}, ep.overview) : null)));
      };
      select.append(...seasons.map(s => {
        const b = chip(s.name, s.number === season, () => loadSeason(s.number));
        b.dataset.n = s.number;
        return b;
      }));
      parts.push(h('section.kb-section', {}, h('header.kb-section-head', {}, h('h2', {}, 'Episodes')), select, eps));
      loadSeason(season).catch(() => {});
    }

    if (d.cast && d.cast.length) {
      parts.push(shelf('Cast', d.cast.slice(0, 16), p => h('div.kb-person', {},
        p.photo ? img(p.photo, 'kb-person-img') : h('div.kb-person-img.kb-person-none', {}, initials(p.name)),
        h('div.kb-person-name', {}, p.name),
        h('div.kb-person-role', {}, p.character || ''))));
    }
    const more = (d.recommendations && d.recommendations.length ? d.recommendations : d.similar) || [];
    parts.push(shelf('More like this', more, it => posterCard(it, c.open)));
    c.set(...parts);
  }

  async function viewLive(c) {
    const mode = route.mode || 'category';
    const key = route.key || (mode === 'category' ? 'general' : 'us');
    const [cats, countries] = await Promise.all([cached('iptv:cats', () => S().iptv.categories()), cached('iptv:countries', () => S().iptv.countries())]);
    if (!c.alive()) return;
    const list = mode === 'category' ? cats : countries;
    const filter = h('input', { type: 'search', placeholder: 'Filter channels', spellcheck: 'false', value: route.q || '' });
    const toolbar = h('div.kb-toolbar', {},
      h('div.kb-toolbar-row', {},
        h('div.kb-seg', {},
          h('button', { type: 'button', class: mode === 'category' ? 'kb-on' : '', onClick: () => go({ name: 'live', mode: 'category' }, { replace: true }) }, 'Categories'),
          h('button', { type: 'button', class: mode === 'country' ? 'kb-on' : '', onClick: () => go({ name: 'live', mode: 'country' }, { replace: true }) }, 'Countries')),
        h('label.kb-field', {}, icon('search', { size: 16 }), filter)),
      h('div.kb-chiprow', {}, list.map(x => chip(x.name, x.id === key, () => go({ name: 'live', mode, key: x.id }, { replace: true })))));
    const head = h('div.kb-head', {}, h('h1', {}, 'Live TV'), h('p', {}, 'Free, public channels from around the world. Plays in Kaleido.'));
    c.set(head, toolbar, skelTiles());
    const channels = await cached(`iptv:${mode}:${key}`, () => (mode === 'category' ? S().iptv.byCategory(key) : S().iptv.byCountry(key)));
    if (!c.alive()) return;

    const grid = h('div.kb-tiles');
    const moreBtn = h('div.kb-more');
    const count = h('span.kb-count');
    let shown = PAGE_TILES;
    const play = playChannel;
    const draw = () => {
      const needle = filter.value.trim().toLowerCase();
      const hits = needle ? channels.filter(ch => `${ch.name} ${ch.group}`.toLowerCase().includes(needle)) : channels;
      grid.replaceChildren(...hits.slice(0, shown).map(ch => channelTile(ch, play)));
      moreBtn.replaceChildren(hits.length > shown ? btn('glass', `Show more (${hits.length - shown})`, null, () => { shown += PAGE_TILES; draw(); }) : '');
      count.textContent = `${hits.length.toLocaleString()} channel${hits.length === 1 ? '' : 's'}`;
    };
    let t = null;
    filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { route.q = filter.value; shown = PAGE_TILES; draw(); }, 150); });
    filter.addEventListener('keydown', e => e.stopPropagation());
    head.querySelector('p').append(' ', count);
    c.set(head, toolbar, channels.length ? [grid, moreBtn] : state('frame', 'No channels here', 'This list is empty right now. Try another category.'));
    draw();
  }

  async function viewRadio(c) {
    const f = route.filter || 'top';
    const q = route.q || '';
    const head = h('div.kb-head', {}, h('h1', {}, 'Radio'), h('p', {}, 'Thousands of live stations, from radio-browser.info. Keep browsing while you listen.'));
    const input = h('input', { type: 'search', placeholder: 'Find a station', spellcheck: 'false', value: q });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') go({ name: 'radio', q: input.value.trim(), filter: input.value.trim() ? 'search' : 'top' }, { replace: true });
    });
    const chips = h('div.kb-chiprow');
    const toolbar = h('div.kb-toolbar', {}, h('div.kb-toolbar-row', {}, h('label.kb-field', {}, icon('search', { size: 16 }), input)), chips);
    c.set(head, toolbar, skelTiles());
    const [tags, stations] = await Promise.all([
      cached('radio:tags', () => S().radio.tags(30)),
      cached(`radio:${f}:${q}`, () => (f === 'search' ? S().radio.search(q, { limit: 90 }) : f === 'top' ? S().radio.top(90) : f === 'popular' ? S().radio.popular(90) : S().radio.byTag(f, 90))),
    ]);
    if (!c.alive()) return;
    const pick = id => () => go({ name: 'radio', filter: id }, { replace: true });
    chips.replaceChildren(
      chip('Top voted', f === 'top', pick('top')),
      chip('Most played', f === 'popular', pick('popular')),
      ...tags.slice(0, 18).map(t => chip(t.name, f === t.name, pick(t.name))));
    const play = playStation;
    c.set(head, toolbar, stations.length
      ? h('div.kb-tiles', {}, stations.map(st => stationTile(st, play, radioNow && radioNow.id === st.id)))
      : state('music', 'No stations found', 'Try another name or genre.'));
  }

  function viewKey(c, gate = false) {
    const input = h('input.kb-key-input', { type: 'text', placeholder: 'Paste your TMDB API key', spellcheck: 'false', autocomplete: 'off' });
    const error = h('div.kb-key-error');
    S().tmdb.getKey().then(k => { if (k && !input.value) input.value = k; });
    const save = async () => {
      const key = input.value.trim();
      if (!key) { error.textContent = 'Paste a key first.'; return; }
      error.textContent = '';
      saveBtn.disabled = true;
      await S().tmdb.setKey(key);
      try {
        await S().tmdb.trending('all', 'day', 1);
        engine.saveSettings({ tmdbKey: key });
        memo.clear();
        stack.length = 0;
        route = { name: gate && route.name !== 'key' ? route.name : 'home' };
        render();
      } catch {
        error.textContent = 'That key did not work. Use the "API Key" (v3), not the read access token.';
        saveBtn.disabled = false;
      }
    };
    const saveBtn = btn('primary', 'Connect', null, save);
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(); });
    c.set(h('div.kb-key', {}, h('div.kb-key-card', {},
      h('div.kb-state-icon', {}, icon('frame', { size: 28 })),
      h('h1', {}, gate ? 'One step to films and series' : 'TMDB key'),
      h('p.kb-key-lead', {}, 'Kaleido uses The Movie Database for posters, titles and episode lists. The key is free.'),
      h('ol.kb-steps', {},
        h('li', {}, 'Make a free account at themoviedb.org'),
        h('li', {}, 'Open Settings, then API, and request a developer key'),
        h('li', {}, 'Copy the “API Key” and paste it here')),
      h('label.kb-field.kb-field-lg', {}, icon('link', { size: 16 }), input),
      error,
      h('div.kb-actions', {}, saveBtn),
      h('p.kb-key-alt', {}, 'Live TV and Radio work without a key. ',
        h('button.kb-link', { type: 'button', onClick: () => { stack.length = 0; route = { name: 'live' }; render(); } }, 'Open Live TV'), ' or ',
        h('button.kb-link', { type: 'button', onClick: () => { stack.length = 0; route = { name: 'radio' }; render(); } }, 'Radio'), '.'))));
    input.focus();
  }

  const VIEWS = {
    home: viewHome,
    anime: viewAnime,
    movies: c => viewCatalog(c, 'movie'),
    tv: c => viewCatalog(c, 'tv'),
    search: viewSearch,
    detail: viewDetail,
    live: viewLive,
    radio: viewRadio,
    key: c => viewKey(c),
  };

  return {
    el,
    show() { visible = true; holdAmbients('away', false); if (!rendered || !page.childElementCount) render(); else render(scroller.scrollTop); },
    hide() { visible = false; holdAmbients('away', true); hidePop(true); closeTheater(); cleanups.forEach(f => f()); cleanups = []; token++; },
    back,
    render,
    destroy() { clearTimeout(searchTimer); offEngine(); closeTheater(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVis); document.removeEventListener('click', closeMenu); },
  };
}
