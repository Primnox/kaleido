// Normal: an ordinary player that gets out of the way, with one special moment.
// Pausing warms the room and holds the picture like a photograph, with the last
// few moments you saw beside it.

import { DOODLES } from './doodles.js';

const ONE_STEP = 14;
// Colour themes: [id, name, background swatch, accent swatch]. The CSS holds the full palettes.
const THEMES = [
  ['tungsten', 'Tungsten', '#120c08', '#f0c98a'],
  ['daylight', 'Daylight', '#f3eee5', '#d9583b'],
  ['neon', 'Neon', '#090a14', '#4fe3ff'],
  ['forest', 'Forest', '#0b120d', '#c8e39a'],
  ['rose', 'Rose', '#120a0e', '#f3a6b8'],
  ['mono', 'Mono', '#0a0a0a', '#ffffff'],
];

function behind(f) {
  if (f < 0.1) return 'just getting started';
  if (f < 0.4) return 'less than half behind you';
  if (f < 0.6) return 'about half behind you';
  if (f < 0.9) return 'more than half behind you';
  return 'nearly done';
}

export default {
  options: { idleDelay: 2600 },

  mount({ root, stage, engine, ui, shell, on }) {
    const { h, icon, button, setIcon } = ui;
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const nameOf = it => (it ? it.title || it.name : '');

    // ---------- themes ----------
    const themeOf = () => (THEMES.some(t => t[0] === engine.state.settings.theme) ? engine.state.settings.theme : 'tungsten');
    const applyTheme = () => { document.documentElement.dataset.theme = themeOf(); };
    const setTheme = id => { engine.saveSettings({ theme: id }); applyTheme(); swatchSync(); };
    const swatches = h('div.nm-swatches', { title: 'Theme' }, THEMES.map(([id, name, bg, accent]) => {
      const b = h('button.nm-swatch', { type: 'button', title: name, 'aria-label': `${name} theme`, dataset: { id }, style: { background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)` } });
      b.addEventListener('click', e => { e.stopPropagation(); setTheme(id); });
      return b;
    }));
    const swatchSync = () => swatches.querySelectorAll('.nm-swatch').forEach(b => b.classList.toggle('nm-on', b.dataset.id === themeOf()));
    const themeItems = () => [{ heading: 'Theme' }, ...THEMES.map(([id, name]) => ({ label: name, checked: themeOf() === id, onSelect: () => setTheme(id) }))];
    applyTheme();
    swatchSync();

    // ---------- top bar ----------
    const title = h('div.nm-title');
    const badges = h('span.nm-badges');
    const sub = h('div.nm-sub');
    const topBar = h('header.nm-top', {}, h('div.nm-titles', {}, h('div.nm-title-row', {}, title, badges), sub), ui.windowButtons(engine));

    // 4K, 1080p, HEVC, 5.1: what the file is, at a glance.
    function badgeList(s) {
      const out = [];
      const v = s.video;
      if (v && v.width) {
        const w = v.width, hh = v.height;
        out.push(w >= 3800 || hh >= 2100 ? '4K' : w >= 2500 || hh >= 1400 ? '1440p' : w >= 1900 || hh >= 1000 ? '1080p' : w >= 1200 || hh >= 700 ? '720p' : `${hh}p`);
        const c = (v.codec || '').toLowerCase();
        const codec = { hevc: 'HEVC', h265: 'HEVC', h264: 'H.264', avc1: 'H.264', av01: 'AV1', vp09: 'VP9', vp90: 'VP9', mpgv: 'MPEG-2', mp4v: 'MPEG-4' }[c];
        if (codec) out.push(codec);
        if (v.fps >= 48) out.push(`${Math.round(v.fps)} fps`);
      }
      const a = s.audioInfo.find(x => s.audioTrack === -1 || x.id === s.audioTrack) || s.audioInfo[0];
      if (a && a.channels) out.push(a.channels >= 8 ? '7.1' : a.channels >= 6 ? '5.1' : a.channels === 1 ? 'Mono' : 'Stereo');
      return out;
    }

    // ---------- bottom bar ----------
    const playBtn = button('play', 'Play (Space)', () => engine.toggle(), { cls: 'nm-play', size: 26 });
    const prevBtn = button('prev', 'Previous (P)', () => engine.prev(), { size: 20 });
    const nextBtn = button('next', 'Next (N)', () => engine.next(), { size: 20 });
    const menuBtn = (ic, label, items) => {
      const b = button(ic, label, () => ui.menu(b, items(), { align: 'up' }), { size: 22 });
      return b;
    };
    const subBtn = menuBtn('subtitles', 'Subtitles (V)', () => ui.menus.subtitles(engine));
    const audBtn = menuBtn('audio', 'Audio (B)', () => ui.menus.audio(engine));
    const speedLabel = h('span.nm-speed');
    const speedBtn = h('button.k-btn.nm-speed-btn', { type: 'button', title: 'Speed' }, speedLabel);
    speedBtn.addEventListener('click', e => { e.stopPropagation(); ui.menu(speedBtn, ui.menus.speed(engine), { align: 'up' }); });
    const moreBtn = menuBtn('settings', 'More', () => [...ui.menus.main(engine, shell), ...themeItems()]);
    const fsBtn = button('fullscreen', 'Full screen (F)', () => engine.toggleFullscreen(), { size: 22 });
    const markBtn = menuBtn('pin', 'Bookmarks (Ctrl+D)', () => {
      const s = engine.state;
      const t = engine.currentTime();
      const here = s.marks.find(m => Math.abs(m.t - t) < 2);
      return [
        here ? { label: 'Remove this bookmark', icon: 'trash', onSelect: () => engine.removeMark(here.t) } : { label: 'Bookmark this moment', icon: 'plus', hint: 'Ctrl+D', onSelect: () => engine.addMark() },
        s.marks.length ? { heading: 'Go back to' } : null,
        ...s.marks.map(m => ({ label: m.chapter ? `${ui.fmt(m.t)}  ${m.chapter}` : ui.fmt(m.t), onSelect: () => engine.seek(m.t) })),
        s.marks.length > 1 ? { label: 'Clear all bookmarks', icon: 'trash', onSelect: () => [...s.marks].forEach(m => engine.removeMark(m.t)) } : null,
      ];
    });
    const queueBtn = button('playlist', 'Queue (Ctrl+L)', () => openQueue(), { size: 22 });
    const miniBtn = button('mini', 'Mini player (Ctrl+M)', () => engine.toggleMini(), { size: 22, cls: 'nm-mini-btn' });
    const bottom = h('footer.nm-bottom', { 'data-k-hold': '' },
      ui.seekbar(engine, { previewWidth: 220 }),
      h('div.nm-row', {},
        h('div.nm-left', {}, playBtn, prevBtn, nextBtn, ui.volume(engine), ui.timeLabel(engine)),
        h('div.nm-right', {}, markBtn, subBtn, audBtn, speedBtn, queueBtn, moreBtn, miniBtn, fsBtn)));
    const openQueue = () => shell.drawer('Queue', ui.panels.playlist(engine, { thumbs: true }));

    // ---------- skip intro and up next ----------
    const skipLabel = h('span');
    const skipBtn = h('button.nm-skip', { type: 'button', 'data-k-hold': '' }, skipLabel, icon('skip', { size: 16 }));
    let skipTo = 0;
    skipBtn.addEventListener('click', e => { e.stopPropagation(); engine.seek(skipTo); });
    const unImg = h('img', { alt: '' });
    const unName = h('div.nm-un-name');
    const unWhen = h('div.nm-un-when');
    const upNext = h('div.nm-upnext', { 'data-k-hold': '' },
      h('div.nm-un-art', {}, unImg),
      h('div.nm-un-text', {}, h('div.nm-un-label', {}, 'Up next'), unName, unWhen,
        h('div.nm-un-acts', {},
          h('button.k-btn.k-text-btn.nm-primary', { type: 'button', onClick: e => { e.stopPropagation(); engine.next(); } }, 'Play now'),
          h('button.k-btn.k-text-btn', { type: 'button', onClick: e => { e.stopPropagation(); engine.holdNext(true); upNext.classList.remove('nm-show'); } }, 'Cancel'))));
    let upNextFor = null;

    // ---------- double click on the sides jumps 10 seconds ----------
    const ripple = h('div.nm-ripple');
    function jump(dir, x, y) {
      engine.seekBy(dir * 10);
      ripple.replaceChildren(icon(dir > 0 ? 'forward' : 'rewind', { size: 34 }));
      ripple.className = `nm-ripple nm-${dir > 0 ? 'right' : 'left'}`;
      void ripple.offsetWidth;
      ripple.classList.add('nm-go');
    }

    const held = h('div.nm-held');
    const home = h('section.nm-home');
    const done = h('div.nm-done');
    const wrap = h('div.nm', {}, stage, ripple, held, done, topBar, skipBtn, upNext, bottom, home);
    root.append(wrap);

    // ---------- where the picture sits ----------
    let photo = false;
    function placeStage() {
      if (!photo) {
        Object.assign(stage.style, { left: '0px', top: '0px', width: `${W()}px`, height: `${H()}px`, transform: 'rotate(0deg)' });
        return;
      }
      const ar = engine.surface.contentAspect();
      let w = W() * 0.5, hh = w / ar;
      if (hh > H() * 0.54) { hh = H() * 0.54; w = hh * ar; }
      const l = W() * 0.57 - w / 2, t = H() * 0.42 - hh / 2;
      Object.assign(stage.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${hh}px`, transform: 'rotate(-1.4deg)' });
      for (const [k, v] of [['--pl', l], ['--pt', t], ['--pw', w], ['--ph', hh]]) wrap.style.setProperty(k, `${Math.round(v)}px`);
    }
    const onResize = () => placeStage();
    window.addEventListener('resize', onResize);

    // ---------- the pause: warm room, the picture held like a photograph ----------
    function hold(s) {
      photo = true;
      engine.surface.setTrim(true);
      // On Android the picture is drawn natively; freeze() puts the current frame on the page first.
      const lift = () => { if (!photo) return; wrap.classList.add('nm-holding'); placeStage(); };
      if (engine.surface.freeze) engine.surface.freeze().then(lift); else lift();
      const ar = engine.surface.contentAspect();
      const t = engine.currentTime();
      const stills = h('div.nm-stills', {}, [3, 2, 1].map(k => {
        const tt = Math.max(0, t - k * ONE_STEP);
        const img = h('img', { alt: '' });
        if (!s.item.isAudio) engine.thumbAt(s.item.path, tt, 360).then(u => { if (u) img.src = u; });
        const b = h('button.nm-still', { type: 'button', title: 'Go back to here', style: { aspectRatio: String(ar) } }, img);
        b.addEventListener('click', e => { e.stopPropagation(); engine.seek(tt); engine.play(); });
        return b;
      }));
      const f = s.duration ? t / s.duration : 0;
      const ch = s.chapters[s.chapter];
      const caption = h('div.nm-caption', {}, h('span.nm-cap-title', {}, nameOf(s.item)), h('span.nm-cap-soft', {}, `, ${ch && ch.name ? `in ${ch.name}, ` : ''}${behind(f)}`));
      const word = (label, fn) => { const b = h('button.nm-word', { type: 'button' }, label); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
      held.replaceChildren(stills, h('div.nm-under', {},
        ui.seekbar(engine, { previewWidth: 200, chapters: true }),
        caption,
        h('div.nm-words', {}, word('carry on', () => engine.play()), word('start over', () => { engine.seek(0); engine.play(); }))));
    }
    function release() {
      if (!photo) return;
      photo = false;
      wrap.classList.remove('nm-holding');
      engine.surface.setTrim(false);
      placeStage();
      held.querySelectorAll('.k-seek').forEach(el => el.destroy && el.destroy());
      setTimeout(() => { if (!photo) held.replaceChildren(); }, 900);
    }

    // ---------- home ----------
    function renderHome(s) {
      const items = engine.galleryItems();
      const recent = items.filter(i => i.recent).slice(0, 8);
      const library = items.filter(i => !i.recent).slice(0, 16);
      const card = it => {
        const pct = it.duration ? Math.min(100, (it.time / it.duration) * 100) : 0;
        const c = h('button.nm-card', { type: 'button', title: it.path },
          h('div.nm-card-art', {}, ui.poster(engine, it, 'nm-card-img'), pct > 0 ? h('div.nm-card-bar', {}, h('i', { style: { width: `${pct}%` } })) : null),
          h('div.nm-card-name', {}, nameOf(it)),
          h('span.nm-card-x', { title: 'Remove from recent', onClick: e => { e.stopPropagation(); engine.forgetRecent(it.path); } }, icon('close', { size: 13 })));
        if (!it.recent) c.querySelector('.nm-card-x').remove();
        c.addEventListener('click', () => engine.open([it.path]));
        return c;
      };
      const act = (label, ic, fn, primary) => h(`button.k-btn.k-text-btn.nm-act${primary ? '.nm-primary' : ''}`, { type: 'button', onClick: fn }, icon(ic, { size: 17 }), label);
      const art = h('div.nm-dd-wrap', { html: DOODLES });
      const last = s.recent.find(r => !r.isAudio);
      if (last) engine.poster(last.path, last.time || 60).then(u => { const img = art.querySelector('.dd-poster'); if (u && img) img.setAttribute('href', u); });
      const underline = h('div.nm-underline', { html: '<svg viewBox="0 0 300 24" preserveAspectRatio="none"><path pathLength="1" d="M4 15 C 60 4, 120 22, 180 11 S 270 8, 296 14"/></svg>' });
      home.replaceChildren(
        h('header.nm-home-top', {}, h('span.nm-brand', {}, h('img.nm-brand-mark', { src: '../assets/logo.svg', alt: '' }), 'Kaleido'), h('div.nm-home-tools', {}, swatches, ui.windowButtons(engine))),
        h('section.nm-hero', {}, art,
          h('div.nm-hero-text', {},
            h('div.nm-wordrow', {}, h('img.nm-mark', { src: '../assets/logo.svg', alt: '' }), h('h1.nm-wordmark', {}, 'Kaleido')), underline,
            h('p.nm-tag', {}, 'Plays anything VLC plays.', h('br'), 'Remembers where you stopped.'),
            h('div.nm-start-row', {},
              act('Open file', 'file', () => engine.openDialog(), true),
              act('Open folder', 'folder', () => engine.openFolderDialog()),
              act('Open URL', 'link', () => shell.openUrlDialog())),
            h('div.nm-hint', {}, 'or drop videos anywhere'))),
        h('div.nm-home-body', {},
          recent.length ? h('section.nm-shelf', {}, h('h2', {}, 'Continue watching'), h('div.nm-grid', {}, recent.map(card))) : null,
          library.length ? h('section.nm-shelf', {}, h('h2', {}, 'Library'), h('div.nm-grid', {}, library.map(card))) : null,
          !library.length ? h('button.nm-link', { type: 'button', onClick: () => engine.addLibraryFolder() }, 'Add a folder to your library') : null));
    }

    // ---------- the end of the queue ----------
    function renderDone(s) {
      done.replaceChildren(h('div.nm-done-box', {},
        h('button.k-btn.k-text-btn.nm-primary', { type: 'button', onClick: () => engine.play() }, icon('history', { size: 18 }), 'Watch again'),
        h('button.k-btn.k-text-btn', { type: 'button', onClick: () => engine.stop() }, 'Close')));
    }

    // ---------- live state ----------
    let mode = '';
    let homeKey = '';
    function sync(s, keys) {
      const m = !s.item || s.view === 'library' ? 'home' : s.status === 'ended' ? 'done' : !s.playing && s.status === 'paused' && !s.mini ? 'held' : 'play';
      if (m !== mode) {
        const was = mode;
        mode = m;
        wrap.dataset.mode = m;
        if (m === 'held') hold(s);
        else if (was === 'held') release();
        if (m === 'done') renderDone(s);
      }
      if (m === 'home') {
        const k = `${s.recent.map(r => r.path + r.time).join()}|${s.library.length}`;
        if (k !== homeKey) { homeKey = k; renderHome(s); }
      }
      if (!keys || keys.has('playing')) setIcon(playBtn, s.playing ? 'pause' : 'play');
      if (!keys || keys.has('fullscreen')) setIcon(fsBtn, s.fullscreen ? 'exitFullscreen' : 'fullscreen');
      if (!keys || keys.has('item') || keys.has('chapter') || keys.has('index') || keys.has('playlist')) {
        title.textContent = nameOf(s.item);
        const ch = s.chapters[s.chapter];
        sub.textContent = [ch && ch.name, s.playlist.length > 1 ? `${s.index + 1} of ${s.playlist.length}` : ''].filter(Boolean).join('   ');
      }
      if (!keys || keys.has('rate')) speedLabel.textContent = s.rate === 1 ? '1x' : `${s.rate}x`;
      if (!keys || keys.has('subtitleTrack')) subBtn.classList.toggle('k-on', s.subtitleTrack !== -1);
      if (!keys || keys.has('video') || keys.has('audioInfo') || keys.has('audioTrack')) badges.replaceChildren(...badgeList(s).map(b => h('i.nm-badge', {}, b)));
      if (!keys || keys.has('marks')) markBtn.classList.toggle('k-on', s.marks.length > 0);
      if (!keys || keys.has('mini')) { wrap.classList.toggle('nm-mini', s.mini); setIcon(miniBtn, s.mini ? 'expand' : 'mini'); miniBtn.title = s.mini ? 'Back to the full window (Ctrl+M)' : 'Mini player (Ctrl+M)'; }
      nextBtn.disabled = !engine.upNext();
      audBtn.hidden = s.audioTracks.length < 2;
    }
    on('change', sync);
    // A new item can change the picture's shape while held.
    on('change', (s, keys) => { if (photo && keys.has('video')) placeStage(); });

    // Skip intro while a chapter called Intro, Opening or Recap plays; up next in the last 20 seconds.
    let tick = 0;
    on('time', s => {
      const now = performance.now();
      if (now - tick < 250) return;
      tick = now;
      const sk = s.playing && s.settings.skipIntro ? engine.skippable() : null;
      const showSkip = !!(sk && !/credit|ending|\bed\b/i.test(sk.name) && s.time < sk.until - 2);
      if (showSkip) { skipTo = sk.until; skipLabel.textContent = /recap|previously/i.test(sk.name) ? 'Skip recap' : 'Skip intro'; }
      skipBtn.classList.toggle('nm-show', showSkip);

      const nxt = engine.upNext();
      const left = s.duration - s.time;
      const show = !!(nxt && s.item && s.playing && s.duration > 120 && left < 20 && left > 0 && !engine.isHeld());
      if (show) {
        if (upNextFor !== nxt.path) {
          upNextFor = nxt.path;
          unName.textContent = nxt.name;
          unImg.removeAttribute('src');
          engine.poster(nxt.path, 120).then(u => { if (u && upNextFor === nxt.path) unImg.src = u; });
        }
        const n = Math.max(1, Math.ceil(left));
        unWhen.textContent = `Starts in ${n} second${n === 1 ? '' : 's'}`;
      }
      upNext.classList.toggle('nm-show', show);
    });

    placeStage();
    sync(engine.state, null);

    return {
      unmount() {
        delete document.documentElement.dataset.theme;
        window.removeEventListener('resize', onResize);
        engine.surface.setTrim(false);
        Object.assign(stage.style, { left: '', top: '', width: '', height: '', transform: '' });
      },
      onCommand(name) {
        if (name === 'playlist') { openQueue(); return true; }
        return false;
      },
      // Double click on the left or right third jumps back or forward 10 seconds; the middle goes full screen.
      onStageDoubleClick(e) {
        if (mode !== 'play' || engine.state.mini) return false;
        const x = e.clientX / W();
        if (x < 0.3) { jump(-1); return true; }
        if (x > 0.7) { jump(1); return true; }
        return false;
      },
    };
  },
};
