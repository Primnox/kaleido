// Stands in for the desktop preload (preload.js) on Android: the same window.host, backed by the
// Kotlin bridge (KaleidoNative) instead of Electron's IPC. Runs before the page's own code.
(() => {
  if (window.host || !window.KaleidoNative) return;
  const N = window.KaleidoNative;

  let seq = 0;
  const waiting = new Map();
  const call = (name, ...args) => new Promise(resolve => {
    const id = ++seq;
    waiting.set(id, resolve);
    N.call(id, name, JSON.stringify(args));
  });
  const done = v => Promise.resolve(v);

  const listeners = new Map();
  const listen = ch => cb => {
    if (!listeners.has(ch)) listeners.set(ch, new Set());
    listeners.get(ch).add(cb);
    return () => listeners.get(ch).delete(cb);
  };
  const emit = (ch, v) => (listeners.get(ch) || []).forEach(cb => { try { cb(v); } catch (e) { console.error(e); } });

  // A WebSocket-shaped pipe to the libVLC engine, so engine.js keeps a single code path.
  let socket = null;
  function connectEngine() {
    socket = {
      readyState: 0, binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, onerror: null,
      send(text) { N.engine(text); },
      close() {},
    };
    const s = socket;
    setTimeout(() => { s.readyState = 1; if (s.onopen) s.onopen(); N.engineConnect(); }, 0);
    return s;
  }

  const setInsets = v => {
    const st = document.documentElement.style;
    ['top', 'right', 'bottom', 'left'].forEach((k, i) => st.setProperty(`--k-safe-${k}`, `${v[i] || 0}px`));
  };

  window.__kaleido = {
    resolve(id, v) { const r = waiting.get(id); waiting.delete(id); if (r) r(v); },
    engineEvent(text) { if (socket && socket.onmessage) socket.onmessage({ data: text }); },
    emit,
    glimpse(url) { emit('glimpse', url); },
    insets: setInsets,
    mediaAccess() { if (window.kaleido) window.kaleido.engine.scanLibrary(); },
    // The Back button: close what is open, then leave the film, then leave the app.
    back() {
      const k = window.kaleido;
      if (!k) return false;
      if (document.querySelector('.k-overlay, .k-menu')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }
      const s = k.engine.state;
      if (s.item && s.view === 'library') { k.engine.showLibrary(false); return true; }
      if (s.item) { k.engine.stop(); return true; }
      return false;
    },
  };

  window.host = {
    platform: 'android',
    // libVLC draws the picture natively under the page (see src/core/native-video.js).
    nativeVideo: true,
    // Desktop features that need FFmpeg or a desktop window manager.
    features: { dialogue: false, silence: false, clips: false, barcode: false, alwaysOnTop: false, deinterlace: false, adjust: false, frameStep: false, windowButtons: false, keyboard: false, pauseOnLock: false },
    engineInfo: () => done({ native: true }),
    connectEngine,
    openFiles: () => call('openFiles'),
    openFolder: () => call('openFolder'),
    openSubtitle: () => call('openSubtitle'),
    expand: paths => call('expand', paths),
    siblings: file => call('siblings', file),
    thumb: (file, t, w) => call('thumb', file, t, w),
    poster: (file, t) => call('poster', file, t),
    stat: file => call('stat', file),
    duration: file => call('duration', file),
    barcode: () => done(null),
    dialogue: () => done(null),
    silences: () => done([]),
    saveClip: () => done(null),
    scanLibrary: folders => call('scanLibrary', folders),
    defaultLibrary: () => call('defaultLibrary'),
    pickFolder: () => call('pickFolder'),
    storeGet: () => call('storeGet'),
    storeSet: data => N.storeSet(JSON.stringify(data)),
    snapshotPath: name => call('snapshotPath', name),
    showItem: () => done(),
    initialFiles: () => call('initialFiles'),
    pathForFile: () => '',
    grabStill: () => call('grabStill'),
    placeVideo: (x, y, w, h) => N.placeVideo(x, y, w, h),
    setVideoView: (aspect, zoom) => N.setView(aspect, zoom),
    setBrightness: v => N.setBrightness(v),
    onGlimpse: listen('glimpse'),
    onMini: listen('mini'),
    win: {
      minimize: () => call('win', 'minimize'),
      toggleMaximize: () => done(),
      close: () => call('win', 'close'),
      setFullScreen: v => call('win', 'setFullScreen', !!v),
      setAlwaysOnTop: () => done(),
      resize: () => done(),
      state: () => call('win', 'state'),
      mini: on => call('win', 'mini', !!on),
    },
    onOpenFiles: listen('open-files'),
    onFullScreen: listen('fullscreen'),
    onMaximized: listen('maximized'),
    onEngineRestarted: listen('engine-restarted'),
    onSystem: listen('system'),
    debug: { capture: () => done(), quit: () => done(), system: () => done() },
  };

  try { setInsets(JSON.parse(N.insets())); } catch (e) {}
})();
