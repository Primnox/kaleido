// Prose: the interface is one sentence about what is happening, and every control is a word in it.
// Click a lit word to change it, drag it to slide it, scroll on it to roll through its choices.

const SPEEDS = [[0.25, 'very slow'], [0.5, 'half speed'], [0.75, 'a bit slow'], [1, 'normal speed'], [1.25, 'a bit fast'], [1.5, 'fast'], [2, 'double speed'], [3, 'triple speed'], [4, 'as fast as it goes']];
const VOLUMES = [[0, 'silent'], [1, 'whispering'], [20, 'quiet'], [50, 'soft'], [80, 'loud'], [110, 'very loud'], [140, 'louder than loud'], [180, 'as loud as it goes']];
const SYNC = [[-1000, 'a second sooner'], [-500, 'half a second sooner'], [-150, 'a bit sooner'], [0, 'at their time'], [150, 'a bit later'], [500, 'half a second later'], [1000, 'a second later']];
const AUDIO_SYNC = [[-1000, 'a second ahead of the picture'], [-500, 'half a second ahead'], [-150, 'a little ahead'], [0, 'in step with the picture'], [150, 'a little behind'], [500, 'half a second behind'], [1000, 'a second behind the picture']];
const SIZES = [[70, 'small'], [100, 'normal size'], [140, 'large'], [180, 'very large']];
const REPEAT = [['off', "play what's next"], ['one', 'play it again'], ['all', 'start the queue over']];
const ASPECTS = [['auto', 'fits as it was made'], ['crop', 'fills the screen'], ['fill', 'is stretched to fit'], ['16:9', 'is 16 by 9'], ['4:3', 'is 4 by 3'], ['2.39:1', 'is cinema wide']];
const COLOURS = [['as they were', {}], ['warmer', { hue: -10, saturation: 1.12 }], ['cooler', { hue: 12, saturation: 0.95 }], ['richer', { saturation: 1.45, contrast: 1.06 }], ['faded', { saturation: 0.6, contrast: 0.9 }], ['black and white', { saturation: 0 }]];
const LIGHTS = [['much darker', 0.75], ['a bit darker', 0.9], ['as bright as it was', 1], ['a bit brighter', 1.12], ['much brighter', 1.3]];
const EQ_WORDS = {
  'Flat': 'left flat', 'Classical': 'tuned for classical', 'Club': 'like a club', 'Dance': 'tuned for dance',
  'Full bass': 'with the bass lifted', 'Full bass and treble': 'with bass and treble lifted', 'Full treble': 'with the treble lifted',
  'Headphones': 'shaped for headphones', 'Large Hall': 'like a large hall', 'Live': "like it's live", 'Party': 'like a party',
  'Pop': 'tuned for pop', 'Reggae': 'tuned for reggae', 'Rock': 'tuned for rock', 'Ska': 'tuned for ska', 'Soft': 'softened',
  'Soft rock': 'tuned for soft rock', 'Techno': 'tuned for techno',
};
const TIMES = ['never', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times'];
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pretty = name => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
const nearest = (list, v) => list.reduce((best, x, i) => (Math.abs(x[0] - v) < Math.abs(list[best][0] - v) ? i : best), 0);

function span(t) {
  t = Math.max(0, Math.round(t));
  if (t < 60) return plural(t, 'second');
  const hr = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (!hr) return t < 600 && s ? `${plural(m, 'minute')} ${plural(s, 'second')}` : plural(m, 'minute');
  return m ? `${plural(hr, 'hour')} ${plural(m, 'minute')}` : plural(hr, 'hour');
}
function timePhrase(t, d) {
  if (t < 4) return 'just starting';
  if (!d) return `${span(t)} in`;
  const left = d - t;
  if (left < 60) return `${plural(Math.max(1, Math.round(left)), 'second')} left`;
  if (d > 1200 && left < 600) return `${span(left)} left`;
  return `${span(t)} in`;
}
function wherePhrase(f) {
  if (f < 0.05) return 'right at the start';
  if (f < 0.25) return 'early on';
  if (f < 0.45) return 'before the middle';
  if (f < 0.56) return 'around the middle';
  if (f < 0.72) return 'a little past the middle';
  if (f < 0.9) return 'well past the middle';
  return 'near the end';
}
function watchedPhrase(it) {
  if (!it.duration || !it.time) return 'not started';
  const f = it.time / it.duration;
  if (f < 0.15) return 'just started';
  if (f < 0.4) return 'a little watched';
  if (f < 0.62) return 'half watched';
  if (f < 0.9) return 'mostly watched';
  return 'nearly done';
}
const volumeWord = (v, muted) => (muted ? 'muted' : VOLUMES.filter(([x]) => v >= x).pop()[1]);
const speedWord = r => (SPEEDS.find(([x]) => Math.abs(x - r) < 0.01) || [0, `${r} times speed`])[1];
function trackLabel(name) {
  const lang = /\[([^\]]+)\]/.exec(name);
  const rest = name.replace(/^Track\s*\d+\s*-?\s*/i, '').replace(/\s*-?\s*\[[^\]]+\]\s*/, '').trim();
  if (lang) return rest ? `${rest}, ${lang[1]}` : lang[1];
  return rest || name.toLowerCase();
}

export default {
  options: { osd: false, contextMenu: false, idleDelay: 2600 },

  mount({ root, stage, engine, ui, shell, on }) {
    const { h } = ui;

    // ---------- words ----------
    let busy = 0;          // a drag or a wheel is in progress, so do not rebuild the sentence
    let pending = false;
    const T = text => document.createTextNode(text);
    const title = text => h('span.pt', {}, text);

    function W(text, opts = {}) {
      const el = h(`span.pw${opts.verb ? '.pw-verb' : ''}${opts.cls ? '.' + opts.cls : ''}`, { tabindex: '0', role: 'button', 'data-k-hold': '', title: opts.tip || null }, text);
      let down = null;
      let dragging = false;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        down = { x: e.clientX, base: opts.drag ? opts.drag.start() : null };
        try { el.setPointerCapture(e.pointerId); } catch {}
      });
      el.addEventListener('pointermove', e => {
        if (!down || !opts.drag) return;
        const dx = e.clientX - down.x;
        if (!dragging && Math.abs(dx) > 4) { dragging = true; busy++; el.classList.add('pw-drag'); }
        if (dragging) opts.drag.move(dx * (e.shiftKey ? 0.1 : 1), down.base, el);
      });
      const finish = (e, cancelled) => {
        if (!down) return;
        if (dragging) {
          busy--;
          el.classList.remove('pw-drag');
          if (!cancelled) opts.drag.end((e.clientX - down.x) * (e.shiftKey ? 0.1 : 1), down.base, el);
          flush();
        } else if (!cancelled) {
          if (opts.choices) openWheel(el, opts.choices, false);
          else if (opts.onClick) opts.onClick(e);
        }
        down = null;
        dragging = false;
      };
      el.addEventListener('pointerup', e => finish(e, false));
      el.addEventListener('pointercancel', e => finish(e, true));
      el.addEventListener('click', e => e.stopPropagation());
      el.addEventListener('dblclick', e => e.stopPropagation());
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (opts.choices) openWheel(el, opts.choices, false);
        else if (opts.onClick) opts.onClick(e);
      });
      if (opts.choices || opts.onWheel) {
        el.addEventListener('wheel', e => {
          e.preventDefault();
          e.stopPropagation();
          const d = e.deltaY > 0 ? 1 : -1;
          if (opts.onWheel) opts.onWheel(d);
          else stepWheel(el, opts.choices, d);
        }, { passive: false });
      }
      el.setText = t => { if (el.firstChild && el.firstChild.nodeType === 3) { if (el.firstChild.nodeValue !== t) el.firstChild.nodeValue = t; } else el.prepend(T(t)); };
      return el;
    }

    // ---------- the choice wheel: alternatives wait above and below a word ----------
    let wheel = null;
    function openWheel(el, choices, auto) {
      if (wheel && wheel.el === el) { if (!auto) wheel.sticky = true; return wheel; }
      closeWheel();
      const c = choices();
      if (!c.items.length) return null;
      const r = el.getBoundingClientRect();
      const box = h('div.pr-wheel', { 'data-k-hold': '' });
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.font = getComputedStyle(el).font;
      box.style.lineHeight = 'normal';
      const w = { el, box, c, i: Math.max(0, c.index), sticky: !auto, timer: null };
      const paint = () => {
        box.replaceChildren(...w.c.items.map((it, j) => {
          const d = j - w.i;
          const opt = h('div.pr-opt', { class: d === 0 ? 'pr-on' : '' }, it.label);
          opt.style.transform = `translateY(${d * 1.32}em)`;
          opt.style.opacity = d === 0 ? '1' : String(Math.max(0, 0.62 - Math.abs(d) * 0.16));
          opt.style.visibility = Math.abs(d) > 3 ? 'hidden' : '';
          opt.addEventListener('pointerdown', e => e.stopPropagation());
          opt.addEventListener('click', e => { e.stopPropagation(); w.i = j; w.c.pick(it.value); closeWheel(); });
          return opt;
        }));
      };
      w.paint = paint;
      box.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); stepWheel(el, choices, e.deltaY > 0 ? 1 : -1); }, { passive: false });
      paint();
      document.body.append(box);
      el.classList.add('pw-open');
      busy++;
      wheel = w;
      return w;
    }
    function stepWheel(el, choices, d) {
      const w = openWheel(el, choices, true);
      if (!w) return;
      const j = Math.max(0, Math.min(w.c.items.length - 1, w.i + d));
      if (j !== w.i) { w.i = j; w.c.pick(w.c.items[j].value); w.paint(); }
      if (!w.sticky) { clearTimeout(w.timer); w.timer = setTimeout(closeWheel, 1300); }
    }
    function closeWheel() {
      if (!wheel) return;
      clearTimeout(wheel.timer);
      wheel.box.remove();
      wheel.el.classList.remove('pw-open');
      wheel = null;
      busy--;
      flush();
    }
    const outside = e => { if (wheel && !wheel.box.contains(e.target) && e.target !== wheel.el) closeWheel(); };
    document.addEventListener('pointerdown', outside, true);

    // ---------- the frames that gather under the time phrase while you drag it ----------
    const strip = h('div.pr-strip');
    let stripAt = -1;
    function showStrip(el, t) {
      const s = engine.state;
      if (!s.item || s.item.isAudio || !s.duration) return;
      if (strip.parentElement !== el) el.append(strip);
      const step = Math.max(2, s.duration / 80);
      const key = Math.round(t / step);
      if (key === stripAt) return;
      stripAt = key;
      strip.replaceChildren(...Array.from({ length: 7 }, (_, k) => {
        const tt = Math.max(0, Math.min(s.duration - 1, (key + k - 3) * step));
        const img = h('img', { alt: '', class: k === 3 ? 'pr-now' : '' });
        engine.thumbAt(s.item.path, tt, 200).then(u => { if (u) img.src = u; });
        return img;
      }));
    }
    const hideStrip = () => { strip.remove(); stripAt = -1; };

    // ---------- reusable word builders ----------
    let lastLive = 0;
    const timeWord = () => W('', {
      tip: 'Drag to move through the film. Hold Shift for fine steps. Click to find a moment by what it looked like.',
      onClick: () => openFind(),
      drag: {
        start: () => engine.currentTime(),
        move: (dx, base, el) => {
          const s = engine.state;
          const t = Math.max(0, Math.min(s.duration - 0.5, base + dx * (s.duration / (window.innerWidth * 1.15))));
          el.setText(timePhrase(t, s.duration));
          el.title = `${ui.fmt(t)} of ${ui.fmt(s.duration)}`;
          showStrip(el, t);
          if (performance.now() - lastLive > 160) { lastLive = performance.now(); engine.seek(t); }
        },
        end: (dx, base) => {
          const s = engine.state;
          engine.seek(Math.max(0, Math.min(s.duration - 0.5, base + dx * (s.duration / (window.innerWidth * 1.15)))));
          hideStrip();
        },
        cancel: hideStrip,
      },
    });
    const volumeWordEl = () => W('', {
      tip: 'Drag or scroll to make it louder or quieter, up to 200%. Click to mute.',
      onClick: () => engine.toggleMute(),
      onWheel: d => engine.setVolume(engine.state.volume - d * 5),
      drag: { start: () => engine.state.volume, move: (dx, base) => engine.setVolume(base + dx * 0.4), end: () => {} },
    });
    const speedWordEl = () => W('', {
      tip: 'Click or scroll to change the speed.',
      choices: () => ({ items: SPEEDS.map(([v, label]) => ({ label, value: v })), index: nearest(SPEEDS, engine.state.rate), pick: v => engine.setRate(v) }),
    });
    const audioChoices = () => {
      const s = engine.state;
      return { items: s.audioTracks.map(t => ({ label: trackLabel(t.name), value: t.id })), index: s.audioTracks.findIndex(t => t.id === s.audioTrack), pick: v => engine.setAudioTrack(v) };
    };
    const subtitleLabel = s => {
      const t = s.subtitleTracks.find(x => x.id === s.subtitleTrack);
      return t ? `with ${trackLabel(t.name)} words` : 'without words';
    };
    const subtitleChoices = () => {
      const s = engine.state;
      const items = [{ label: 'without words', value: -1 }, ...s.subtitleTracks.map(t => ({ label: `with ${trackLabel(t.name)} words`, value: t.id })), { label: 'with words from a file', value: 'file' }];
      return { items, index: Math.max(0, items.findIndex(i => i.value === s.subtitleTrack)), pick: v => (v === 'file' ? engine.openSubtitleDialog() : engine.setSubtitleTrack(v)) };
    };
    const itemTitle = it => (it.title && !/^track\s*\d*$/i.test(it.title) ? it.title : pretty(it.name));

    // ---------- the room ----------
    const lamp = h('div.pr-lamp');
    const shade = h('div.pr-shade');
    const layer = h('div.pr-layer');
    const whisper = h('div.pr-whisper');
    const peek = h('div.pr-peek');
    const fsWord = W('fill the screen', { onClick: () => engine.toggleFullscreen() });
    const maxWord = W('bigger', { onClick: () => window.host.win.toggleMaximize() });
    const top = h('div.pr-top', {}, W('smaller', { onClick: () => window.host.win.minimize() }), maxWord, fsWord, W('close', { onClick: () => window.host.win.close() }));
    const room = h('div.pr', {}, stage, lamp, shade, layer, peek, whisper, top);
    root.append(room);

    // ---------- views ----------
    let viewName = '';
    let shape = '';
    let api = null;
    let findOpen = false;
    let reachOpen = false;
    let libOpen = false;
    let pauses = [];
    let pausesFor = null;
    let look = { colour: 0, light: 2 };

    function endingNow(s) {
      if (!s.item || !s.playing || s.duration < 120) return false;
      const ch = s.chapters[s.chapter];
      const credits = ch && /\b(credits|ending|end credits|outro)\b/i.test(ch.name);
      return credits || s.duration - s.time < 12;
    }
    function decide(s) {
      if (findOpen && s.item) return 'find';
      if (reachOpen && s.item) return 'reach';
      if (!s.item || s.view === 'library') return 'home';
      if (s.status === 'error') return 'error';
      if (s.status === 'ended') return 'ended';
      if (endingNow(s)) return 'ending';
      if (!s.playing && s.status === 'paused') return 'paused';
      return 'watching';
    }
    function shapeOf(v, s) {
      const nxt = engine.upNext();
      const base = s.item ? `${s.item.path}|${s.audioTracks.length > 1}|${s.subtitleTracks.map(t => t.id).join(',')}|${nxt ? nxt.path : ''}|${s.chapters.length}|${s.status === 'opening'}` : '';
      if (v === 'home') return `${base}|${s.recent.slice(0, 6).map(r => r.path).join(',')}|${s.library.length}|${libOpen}|${(s.settings.libraryFolders || []).join(',')}`;
      if (v === 'ending' || v === 'ended') return `${base}|${engine.isHeld()}`;
      return base;
    }
    function render(force) {
      const s = engine.state;
      const v = decide(s);
      const sh = `${v}#${shapeOf(v, s)}`;
      if (!force && sh === shape) { if (api && api.update) api.update(s); return; }
      if (busy) { pending = true; return; }
      shape = sh;
      viewName = v;
      room.dataset.view = v;
      api = VIEWS[v](s);
      layer.replaceChildren(api.el);
      if (api.update) api.update(s);
    }
    function flush() { if (pending && !busy) { pending = false; render(true); } }

    const clauses = (s, refs) => {
      // "It's loud, in English, without words, at normal speed."
      const out = [T("It's "), refs.vol = volumeWordEl()];
      if (s.audioTracks.length > 1) out.push(T(', in '), refs.aud = W('', { tip: 'Click or scroll for another language', choices: audioChoices }));
      out.push(T(', '), refs.sub = W('', { tip: 'Click or scroll for subtitles', choices: subtitleChoices }));
      out.push(T(', at '), refs.spd = speedWordEl(), T('. '), W('More', { verb: true, tip: 'Everything else VLC can do', onClick: () => openReach() }), T('.'));
      return out;
    };
    const updateClauses = (s, refs) => {
      refs.vol.setText(volumeWord(s.volume, s.muted));
      refs.vol.title = `Volume ${s.muted ? 0 : s.volume}%`;
      if (refs.aud) { const t = s.audioTracks.find(x => x.id === s.audioTrack); refs.aud.setText(t ? trackLabel(t.name) : 'no sound'); }
      refs.sub.setText(subtitleLabel(s));
      refs.spd.setText(speedWord(s.rate));
    };

    const VIEWS = {
      watching(s) {
        const refs = {};
        const nxt = engine.upNext();
        const opening = s.status === 'opening' || s.duration === 0;
        const name = title(itemTitle(s.item));
        const el = h('div.pr-say.pr-low', {},
          name, T(', '), refs.time = timeWord(), T('. '),
          refs.verb = W('Pause', { verb: true, onClick: () => engine.toggle() }), T('. '),
          ...clauses(s, refs),
          nxt ? h('span.pr-next', {}, T('Next is '), W(pretty(nxt.name), { onClick: () => engine.next() }), T('.')) : null);
        if (opening) refs.time.classList.add('pr-quiet');
        return {
          el,
          update(st) {
            name.textContent = itemTitle(st.item);
            if (!refs.time.classList.contains('pw-drag')) {
              refs.time.setText(st.status === 'opening' ? 'opening' : timePhrase(st.time, st.duration));
              refs.time.title = `${ui.fmt(st.time)} of ${ui.fmt(st.duration)}. Drag to move, click to find a moment.`;
            }
            refs.verb.setText(st.playing ? 'Pause' : 'Play');
            updateClauses(st, refs);
          },
        };
      },

      paused(s) {
        const refs = {};
        const chapter = h('span');
        const el = h('div.pr-say.pr-mid', {},
          T('Paused '), chapter, refs.time = timeWord(), T('.'), h('br'),
          W('Carry on', { verb: true, onClick: () => engine.play() }), T(', '),
          W('go back a little', { verb: true, onClick: () => { engine.seek(engine.currentTime() - 15); engine.play(); } }), T(', or '),
          W('find a moment', { verb: true, onClick: () => openFind() }), T('.'),
          h('span.pr-small', {}, ...clauses(s, refs)));
        return {
          el,
          update(st) {
            const ch = st.chapters[st.chapter];
            chapter.replaceChildren(...(ch && ch.name ? [T('during '), title(ch.name), T(', ')] : []));
            if (!refs.time.classList.contains('pw-drag')) refs.time.setText(timePhrase(st.time, st.duration));
            updateClauses(st, refs);
          },
        };
      },

      home(s) {
        const items = engine.galleryItems();
        const last = s.recent.find(r => r.time > 5 && r.duration && r.time < r.duration - 20) || s.recent[0];
        const rest = items.filter(it => !last || it.path !== last.path);
        const folders = s.settings.libraryFolders || [];
        const libLabel = !folders.length ? 'a folder you keep films in' : folders.length === 1 ? `anything in ${folders[0].split(/[\\/]/).pop()}` : 'anything in your library';
        const open = (path, start = null) => engine.open([path], { start });
        const hoverPeek = (el, it) => {
          el.addEventListener('pointerenter', () => { peek.replaceChildren(ui.poster(engine, it, 'pr-peek-img')); peek.classList.add('pr-on'); });
          el.addEventListener('pointerleave', () => peek.classList.remove('pr-on'));
          return el;
        };
        const back = s.item ? h('div.pr-back', {}, W(`Back to ${itemTitle(s.item)}`, { verb: true, onClick: () => engine.showLibrary(false) })) : null;

        let main;
        if (last) {
          const photo = h('div.pr-photo', {}, ui.poster(engine, last, 'pr-photo-img'));
          const f = last.duration ? last.time / last.duration : 0;
          main = h('div.pr-home-main', {}, photo,
            h('div.pr-say.pr-static', {},
              T('You stopped '), hoverPeek(W(last.title || pretty(last.name), { onClick: () => open(last.path) }), last), T(` ${last.time > 5 ? wherePhrase(f) : 'right at the start'}.`), h('br'),
              W('Carry on', { verb: true, onClick: () => open(last.path) }), T(', '),
              W('start over', { verb: true, onClick: () => open(last.path, 0) }), T(', or '),
              W('watch something else', { verb: true, onClick: () => { libOpen = true; render(true); } }), T('.')));
        } else {
          main = h('div.pr-say.pr-mid', {},
            T('Nothing is playing yet.'), h('br'),
            T('Open '), W('a file', { onClick: () => engine.openDialog() }), T(', '), W('a folder', { onClick: () => engine.openFolderDialog() }),
            T(' or '), W('a stream', { onClick: () => shell.openUrlDialog() }), T(', or drop something anywhere.'));
        }

        const shown = libOpen ? rest : rest.slice(0, 4);
        const lines = shown.map(it => h('div.pr-line-item', {}, hoverPeek(W(it.title || pretty(it.name), { cls: 'pw-soft', onClick: () => open(it.path) }), it), T(`, ${watchedPhrase(it)}.`)));
        const tail = h('div.pr-line-item.pr-tail', {},
          T(libOpen ? '' : lines.length ? 'Or ' : 'Or open '),
          libOpen ? W('show fewer', { cls: 'pw-soft', onClick: () => { libOpen = false; render(true); } }) : W(libLabel, { cls: 'pw-soft', onClick: () => { if (!folders.length) engine.addLibraryFolder(); else { libOpen = true; render(true); } } }),
          T(', '), W('a file', { cls: 'pw-soft', onClick: () => engine.openDialog() }), T(', '), W('a folder', { cls: 'pw-soft', onClick: () => engine.openFolderDialog() }),
          T(' or '), W('a stream', { cls: 'pw-soft', onClick: () => shell.openUrlDialog() }), T('.'),
          libOpen ? h('span', {}, T(' '), W('Add another folder', { verb: true, cls: 'pw-soft', onClick: () => engine.addLibraryFolder() }), T('.')) : null);
        const side = (last || rest.length) ? h('div.pr-side', { class: last ? '' : 'pr-side-wide' },
          lines.length ? h('div.pr-side-head', {}, last ? 'Also waiting:' : 'In your library:') : null, ...lines, tail) : null;
        const el = h('div.pr-home', { class: last ? 'pr-has-last' : '' }, back, main, side);
        return { el };
      },

      ending(s) { return endView(s, true); },
      ended(s) { return endView(s, false); },

      error(s) {
        const el = h('div.pr-say.pr-mid', {},
          T("VLC couldn't play "), title(itemTitle(s.item)), T('.'), h('br'),
          W('Try the next one', { verb: true, onClick: () => engine.next() }), T(' or '),
          W('open something else', { verb: true, onClick: () => engine.openDialog() }), T('.'));
        return { el };
      },

      find(s) { return findView(s); },
      reach(s) { return reachView(s); },
    };

    // ---------- the end: the whole film as one line of its colours ----------
    function endView(s, ending) {
      const line = h('div.pr-colours');
      engine.barcode(s.item.path, 180).then(cols => {
        if (!cols) return;
        line.replaceChildren(...cols.map(c => h('i', { style: { background: `rgb(${c[0]}, ${c[1]}, ${c[2]})` } })),
          ...pauses.filter(p => s.duration).map(p => h('b', { style: { left: `${(p / s.duration) * 100}%` } })));
        line.classList.add('pr-on');
      });
      const nxt = engine.upNext();
      const held = engine.isHeld();
      const count = W('', { onClick: () => engine.next() });
      const n = pauses.length;
      const parts = [line, T('That was '), title(itemTitle(s.item)), T('. '), T(n ? `You stopped ${TIMES[Math.min(n, 10)]}.` : 'You watched it straight through.'), h('br')];
      if (ending && nxt && !held) {
        parts.push(W(pretty(nxt.name), { onClick: () => engine.next() }), T(' is next, '), count, T('. '), W('Not now', { verb: true, onClick: () => { engine.holdNext(true); render(true); } }), T('.'));
      } else {
        parts.push(W('Watch it again', { verb: true, onClick: () => { if (engine.state.status === 'ended') engine.play(); else engine.seek(0); } }));
        if (nxt) parts.push(T(', '), W(`play ${pretty(nxt.name)}`, { verb: true, onClick: () => engine.next() }));
        parts.push(T(', or '), W('watch something else', { verb: true, onClick: () => engine.showLibrary(true) }), T('.'));
      }
      const el = h('div.pr-say.pr-mid.pr-end', {}, ...parts);
      return {
        el,
        update(st) {
          const left = Math.max(0, Math.ceil(st.duration - st.time));
          count.setText(left <= 0 ? 'now' : `in ${NUMBERS[left] || left} second${left === 1 ? '' : 's'}`);
        },
      };
    }

    // ---------- find a moment: the film as a field of blurred colour that sharpens near your hand ----------
    function openFind() { if (!engine.state.item || engine.state.item.isAudio) return; findOpen = true; reachOpen = false; render(true); }
    function closeFind() { findOpen = false; render(true); }
    function findView(s) {
      const cols = 8;
      const rows = 5;
      const n = cols * rows;
      const label = h('div.pr-patch-label');
      const patches = Array.from({ length: n }, (_, i) => {
        const t = ((i + 0.5) / n) * s.duration;
        const img = h('img', { alt: '' });
        const p = h('div.pr-patch', { 'data-k-hold': '' }, img);
        p.addEventListener('click', e => { e.stopPropagation(); engine.seek(t); engine.play(); closeFind(); });
        p.addEventListener('pointerenter', () => {
          const ch = s.chapters.filter(c => c.time <= t).pop();
          label.textContent = `${timePhrase(t, s.duration)}${ch && ch.name ? `, ${ch.name}` : ''}`;
          const r = p.getBoundingClientRect();
          label.style.left = `${r.left + r.width / 2}px`;
          label.style.top = `${r.bottom + 8}px`;
          label.classList.add('pr-on');
        });
        p.addEventListener('pointerleave', () => label.classList.remove('pr-on'));
        p.t = t;
        return p;
      });
      engine.barcode(s.item.path, n).then(c => { if (c) patches.forEach((p, i) => { if (c[i]) p.style.background = `rgb(${c[i]})`; }); });
      (async () => {
        for (const p of patches) {
          if (!findOpen) return;
          const u = await engine.thumbAt(s.item.path, p.t, 240);
          if (u) { p.firstChild.src = u; p.classList.add('pr-loaded'); }
        }
      })();
      const field = h('div.pr-field', {}, patches);
      let raf = 0;
      let mx = -1e4, my = -1e4;
      const blurAll = () => {
        raf = 0;
        const w = field.getBoundingClientRect().width || 1;
        for (const p of patches) {
          const r = p.getBoundingClientRect();
          const d = Math.hypot(r.left + r.width / 2 - mx, r.top + r.height / 2 - my) / w;
          const k = Math.min(1, d / 0.2);
          p.style.filter = `blur(${(k * 11).toFixed(1)}px) brightness(${(1 - k * 0.45).toFixed(2)})`;
        }
      };
      const el = h('div.pr-find', { 'data-k-hold': '' },
        h('div.pr-say.pr-static.pr-find-head', {}, T('Find a moment in '), title(itemTitle(s.item)), T(' by what it looked like. '), W('Never mind', { verb: true, onClick: () => closeFind() }), T('.')),
        field, label);
      el.addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(blurAll); });
      el.addEventListener('click', e => { if (e.target === el || e.target === field) closeFind(); });
      requestAnimationFrame(blurAll);
      return { el };
    }

    // ---------- reaching for more: everything VLC hides in menus, as sentences you edit ----------
    function openReach() { if (!engine.state.item) return; reachOpen = true; findOpen = false; render(true); }
    function closeReach() { reachOpen = false; render(true); }
    function applyLook() {
      const c = COLOURS[look.colour][1];
      const b = LIGHTS[look.light][1];
      if (look.colour === 0 && look.light === 2) engine.resetAdjust();
      else engine.setAdjust({ brightness: b, contrast: c.contrast || 1, saturation: c.saturation ?? 1, hue: c.hue || 0, gamma: 1 });
    }
    function reachView(s) {
      const refs = {};
      const choice = (list, get, set) => () => ({ items: list.map(([v, label]) => ({ label, value: v })), index: Math.max(0, list.findIndex(([v]) => v === get())), pick: v => set(v) });
      const eqChoices = () => {
        const st = engine.state;
        const items = [{ label: 'as it was made', value: -1 }, ...st.eqPresets.map(p => ({ label: EQ_WORDS[p.name] || `tuned ${p.name.toLowerCase()}`, value: p.index }))];
        return { items, index: st.eq.enabled ? Math.max(0, items.findIndex(i => i.value === st.eq.preset)) : 0, pick: v => (v === -1 ? engine.setEq({ enabled: false }) : engine.applyEqPreset(v)) };
      };
      const lines = [];
      if (s.subtitleTrack !== -1) lines.push([T('The words show up '), refs.sync = W('', { choices: choice(SYNC, () => engine.state.subtitleDelay, v => engine.setSubtitleDelay(v)) }), T(', and they are '), refs.size = W('', { choices: choice(SIZES, () => engine.state.subtitleScale, v => engine.setSubtitleScale(v)) }), T('.')]);
      else {
        const subPick = () => {
          const st = engine.state;
          const items = [{ label: 'no words', value: -1 }, ...st.subtitleTracks.map(t => ({ label: `${trackLabel(t.name)} words`, value: t.id })), { label: 'words from a file', value: 'file' }];
          return { items, index: 0, pick: v => (v === 'file' ? engine.openSubtitleDialog() : engine.setSubtitleTrack(v)) };
        };
        lines.push([T('There are '), refs.subs = W('', { choices: subPick }), T(' on screen.')]);
      }
      lines.push([T('The sound is '), refs.vol = volumeWordEl(), T(', '), refs.eq = W('', { choices: eqChoices }), T('.')]);
      lines.push([T('Loud scenes are '), refs.night = W('', { choices: () => ({ items: [{ label: 'left alone', value: false }, { label: 'softened', value: true }], index: engine.state.nightMode ? 1 : 0, pick: v => { if (v !== engine.state.nightMode) engine.toggleNightMode(); } }) }), T('.')]);
      if (s.audioTracks.length > 1) lines.push([T('It speaks '), refs.aud = W('', { choices: audioChoices }), T(', and the sound is '), refs.adel = W('', { choices: choice(AUDIO_SYNC, () => engine.state.audioDelay, v => engine.setAudioDelay(v)) }), T('.')]);
      if (s.video) {
        lines.push([T('The colours are '), refs.col = W('', { choices: () => ({ items: COLOURS.map(([label], i) => ({ label, value: i })), index: look.colour, pick: v => { look.colour = v; applyLook(); refs.col.setText(COLOURS[v][0]); } }) }),
          T(', and the picture is '), refs.light = W('', { choices: () => ({ items: LIGHTS.map(([label], i) => ({ label, value: i })), index: look.light, pick: v => { look.light = v; applyLook(); refs.light.setText(LIGHTS[v][0]); } }) }), T('.')]);
        lines.push([T('The picture '), refs.asp = W('', { choices: choice(ASPECTS, () => engine.state.aspect, v => engine.setAspect(v)) }), T('.')]);
      }
      lines.push([T('When it ends, '), refs.rep = W('', { choices: choice(REPEAT, () => engine.state.repeat, v => { while (engine.state.repeat !== v) engine.cycleRepeat(); }) }), T('.')]);
      lines.push([T('This window '), refs.top = W('', { choices: () => ({ items: [{ label: 'stays where it is', value: false }, { label: 'floats above everything', value: true }], index: engine.state.alwaysOnTop ? 1 : 0, pick: v => { if (v !== engine.state.alwaysOnTop) engine.toggleAlwaysOnTop(); } }) }), T('.')]);
      lines.push([W('Take a snapshot', { verb: true, onClick: () => engine.screenshot() }), T(', '), W('loop a part', { verb: true, onClick: () => engine.cycleLoop() }), T(', '),
        W('add words from a file', { verb: true, onClick: () => engine.openSubtitleDialog() }), T(', or '), W('done', { verb: true, onClick: () => closeReach() }), T('.')]);
      const el = h('div.pr-reach', { 'data-k-hold': '' }, h('div.pr-say.pr-static.pr-reach-text', {}, lines.map(l => h('div.pr-reach-line', {}, ...l))));
      el.addEventListener('click', e => { if (e.target === el) closeReach(); });
      return {
        el,
        update(st) {
          if (refs.sync) refs.sync.setText(SYNC[nearest(SYNC, st.subtitleDelay)][1]);
          if (refs.size) refs.size.setText(SIZES[nearest(SIZES, st.subtitleScale)][1]);
          if (refs.subs) refs.subs.setText('no words');
          refs.vol.setText(volumeWord(st.volume, st.muted));
          const p = st.eqPresets.find(x => x.index === st.eq.preset);
          refs.eq.setText(!st.eq.enabled ? 'as it was made' : p ? EQ_WORDS[p.name] || `tuned ${p.name.toLowerCase()}` : 'shaped by hand');
          refs.night.setText(st.nightMode ? 'softened' : 'left alone');
          if (refs.aud) { const t = st.audioTracks.find(x => x.id === st.audioTrack); refs.aud.setText(t ? trackLabel(t.name) : 'nothing'); }
          if (refs.adel) refs.adel.setText(AUDIO_SYNC[nearest(AUDIO_SYNC, st.audioDelay)][1]);
          if (refs.col) refs.col.setText(COLOURS[look.colour][0]);
          if (refs.light) refs.light.setText(LIGHTS[look.light][0]);
          if (refs.asp) refs.asp.setText((ASPECTS.find(([v]) => v === st.aspect) || [0, `is ${st.aspect}`])[1]);
          refs.rep.setText((REPEAT.find(([v]) => v === st.repeat) || REPEAT[0])[1]);
          refs.top.setText(st.alwaysOnTop ? 'floats above everything' : 'stays where it is');
        },
      };
    }

    // ---------- whispers: short messages from VLC, in the same voice ----------
    let whisperTimer = null;
    on('osd', ({ text }) => {
      if (viewName === 'reach') return;
      whisper.textContent = text;
      whisper.classList.add('pr-on');
      clearTimeout(whisperTimer);
      whisperTimer = setTimeout(() => whisper.classList.remove('pr-on'), 1600);
    });

    // ---------- live state ----------
    let lastTimeRender = 0;
    on('change', (s, keys) => {
      if (s.item && s.item.path !== pausesFor) { pausesFor = s.item.path; pauses = []; }
      if (keys.has('playing') && !s.playing && s.status === 'paused' && s.item) pauses.push(s.time);
      if (keys.has('item') && !s.item) { findOpen = false; reachOpen = false; }
      if (keys.has('fullscreen')) fsWord.setText(s.fullscreen ? 'leave full screen' : 'fill the screen');
      if (keys.has('maximized')) maxWord.setText(s.maximized ? 'smaller window' : 'bigger');
      render();
    });
    on('time', s => {
      const now = performance.now();
      if (now - lastTimeRender < 200) return;
      lastTimeRender = now;
      render();
    });
    const onContext = e => { if (engine.state.item) { e.preventDefault(); reachOpen ? closeReach() : openReach(); } };
    room.addEventListener('contextmenu', onContext);

    render(true);

    return {
      unmount() {
        document.removeEventListener('pointerdown', outside, true);
        closeWheel();
        clearTimeout(whisperTimer);
      },
      onKey(e) {
        if (e.key !== 'Escape') return false;
        if (wheel) { closeWheel(); return true; }
        if (findOpen) { closeFind(); return true; }
        if (reachOpen) { closeReach(); return true; }
        if (libOpen && viewName === 'home') { libOpen = false; render(true); return true; }
        return false;
      },
      onCommand(name) {
        if (name === 'effects' || name === 'tracks' || name === 'info') { openReach(); return true; }
        if (name === 'playlist') { engine.showLibrary(true); return true; }
        return false;
      },
    };
  },
};
