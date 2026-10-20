// Shared UI kit. Skins compose these and restyle them; none of them assume a layout.
import { fmt, ASPECTS, RATES, DEINTERLACE } from './engine.js';

// ---------- DOM helper ----------
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- icons (24px grid, stroke based, inherit currentColor) ----------
const P = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  prev: '<path d="M19 5v14L9 12z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>',
  forward: '<path d="M12 5a7 7 0 1 1-7 7"/><path d="M12 2v6l4-3z" fill="currentColor"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="700">10</text>',
  rewind: '<path d="M12 5a7 7 0 1 0 7 7"/><path d="M12 2v6L8 5z" fill="currentColor"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="700">10</text>',
  volume: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeLow: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  exitFullscreen: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  subtitles: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 11h4M13 11h4M7 15h7M16 15h1"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  playlist: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M16 14v6l5-3z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<rect x="5" y="8" width="11" height="11" rx="1.5"/><path d="M8 5h9.5A1.5 1.5 0 0 1 19 6.5V16"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
  speed: '<path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 12l4.5-3.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  repeatOne: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11.5 10.5l1.5-1v5"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>',
  eq: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="14" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="18" cy="16" r="2" fill="currentColor"/>',
  video: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M10 11.5v5l4-2.5z" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  chapter: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 10h6M9 14h6"/>',
  frame: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z" fill="currentColor"/><path d="M7 5v14M17 5v14"/>',
  aspect: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10V9h2M17 14v1h-2"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M11 8.5v5M8.5 11h5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  queue: '<path d="M4 6h16M4 12h10M4 18h10"/><path d="M18 14v8M14 18h8"/>',
  skin: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.6-1.4-.6-2.2c0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="10.5" cy="7" r="1.3" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.3" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  grip: '<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  chevronUp: '<path d="M5 15l7-7 7 7"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="17.5" cy="16" r="2.5" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  skip: '<path d="M5 5v14l8-7z" fill="currentColor"/><path d="M13 5v14l8-7z" fill="currentColor"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  expand: '<path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7"/>',
};
export const icons = Object.keys(P);
export function icon(name, { size = 24, stroke = 1.8, cls = '' } = {}) {
  const span = document.createElement('span');
  span.className = `k-icon ${cls}`.trim();
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.more}</svg>`;
  return span;
}
export function button(iconName, title, onClick, { cls = '', label = null, size } = {}) {
  return h(`button.k-btn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', title, 'aria-label': title, onClick: e => { e.stopPropagation(); onClick(e); } },
    iconName ? icon(iconName, { size }) : null, label ? h('span.k-btn-label', {}, label) : null);
}
export function setIcon(btn, name) {
  const old = btn.querySelector('.k-icon');
  if (old && old.dataset.name !== name) { const n = icon(name); n.dataset.name = name; old.replaceWith(n); }
}

// ---------- subscription helper that cleans up with a component ----------
function bind(engine, el, fn, { time = false } = {}) {
  const offs = [engine.on('change', (s, keys) => fn(s, keys))];
  if (time) offs.push(engine.on('time', s => fn(s, new Set(['time']))));
  fn(engine.state, null);
  const prev = el.destroy;
  el.destroy = () => { offs.forEach(o => o()); prev && prev(); };
  return el;
}

// ---------- seek bar ----------
export function seekbar(engine, { preview = true, chapters = true, liveSeek = true, previewWidth = 200 } = {}) {
  const fill = h('div.k-seek-fill');
  const buffer = h('div.k-seek-buffer');
  const loop = h('div.k-seek-loop');
  const handle = h('div.k-seek-handle');
  const marks = h('div.k-seek-chapters');
  const hoverFill = h('div.k-seek-hover');
  const img = h('img.k-seek-thumb', { alt: '' });
  const pTime = h('div.k-seek-ptime');
  const pChap = h('div.k-seek-pchapter');
  const pop = h('div.k-seek-preview', { style: { width: previewWidth + 'px' } }, img, h('div.k-seek-pmeta', {}, pChap, pTime));
  const track = h('div.k-seek-track', {}, buffer, hoverFill, loop, fill, marks);
  const el = h('div.k-seek', { role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'data-k-hold': '' }, track, handle, preview ? pop : null);
  let dragging = false;
  let hoverReq = 0;
  let lastLive = 0;

  const ratioAt = x => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  const render = t => {
    const d = engine.state.duration || 0;
    const p = d ? Math.min(1, t / d) : 0;
    fill.style.width = `${p * 100}%`;
    handle.style.left = `${p * 100}%`;
    el.setAttribute('aria-valuenow', Math.round(t));
    el.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(d)}`);
  };
  const showPreview = x => {
    const d = engine.state.duration;
    if (!d) return;
    const p = ratioAt(x);
    const t = p * d;
    hoverFill.style.width = `${p * 100}%`;
    pTime.textContent = fmt(t);
    const ch = engine.state.chapters.filter(c => c.time <= t).pop();
    pChap.textContent = chapters && ch ? ch.name : '';
    if (!preview) return;
    const r = track.getBoundingClientRect();
    const half = previewWidth / 2;
    pop.style.left = `${Math.max(half - r.left, Math.min(p * r.width, window.innerWidth - r.left - half))}px`;
    el.classList.add('k-previewing');
    const id = ++hoverReq;
    engine.thumb(t).then(url => {
      if (id !== hoverReq) return;
      if (url) { img.src = url; pop.classList.add('k-has-thumb'); } else pop.classList.remove('k-has-thumb');
    });
  };
  el.addEventListener('pointermove', e => showPreview(e.clientX));
  el.addEventListener('pointerleave', () => { if (!dragging) { el.classList.remove('k-previewing'); hoverFill.style.width = '0'; } });
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !engine.state.duration) return;
    e.stopPropagation();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('k-dragging');
    render(ratioAt(e.clientX) * engine.state.duration);
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const t = ratioAt(e.clientX) * engine.state.duration;
    render(t);
    if (liveSeek && performance.now() - lastLive > 140) { lastLive = performance.now(); engine.seek(t); }
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('k-dragging');
    engine.seek(ratioAt(e.clientX) * engine.state.duration);
    if (!el.matches(':hover')) el.classList.remove('k-previewing');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => e.stopPropagation());
  el.addEventListener('dblclick', e => e.stopPropagation());

  return bind(engine, el, (s, keys) => {
    if (!dragging) render(s.time);
    if (!keys || keys.has('chapters') || keys.has('duration') || keys.has('marks')) {
      const at = t => `${(t / s.duration) * 100}%`;
      marks.replaceChildren(
        ...(chapters && s.duration ? s.chapters.filter(c => c.time > 0.5).map(c => h('i.k-seek-chapter', { style: { left: at(c.time) }, title: c.name })) : []),
        ...(s.duration ? (s.marks || []).map(m => h('i.k-seek-mark', { style: { left: at(m.t) }, title: `Bookmark ${fmt(m.t)}` })) : []));
    }
    if (!keys || keys.has('loopA') || keys.has('loopB') || keys.has('duration')) {
      const on = s.loopA != null && s.duration;
      loop.style.display = on ? '' : 'none';
      if (on) {
        loop.style.left = `${(s.loopA / s.duration) * 100}%`;
        loop.style.width = `${(((s.loopB ?? s.time) - s.loopA) / s.duration) * 100}%`;
      }
    }
    if (!keys || keys.has('buffering')) buffer.style.width = s.buffering >= 100 || !s.item ? '100%' : `${s.buffering}%`;
    el.classList.toggle('k-disabled', !s.duration);
  }, { time: true });
}

// ---------- generic slider ----------
export function slider({ min = 0, max = 1, step = 0.01, value = 0, onInput, vertical = false, cls = '', label = '', marks = [], wheelStep } = {}) {
  const fill = h('div.k-slider-fill');
  const knob = h('div.k-slider-knob');
  const markEls = marks.map(m => h('i.k-slider-mark', { style: { [vertical ? 'bottom' : 'left']: `${((m - min) / (max - min)) * 100}%` } }));
  const el = h(`div.k-slider${vertical ? '.k-vertical' : ''}${cls ? '.' + cls : ''}`, { role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, 'data-k-hold': '' },
    h('div.k-slider-track', {}, fill, ...markEls), knob);
  let v = value;
  let dragging = false;
  const clamp = x => Math.max(min, Math.min(max, Math.round(x / step) * step));
  const paint = () => {
    const p = ((v - min) / (max - min)) * 100;
    if (vertical) { fill.style.height = `${p}%`; knob.style.bottom = `${p}%`; }
    else { fill.style.width = `${p}%`; knob.style.left = `${p}%`; }
    el.setAttribute('aria-valuenow', String(Math.round(v * 100) / 100));
  };
  const fromPointer = e => {
    const r = el.getBoundingClientRect();
    const p = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return clamp(min + Math.max(0, Math.min(1, p)) * (max - min));
  };
  const commit = nv => { nv = clamp(nv); if (nv !== v) { v = nv; paint(); onInput && onInput(v); } };
  el.addEventListener('pointerdown', e => { e.stopPropagation(); dragging = true; el.setPointerCapture(e.pointerId); el.classList.add('k-dragging'); commit(fromPointer(e)); });
  el.addEventListener('pointermove', e => { if (dragging) commit(fromPointer(e)); });
  el.addEventListener('pointerup', () => { dragging = false; el.classList.remove('k-dragging'); });
  el.addEventListener('click', e => e.stopPropagation());
  el.addEventListener('dblclick', e => e.stopPropagation());
  el.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); commit(v + (e.deltaY < 0 ? 1 : -1) * (wheelStep || step)); }, { passive: false });
  el.addEventListener('keydown', e => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); commit(v + d * (wheelStep || step)); }
  });
  el.setValue = nv => { if (!dragging) { v = clamp(nv); paint(); } };
  paint();
  return el;
}

// Mute button plus 0 to 200 percent slider (VLC's boost range), with a tick at 100.
export function volume(engine, { vertical = false, showValue = false } = {}) {
  const btn = button('volume', 'Mute (M)', () => engine.toggleMute(), { cls: 'k-vol-btn' });
  const value = h('span.k-vol-value');
  const s = slider({ min: 0, max: 200, step: 1, wheelStep: 5, vertical, label: 'Volume', marks: [100], cls: 'k-vol-slider', onInput: v => engine.setVolume(v) });
  const el = h('div.k-volume', { 'data-k-hold': '' }, btn, s, showValue ? value : null);
  return bind(engine, el, st => {
    s.setValue(st.muted ? 0 : st.volume);
    setIcon(btn, st.muted || st.volume === 0 ? 'mute' : st.volume < 60 ? 'volumeLow' : 'volume');
    value.textContent = st.muted ? 'Muted' : `${st.volume}%`;
    el.classList.toggle('k-boost', !st.muted && st.volume > 100);
  });
}

export function timeLabel(engine, { remaining = false, frames = false } = {}) {
  const el = h('span.k-time', { title: 'Click to switch between elapsed and remaining' });
  let rem = remaining;
  el.addEventListener('click', e => { e.stopPropagation(); rem = !rem; });
  return bind(engine, el, s => {
    const fps = frames && s.video ? Math.round(s.video.fps) : 0;
    const cur = rem && s.duration ? `-${fmt(Math.max(0, s.duration - s.time), { frames: fps })}` : fmt(s.time, { frames: fps });
    el.textContent = s.item ? `${cur} / ${fmt(s.duration, { frames: fps })}` : '0:00 / 0:00';
  }, { time: true });
}

export function toggleSwitch(label, get, onChange, { hint = '' } = {}) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!get();
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label.k-switch', { 'data-k-hold': '' }, input, h('span.k-switch-ui'), h('span.k-switch-label', {}, label, hint ? h('small', {}, hint) : null));
  el.sync = () => { input.checked = !!get(); };
  return el;
}

// ---------- popover menus ----------
let openMenu = null;
export function closeMenus() { if (openMenu) openMenu.close(); }
export const menuOpen = () => !!openMenu;

export function menu(anchor, items, { align = 'auto', cls = '', parent = null } = {}) {
  if (!parent) closeMenus();
  const el = h(`div.k-menu${cls ? '.' + cls : ''}`, { role: 'menu', 'data-k-hold': '' });
  let sub = null;
  const close = () => {
    if (sub) sub.close();
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    if (!parent && openMenu && openMenu.el === el) openMenu = null;
  };
  const closeAll = () => { let m = api; while (m.parentApi) m = m.parentApi; m.close(); };
  const rows = [];
  for (const it of items.filter(Boolean)) {
    if (it.heading) { el.append(h('div.k-menu-heading', {}, it.heading)); continue; }
    const row = h('button.k-menu-item', { type: 'button', role: 'menuitem', disabled: it.disabled },
      h('span.k-menu-check', {}, it.checked ? icon('check', { size: 16 }) : it.icon ? icon(it.icon, { size: 16 }) : null),
      h('span.k-menu-label', {}, it.label),
      it.hint ? h('span.k-menu-hint', {}, it.hint) : null,
      it.items ? icon('chevronRight', { size: 14, cls: 'k-menu-arrow' }) : null);
    if (it.checked) row.classList.add('k-checked');
    const openSub = () => {
      if (sub) sub.close();
      sub = menu(row, typeof it.items === 'function' ? it.items() : it.items, { parent: api, align: 'side' });
    };
    row.addEventListener('click', e => {
      e.stopPropagation();
      if (it.items) return openSub();
      closeAll();
      it.onSelect && it.onSelect();
    });
    row.addEventListener('pointerenter', () => { row.focus({ preventScroll: true }); if (it.items) openSub(); else if (sub) { sub.close(); sub = null; } });
    rows.push(row);
    el.append(row);
  }
  document.body.append(el);
  const a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const m = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x, y;
  if (align === 'side') { x = a.right + 4; y = a.top - 6; if (x + m.width > vw - 8) x = a.left - m.width - 4; }
  else {
    x = Math.min(a.left, vw - m.width - 8);
    y = a.top - m.height - 8 > 8 && (align === 'up' || (align === 'auto' && a.top > vh / 2)) ? a.top - m.height - 8 : a.bottom + 8;
  }
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, Math.min(y, vh - m.height - 8))}px`;
  const outside = e => { if (!el.contains(e.target) && !(sub && sub.el.contains(e.target)) && !parent) close(); };
  const keys = e => {
    if (parent && sub) return;
    const i = rows.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const n = rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
      n && n.focus();
    } else if (e.key === 'ArrowRight' && i >= 0 && items.filter(x => x && !x.heading)[i].items) { e.preventDefault(); e.stopPropagation(); rows[i].click(); }
    else if (e.key === 'ArrowLeft' && parent) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); e.stopPropagation(); rows[i].click(); }
  };
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true); });
  const api = { el, close, parentApi: parent };
  if (!parent) openMenu = api;
  return api;
}

export const menus = {
  audio: e => {
    const s = e.state;
    return [
      { heading: 'Audio track' },
      ...(s.audioTracks.length ? s.audioTracks.map(t => ({ label: t.name, checked: t.id === s.audioTrack, onSelect: () => e.setAudioTrack(t.id) })) : [{ label: 'No audio tracks', disabled: true }]),
      { heading: 'Sound' },
      { label: 'Night mode', hint: 'D', checked: s.nightMode, onSelect: () => e.toggleNightMode() },
      { label: 'Equalizer preset', items: () => menus.eqPresets(e) },
      { label: 'Audio delay', items: () => [-200, -100, -50, 0, 50, 100, 200].map(d => ({ label: d === 0 ? 'In sync' : `${d > 0 ? '+' : ''}${d} ms`, checked: s.audioDelay === d, onSelect: () => e.setAudioDelay(d) })) },
    ];
  },
  subtitles: e => {
    const s = e.state;
    return [
      { heading: 'Subtitles' },
      { label: 'Off', checked: s.subtitleTrack === -1, onSelect: () => e.setSubtitleTrack(-1) },
      ...s.subtitleTracks.map(t => ({ label: t.name, checked: t.id === s.subtitleTrack, onSelect: () => e.setSubtitleTrack(t.id) })),
      { label: 'Add subtitle file', icon: 'plus', onSelect: () => e.openSubtitleDialog() },
      { label: 'What did they say?', icon: 'rewind', hint: 'W', onSelect: () => e.whatDidTheySay() },
      { label: 'Search what they say', icon: 'search', hint: '/', onSelect: () => (window.kaleido ? window.kaleido.shell.searchDialogue() : null) },
      { heading: 'Timing and size' },
      { label: 'Delay', hint: 'G and H', items: () => [-1000, -500, -250, -100, 0, 100, 250, 500, 1000].map(d => ({ label: d === 0 ? 'In sync' : `${d > 0 ? '+' : ''}${d} ms`, checked: s.subtitleDelay === d, onSelect: () => e.setSubtitleDelay(d) })) },
      { label: 'Size', items: () => [60, 80, 100, 125, 150, 200].map(p => ({ label: `${p}%`, checked: s.subtitleScale === p, onSelect: () => e.setSubtitleScale(p) })) },
    ];
  },
  speed: e => RATES.map(r => ({ label: r === 1 ? 'Normal' : `${r}x`, checked: e.state.rate === r, onSelect: () => e.setRate(r) })),
  aspect: e => ASPECTS.map(a => ({ label: { auto: 'Original', fill: 'Stretch to fill', crop: 'Crop to fill' }[a] || a, checked: e.state.aspect === a, onSelect: () => e.setAspect(a) })),
  zoom: e => [0.5, 0.75, 1, 1.25, 1.5, 2].map(z => ({ label: `${z * 100}%`, checked: e.state.zoom === z, onSelect: () => e.setZoom(z) })),
  chapters: e => (e.state.chapters.length ? e.state.chapters.map((c, i) => ({ label: c.name || `Chapter ${i + 1}`, hint: fmt(c.time), checked: i === e.state.chapter, onSelect: () => e.setChapter(i) })) : [{ label: 'No chapters', disabled: true }]),
  eqPresets: e => [
    { label: 'Off', checked: !e.state.eq.enabled, onSelect: () => e.setEq({ enabled: false }) },
    ...e.state.eqPresets.map(p => ({ label: p.name, checked: e.state.eq.enabled && e.state.eq.preset === p.index, onSelect: () => e.applyEqPreset(p.index) })),
  ],
  deinterlace: e => DEINTERLACE.map(m => ({ label: m || 'Automatic', checked: e.state.deinterlace === m, onSelect: () => e.setDeinterlace(m) })),
  visualizer: e => [['', 'Album art only'], ['spectrum', 'Spectrum'], ['spectrometer', 'Spectrometer'], ['scope', 'Oscilloscope'], ['vuMeter', 'VU meter'], ['goom', 'Goom']]
    .map(([v, label]) => ({ label, checked: (e.state.settings.visualizer || '') === v, onSelect: () => e.setVisualizer(v) })),
  recent: e => (e.state.recent.length ? e.state.recent.slice(0, 12).map(r => ({ label: r.title || r.name, hint: r.time && r.duration ? `${Math.round((r.time / r.duration) * 100)}%` : '', onSelect: () => e.open([r.path]) })) : [{ label: 'Nothing yet', disabled: true }]),
  main: (e, shell) => {
    const s = e.state;
    return [
      { label: 'Open files', icon: 'file', hint: 'Ctrl+O', onSelect: () => e.openDialog() },
      { label: 'Open folder', icon: 'folder', hint: 'Ctrl+F', onSelect: () => e.openFolderDialog() },
      { label: 'Open network stream', icon: 'link', hint: 'Ctrl+N', onSelect: () => shell.openUrlDialog() },
      { label: 'Recent', icon: 'history', items: () => menus.recent(e) },
      s.item && { heading: 'Playback' },
      s.item && { label: 'Audio', items: () => menus.audio(e) },
      s.item && { label: 'Subtitles', items: () => menus.subtitles(e) },
      s.item && { label: 'Speed', hint: `${s.rate}x`, items: () => menus.speed(e) },
      s.item && s.chapters.length > 0 && { label: 'Chapters', items: () => menus.chapters(e) },
      s.item && { label: 'Aspect ratio', hint: 'A', items: () => menus.aspect(e) },
      s.item && { label: 'Zoom', hint: 'Z', items: () => menus.zoom(e) },
      s.item && { label: 'Deinterlace', items: () => menus.deinterlace(e) },
      s.item && { label: 'Take snapshot', icon: 'camera', hint: 'Shift+S', onSelect: () => e.screenshot() },
      s.item && { label: s.loopA != null && s.loopB != null ? 'Save the loop as a clip' : 'Save the last 30 seconds', icon: 'frame', hint: 'C', onSelect: () => e.saveClip() },
      s.item && { label: 'Skip silence', checked: !!s.settings.skipSilence, onSelect: () => e.toggleSkipSilence() },
      s.item && { label: s.loopA == null ? 'Set loop start' : s.loopB == null ? 'Set loop end' : 'Clear loop', icon: 'loop', hint: 'X', onSelect: () => e.cycleLoop() },
      { heading: 'Window' },
      { label: 'Fullscreen', checked: s.fullscreen, hint: 'F', onSelect: () => e.toggleFullscreen() },
      { label: 'Always on top', checked: s.alwaysOnTop, hint: 'Ctrl+T', onSelect: () => e.toggleAlwaysOnTop() },
      { label: 'Pause when the PC locks', checked: s.settings.pauseOnLock !== false, onSelect: () => e.togglePauseOnLock() },
      { label: 'Picture in picture', icon: 'pip', hint: 'Ctrl+P', onSelect: () => e.togglePip() },
      { heading: 'Kaleido' },
      { label: 'Templates', icon: 'skin', hint: 'Ctrl+,', onSelect: () => shell.openSkinPicker() },
      { label: s.view === 'library' ? 'Back to the player' : 'Library', icon: 'folder', hint: 'Ctrl+B', onSelect: () => e.showLibrary(s.view !== 'library') },
      { label: 'Command palette', icon: 'search', hint: 'Ctrl+K', onSelect: () => shell.openPalette() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onSelect: () => shell.showShortcuts() },
    ];
  },
};

// ---------- panels (live views that skins can dock anywhere) ----------
export const panels = {
  playlist(engine, { thumbs = false } = {}) {
    const list = h('div.k-pl-list');
    const el = h('div.k-panel.k-pl', { 'data-k-hold': '' }, list);
    let dragFrom = -1;
    const row = (it, i, s) => {
      const r = h('div.k-pl-row', { draggable: 'true', title: it.path, class: i === s.index ? 'k-current' : '' },
        h('span.k-pl-num', {}, i === s.index && s.playing ? icon('volume', { size: 14 }) : String(i + 1)),
        h('span.k-pl-name', {}, it.name.replace(/\.[a-z0-9]{2,4}$/i, '')),
        h('button.k-pl-remove', { type: 'button', title: 'Remove', onClick: ev => { ev.stopPropagation(); engine.removeIndex(i); } }, icon('close', { size: 14 })));
      r.addEventListener('dblclick', ev => { ev.stopPropagation(); engine.playIndex(i); });
      r.addEventListener('click', ev => { ev.stopPropagation(); if (i !== s.index) engine.playIndex(i); });
      r.addEventListener('dragstart', ev => { dragFrom = i; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(i)); });
      r.addEventListener('dragover', ev => { if (dragFrom >= 0) { ev.preventDefault(); r.classList.add('k-drop-target'); } });
      r.addEventListener('dragleave', () => r.classList.remove('k-drop-target'));
      r.addEventListener('drop', ev => { ev.preventDefault(); ev.stopPropagation(); r.classList.remove('k-drop-target'); if (dragFrom >= 0 && dragFrom !== i) engine.moveItem(dragFrom, i); dragFrom = -1; });
      if (thumbs) {
        const img = h('img.k-pl-thumb', { alt: '', loading: 'lazy' });
        engine.poster(it.path, 30).then(u => { if (u) img.src = u; });
        r.prepend(img);
      }
      return r;
    };
    return bind(engine, el, (s, keys) => {
      if (keys && !keys.has('playlist') && !keys.has('index') && !keys.has('playing')) return;
      list.replaceChildren(...(s.playlist.length ? s.playlist.map((it, i) => row(it, i, s)) : [h('div.k-empty', {}, 'The queue is empty. Drop files or a folder anywhere.')]));
      const cur = list.querySelector('.k-current');
      if (cur && (!keys || keys.has('index'))) cur.scrollIntoView({ block: 'nearest' });
    });
  },

  eq(engine, { vertical = true } = {}) {
    const presets = h('select.k-select', { title: 'VLC equalizer presets' });
    const enabled = toggleSwitch('Equalizer', () => engine.state.eq.enabled, v => engine.setEq({ enabled: v }));
    const pre = slider({ min: -20, max: 20, step: 0.5, vertical, label: 'Preamp', cls: 'k-eq-band', onInput: v => engine.setEq({ preamp: v, enabled: true, preset: -1 }) });
    const bandSliders = Array.from({ length: 10 }, (_, i) => slider({
      min: -20, max: 20, step: 0.5, vertical, label: `Band ${i + 1}`, cls: 'k-eq-band', marks: [0],
      onInput: v => { const bands = [...engine.state.eq.bands]; bands[i] = v; engine.setEq({ bands, enabled: true, preset: -1 }); },
    }));
    const freqLabel = f => (f >= 1000 ? `${Math.round(f / 100) / 10}k` : `${Math.round(f)}`);
    const labels = bandSliders.map(() => h('span.k-eq-freq'));
    presets.addEventListener('change', () => engine.applyEqPreset(Number(presets.value)));
    const bands = h('div.k-eq-bands', {},
      h('div.k-eq-col.k-eq-pre', {}, pre, h('span.k-eq-freq', {}, 'Pre')),
      bandSliders.map((s, i) => h('div.k-eq-col', {}, s, labels[i])));
    const el = h('div.k-panel.k-eq', { 'data-k-hold': '' }, h('div.k-eq-top', {}, enabled, presets), bands);
    return bind(engine, el, (s, keys) => {
      if (keys && !keys.has('eq') && !keys.has('eqPresets') && !keys.has('eqBands')) return;
      if (!keys || keys.has('eqPresets')) presets.replaceChildren(h('option', { value: '-1' }, 'Custom'), ...s.eqPresets.map(p => h('option', { value: String(p.index) }, p.name)));
      presets.value = String(s.eq.enabled ? s.eq.preset : -1);
      enabled.sync();
      pre.setValue(s.eq.preamp);
      bandSliders.forEach((b, i) => b.setValue(s.eq.bands[i] || 0));
      s.eqBands.forEach((f, i) => { if (labels[i]) labels[i].textContent = freqLabel(f); });
      el.classList.toggle('k-off', !s.eq.enabled);
    });
  },

  adjust(engine) {
    const defs = [['brightness', 'Brightness', 0, 2, 1], ['contrast', 'Contrast', 0, 2, 1], ['saturation', 'Saturation', 0, 3, 1], ['hue', 'Hue', -180, 180, 0], ['gamma', 'Gamma', 0.01, 3, 1]];
    const rows = defs.map(([key, label, min, max]) => {
      const val = h('span.k-row-value');
      const s = slider({ min, max, step: key === 'hue' ? 1 : 0.01, label, marks: [key === 'hue' ? 0 : 1], onInput: v => engine.setAdjust({ [key]: v }) });
      return { key, val, s, el: h('div.k-row', {}, h('span.k-row-label', {}, label), s, val) };
    });
    const deint = h('select.k-select');
    DEINTERLACE.forEach(m => deint.append(h('option', { value: m }, m || 'Automatic')));
    deint.addEventListener('change', () => engine.setDeinterlace(deint.value));
    const reset = h('button.k-btn.k-text-btn', { type: 'button', onClick: () => engine.resetAdjust() }, 'Reset picture');
    const el = h('div.k-panel.k-adjust', { 'data-k-hold': '' }, rows.map(r => r.el), h('div.k-row', {}, h('span.k-row-label', {}, 'Deinterlace'), deint), reset);
    return bind(engine, el, (s, keys) => {
      if (keys && !keys.has('adjust') && !keys.has('deinterlace')) return;
      rows.forEach(r => { r.s.setValue(s.adjust[r.key]); r.val.textContent = r.key === 'hue' ? `${Math.round(s.adjust.hue)}°` : s.adjust[r.key].toFixed(2); });
      deint.value = s.deinterlace;
    });
  },

  sync(engine) {
    const mk = (label, get, setFn, by, range, step) => {
      const val = h('span.k-row-value');
      const s = slider({ min: -range, max: range, step, label, marks: [0], onInput: v => setFn(v) });
      const row = h('div.k-row.k-sync-row', {}, h('span.k-row-label', {}, label),
        button('chevronLeft', `${label} earlier`, () => by(-step)), s, button('chevronRight', `${label} later`, () => by(step)), val);
      return { row, update: st => { s.setValue(get(st)); val.textContent = `${get(st)} ms`; } };
    };
    const a = mk('Audio delay', st => st.audioDelay, v => engine.setAudioDelay(v), d => engine.audioDelayBy(d), 2000, 50);
    const sub = mk('Subtitle delay', st => st.subtitleDelay, v => engine.setSubtitleDelay(v), d => engine.subtitleDelayBy(d), 5000, 50);
    const size = slider({ min: 50, max: 250, step: 5, label: 'Subtitle size', marks: [100] });
    let sizeTimer;
    const sizeVal = h('span.k-row-value');
    size.addEventListener('pointerup', () => { clearTimeout(sizeTimer); sizeTimer = setTimeout(() => engine.setSubtitleScale(Number(size.getAttribute('aria-valuenow'))), 150); });
    const el = h('div.k-panel.k-sync', { 'data-k-hold': '' }, a.row, sub.row, h('div.k-row', {}, h('span.k-row-label', {}, 'Subtitle size'), size, sizeVal));
    return bind(engine, el, s => { a.update(s); sub.update(s); size.setValue(s.subtitleScale); sizeVal.textContent = `${s.subtitleScale}%`; });
  },

  tracks(engine) {
    const audio = h('div.k-tracks-col');
    const subs = h('div.k-tracks-col');
    const el = h('div.k-panel.k-tracks', { 'data-k-hold': '' }, h('div', {}, h('h4', {}, 'Audio'), audio), h('div', {}, h('h4', {}, 'Subtitles'), subs));
    const opt = (label, on, fn) => h('button.k-track', { type: 'button', class: on ? 'k-checked' : '', onClick: e => { e.stopPropagation(); fn(); } }, on ? icon('check', { size: 16 }) : h('span.k-icon-gap'), label);
    return bind(engine, el, (s, keys) => {
      if (keys && !['audioTracks', 'audioTrack', 'subtitleTracks', 'subtitleTrack'].some(k => keys.has(k))) return;
      audio.replaceChildren(...(s.audioTracks.length ? s.audioTracks.map(t => opt(t.name, t.id === s.audioTrack, () => engine.setAudioTrack(t.id))) : [h('div.k-empty', {}, 'No audio')]));
      subs.replaceChildren(opt('Off', s.subtitleTrack === -1, () => engine.setSubtitleTrack(-1)),
        ...s.subtitleTracks.map(t => opt(t.name, t.id === s.subtitleTrack, () => engine.setSubtitleTrack(t.id))),
        h('button.k-track.k-add', { type: 'button', onClick: e => { e.stopPropagation(); engine.openSubtitleDialog(); } }, icon('plus', { size: 16 }), 'Add file'));
    });
  },

  info(engine) {
    const body = h('div.k-info-grid');
    const el = h('div.k-panel.k-info', { 'data-k-hold': '' }, body);
    const kb = n => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
    let stat = null;
    let statFor = null;
    return bind(engine, el, (s, keys) => {
      if (keys && !['video', 'audioInfo', 'item', 'duration', 'meta', 'version'].some(k => keys.has(k))) return;
      if (s.item && statFor !== s.item.path) { statFor = s.item.path; window.host.stat(s.item.path).then(r => { stat = r; engine.set({ meta: { ...s.meta } }); }); }
      const v = s.video;
      const rows = [
        ['File', s.item ? s.item.name : 'Nothing playing'],
        s.meta.title && ['Title', s.meta.title], s.meta.artist && ['Artist', s.meta.artist], s.meta.album && ['Album', s.meta.album],
        ['Duration', fmt(s.duration)], stat && ['Size', kb(stat.size)],
        v && ['Video', `${v.codec.toUpperCase()}  ${v.width} x ${v.height}  ${v.fps ? v.fps.toFixed(3).replace(/\.?0+$/, '') + ' fps' : ''}`],
        v && v.sar !== 1 && ['Pixel aspect', v.sar.toFixed(3)],
        ...s.audioInfo.map((a, i) => [`Audio ${i + 1}`, `${a.codec.toUpperCase()}  ${a.channels} ch  ${(a.rate / 1000).toFixed(1)} kHz${a.language ? '  ' + a.language : ''}`]),
        ['Engine', s.version ? `libVLC ${s.version}` : 'connecting'],
      ].filter(Boolean);
      body.replaceChildren(...rows.flatMap(([k, val]) => [h('span.k-info-key', {}, k), h('span.k-info-val', {}, val)]));
    });
  },
};

export function windowButtons(engine) {
  const max = button('maximize', 'Maximize', () => window.host.win.toggleMaximize(), { cls: 'k-win-max' });
  const el = h('div.k-winbtns', {},
    button('minimize', 'Minimize', () => window.host.win.minimize(), { cls: 'k-win-min' }),
    max,
    button('close', 'Close', () => window.host.win.close(), { cls: 'k-win-close' }));
  return bind(engine, el, s => setIcon(max, s.maximized ? 'restore' : 'maximize'));
}

// Poster image for a recent entry, captured near where the viewer stopped.
export function poster(engine, entry, cls = 'k-poster') {
  const img = h(`img.${cls}`, { alt: '', loading: 'lazy', draggable: 'false' });
  const t = entry.time || (entry.duration ? entry.duration * 0.2 : 60);
  engine.poster(entry.path, t).then(u => { if (u) { img.src = u; img.classList.add('k-loaded'); } });
  return img;
}

// Live, heavily downscaled copy of the picture for ambient glows and backdrops.
export function ambient(engine, { fps = 12, w = 48, h = 27, cls = 'k-ambient' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h; c.className = cls;
  const ctx = c.getContext('2d');
  let last = 0;
  let raf = 0;
  const loop = now => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / fps || !c.isConnected) return;
    last = now;
    if (engine.surface.hasFrame) ctx.drawImage(engine.canvas, 0, 0, w, h);
  };
  raf = requestAnimationFrame(loop);
  c.destroy = () => cancelAnimationFrame(raf);
  return c;
}
export const rgb = (c, a = 1) => (c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : `rgba(128, 128, 128, ${a})`);

export { fmt, bind };
