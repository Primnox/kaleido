// App shell: owns the stage, loads skins, and provides keyboard, drag and drop, idle hiding,
// context menu, command palette, skin picker and dialogs that every skin shares.
import { createEngine, fmt } from './engine.js';
import * as ui from './ui.js';
import { SKINS } from '../skins/index.js';

const { h, icon } = ui;
const engine = createEngine();
const body = document.body;

// ---------- stage: the video surface plus shared overlays ----------
const osdEl = h('div.k-osd');
const spinner = h('div.k-spinner', {}, h('i'), h('i'), h('i'));
const errorEl = h('div.k-error');
const stage = h('div.k-stage', {}, engine.canvas, spinner, errorEl, osdEl);
const holding = h('div.k-holding', { style: { display: 'none' } }, stage);
const skinRoot = h('div#skin-root.k-skin-root');
body.append(holding, skinRoot);

let current = null;       // { meta, module, handle, offs, link }
let skinOpts = {};
let skinSeq = 0;

// ---------- OSD ----------
let osdTimer = null;
engine.on('osd', ({ text, icon: ic }) => {
  if (skinOpts.osd === false) return;
  osdEl.replaceChildren(ic ? icon(ic, { size: 20 }) : '', h('span', {}, text));
  osdEl.classList.add('k-show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osdEl.classList.remove('k-show'), 1700);
});

// ---------- body state classes ----------
function syncClasses(s) {
  const loading = s.item && (s.status === 'opening' || (s.status === 'buffering' && s.buffering < 100) || (s.playing && !engine.surface.hasFrame && !s.item.isAudio));
  body.classList.toggle('k-has-media', !!s.item);
  body.classList.toggle('k-playing', s.playing);
  body.classList.toggle('k-paused', !!s.item && !s.playing);
  body.classList.toggle('k-audio', !!(s.item && s.item.isAudio));
  body.classList.toggle('k-fullscreen', s.fullscreen);
  body.classList.toggle('k-loading', !!loading);
  body.classList.toggle('k-errored', s.status === 'error');
  errorEl.textContent = s.status === 'error' ? `${s.error || 'VLC could not play this.'}` : '';
  document.title = s.item ? `${s.item.title || s.item.name} - Kaleido` : 'Kaleido';
}
engine.on('change', syncClasses);
setInterval(() => syncClasses(engine.state), 500);

// ---------- idle hiding ----------
let idleTimer = null;
let pointerOverHold = false;
function wake() {
  if (engine.state.idle) engine.set({ idle: false });
  body.classList.remove('k-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!engine.state.playing || pointerOverHold || ui.menuOpen() || document.querySelector('.k-overlay')) return wake();
    engine.set({ idle: true });
    body.classList.add('k-idle');
  }, skinOpts.idleDelay || 2600);
}
document.addEventListener('pointermove', e => { pointerOverHold = !!(e.target.closest && e.target.closest('[data-k-hold]')); wake(); });
document.addEventListener('pointerdown', wake);
document.addEventListener('keydown', wake, true);
engine.on('change', (s, keys) => { if (keys.has('playing')) wake(); });

// ---------- stage clicks and wheel ----------
let clickTimer = null;
stage.addEventListener('click', e => {
  if (skinOpts.stageClick === false || e.target.closest('[data-k-hold]')) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => (engine.state.item ? engine.toggle() : engine.openDialog()), 220);
});
stage.addEventListener('dblclick', e => {
  clearTimeout(clickTimer);
  if (skinOpts.stageDoubleClick === false || e.target.closest('[data-k-hold]')) return;
  if (current && current.handle && current.handle.onStageDoubleClick && current.handle.onStageDoubleClick(e)) return;
  engine.toggleFullscreen();
});
stage.addEventListener('wheel', e => {
  if (skinOpts.wheelVolume === false || e.target.closest('[data-k-hold]')) return;
  e.preventDefault();
  if (e.ctrlKey) engine.setZoom(engine.state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
  else engine.volumeBy(e.deltaY < 0 ? 5 : -5);
}, { passive: false });

// ---------- context menu ----------
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (skinOpts.contextMenu === false || (e.target.closest && e.target.closest('input, textarea'))) return;
  ui.menu({ x: e.clientX, y: e.clientY }, ui.menus.main(engine, shell), { align: 'down' });
});

// ---------- drag and drop ----------
const dropEl = h('div.k-drop', {}, h('div.k-drop-card', {}, icon('plus', { size: 40 }), h('div', {}, 'Drop to play'), h('small', {}, 'Hold Shift to add to the queue. Subtitle files attach to what is playing.')));
body.append(dropEl);
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; dropEl.classList.add('k-show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropEl.classList.remove('k-show'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove('k-show');
  const paths = [...e.dataTransfer.files].map(f => window.host.pathForFile(f)).filter(Boolean);
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (!paths.length && /^[a-z]+:\/\//i.test(text || '')) paths.push(text.trim());
  if (paths.length) engine.open(paths, { append: e.shiftKey });
});

// ---------- overlays: palette, picker, url dialog, shortcuts, drawers ----------
function overlay(content, { cls = '', onClose } = {}) {
  closeOverlays();
  ui.closeMenus();
  const el = h(`div.k-overlay${cls ? '.' + cls : ''}`, { 'data-k-hold': '' }, content);
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  const close = () => { el.remove(); onClose && onClose(); };
  el.close = close;
  body.append(el);
  return el;
}
function closeOverlays() { document.querySelectorAll('.k-overlay').forEach(o => o.close ? o.close() : o.remove()); }

function commands() {
  const e = engine;
  const s = e.state;
  const list = [
    ['Open files', 'Ctrl+O', () => e.openDialog()],
    ['Open folder', 'Ctrl+F', () => e.openFolderDialog()],
    ['Open network stream', 'Ctrl+N', () => shell.openUrlDialog()],
    ['Add subtitle file', '', () => e.openSubtitleDialog()],
    ['Play or pause', 'Space', () => e.toggle()],
    ['Stop', 'S', () => e.stop()],
    ['Next in queue', 'N', () => e.next()],
    ['Previous in queue', 'P', () => e.prev()],
    ['Toggle fullscreen', 'F', () => e.toggleFullscreen()],
    ['Toggle mute', 'M', () => e.toggleMute()],
    ['Night mode (soften loud scenes)', 'D', () => e.toggleNightMode()],
    ['Cycle audio track', 'B', () => e.cycleAudioTrack()],
    ['Cycle subtitles', 'V', () => e.cycleSubtitleTrack()],
    ['Subtitles earlier', 'G', () => e.subtitleDelayBy(-50)],
    ['Subtitles later', 'H', () => e.subtitleDelayBy(50)],
    ['Audio earlier', 'Ctrl+G', () => e.audioDelayBy(-50)],
    ['Audio later', 'Ctrl+H', () => e.audioDelayBy(50)],
    ['Reset speed', '=', () => e.setRate(1)],
    e.can('frameStep') && ['Next frame', 'E', () => e.frameStep()],
    ['Take snapshot', 'Shift+S', () => e.screenshot()],
    ['A to B loop', 'X', () => e.cycleLoop()],
    ['Cycle aspect ratio', 'A', () => e.cycleAspect()],
    ['Reset zoom', 'Shift+Z', () => e.setZoom(1)],
    ['Shuffle', 'R', () => e.toggleShuffle()],
    ['Cycle repeat', 'Shift+R', () => e.cycleRepeat()],
    e.can('alwaysOnTop') && ['Always on top', 'Ctrl+T', () => e.toggleAlwaysOnTop()],
    e.can('windowButtons') && ['Picture in picture', 'Ctrl+P', () => e.togglePip()],
    ['Mini player', 'Ctrl+M', () => e.toggleMini()],
    ['Bookmark this moment', 'Ctrl+D', () => e.addMark()],
    ['What did they say? Replay with subtitles', 'W', () => e.whatDidTheySay()],
    e.can('dialogue') && ['Search what they say', '/', () => shell.searchDialogue()],
    e.can('clips') && ['Save a clip (the loop, or the last 30 seconds)', 'C', () => e.saveClip()],
    e.can('silence') && [s.settings.skipSilence ? 'Stop skipping silence' : 'Skip silence', '', () => e.toggleSkipSilence()],
    e.can('pauseOnLock') && [s.settings.pauseOnLock === false ? 'Pause when the PC locks' : 'Keep playing when the PC locks', '', () => e.togglePauseOnLock()],
    ['Next bookmark', 'Ctrl+.', () => e.jumpMark(1)],
    ['Previous bookmark', 'Ctrl+;', () => e.jumpMark(-1)],
    ['Show playlist', 'Ctrl+L', () => shell.command('playlist')],
    ['Show effects (EQ, picture, sync)', 'Ctrl+E', () => shell.command('effects')],
    ['Show media info', 'Ctrl+I', () => shell.command('info')],
    e.can('keyboard') && ['Keyboard shortcuts', '?', () => shell.showShortcuts()],
    SKINS.length > 1 && ['Template gallery', 'Ctrl+,', () => shell.openSkinPicker()],
    ['Show library', 'Ctrl+B', () => e.showLibrary(e.state.view !== 'library')],
    ['Add a folder to the library', '', () => e.addLibraryFolder()],
    [s.settings.autoQueue ? 'Stop queueing the rest of the folder' : 'Queue the rest of the folder when opening a file', '', () => e.saveSettings({ autoQueue: !s.settings.autoQueue })],
    [s.settings.resume ? 'Stop remembering where I left off' : 'Remember where I left off', '', () => e.saveSettings({ resume: !s.settings.resume })],
  ].filter(Boolean).map(([label, hint, run]) => ({ label, hint, run, group: 'Actions' }));
  if (SKINS.length > 1) SKINS.forEach(k => list.push({ label: `Template: ${k.name}`, hint: k.line, run: () => setSkin(k.id), group: 'Templates' }));
  s.chapters.forEach((c, i) => list.push({ label: `Chapter: ${c.name || i + 1}`, hint: fmt(c.time), run: () => e.setChapter(i), group: 'Chapters' }));
  s.audioTracks.forEach(t => list.push({ label: `Audio: ${t.name}`, hint: t.id === s.audioTrack ? 'current' : '', run: () => e.setAudioTrack(t.id), group: 'Tracks' }));
  s.subtitleTracks.forEach(t => list.push({ label: `Subtitles: ${t.name}`, hint: t.id === s.subtitleTrack ? 'current' : '', run: () => e.setSubtitleTrack(t.id), group: 'Tracks' }));
  s.eqPresets.forEach(p => list.push({ label: `Equalizer: ${p.name}`, hint: '', run: () => e.applyEqPreset(p.index), group: 'Sound' }));
  [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(r => list.push({ label: `Speed ${r}x`, hint: '', run: () => e.setRate(r), group: 'Speed' }));
  s.playlist.forEach((it, i) => list.push({ label: `Play: ${it.name}`, hint: i === s.index ? 'now' : `#${i + 1}`, run: () => e.playIndex(i), group: 'Queue' }));
  s.recent.forEach(r => list.push({ label: `Recent: ${r.title || r.name}`, hint: r.time && r.duration ? `${Math.round((r.time / r.duration) * 100)}%` : '', run: () => e.open([r.path]), group: 'Recent' }));
  return list;
}

// Subsequence match with a bonus for word starts, good enough for a few hundred commands.
function score(q, label) {
  if (!q) return 1;
  const l = label.toLowerCase();
  if (l.includes(q)) return 100 - l.indexOf(q);
  let i = 0, sc = 0, prev = -2;
  for (const ch of q) {
    const j = l.indexOf(ch, i);
    if (j < 0) return 0;
    sc += j === prev + 1 ? 3 : 1;
    if (j === 0 || l[j - 1] === ' ') sc += 2;
    prev = j;
    i = j + 1;
  }
  return sc;
}

const shell = {
  skins: SKINS,
  get current() { return current && current.meta; },
  setSkin: id => setSkin(id),
  closeOverlays,

  openPalette() {
    const input = h('input.k-palette-input', { placeholder: 'Type a command, track, chapter or file', spellcheck: 'false' });
    const list = h('div.k-palette-list');
    const all = commands();
    let sel = 0;
    let shown = [];
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = all.map(c => ({ c, s: score(q, c.label) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.c);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...shown.map((c, i) => {
        const row = h('button.k-palette-row', { type: 'button', class: i === sel ? 'k-sel' : '' }, h('span.k-palette-group', {}, c.group), h('span.k-palette-label', {}, c.label), c.hint ? h('kbd', {}, c.hint) : null);
        row.addEventListener('click', () => { o.close(); c.run(); });
        row.addEventListener('pointermove', () => { if (sel !== i) { sel = i; render(); } });
        return row;
      }));
      const s = list.querySelector('.k-sel');
      s && s.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = shown[sel]; o.close(); c && c.run(); }
      else if (e.key === 'Escape') { e.preventDefault(); o.close(); }
      e.stopPropagation();
    });
    const o = overlay(h('div.k-palette', {}, h('div.k-palette-bar', {}, icon('search', { size: 18 }), input), list), { cls: 'k-overlay-top' });
    render();
    input.focus();
  },

  // Live try-on gallery: hovering a tile turns the whole app into that template, click keeps it.
  openSkinPicker({ firstRun = false } = {}) {
    const original = current ? current.meta.id : 'orbit';
    let chosen = original;
    let hoverTimer = null;
    const tiles = SKINS.map((k, i) => {
      const tile = h('button.k-gal-tile', { type: 'button', dataset: { id: k.id } },
        h('div.k-gal-shot', {}, h('img', { src: `skins/${k.id}/preview.jpg`, alt: '', onError: e => e.target.remove() }), h('span.k-gal-num', {}, String(i + 1).padStart(2, '0'))),
        h('div.k-gal-name', {}, k.name),
        h('div.k-gal-line', {}, k.line));
      tile.addEventListener('pointerenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => tryOn(k.id), 180); });
      tile.addEventListener('focus', () => tryOn(k.id));
      tile.addEventListener('click', () => { chosen = k.id; keep(); });
      return tile;
    });
    const mark = () => tiles.forEach(t => t.classList.toggle('k-on', t.dataset.id === (current && current.meta.id)));
    const tryOn = id => { if (!current || current.meta.id !== id) setSkin(id, { live: true }).then(mark); };
    const keep = () => { kept = true; o.close(); if (current && current.meta.id === chosen) engine.saveSettings({ skin: chosen }); else setSkin(chosen); };
    let kept = false;
    const strip = h('div.k-gal', {},
      h('div.k-gal-head', {},
        h('span.k-gal-title', {}, firstRun ? 'Pick a template' : 'Templates'),
        h('span.k-gal-hint', {}, 'Hover to try it on. Click to keep. Esc puts it back.')),
      h('div.k-gal-row', {}, tiles));
    strip.addEventListener('keydown', e => {
      const i = tiles.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); tiles[(i + (e.key === 'ArrowRight' ? 1 : -1) + tiles.length) % tiles.length].focus(); }
      if (e.key === 'Enter' && i >= 0) { e.preventDefault(); chosen = tiles[i].dataset.id; keep(); }
    });
    const o = overlay(strip, { cls: 'k-overlay-gallery', onClose: () => { clearTimeout(hoverTimer); if (!kept && current && current.meta.id !== chosen) setSkin(chosen, {}); } });
    o.addEventListener('pointerdown', e => { if (e.target === o) { chosen = current ? current.meta.id : original; kept = true; } }, true);
    mark();
    (tiles.find(t => t.dataset.id === original) || tiles[0]).focus({ preventScroll: true });
  },

  // Search what people say: every subtitle line, filtered as you type, click to go there.
  async searchDialogue() {
    if (!engine.state.item) return;
    const input = h('input.k-palette-input', { placeholder: 'Search what they say', spellcheck: 'false' });
    const list = h('div.k-palette-list');
    const note = h('div.k-say-note', {}, 'Reading the subtitles...');
    const o = overlay(h('div.k-palette.k-say', {}, h('div.k-palette-bar', {}, icon('search', { size: 18 }), input), note, list), { cls: 'k-overlay-top' });
    input.focus();
    const data = await engine.dialogue();
    if (!o.isConnected) return;
    if (!data || !data.cues.length) { note.textContent = 'This file has no subtitle text to search. Drop a .srt file on the player to add one.'; return; }
    note.textContent = `${data.cues.length} lines from ${data.source}`;
    let sel = 0;
    let shown = [];
    const mark = (text, q) => {
      if (!q) return [text];
      const i = text.toLowerCase().indexOf(q);
      return i < 0 ? [text] : [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
    };
    const go = c => { o.close(); engine.seek(Math.max(0, c.start - 0.6)); engine.play(); };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = (q ? data.cues.filter(c => c.text.toLowerCase().includes(q)) : data.cues.filter(c => c.start >= engine.currentTime() - 5)).slice(0, 80);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((c, i) => {
        const row = h('button.k-palette-row.k-say-row', { type: 'button', class: i === sel ? 'k-sel' : '' }, h('kbd', {}, fmt(c.start)), h('span.k-palette-label', {}, ...mark(c.text, q)));
        row.addEventListener('click', () => go(c));
        row.addEventListener('pointermove', () => { if (sel !== i) { sel = i; render(); } });
        return row;
      }) : [h('div.k-empty', {}, 'Nobody says that.')]));
      const s = list.querySelector('.k-sel');
      s && s.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) go(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); o.close(); }
      e.stopPropagation();
    });
    render();
  },

  openUrlDialog() {
    const input = h('input.k-dialog-input', { placeholder: 'https:// rtsp:// udp:// or any URL VLC understands', spellcheck: 'false' });
    const go = () => { const v = input.value.trim(); if (v) { o.close(); engine.openUrl(v); } };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') o.close(); });
    const o = overlay(h('div.k-dialog', {},
      h('h3', {}, 'Open network stream'),
      h('p', {}, 'VLC opens HTTP, HLS, RTSP, RTMP, UDP, SMB and more.'),
      input,
      h('div.k-dialog-actions', {}, h('button.k-btn.k-text-btn', { type: 'button', onClick: () => o.close() }, 'Cancel'), h('button.k-btn.k-text-btn.k-primary', { type: 'button', onClick: go }, 'Play'))));
    input.focus();
  },

  showShortcuts() {
    const groups = [
      ['Playback', [['Space or K', 'Play or pause'], ['S', 'Stop'], ['Left and Right', 'Back or forward 5s'], ['J and L', 'Back or forward 10s'], ['Shift+Left and Right', '1s'], ['Ctrl+Left and Right', '1 minute'], ['0 to 9', 'Jump to 0% to 90%'], ['Home', 'Start over'], ['E', 'Next frame'], ['[ and ]', 'Slower or faster'], ['=', 'Normal speed'], ['X', 'A to B loop']]],
      ['Sound and subtitles', [['Up and Down', 'Volume (up to 200%)'], ['M', 'Mute'], ['D', 'Night mode'], ['B', 'Next audio track'], ['V', 'Next subtitle track'], ['G and H', 'Subtitle delay'], ['Ctrl+G and Ctrl+H', 'Audio delay']]],
      ['Queue and picture', [['N and P', 'Next or previous file'], ['Page Up and Down', 'Chapters'], ['A', 'Aspect ratio'], ['Z and Shift+Z', 'Zoom, reset zoom'], ['Shift+S', 'Snapshot'], ['R and Shift+R', 'Shuffle, repeat']]],
      ['Only in Kaleido', [['W', 'What did they say? Back 10s with subtitles'], ['/', 'Search what they say'], ['C', 'Save a clip'], ['X then X', 'Loop a part, then C to keep it']]],
      ['Bookmarks and mini player', [['Ctrl+D', 'Bookmark this moment'], ['Ctrl+. and Ctrl+;', 'Next or previous bookmark'], ['Ctrl+M', 'Mini player'], ['Double click left or right', 'Back or forward 10s']]],
      ['Window', [['F or double click', 'Fullscreen'], ['Esc', 'Leave fullscreen'], ['Ctrl+B', 'Library'], ['Ctrl+T', 'Always on top'], ['Ctrl+P', 'Picture in picture'], ['Ctrl+K', 'Command palette'], ['Ctrl+Tab', 'Next template'], ['Ctrl+, ', 'Template gallery'], ['Ctrl+O, Ctrl+F, Ctrl+N', 'Open file, folder, stream']]],
    ];
    overlay(h('div.k-shortcuts', {}, h('h3', {}, 'Keyboard shortcuts'), h('div.k-shortcuts-grid', {},
      groups.map(([title, rows]) => h('section', {}, h('h4', {}, title), rows.map(([k, d]) => h('div.k-shortcut', {}, h('kbd', {}, k), h('span', {}, d))))))));
  },

  // Generic side drawer for skins that do not dock a given panel themselves.
  drawer(title, panel) {
    const o = overlay(h('aside.k-drawer', {}, h('div.k-drawer-head', {}, h('h3', {}, title), ui.button('close', 'Close', () => o.close())), panel), { cls: 'k-overlay-drawer', onClose: () => panel.destroy && panel.destroy() });
    return o;
  },
  command(name) {
    if (current && current.handle && current.handle.onCommand && current.handle.onCommand(name)) return;
    if (name === 'playlist') shell.drawer('Queue', ui.panels.playlist(engine));
    else if (name === 'effects') shell.drawer('Effects', h('div.k-drawer-stack', {}, h('h4', {}, 'Equalizer'), ui.panels.eq(engine), h('h4', {}, 'Picture'), ui.panels.adjust(engine), h('h4', {}, 'Sync'), ui.panels.sync(engine)));
    else if (name === 'info') shell.drawer('Media info', ui.panels.info(engine));
    else if (name === 'tracks') shell.drawer('Audio and subtitles', ui.panels.tracks(engine));
  },
};

// ---------- keyboard ----------
const KEYS = [
  [' ', e => e.toggle()], ['k', e => e.toggle()],
  ['ArrowLeft', e => e.seekBy(-5)], ['ArrowRight', e => e.seekBy(5)],
  ['shift+ArrowLeft', e => e.seekBy(-1)], ['shift+ArrowRight', e => e.seekBy(1)],
  ['ctrl+ArrowLeft', e => e.seekBy(-60)], ['ctrl+ArrowRight', e => e.seekBy(60)],
  ['alt+ArrowLeft', e => e.seekBy(-10)], ['alt+ArrowRight', e => e.seekBy(10)],
  ['j', e => e.seekBy(-10)], ['l', e => e.seekBy(10)],
  ['ArrowUp', e => e.volumeBy(5)], ['ArrowDown', e => e.volumeBy(-5)],
  ['ctrl+ArrowUp', e => e.volumeBy(5)], ['ctrl+ArrowDown', e => e.volumeBy(-5)],
  ['m', e => e.toggleMute()], ['f', e => e.toggleFullscreen()],
  ['s', e => e.stop()], ['shift+S', e => e.screenshot()],
  ['n', e => e.next()], ['p', e => e.prev()],
  ['PageDown', e => e.nextChapter()], ['PageUp', e => e.prevChapter()],
  ['b', e => e.cycleAudioTrack()], ['v', e => e.cycleSubtitleTrack()],
  ['g', e => e.subtitleDelayBy(-50)], ['h', e => e.subtitleDelayBy(50)],
  ['ctrl+g', e => e.audioDelayBy(-50)], ['ctrl+h', e => e.audioDelayBy(50)],
  ['[', e => e.rateBy(-0.1)], [']', e => e.rateBy(0.1)], ['-', e => e.rateBy(-0.1)], ['+', e => e.rateBy(0.1)], ['=', e => e.setRate(1)],
  ['e', e => e.frameStep()], ['.', e => e.frameStep()],
  ['x', e => e.cycleLoop()], ['a', e => e.cycleAspect()],
  ['z', e => e.setZoom(e.state.zoom >= 2 ? 1 : e.state.zoom + 0.25)], ['shift+Z', e => e.setZoom(1)],
  ['d', e => e.toggleNightMode()], ['r', e => e.toggleShuffle()], ['shift+R', e => e.cycleRepeat()],
  ['t', e => e.osd(`${fmt(e.currentTime())} of ${fmt(e.state.duration)}`, 'history')],
  ['Home', e => e.seek(0)], ['End', e => e.seek(e.state.duration - 5)],
  ['ctrl+o', e => e.openDialog()], ['ctrl+f', e => e.openFolderDialog()], ['ctrl+n', () => shell.openUrlDialog()],
  ['ctrl+t', e => e.toggleAlwaysOnTop()], ['ctrl+p', e => e.togglePip()], ['ctrl+m', e => e.toggleMini()],
  ['ctrl+d', e => e.addMark()], ['ctrl+.', e => e.jumpMark(1)], ['ctrl+;', e => e.jumpMark(-1)],
  ['w', e => e.whatDidTheySay()], ['/', () => shell.searchDialogue()], ['c', e => e.saveClip()],
  ['ctrl+k', () => shell.openPalette()], ['ctrl+,', () => shell.openSkinPicker()],
  ['ctrl+Tab', () => cycleSkin(1)], ['ctrl+shift+Tab', () => cycleSkin(-1)], ['ctrl+b', e => e.showLibrary(e.state.view !== 'library')],
  ['ctrl+l', () => shell.command('playlist')], ['ctrl+e', () => shell.command('effects')], ['ctrl+i', () => shell.command('info')],
  ['shift+?', () => shell.showShortcuts()], ['?', () => shell.showShortcuts()],
  ['ctrl+q', () => window.host.win.close()], ['ctrl+w', () => window.host.win.close()],
  ['MediaPlayPause', e => e.toggle()], ['MediaTrackNext', e => e.next()], ['MediaTrackPrevious', e => e.prev()], ['MediaStop', e => e.stop()],
];
const keyMap = new Map(KEYS.map(([k, fn]) => [k, fn]));
function keyId(e) {
  let k = e.key.length === 1 ? (e.shiftKey && /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.key.toLowerCase()) : e.key;
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey && (e.key.length > 1 || /[a-z?]/i.test(e.key)) ? 'shift' : ''].filter(Boolean);
  return [...mods, k].join('+');
}
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select') && e.key !== 'Escape') return;
  if (e.key === 'Escape') {
    if (document.querySelector('.k-overlay')) { closeOverlays(); e.preventDefault(); return; }
    if (engine.state.fullscreen) { engine.toggleFullscreen(); e.preventDefault(); return; }
  }
  if (current && current.handle && current.handle.onKey && current.handle.onKey(e)) { e.preventDefault(); return; }
  if (e.key === 'Escape' && engine.state.view === 'library' && engine.state.item) { engine.showLibrary(false); e.preventDefault(); return; }
  if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) { engine.seekPercent(Number(e.key) / 10); e.preventDefault(); return; }
  const fn = keyMap.get(keyId(e));
  if (fn) { e.preventDefault(); fn(engine); }
});

// ---------- skin loading ----------
function cycleSkin(dir) {
  if (SKINS.length < 2) return;
  const i = SKINS.findIndex(k => current && k.id === current.meta.id);
  setSkin(SKINS[(i + dir + SKINS.length) % SKINS.length].id);
}

async function setSkin(id, { live = false } = {}) {
  const meta = SKINS.find(k => k.id === id) || SKINS[0];
  const seq = ++skinSeq;
  const link = h('link', { rel: 'stylesheet', href: `skins/${meta.id}/skin.css` });
  const loaded = new Promise(r => { link.onload = r; link.onerror = r; });
  document.head.append(link);
  let mod;
  try { mod = (await import(`../skins/${meta.id}/skin.js`)).default; }
  catch (err) { console.error(err); link.remove(); engine.osd(`Skin ${meta.name} failed to load`); return; }
  await loaded;
  if (seq !== skinSeq) { link.remove(); return; }

  if (current) {
    try { current.handle && current.handle.unmount && current.handle.unmount(); } catch (err) { console.error(err); }
    current.offs.forEach(o => o());
    current.link.remove();
  }
  ui.closeMenus();
  if (!live) closeOverlays();
  holding.append(stage);
  skinRoot.replaceChildren();
  document.documentElement.dataset.skin = meta.id;
  skinOpts = mod.options || {};
  const offs = [];
  // Scoped engine: every subscription a skin (or a ui component it builds) makes is dropped on unmount.
  const scoped = Object.create(engine);
  scoped.on = (ev, fn) => { const off = engine.on(ev, fn); offs.push(off); return off; };
  const ctx = { root: skinRoot, stage, engine: scoped, ui, shell, meta, on: scoped.on };
  current = { meta, module: mod, handle: null, offs, link };
  try { current.handle = mod.mount(ctx) || {}; }
  catch (err) { console.error(err); engine.osd(`Skin ${meta.name} crashed while loading`); }
  if (!stage.isConnected || stage.parentElement === holding) skinRoot.prepend(stage);
  if (!live) engine.saveSettings({ skin: meta.id });
  syncClasses(engine.state);
  wake();
}

// ---------- boot ----------
document.documentElement.dataset.platform = window.host.platform;
// Phones and tablets: taps and swipes instead of a mouse and keyboard.
if (!engine.can('keyboard')) import('./touch.js').then(m => m.enableTouch(engine, stage));
(async () => {
  await engine.restore();
  engine.connect();
  const st = await window.host.win.state();
  engine.set({ fullscreen: st.fullscreen, maximized: st.maximized });
  const initial = await window.host.initialFiles();
  const forced = new URLSearchParams(location.search).get('skin');
  if (forced || engine.state.settings.skin) await setSkin(forced || engine.state.settings.skin);
  else await setSkin(SKINS[0].id);
  engine.scanLibrary();
  if (initial.length) engine.open(initial);
  window.host.onOpenFiles(files => engine.open(files));
})();

window.kaleido = { engine, shell, ui };
