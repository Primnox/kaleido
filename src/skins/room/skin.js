// The room: the film is the only thing lit, and your cursor is a small light.
// Nothing on screen is lit on its own; things appear as much as your hand is near them.
// Shaped around four moments: holding it, remembering a scene, coming back, and the end.

const SPEEDS = [[0.5, 'half speed'], [0.75, 'a bit slower'], [1, 'as it was made'], [1.25, 'a bit faster'], [1.5, 'faster'], [2, 'double speed']];
const LOUD = [[30, 'quiet'], [60, 'soft'], [100, 'full'], [130, 'louder'], [160, 'much louder'], [200, 'as loud as it goes']];
const SYNC = [[-1000, 'a second sooner'], [-500, 'half a second sooner'], [-150, 'a bit sooner'], [0, 'in time'], [150, 'a bit later'], [500, 'half a second later'], [1000, 'a second later']];
const COLOURS = [['as they were', {}], ['warmer', { hue: -10, saturation: 1.12 }], ['cooler', { hue: 12, saturation: 0.95 }], ['richer', { saturation: 1.45, contrast: 1.06 }], ['faded', { saturation: 0.6, contrast: 0.9 }], ['black and white', { saturation: 0 }]];
const SHAPES = [['auto', 'as it was made'], ['crop', 'fill the screen'], ['fill', 'stretched'], ['16:9', '16 by 9'], ['4:3', '4 by 3'], ['2.39:1', 'cinema wide']];
const ONCE = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times'];
const SLOTS = [[70, 12, 19, -2], [80, 46, 15, 2], [4, 7, 14, 1.5], [5, 66, 17, -1], [58, 74, 14, 1], [86, 76, 11, -2], [44, 3, 12, -1], [26, 82, 12, 2], [89, 9, 9, 1], [48, 88, 9, -1.5], [18, 4, 9, -2], [92, 56, 8, 1]];

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pretty = name => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
const nearest = (list, v) => list.reduce((best, x, i) => (Math.abs(x[0] - v) < Math.abs(list[best][0] - v) ? i : best), 0);
function span(t) {
  t = Math.max(0, Math.round(t));
  if (t < 60) return plural(t, 'second');
  const hr = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  if (!hr) return plural(m, 'minute');
  return m ? `${plural(hr, 'hour')} ${plural(m, 'minute')}` : plural(hr, 'hour');
}
function where(f) {
  if (f < 0.05) return 'Right at the start.';
  if (f < 0.25) return 'Early on.';
  if (f < 0.45) return 'A little before the middle.';
  if (f < 0.56) return 'Around the middle.';
  if (f < 0.72) return 'A little past the middle.';
  if (f < 0.9) return 'Well past the middle.';
  return 'Near the end.';
}
function behind(f) {
  if (f < 0.1) return 'just getting started';
  if (f < 0.4) return 'less than half behind you';
  if (f < 0.6) return 'about half behind you';
  if (f < 0.9) return 'more than half behind you';
  return 'nearly done';
}
function trackLabel(name) {
  const lang = /\[([^\]]+)\]/.exec(name);
  const rest = name.replace(/^Track\s*\d+\s*-?\s*/i, '').replace(/\s*-?\s*\[[^\]]+\]\s*/, '').trim();
  if (lang) return rest ? `${rest}, ${lang[1]}` : lang[1];
  return rest || name.toLowerCase();
}

export default {
  options: { osd: false, contextMenu: false, wheelVolume: false, idleDelay: 2600 },

  mount({ root, stage, engine, ui, shell, on }) {
    const { h } = ui;
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const titleOf = it => (it && it.title && !/^track\s*\d*$/i.test(it.title) ? it.title : pretty(it && it.name));
    const words = (cls, text) => h(`span.${cls}`, {}, text);

    // ---------- the room and the light you carry ----------
    const lamp = h('div.rm-lamp');
    const light = h('div.rm-light');
    const layer = h('div.rm-layer');
    const moments = h('div.rm-moments', { 'data-k-hold': '' });
    const whisper = h('div.rm-whisper');
    const halo = h('div.rm-halo', {}, h('span'));
    const winWord = (label, fn) => {
      const el = h('button.rm-win', { type: 'button', 'data-near': '' }, label);
      el.addEventListener('click', e => { e.stopPropagation(); fn(); });
      return el;
    };
    const fsWord = winWord('full screen', () => engine.toggleFullscreen());
    const top = h('div.rm-top', {}, winWord('hide', () => window.host.win.minimize()), winWord('bigger', () => window.host.win.toggleMaximize()), fsWord, winWord('close', () => window.host.win.close()));
    const room = h('div.rm', {}, lamp, stage, moments, layer, halo, whisper, top, light);
    root.append(room);

    let mx = W() / 2, my = H() / 2;
    let nearRaf = 0;
    // Everything marked data-near is revealed (and sharpened) by how close the light is.
    function nearPass() {
      nearRaf = 0;
      light.style.transform = `translate(${mx}px, ${my}px)`;
      for (const el of room.querySelectorAll('[data-near]')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const dx = Math.max(r.left - mx, 0, mx - r.right);
        const dy = Math.max(r.top - my, 0, my - r.bottom);
        const reach = Number(el.dataset.near) || 260;
        el.style.setProperty('--near', Math.max(0, 1 - Math.hypot(dx, dy) / reach).toFixed(3));
      }
      const fromBottom = (my - H() * 0.62) / (H() * 0.3);
      const low = Math.max(0, Math.min(1, fromBottom));
      moments.style.setProperty('--low', low.toFixed(3));
      moments.classList.toggle('rm-live', low > 0.15);
      moments.style.setProperty('--mx', `${mx}px`);
    }
    const queueNear = () => { if (!nearRaf) nearRaf = requestAnimationFrame(nearPass); };
    const onMove = e => { mx = e.clientX; my = e.clientY; queueNear(); };
    document.addEventListener('pointermove', onMove);

    // ---------- where the picture sits: the whole room, a photograph on the table, or small at the end ----------
    let placed = 'full';
    const aspect = () => { const v = engine.state.video; return v && v.width ? (v.width * (v.sar || 1)) / v.height : 16 / 9; };
    function place(mode) {
      placed = mode;
      const ar = aspect();
      let r;
      if (mode === 'held') {
        let w = W() * 0.5, hh = w / ar;
        if (hh > H() * 0.56) { hh = H() * 0.56; w = hh * ar; }
        r = { l: W() * 0.57 - w / 2, t: H() * 0.43 - hh / 2, w, h: hh, rot: -1.4 };
      } else if (mode === 'end') {
        let w = W() * 0.38, hh = w / ar;
        if (hh > H() * 0.38) { hh = H() * 0.38; w = hh * ar; }
        r = { l: (W() - w) / 2, t: H() * 0.08, w, h: hh, rot: 0 };
      } else if (mode === 'away') {
        r = { l: W() * 0.1, t: H() * 0.1, w: W() * 0.8, h: H() * 0.8, rot: 0 };
      } else r = { l: 0, t: 0, w: W(), h: H(), rot: 0 };
      Object.assign(stage.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px`, transform: `rotate(${r.rot}deg)` });
      for (const [k, v] of [['--pl', r.l], ['--pt', r.t], ['--pw', r.w], ['--ph', r.h]]) room.style.setProperty(k, `${Math.round(v)}px`);
      stage.classList.toggle('rm-photo', mode === 'held' || mode === 'end');
    }
    const onResize = () => place(placed);
    window.addEventListener('resize', onResize);

    // ---------- the film's own moments, under your hand when it drifts low ----------
    let momentKey = '';
    function renderMoments(s) {
      if (!s.item || s.item.isAudio || !s.duration || !s.thumbs) { moments.replaceChildren(); momentKey = ''; return; }
      const step = Math.max(4, s.duration / 60);
      const c = Math.round(s.time / step);
      const key = `${s.item.path}|${c}`;
      if (key === momentKey) return;
      momentKey = key;
      moments.replaceChildren(...Array.from({ length: 9 }, (_, k) => {
        const t = (c + k - 4) * step;
        if (t < 0 || t > s.duration - 1) return h('i.rm-m.rm-gap');
        const img = h('img', { alt: '' });
        engine.thumbAt(s.item.path, t, 200).then(u => { if (u) img.src = u; });
        const m = h('button.rm-m', { type: 'button', class: k === 4 ? 'rm-now' : '', title: span(t) + ' in' }, img);
        m.addEventListener('click', e => { e.stopPropagation(); engine.seek(t); });
        return m;
      }));
    }

    // ---------- hold to stop, pull and push to move through time ----------
    const reel = h('div.rm-reel');
    const reelRow = h('div.rm-reel-row');
    const reelSay = h('div.rm-reel-say');
    const dotsL = h('div.rm-dots.rm-dots-l');
    const dotsR = h('div.rm-dots.rm-dots-r');
    reel.append(reelRow, reelSay, dotsL, dotsR);
    room.append(reel);
    let press = null;
    let swallowClick = false;
    function reelAt(t) {
      const s = engine.state;
      const step = Math.max(2, s.duration / 150);
      const c = Math.round(t / step);
      if (reel.dataset.c !== String(c)) {
        reel.dataset.c = String(c);
        reelRow.replaceChildren(...[-3, -2, -1, 0, 1, 2, 3].map(k => {
          const tt = (c + k) * step;
          const cls = k === 0 ? 'rm-r0' : Math.abs(k) === 1 ? 'rm-r1' : 'rm-r2';
          if (tt < 0 || tt > s.duration) return h(`i.rm-rf.${cls}.rm-gap`);
          const img = h('img', { alt: '' });
          engine.thumbAt(s.item.path, tt, k === 0 ? 640 : 240).then(u => { if (u) img.src = u; });
          return h(`i.rm-rf.${cls}`, {}, img);
        }));
      }
      reelSay.textContent = `${span(t)} in`;
      const f = s.duration ? t / s.duration : 0;
      const dots = n => Array.from({ length: n }, () => h('i'));
      dotsL.replaceChildren(...dots(Math.round(f * 14)));
      dotsR.replaceChildren(...dots(Math.round((1 - f) * 14)));
    }
    const targetFor = dx => {
      const s = engine.state;
      return Math.max(0, Math.min(s.duration - 0.5, press.base - dx * (s.duration / (W() * 1.4))));
    };
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !engine.state.item) return;
      press = { x: e.clientX, y: e.clientY, base: engine.currentTime(), mode: null, id: e.pointerId };
      press.timer = setTimeout(() => {
        if (press && !press.mode && engine.state.playing) { press.mode = 'hold'; engine.pause(); }
      }, 450);
    });
    stage.addEventListener('pointermove', e => {
      if (!press) return;
      const dx = e.clientX - press.x;
      if (!press.mode && Math.abs(dx) > 10 && engine.state.duration && !engine.state.item.isAudio) {
        press.mode = 'pull';
        clearTimeout(press.timer);
        try { stage.setPointerCapture(press.id); } catch {}
        room.classList.add('rm-pulling');
      }
      if (press.mode === 'pull') reelAt(targetFor(dx));
    });
    const release = e => {
      if (!press) return;
      clearTimeout(press.timer);
      if (press.mode === 'pull') { engine.seek(targetFor(e.clientX - press.x)); room.classList.remove('rm-pulling'); }
      if (press.mode) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 350); }
      press = null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); } }, true);

    // ---------- near and far: scrolling brings the picture closer and louder ----------
    let nearTimer = null;
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      if (!engine.state.item) return;
      engine.setVolume(engine.state.volume + (e.deltaY < 0 ? 5 : -5));
      const v = engine.state.muted ? 0 : engine.state.volume;
      room.style.setProperty('--near-scale', (0.86 + (v / 200) * 0.18).toFixed(3));
      room.style.setProperty('--near-light', (0.55 + (v / 200) * 0.5).toFixed(3));
      room.classList.add('rm-nearing');
      halo.style.transform = `translate(${mx}px, ${my}px)`;
      halo.style.setProperty('--size', `${40 + v * 0.75}px`);
      halo.firstChild.textContent = String(v);
      halo.classList.add('rm-on');
      clearTimeout(nearTimer);
      nearTimer = setTimeout(() => { room.classList.remove('rm-nearing'); halo.classList.remove('rm-on'); }, 900);
    }, { passive: false });

    // ---------- reaching: the things you might want bloom around your hand ----------
    let look = 0;
    let ring = null;
    function closeRing() { if (ring) { ring.remove(); ring = null; } }
    function bloom(items, cx, cy, back) {
      closeRing();
      // An ellipse, wider than tall, so long labels on the sides do not collide.
      const R = Math.min(185, 80 + items.length * 11);
      const RX = R * 1.45;
      cx = Math.max(RX + 110, Math.min(W() - RX - 110, cx));
      cy = Math.max(R + 50, Math.min(H() - R - 50, cy));
      ring = h('div.rm-ring', { 'data-k-hold': '' }, h('div.rm-ring-shade', { style: { width: `${RX * 2 + 320}px`, height: `${R * 2 + 220}px` } }));
      ring.style.left = `${cx}px`;
      ring.style.top = `${cy}px`;
      const center = h('button.rm-ring-center', { type: 'button', title: back ? 'Back' : 'Close' });
      center.addEventListener('click', e => { e.stopPropagation(); back ? back() : closeRing(); });
      ring.append(center);
      items.forEach((it, i) => {
        const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        const el = h('button.rm-ring-item', { type: 'button', class: it.on ? 'rm-on' : '' }, h('span', {}, it.label), it.small ? h('small', {}, it.small) : null);
        el.style.left = `${Math.cos(a) * RX}px`;
        el.style.top = `${Math.sin(a) * R}px`;
        el.style.animationDelay = `${i * 0.03}s`;
        el.addEventListener('click', e => { e.stopPropagation(); it.run(cx, cy); });
        ring.append(el);
      });
      room.append(ring);
    }
    function choices(list, current, apply, cx, cy) {
      bloom(list.map(([v, label]) => ({ label, on: v === current, run: () => { apply(v); reach(cx, cy); } })), cx, cy, () => reach(cx, cy));
    }
    function reach(cx, cy) {
      const s = engine.state;
      if (!s.item) return;
      const sub = s.subtitleTracks.find(t => t.id === s.subtitleTrack);
      const aud = s.audioTracks.find(t => t.id === s.audioTrack);
      const items = [
        { label: 'Words', small: sub ? trackLabel(sub.name) : 'none', run: (x, y) => choices([[-1, 'no words'], ...s.subtitleTracks.map(t => [t.id, trackLabel(t.name)]), ['file', 'from a file']], s.subtitleTrack, v => (v === 'file' ? engine.openSubtitleDialog() : engine.setSubtitleTrack(v)), x, y) },
        s.audioTracks.length > 1 && { label: 'Voice', small: aud ? trackLabel(aud.name) : '', run: (x, y) => choices(s.audioTracks.map(t => [t.id, trackLabel(t.name)]), s.audioTrack, v => engine.setAudioTrack(v), x, y) },
        { label: 'Slower, faster', small: SPEEDS[nearest(SPEEDS, s.rate)][1], run: (x, y) => choices(SPEEDS, SPEEDS[nearest(SPEEDS, s.rate)][0], v => engine.setRate(v), x, y) },
        { label: 'Louder than loud', small: `up to 200, now ${s.volume}`, run: (x, y) => choices(LOUD, LOUD[nearest(LOUD, s.volume)][0], v => engine.setVolume(v), x, y) },
        sub && { label: 'Words are late', small: SYNC[nearest(SYNC, s.subtitleDelay)][1], run: (x, y) => choices(SYNC, SYNC[nearest(SYNC, s.subtitleDelay)][0], v => engine.setSubtitleDelay(v), x, y) },
        s.video && { label: 'Colour', small: COLOURS[look][0], run: (x, y) => choices(COLOURS.map(([n], i) => [i, n]), look, v => { look = v; applyLook(); }, x, y) },
        s.video && { label: 'Shape', small: (SHAPES.find(([v]) => v === s.aspect) || SHAPES[0])[1], run: (x, y) => choices(SHAPES, s.aspect, v => engine.setAspect(v), x, y) },
        { label: s.nightMode ? 'Loud scenes softened' : 'Soften loud scenes', small: s.nightMode ? 'on' : 'off', on: s.nightMode, run: (x, y) => { engine.toggleNightMode(); setTimeout(() => reach(x, y), 50); } },
        s.video && { label: 'Keep this frame', small: 'snapshot', run: () => { engine.screenshot(); closeRing(); } },
        s.video && { label: 'Remember a moment', small: 'by how it looked', run: () => { closeRing(); openRemember(); } },
      ].filter(Boolean);
      bloom(items, cx, cy, null);
    }
    function applyLook() {
      const c = COLOURS[look][1];
      if (look === 0) engine.resetAdjust();
      else engine.setAdjust({ brightness: 1, contrast: c.contrast || 1, saturation: c.saturation ?? 1, hue: c.hue || 0, gamma: 1 });
    }
    const onContext = e => { e.preventDefault(); if (engine.state.item) reach(e.clientX, e.clientY); };
    room.addEventListener('contextmenu', onContext);
    const outside = e => { if (ring && !ring.contains(e.target)) closeRing(); };
    document.addEventListener('pointerdown', outside, true);

    // ---------- views ----------
    let view = '';
    let shape = '';
    let remembering = false;
    let pauses = [];
    let pausesFor = null;

    function endingNow(s) {
      if (!s.item || !s.playing || s.duration < 120) return false;
      const ch = s.chapters[s.chapter];
      return (ch && /\b(credits|ending|end credits|outro)\b/i.test(ch.name)) || s.duration - s.time < 12;
    }
    function decide(s) {
      if (!s.item || s.view === 'library') return 'home';
      if (remembering) return 'remember';
      if (s.status === 'error') return 'error';
      if (s.status === 'ended') return 'ended';
      if (endingNow(s)) return 'ending';
      if (!s.playing && s.status === 'paused') return 'held';
      return 'watching';
    }
    function render(force) {
      const s = engine.state;
      const v = decide(s);
      const nxt = engine.upNext();
      const sh = `${v}|${s.item ? s.item.path : ''}|${nxt ? nxt.path : ''}|${engine.isHeld()}|${v === 'home' ? s.recent.slice(0, 12).map(r => r.path).join() + s.library.length : ''}|${v === 'held' ? s.chapter : ''}`;
      if (!force && sh === shape) { if (VIEWS[view] && VIEWS[view].update) VIEWS[view].update(s); return; }
      shape = sh;
      view = v;
      room.dataset.view = v;
      closeRing();
      place(v === 'held' ? 'held' : v === 'ending' || v === 'ended' ? 'end' : v === 'home' ? 'away' : 'full');
      layer.replaceChildren(VIEWS[v].build(s));
      queueNear();
    }

    const VIEWS = {
      watching: { build: () => h('div'), update: s => renderMoments(s) },

      // Holding it: the house lights come up and the picture settles like a photograph.
      held: {
        build(s) {
          const step = 14;
          const t = engine.currentTime();
          const stills = h('div.rm-justnow', {}, [3, 2, 1].map(k => {
            const tt = Math.max(0, t - k * step);
            const img = h('img', { alt: '' });
            if (!s.item.isAudio) engine.thumbAt(s.item.path, tt, 320).then(u => { if (u) img.src = u; });
            const b = h('button.rm-still', { type: 'button', title: 'Go back here', 'data-k-hold': '' }, img);
            b.addEventListener('click', e => { e.stopPropagation(); engine.seek(tt); engine.play(); });
            return b;
          }));
          const f = s.duration ? t / s.duration : 0;
          const ch = s.chapters[s.chapter];
          const glass = h('div.rm-glass', {}, h('i', { style: { width: `${f * 100}%` } }));
          const caption = h('div.rm-caption', {}, words('rm-title', titleOf(s.item)), words('rm-soft', `, ${ch && ch.name ? `in ${ch.name}, ` : ''}${behind(f)}`));
          const say = (label, fn) => { const b = h('button.rm-word', { type: 'button', 'data-near': '220', 'data-k-hold': '' }, label); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
          const acts = h('div.rm-acts', {}, say('carry on', () => engine.play()), say('remember a moment', () => openRemember()), say('start over', () => { engine.seek(0); engine.play(); }), say('reach for more', () => reach(W() / 2, H() / 2)));
          return h('div.rm-held', {}, stills, h('div.rm-under', {}, glass, caption, acts));
        },
      },

      remember: { build: s => rememberView(s) },

      ending: { build: s => endView(s, true), update: s => updateEnd(s) },
      ended: { build: s => endView(s, false), update: () => {} },

      error: {
        build(s) {
          return h('div.rm-center', {}, h('div.rm-big', {}, "VLC couldn't play this one."), h('div.rm-soft', {}, titleOf(s.item)));
        },
      },

      // Coming back: the last thing you saw waits under the lamp; everything else sits further back in the dark.
      home: { build: s => homeView(s) },
    };

    // ---------- coming back ----------
    function homeView(s) {
      const last = s.recent.find(r => r.time > 5 && r.duration && r.time < r.duration - 20) || s.recent[0];
      const others = engine.galleryItems().filter(it => !last || it.path !== last.path).slice(0, SLOTS.length);
      const el = h('div.rm-home');
      const open = (path, start = null) => engine.open([path], { start });
      if (s.item) {
        const back = h('button.rm-word.rm-backto', { type: 'button', 'data-near': '400' }, `back to ${titleOf(s.item)}`);
        back.addEventListener('click', e => { e.stopPropagation(); engine.showLibrary(false); });
        el.append(back);
      }
      others.forEach((it, i) => {
        const [l, t, w, rot] = SLOTS[i];
        const img = ui.poster(engine, it, 'rm-far-img');
        const name = h('span.rm-far-name', {}, titleOf(it));
        const far = h('button.rm-far', { type: 'button', 'data-near': '300', style: { left: `${l}%`, top: `${t}%`, width: `${w}%`, transform: `rotate(${rot}deg)` } }, img, name);
        far.addEventListener('click', e => { e.stopPropagation(); open(it.path); });
        el.append(far);
      });
      if (last) {
        const f = last.duration ? last.time / last.duration : 0;
        const photo = h('button.rm-last', { type: 'button', title: 'Carry on' }, ui.poster(engine, last, 'rm-last-img'));
        photo.addEventListener('click', e => { e.stopPropagation(); open(last.path); });
        const again = h('button.rm-word', { type: 'button', 'data-near': '260' }, 'start over');
        again.addEventListener('click', e => { e.stopPropagation(); open(last.path, 0); });
        el.append(h('div.rm-home-main', {}, photo,
          h('div.rm-stopped', {}, 'You stopped here.'),
          h('div.rm-soft.rm-where', {}, `${titleOf(last)}. ${last.time > 5 ? where(f) : 'Right at the start.'}`),
          h('div.rm-acts.rm-acts-left', {}, again)));
      } else {
        el.append(h('div.rm-center.rm-empty', {}, h('div.rm-big', {}, 'Drop a film anywhere.'), h('div.rm-soft', {}, 'It plays everything VLC plays.')));
      }
      const say = (label, fn) => { const b = h('button.rm-word', { type: 'button', 'data-near': '300' }, label); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
      el.append(h('div.rm-open', {}, say('open a file', () => engine.openDialog()), say('a folder', () => engine.openFolderDialog()), say('a stream', () => shell.openUrlDialog()),
        say((s.settings.libraryFolders || []).length ? 'add a folder to the room' : 'bring in a folder', () => engine.addLibraryFolder())));
      return el;
    }

    // ---------- the end ----------
    let countEl = null;
    function endView(s, ending) {
      const line = h('div.rm-journey');
      engine.barcode(s.item.path, 200).then(cols => {
        if (!cols) return;
        line.replaceChildren(...cols.map(c => h('i', { style: { background: `rgb(${c[0]}, ${c[1]}, ${c[2]})` } })),
          ...pauses.map(p => h('b', { style: { left: `${(p.t / s.duration) * 100}%` } })));
        line.classList.add('rm-on');
      });
      const n = pauses.length;
      const story = !n ? 'You watched it straight through.'
        : n === 1 ? `You stopped once, ${pauses[0].where}.`
          : `You stopped ${ONCE[Math.min(n, 10)]}. ${pauses.slice(0, 4).map((p, i, a) => `${i === 0 ? 'Once' : i === a.length - 1 ? 'and once' : 'once'} ${p.where}`).join(', ')}.`;
      const nxt = engine.upNext();
      const held = engine.isHeld();
      const parts = [line, h('div.rm-story', {}, story)];
      const say = (label, fn) => { const b = h('button.rm-word', { type: 'button', 'data-near': '320' }, label); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
      const acts = h('div.rm-acts', {}, say('watch it again', () => { if (engine.state.status === 'ended') engine.play(); else engine.seek(0); }), say('something else', () => engine.showLibrary(true)));
      if (ending && nxt && !held) acts.prepend(say('not now', () => { engine.holdNext(true); render(true); }));
      parts.push(acts);
      const el = h('div.rm-end', {}, ...parts);
      if (nxt) {
        countEl = h('div.rm-next-say');
        const card = h('button.rm-next', { type: 'button', title: 'Play it' }, ui.poster(engine, { path: nxt.path, time: 0, duration: 0 }, 'rm-next-img'));
        card.addEventListener('click', e => { e.stopPropagation(); engine.next(); });
        el.append(card, countEl);
        updateEnd(s, ending && !held);
      }
      return el;
    }
    function updateEnd(s, counting = view === 'ending' && !engine.isHeld()) {
      if (!countEl) return;
      const nxt = engine.upNext();
      if (!nxt) return;
      const left = Math.max(0, Math.ceil(s.duration - s.time));
      countEl.textContent = counting ? `Next, ${pretty(nxt.name)}, in ${left} second${left === 1 ? '' : 's'}` : `Next, ${pretty(nxt.name)}`;
    }

    // ---------- remembering: the film as a blur of colour that sharpens under the light ----------
    function openRemember() { const s = engine.state; if (!s.item || s.item.isAudio || !s.duration) return; remembering = true; render(true); }
    function closeRemember() { remembering = false; render(true); }
    function rememberView(s) {
      const n = 40;
      const label = h('div.rm-patch-label');
      const patches = Array.from({ length: n }, (_, i) => {
        const t = ((i + 0.5) / n) * s.duration;
        const p = h('button.rm-patch', { type: 'button', 'data-near': '230' }, h('img', { alt: '' }));
        p.addEventListener('click', e => { e.stopPropagation(); engine.seek(t); engine.play(); closeRemember(); });
        p.addEventListener('pointerenter', () => {
          const ch = s.chapters.filter(c => c.time <= t).pop();
          label.textContent = `${span(t)} in${ch && ch.name ? `, ${ch.name}` : ''}`;
          const r = p.getBoundingClientRect();
          label.style.left = `${r.left + r.width / 2}px`;
          label.style.top = `${r.bottom + 8}px`;
          label.classList.add('rm-on');
        });
        p.addEventListener('pointerleave', () => label.classList.remove('rm-on'));
        p.t = t;
        return p;
      });
      engine.barcode(s.item.path, n).then(c => { if (c) patches.forEach((p, i) => { if (c[i]) p.style.background = `rgb(${c[i]})`; }); });
      (async () => {
        for (const p of patches) {
          if (!remembering) return;
          const u = await engine.thumbAt(s.item.path, p.t, 240);
          if (u) { p.firstChild.src = u; p.classList.add('rm-loaded'); }
        }
      })();
      const never = h('button.rm-word', { type: 'button', 'data-near': '400' }, 'never mind');
      never.addEventListener('click', e => { e.stopPropagation(); closeRemember(); });
      const el = h('div.rm-remember', { 'data-k-hold': '' }, h('div.rm-field', {}, patches), label, h('div.rm-acts.rm-remember-acts', {}, never));
      el.addEventListener('click', e => { if (e.target === el) closeRemember(); });
      return el;
    }

    // ---------- whispers from VLC ----------
    let whisperTimer = null;
    on('osd', ({ text }) => {
      if (/^volume/i.test(text) && halo.classList.contains('rm-on')) return;
      whisper.textContent = text;
      whisper.classList.add('rm-on');
      clearTimeout(whisperTimer);
      whisperTimer = setTimeout(() => whisper.classList.remove('rm-on'), 1600);
    });

    // ---------- live state ----------
    let lastTick = 0;
    on('change', (s, keys) => {
      if (s.item && s.item.path !== pausesFor) { pausesFor = s.item.path; pauses = []; remembering = false; }
      if (keys.has('playing') && !s.playing && s.status === 'paused' && s.item) {
        const ch = s.chapters.filter(c => c.time <= s.time).pop();
        pauses.push({ t: s.time, where: ch && ch.name ? `in ${ch.name.replace(/^(The|A|An) /, m => m.toLowerCase())}` : `${span(s.time)} in` });
      }
      if (keys.has('fullscreen')) fsWord.textContent = s.fullscreen ? 'leave full screen' : 'full screen';
      if (keys.has('video') && s.video) place(placed);
      render();
    });
    on('time', s => {
      const now = performance.now();
      if (now - lastTick < 250) return;
      lastTick = now;
      render();
    });

    place('full');
    render(true);
    queueNear();

    return {
      unmount() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('resize', onResize);
        clearTimeout(whisperTimer);
        Object.assign(stage.style, { left: '', top: '', width: '', height: '', transform: '' });
        stage.classList.remove('rm-photo');
        closeRing();
      },
      onKey(e) {
        if (e.key !== 'Escape') return false;
        if (ring) { closeRing(); return true; }
        if (remembering) { closeRemember(); return true; }
        return false;
      },
      onCommand(name) {
        if (name === 'effects' || name === 'tracks' || name === 'info') { reach(W() / 2, H() / 2); return true; }
        if (name === 'playlist') { engine.showLibrary(true); return true; }
        return false;
      },
    };
  },
};
