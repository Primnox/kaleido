// Player state for the UI. Talks to the libVLC engine over a local WebSocket and keeps
// one plain state object that every skin reads. See docs/SKIN_API.md for the contract.
import { createVideoSurface } from './video.js';

const host = window.host;
const baseName = p => (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) ? decodeURIComponent(p.split(/[?#]/)[0].split('/').filter(Boolean).pop() || p) : p.split(/[\\/]/).pop());
const stripExt = n => n.replace(/\.[a-z0-9]{1,5}$/i, '');
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|alac|aiff?|ape|mka|wv)$/i;
const SUB_EXT = /\.(srt|vtt|ass|ssa|sub|idx|smi)$/i;
const fileUri = p => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  return 'file:///' + parts.map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/');
};

export const ASPECTS = ['auto', '16:9', '4:3', '21:9', '2.39:1', '1:1', 'fill', 'crop'];
export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
export const DEINTERLACE = ['', 'blend', 'bob', 'linear', 'x', 'yadif', 'yadif2x', 'phosphor', 'ivtc'];
const DEFAULT_ADJUST = { enabled: false, brightness: 1, contrast: 1, saturation: 1, hue: 0, gamma: 1 };

export function createEngine() {
  const surface = createVideoSurface();
  const listeners = new Map();
  const on = (ev, fn) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  };
  const emit = (ev, ...args) => (listeners.get(ev) || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });

  const state = {
    connected: false, version: '',
    status: 'idle', playing: false, time: 0, duration: 0, buffering: 100,
    volume: 100, muted: false, rate: 1,
    item: null, video: null, audioInfo: [], meta: {},
    audioTracks: [], audioTrack: -1, subtitleTracks: [], subtitleTrack: -1,
    chapters: [], chapter: -1,
    subtitleDelay: 0, audioDelay: 0, subtitleScale: 100,
    playlist: [], index: -1, shuffle: false, repeat: 'off',
    loopA: null, loopB: null,
    fullscreen: false, maximized: false, alwaysOnTop: false, pip: false,
    aspect: 'auto', zoom: 1,
    eq: { enabled: false, preset: 0, preamp: 12, bands: Array(10).fill(0) }, eqBands: [], eqPresets: [],
    adjust: { ...DEFAULT_ADJUST }, deinterlace: '', nightMode: false,
    recent: [], resume: {}, settings: { skin: null, autoQueue: true, resume: true, skipIntro: true, visualizer: 'spectrum', libraryFolders: null },
    error: null, idle: false, thumbs: true,
    library: [], libraryScanning: false, view: 'player', scene: null,
  };

  // ---------- change batching ----------
  let changed = new Set();
  let flushQueued = false;
  function set(patch) {
    for (const k in patch) {
      if (state[k] !== patch[k]) { state[k] = patch[k]; changed.add(k); }
    }
    if (changed.size && !flushQueued) {
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        const keys = changed;
        changed = new Set();
        emit('change', state, keys);
      });
    }
  }
  const osd = (text, icon = null) => emit('osd', { text, icon });

  // ---------- persistence ----------
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => host.storeSet({
      settings: state.settings, recent: state.recent, resume: state.resume,
      volume: state.volume, muted: state.muted, eq: state.eq, nightMode: state.nightMode, subtitleScale: state.subtitleScale,
    }), 400);
  }
  async function restore() {
    const s = await host.storeGet();
    set({
      settings: { ...state.settings, ...(s.settings || {}) },
      recent: s.recent || [], resume: s.resume || {},
      volume: s.volume ?? 100, muted: !!s.muted,
      eq: s.eq ? { ...state.eq, ...s.eq } : state.eq, nightMode: !!s.nightMode, subtitleScale: s.subtitleScale || 100,
    });
  }
  function saveSettings(patch) { set({ settings: { ...state.settings, ...patch } }); persist(); }

  // ---------- engine connection ----------
  let ws = null;
  const queue = [];
  const send = msg => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else queue.push(msg);
  };

  async function connect(info) {
    try { info = info || await host.engineInfo(); }
    catch (e) { set({ status: 'error', error: String(e.message || e) }); return; }
    const sock = new WebSocket(`ws://127.0.0.1:${info.port}/?k=${info.token}`);
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      ws = sock;
      set({ connected: true });
      const dpr = window.devicePixelRatio || 1;
      send({ cmd: 'size', width: Math.min(3840, screen.width * dpr), height: Math.min(2160, screen.height * dpr) });
      applyAudioSettings();
      while (queue.length) sock.send(JSON.stringify(queue.shift()));
    };
    sock.onmessage = e => (typeof e.data === 'string' ? onEvent(JSON.parse(e.data)) : surface.pushFrame(e.data));
    sock.onclose = () => {
      if (ws === sock) ws = null;
      set({ connected: false });
      setTimeout(() => connect(), 800);
    };
  }
  host.onEngineRestarted(info => {
    if (ws) try { ws.close(); } catch {}
    connect(info).then(() => { if (state.item) reopen(); });
  });

  function applyAudioSettings() {
    send({ cmd: 'volume', value: state.volume });
    send({ cmd: 'mute', value: state.muted });
    send({ cmd: 'eq', ...state.eq });
  }

  // ---------- time interpolation ----------
  let base = { time: 0, at: performance.now() };
  let seekGuardUntil = 0;
  let seekTarget = 0;
  const currentTime = () => {
    if (!state.playing) return base.time;
    const t = base.time + ((performance.now() - base.at) / 1000) * state.rate;
    return state.duration ? Math.min(t, state.duration) : t;
  };
  function setBase(t) { base = { time: t, at: performance.now() }; }
  function tick() {
    if (state.playing || state.status === 'buffering') {
      const t = currentTime();
      state.time = t;
      if (state.loopB != null && state.loopA != null && t >= state.loopB) seek(state.loopA);
      emit('time', state);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- events from VLC ----------
  let pendingReselect = null;
  let lastResumeSave = 0;
  function onEvent(m) {
    switch (m.ev) {
      case 'hello':
        set({ version: m.version, eqBands: m.bands, eqPresets: m.presets });
        break;
      case 'state': {
        // VLC reports "stopped" right after "ended"; keep the ended state so templates can show the end.
        if (m.state === 'stopped' && state.status === 'ended') break;
        const playing = m.state === 'playing';
        if (m.state === 'playing' || m.state === 'paused') setBase(currentTime());
        set({ status: m.state === 'stopped' && !state.item ? 'idle' : m.state, playing, error: m.state === 'error' ? (m.message || 'VLC could not play this file') : null });
        if (m.state === 'ended') onEnded();
        if (m.state === 'paused' || m.state === 'stopped') saveResume(true);
        break;
      }
      case 'buffering':
        set({ buffering: m.value });
        break;
      case 'length':
        set({ duration: m.length / 1000 });
        break;
      case 'time': {
        const t = m.time / 1000;
        if (performance.now() < seekGuardUntil && Math.abs(t - seekTarget) > 1.5) break;
        setBase(t);
        state.time = t;
        if (m.length > 0) set({ duration: m.length / 1000 });
        if (!state.playing) emit('time', state);
        updateChapter(t);
        if (performance.now() - lastResumeSave > 5000) { lastResumeSave = performance.now(); saveResume(); }
        break;
      }
      case 'format':
        if (m.width) { formatInfo = m; surface.setGeometry({ ...(state.video || {}), sourceWidth: m.sourceWidth, sourceHeight: m.sourceHeight }); }
        break;
      case 'tracks': onTracks(m); break;
      case 'snapshot':
        osd('Snapshot saved', 'camera');
        emit('snapshot', m.path);
        break;
    }
  }
  let formatInfo = null;

  function onTracks(m) {
    const meta = m.meta || {};
    const item = state.item ? { ...state.item } : null;
    if (item) {
      if (meta.title && meta.title !== item.fileName) item.title = meta.title;
      item.artist = meta.artist || item.artist || '';
      item.album = meta.album || item.album || '';
      item.artwork = meta.artwork || item.artwork || '';
      item.isAudio = !m.video && (m.audioInfo || []).length > 0;
    }
    const video = m.video ? { ...m.video, sar: m.video.sarNum && m.video.sarDen ? m.video.sarNum / m.video.sarDen : 1 } : null;
    set({
      item, video, meta, audioInfo: m.audioInfo || [],
      audioTracks: (m.audio || []).filter(t => t.id !== -1), audioTrack: m.audioTrack,
      subtitleTracks: (m.spu || []).filter(t => t.id !== -1), subtitleTrack: m.spuTrack,
      chapters: (m.chapters || []).map(c => ({ time: c.time / 1000, duration: c.duration / 1000, name: c.name })),
    });
    if (video) surface.setGeometry({ ...video, sourceWidth: formatInfo && formatInfo.sourceWidth, sourceHeight: formatInfo && formatInfo.sourceHeight });
    if (pendingReselect) {
      const r = pendingReselect;
      pendingReselect = null;
      if (r.audio != null && r.audio !== m.audioTrack && state.audioTracks.some(t => t.id === r.audio)) send({ cmd: 'audioTrack', id: r.audio });
      if (r.spu != null && r.spu !== m.spuTrack) send({ cmd: 'spuTrack', id: r.spu });
      if (r.spuDelay) send({ cmd: 'spuDelay', ms: r.spuDelay });
      if (r.audioDelay) send({ cmd: 'audioDelay', ms: r.audioDelay });
    }
    if (item && state.recent[0] && state.recent[0].path === item.path && (item.title || item.isAudio)) {
      state.recent[0] = { ...state.recent[0], title: item.title || '', isAudio: item.isAudio };
    }
  }

  function updateChapter(t) {
    const ch = state.chapters;
    if (!ch.length) return;
    let idx = -1;
    for (let i = 0; i < ch.length; i++) if (t >= ch[i].time - 0.05) idx = i;
    if (idx !== state.chapter) set({ chapter: idx });
  }

  // ---------- resume and recent ----------
  function saveResume(force) {
    const it = state.item;
    if (!it || !state.settings.resume || !state.duration) return;
    const t = currentTime();
    const resume = { ...state.resume };
    if (t < 15 || t > state.duration - 20) delete resume[it.path];
    else resume[it.path] = { time: t, duration: state.duration, updated: Date.now() };
    const keys = Object.keys(resume);
    if (keys.length > 400) keys.sort((a, b) => resume[a].updated - resume[b].updated).slice(0, keys.length - 400).forEach(k => delete resume[k]);
    state.resume = resume;
    const ri = state.recent.findIndex(r => r.path === it.path);
    if (ri >= 0) state.recent[ri] = { ...state.recent[ri], time: t, duration: state.duration };
    if (force) set({ recent: [...state.recent] });
    persist();
  }
  function touchRecent(item) {
    const recent = [{ path: item.path, name: item.name, isAudio: item.isAudio, updated: Date.now(), time: 0, duration: 0 },
      ...state.recent.filter(r => r.path !== item.path)].slice(0, 30);
    const prev = state.recent.find(r => r.path === item.path);
    if (prev) Object.assign(recent[0], { time: prev.time, duration: prev.duration, title: prev.title });
    set({ recent });
    persist();
  }
  function forgetRecent(path) {
    const resume = { ...state.resume };
    delete resume[path];
    set({ recent: state.recent.filter(r => r.path !== path), resume });
    persist();
  }

  // ---------- loading ----------
  const makeItem = p => ({ path: p, name: baseName(p), fileName: baseName(p), title: '', isAudio: AUDIO_EXT.test(p) });

  function mediaOptions(extra = []) {
    const o = [...extra];
    if (state.nightMode) o.push('audio-filter=compressor', 'compressor-makeup-gain=10', 'compressor-ratio=5', 'compressor-threshold=-24');
    if (state.subtitleScale !== 100) o.push(`sub-text-scale=${state.subtitleScale}`);
    return o;
  }

  function load(index, { start = null, paused = false, reselect = null } = {}) {
    const entry = state.playlist[index];
    if (!entry) return;
    if (state.item) saveResume();
    const item = makeItem(entry.path);
    const resumeAt = start == null && state.settings.resume ? (state.resume[item.path] || {}).time || 0 : 0;
    const at = start ?? resumeAt;
    surface.clear();
    formatInfo = null;
    pendingReselect = reselect;
    set({
      index, item, status: 'opening', playing: false, time: at, duration: 0, error: null, video: null, meta: {},
      audioTracks: [], subtitleTracks: [], audioTrack: -1, subtitleTrack: -1, chapters: [], chapter: -1,
      loopA: null, loopB: null, rate: 1, buffering: 0, subtitleDelay: reselect ? state.subtitleDelay : 0, audioDelay: reselect ? state.audioDelay : 0,
    });
    setBase(at);
    send({ cmd: 'open', path: item.path, start: at, paused, options: mediaOptions(item.isAudio ? visualizerOptions() : []) });
    send({ cmd: 'rate', value: 1 });
    if (state.adjust.enabled) send({ cmd: 'adjust', ...state.adjust });
    if (state.deinterlace) send({ cmd: 'deinterlace', mode: state.deinterlace });
    if (!reselect) {
      touchRecent(item);
      if (resumeAt > 0) osd(`Resumed at ${fmt(resumeAt)}. Press Home to start over.`, 'history');
    }
    if (state.view !== 'player' && !reselect) set({ view: 'player' });
    emit('loaded', item);
    prefetchThumbs(item.path);
  }

  // VLC's own audio visualizations (spectrum, scope, vuMeter, spectrometer, goom) render as video frames.
  function visualizerOptions() {
    const v = state.settings.visualizer;
    if (!v) return [];
    return v === 'goom' ? ['audio-visual=goom'] : ['audio-visual=visual', `effect-list=${v}`];
  }
  function setVisualizer(v) { saveSettings({ visualizer: v }); if (state.item && state.item.isAudio) reopen(); }

  // Re-open the current file at the same spot (VLC needs this for audio filter changes).
  function reopen() {
    if (!state.item) return;
    load(state.index, {
      start: currentTime(), paused: !state.playing && state.status !== 'opening',
      reselect: { audio: state.audioTrack, spu: state.subtitleTrack, spuDelay: state.subtitleDelay, audioDelay: state.audioDelay },
    });
  }

  async function open(paths, { append = false, start = null } = {}) {
    if (!paths || !paths.length) return;
    const files = await host.expand(paths);
    const subs = files.filter(f => SUB_EXT.test(f));
    let media = files.filter(f => !SUB_EXT.test(f));
    if (!media.length) {
      if (subs.length && state.item) subs.forEach(addSubtitle);
      else if (paths.length) osd('Nothing playable there');
      return;
    }
    let startIdx = 0;
    if (!append && media.length === 1 && state.settings.autoQueue && !/^[a-z]+:\/\//i.test(media[0])) {
      const sib = await host.siblings(media[0]);
      const i = sib.findIndex(p => p.toLowerCase() === media[0].toLowerCase());
      if (i >= 0) { startIdx = i; media = sib; }
    }
    const items = media.map(p => ({ path: p, name: baseName(p) }));
    if (append && state.playlist.length) {
      set({ playlist: [...state.playlist, ...items] });
      osd(`Added ${items.length} to the queue`, 'queue');
    } else {
      set({ playlist: items });
      load(startIdx, { start });
    }
    if (subs.length) setTimeout(() => subs.forEach(addSubtitle), 800);
  }

  function addSubtitle(path) {
    if (!state.item) return;
    send({ cmd: 'addSubtitle', uri: fileUri(path) });
    osd(`Subtitles loaded: ${baseName(path)}`, 'subtitles');
  }

  // A template can ask the queue to stop after the current file ("not now").
  let holdFor = null;
  const holdNext = (v = true) => { holdFor = v && state.item ? state.item.path : null; };
  const isHeld = () => !!(holdFor && state.item && holdFor === state.item.path);

  function onEnded() {
    saveResume(true);
    if (isHeld()) { setBase(state.duration); state.time = state.duration; set({ playing: false, status: 'ended' }); emit('ended', state); return; }
    if (state.repeat === 'one') return load(state.index, { start: 0 });
    const n = nextIndex();
    if (n != null) load(n, { start: 0 });
    else { setBase(state.duration); state.time = state.duration; set({ playing: false, status: 'ended' }); emit('ended', state); }
  }

  let shuffleOrder = [];
  function nextIndex() {
    const len = state.playlist.length;
    if (!len) return null;
    if (state.shuffle) {
      if (!shuffleOrder.length) shuffleOrder = [...Array(len).keys()].filter(i => i !== state.index).sort(() => Math.random() - 0.5);
      return shuffleOrder.length ? shuffleOrder.shift() : state.repeat === 'all' ? 0 : null;
    }
    if (state.index + 1 < len) return state.index + 1;
    return state.repeat === 'all' ? 0 : null;
  }

  // ---------- playback commands ----------
  function play() {
    if (!state.item) { if (state.playlist.length) load(0); return; }
    if (state.status === 'ended' || state.status === 'stopped' || state.status === 'error') return load(state.index, { start: state.status === 'ended' ? 0 : currentTime() });
    send({ cmd: 'play' });
  }
  function pause() { send({ cmd: 'pause' }); }
  function toggle() { state.playing ? pause() : play(); }
  function stop() {
    saveResume(true);
    send({ cmd: 'stop' });
    surface.clear();
    set({ item: null, status: 'idle', playing: false, time: 0, duration: 0, video: null, chapters: [], audioTracks: [], subtitleTracks: [], scene: null });
  }
  function seek(t) {
    if (!state.item) return;
    const d = state.duration || Infinity;
    t = Math.max(0, Math.min(t, d - 0.25));
    if (state.status === 'ended') return load(state.index, { start: t });
    seekTarget = t;
    seekGuardUntil = performance.now() + 600;
    setBase(t);
    state.time = t;
    send({ cmd: 'seek', time: t });
    emit('time', state);
    emit('seek', t);
  }
  const seekBy = dt => { seek(currentTime() + dt); osd(`${dt > 0 ? 'Forward' : 'Back'} ${Math.abs(dt)}s`, dt > 0 ? 'forward' : 'rewind'); };
  const seekPercent = p => seek((state.duration || 0) * p);

  function setVolume(v) {
    v = Math.round(Math.max(0, Math.min(200, v)));
    set({ volume: v, muted: v === 0 ? state.muted : false });
    send({ cmd: 'volume', value: v });
    if (!state.muted) send({ cmd: 'mute', value: false });
    persist();
  }
  const volumeBy = dv => { setVolume(state.volume + dv); osd(`Volume ${state.volume}%`, 'volume'); };
  function toggleMute() {
    set({ muted: !state.muted });
    send({ cmd: 'mute', value: state.muted });
    osd(state.muted ? 'Muted' : `Volume ${state.volume}%`, state.muted ? 'mute' : 'volume');
    persist();
  }
  function setRate(r) {
    r = Math.round(Math.max(0.25, Math.min(4, r)) * 100) / 100;
    setBase(currentTime());
    set({ rate: r });
    send({ cmd: 'rate', value: r });
    osd(`Speed ${r}x`, 'speed');
  }
  const rateBy = dr => setRate(state.rate + dr);

  const next = () => { const n = nextIndex(); if (n != null) load(n, { start: 0 }); else osd('End of the queue'); };
  function prev() {
    if (currentTime() > 5) return seek(0);
    if (state.index > 0) load(state.index - 1, { start: 0 });
    else seek(0);
  }
  const playIndex = i => load(i, { start: null });
  function removeIndex(i) {
    const playlist = state.playlist.filter((_, j) => j !== i);
    let index = state.index;
    if (i < index) index--;
    set({ playlist, index });
    if (i === state.index) playlist.length ? load(Math.min(i, playlist.length - 1)) : stop();
  }
  function moveItem(from, to) {
    const playlist = [...state.playlist];
    const [it] = playlist.splice(from, 1);
    playlist.splice(to, 0, it);
    let index = state.index;
    if (from === index) index = to;
    else if (from < index && to >= index) index--;
    else if (from > index && to <= index) index++;
    set({ playlist, index });
  }
  const clearPlaylist = () => { set({ playlist: state.item ? [state.playlist[state.index]] : [], index: state.item ? 0 : -1 }); };
  function toggleShuffle() { shuffleOrder = []; set({ shuffle: !state.shuffle }); osd(state.shuffle ? 'Shuffle on' : 'Shuffle off', 'shuffle'); }
  function cycleRepeat() {
    const order = ['off', 'all', 'one'];
    set({ repeat: order[(order.indexOf(state.repeat) + 1) % 3] });
    osd({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this one' }[state.repeat], 'repeat');
  }

  function setAudioTrack(id) {
    send({ cmd: 'audioTrack', id });
    set({ audioTrack: id });
    const t = state.audioTracks.find(x => x.id === id);
    osd(`Audio: ${t ? t.name : 'off'}`, 'audio');
  }
  function cycleAudioTrack() {
    const ts = state.audioTracks;
    if (!ts.length) return osd('No audio tracks');
    const i = ts.findIndex(t => t.id === state.audioTrack);
    setAudioTrack(ts[(i + 1) % ts.length].id);
  }
  function setSubtitleTrack(id) {
    send({ cmd: 'spuTrack', id });
    set({ subtitleTrack: id });
    const t = state.subtitleTracks.find(x => x.id === id);
    osd(`Subtitles: ${t ? t.name : 'off'}`, 'subtitles');
  }
  function cycleSubtitleTrack() {
    const ids = [-1, ...state.subtitleTracks.map(t => t.id)];
    if (ids.length === 1) return osd('No subtitles. Drop a subtitle file to add one.');
    setSubtitleTrack(ids[(ids.indexOf(state.subtitleTrack) + 1) % ids.length]);
  }
  function setSubtitleDelay(ms) { set({ subtitleDelay: Math.round(ms) }); send({ cmd: 'spuDelay', ms: state.subtitleDelay }); osd(`Subtitle delay ${state.subtitleDelay} ms`, 'subtitles'); }
  const subtitleDelayBy = d => setSubtitleDelay(state.subtitleDelay + d);
  function setAudioDelay(ms) { set({ audioDelay: Math.round(ms) }); send({ cmd: 'audioDelay', ms: state.audioDelay }); osd(`Audio delay ${state.audioDelay} ms`, 'audio'); }
  const audioDelayBy = d => setAudioDelay(state.audioDelay + d);
  function setSubtitleScale(pct) { set({ subtitleScale: Math.max(30, Math.min(300, Math.round(pct))) }); persist(); osd(`Subtitle size ${state.subtitleScale}%`, 'subtitles'); reopen(); }

  function setChapter(i) {
    const c = state.chapters[i];
    if (!c) return;
    seek(c.time + 0.01);
    osd(c.name || `Chapter ${i + 1}`, 'chapter');
  }
  const nextChapter = () => (state.chapter + 1 < state.chapters.length ? setChapter(state.chapter + 1) : osd('Last chapter'));
  const prevChapter = () => setChapter(Math.max(0, currentTime() - (state.chapters[state.chapter] || {}).time > 3 ? state.chapter : state.chapter - 1));
  // A chapter called intro, opening, recap or credits gets a skip button in skins that want one.
  function skippable() {
    const c = state.chapters[state.chapter];
    if (!c || !/\b(intro|opening|op|recap|previously|credits|ending|ed)\b/i.test(c.name)) return null;
    return { name: c.name, until: c.time + c.duration };
  }

  function frameStep() {
    if (state.playing) pause();
    send({ cmd: 'frame' });
    const fps = (state.video && state.video.fps) || 25;
    setBase(currentTime() + 1 / fps);
    osd('Next frame', 'frame');
  }
  async function screenshot() {
    if (!state.item || state.item.isAudio) return osd('Nothing to capture');
    const path = await host.snapshotPath(stripExt(state.item.name));
    send({ cmd: 'snapshot', path });
  }
  function cycleLoop() {
    const t = currentTime();
    if (state.loopA == null) { set({ loopA: t }); osd(`Loop start ${fmt(t)}`, 'loop'); }
    else if (state.loopB == null && t > state.loopA) { set({ loopB: t }); osd(`Looping ${fmt(state.loopA)} to ${fmt(t)}`, 'loop'); }
    else { set({ loopA: null, loopB: null }); osd('Loop off', 'loop'); }
  }

  function toggleFullscreen() { host.win.setFullScreen(!state.fullscreen); }
  function toggleAlwaysOnTop() { set({ alwaysOnTop: !state.alwaysOnTop }); host.win.setAlwaysOnTop(state.alwaysOnTop); osd(state.alwaysOnTop ? 'Always on top' : 'Normal window', 'pin'); }
  let pipVideo = null;
  async function togglePip() {
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
      if (!pipVideo) {
        pipVideo = document.createElement('video');
        pipVideo.muted = true;
        pipVideo.srcObject = surface.canvas.captureStream(30);
        pipVideo.addEventListener('leavepictureinpicture', () => set({ pip: false }));
      }
      await pipVideo.play();
      await pipVideo.requestPictureInPicture();
      set({ pip: true });
    } catch (e) { osd('Picture in picture is not available here'); }
  }
  host.onFullScreen(v => set({ fullscreen: v }));
  host.onMaximized(v => set({ maximized: v }));

  function setAspect(a) { set({ aspect: a }); surface.setView({ aspect: a }); osd(`Aspect ${a === 'auto' ? 'original' : a}`, 'aspect'); }
  const cycleAspect = () => setAspect(ASPECTS[(ASPECTS.indexOf(state.aspect) + 1) % ASPECTS.length]);
  function setZoom(z) { z = Math.max(0.5, Math.min(4, Math.round(z * 100) / 100)); set({ zoom: z }); surface.setView({ zoom: z }); osd(`Zoom ${Math.round(z * 100)}%`, 'zoom'); }

  function setEq(patch) {
    const eq = { ...state.eq, ...patch };
    set({ eq });
    send({ cmd: 'eq', ...eq });
    persist();
  }
  function applyEqPreset(index) {
    const p = state.eqPresets.find(x => x.index === index);
    if (!p) return;
    setEq({ enabled: true, preset: index, preamp: p.preamp, bands: [...p.bands] });
    osd(`Equalizer: ${p.name}`, 'eq');
  }
  function setAdjust(patch) {
    const adjust = { ...state.adjust, enabled: true, ...patch };
    set({ adjust });
    send({ cmd: 'adjust', ...adjust });
  }
  const resetAdjust = () => { set({ adjust: { ...DEFAULT_ADJUST } }); send({ cmd: 'adjust', enabled: false }); };
  function setDeinterlace(mode) { set({ deinterlace: mode }); send({ cmd: 'deinterlace', mode }); osd(`Deinterlace ${mode || 'off'}`, 'video'); }
  function toggleNightMode() {
    set({ nightMode: !state.nightMode });
    persist();
    osd(state.nightMode ? 'Night mode on. Loud scenes are softened and dialogue lifted.' : 'Night mode off', 'moon');
    reopen();
  }

  // ---------- thumbnails (seek previews and posters) ----------
  const thumbCache = new Map();
  let thumbPath = null;
  const bucketOf = t => Math.round(t / Math.max(2, (state.duration || 600) / 150));
  async function thumb(t) {
    if (!state.item || state.item.isAudio || !state.thumbs) return null;
    const key = `${state.item.path}|${bucketOf(t)}`;
    if (!thumbCache.has(key)) thumbCache.set(key, host.thumb(state.item.path, t, 320));
    const url = await thumbCache.get(key);
    if (url === null && thumbCache.size === 1) set({ thumbs: false });
    return url;
  }
  async function prefetchThumbs(path) {
    thumbPath = path;
    await new Promise(r => setTimeout(r, 2500));
    for (let i = 1; i < 30 && thumbPath === path && state.duration; i++) {
      await thumb((state.duration * i) / 30);
    }
  }
  const poster = (path, t) => host.poster(path, t || 0);

  // Exact-time frames for strips and walls (cached per half second and width).
  const frameCache = new Map();
  function thumbAt(path, t, w = 240) {
    const key = `${path}|${Math.round(t * 2) / 2}|${w}`;
    if (!frameCache.has(key)) {
      if (frameCache.size > 1500) frameCache.delete(frameCache.keys().next().value);
      frameCache.set(key, host.thumb(path, t, w));
    }
    return frameCache.get(key);
  }
  const durCache = new Map();
  function duration(path) {
    if (state.item && state.item.path === path && state.duration) return Promise.resolve(state.duration);
    if (!durCache.has(path)) durCache.set(path, host.duration(path));
    return durCache.get(path);
  }
  // Movie barcode: the average colour of the film across `cols` columns, as [[r,g,b], ...].
  const codeCache = new Map();
  function barcode(path, cols = 240) {
    const key = `${path}|${cols}`;
    if (!codeCache.has(key)) {
      codeCache.set(key, host.barcode(path, cols).then(b64 => {
        if (!b64) return null;
        const bin = atob(b64);
        const out = [];
        for (let i = 0; i + 2 < bin.length; i += 3) out.push([bin.charCodeAt(i), bin.charCodeAt(i + 1), bin.charCodeAt(i + 2)]);
        return out;
      }));
    }
    return codeCache.get(key);
  }

  // ---------- library ----------
  async function scanLibrary() {
    let folders = state.settings.libraryFolders;
    if (!folders) { folders = await host.defaultLibrary(); saveSettings({ libraryFolders: folders }); }
    set({ libraryScanning: true });
    const files = await host.scanLibrary(folders);
    set({ library: files.map(f => ({ ...f, isAudio: AUDIO_EXT.test(f.path) })), libraryScanning: false });
  }
  async function addLibraryFolder() {
    const dir = await host.pickFolder();
    if (!dir) return;
    saveSettings({ libraryFolders: [...new Set([...(state.settings.libraryFolders || []), dir])] });
    scanLibrary();
  }
  function removeLibraryFolder(dir) {
    saveSettings({ libraryFolders: (state.settings.libraryFolders || []).filter(d => d !== dir) });
    scanLibrary();
  }
  // Everything a gallery can show: recent first (with progress), then the rest of the library.
  function galleryItems({ audio = true } = {}) {
    const seen = new Set();
    const out = [];
    for (const r of state.recent) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      out.push({ path: r.path, name: r.name, title: r.title || '', isAudio: !!r.isAudio, time: r.time || 0, duration: r.duration || 0, recent: true, folder: '' });
    }
    for (const f of state.library) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const res = state.resume[f.path];
      out.push({ path: f.path, name: f.name, title: '', isAudio: f.isAudio, time: res ? res.time : 0, duration: res ? res.duration : 0, recent: false, folder: f.folder });
    }
    return audio ? out : out.filter(i => !i.isAudio);
  }
  const showLibrary = (v = true) => set({ view: v ? 'library' : 'player' });

  // ---------- scene colour (templates tint themselves to the picture) ----------
  setInterval(() => {
    if (!state.item || !surface.hasFrame) return;
    const c = surface.sampleColor();
    if (c && (!state.scene || Math.abs(c[0] - state.scene[0]) + Math.abs(c[1] - state.scene[1]) + Math.abs(c[2] - state.scene[2]) > 6)) set({ scene: c });
  }, 700);

  function upNext() {
    const n = state.repeat === 'one' ? null : peekNext();
    return n == null ? null : state.playlist[n];
  }
  function peekNext() {
    if (state.shuffle) return shuffleOrder[0] ?? null;
    if (state.index + 1 < state.playlist.length) return state.index + 1;
    return state.repeat === 'all' && state.playlist.length ? 0 : null;
  }

  async function openDialog() { open(await host.openFiles()); }
  async function openFolderDialog() { const files = await host.openFolder(); if (files.length) open(files); }
  async function openSubtitleDialog() { const p = await host.openSubtitle(); if (p) addSubtitle(p); }
  function openUrl(url) { if (url) open([url.trim()]); }

  window.addEventListener('beforeunload', () => saveResume());

  const api = {
    state, surface, canvas: surface.canvas, on, set, osd, currentTime, fmt, fileUri,
    restore, connect, saveSettings,
    open, openDialog, openFolderDialog, openSubtitleDialog, openUrl, addSubtitle, forgetRecent,
    play, pause, toggle, stop, seek, seekBy, seekPercent,
    setVolume, volumeBy, toggleMute, setRate, rateBy,
    next, prev, playIndex, removeIndex, moveItem, clearPlaylist, toggleShuffle, cycleRepeat, upNext,
    setAudioTrack, cycleAudioTrack, setSubtitleTrack, cycleSubtitleTrack,
    setSubtitleDelay, subtitleDelayBy, setAudioDelay, audioDelayBy, setSubtitleScale,
    setChapter, nextChapter, prevChapter, skippable,
    frameStep, screenshot, cycleLoop,
    toggleFullscreen, toggleAlwaysOnTop, togglePip,
    setAspect, cycleAspect, setZoom,
    setEq, applyEqPreset, setAdjust, resetAdjust, setDeinterlace, toggleNightMode,
    thumb, poster, reopen, setVisualizer,
    holdNext, isHeld,
    thumbAt, duration, barcode, scanLibrary, addLibraryFolder, removeLibraryFolder, galleryItems, showLibrary,
  };
  return api;
}

export function fmt(sec, { ms = false, frames = 0 } = {}) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = n => String(n).padStart(2, '0');
  let out = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (frames) out += `:${pad(Math.floor((sec % 1) * frames))}`;
  else if (ms) out += `.${String(Math.floor((sec % 1) * 1000)).padStart(3, '0')}`;
  return out;
}
