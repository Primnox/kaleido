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

  // ---------- streaming hub ----------
  // The desktop's own data modules (streaming/*.js, injected by MainActivity) run here in the page.
  // Their require('electron').net.fetch is the app's fetch, which is not bound by other sites' CORS.
  const modules = window.__kaleidoStreaming || null;
  delete window.__kaleidoStreaming;
  function nativeFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const signal = opts.signal;
      const abort = () => reject(new DOMException('The request was aborted', 'AbortError'));
      if (signal && signal.aborted) return abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });
      call('http', String(url), { headers: opts.headers || {} }).then(r => {
        if (signal) signal.removeEventListener('abort', abort);
        if (!r || r.error) { reject(new TypeError((r && r.error) || 'fetch failed')); return; }
        const body = r.body || '';
        resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText, text: async () => body, json: async () => JSON.parse(body) });
      });
    });
  }
  const loaded = {};
  const need = name => {
    if (name === 'electron') return { net: { fetch: nativeFetch } };
    if (!loaded[name]) {
      const module = { exports: {} };
      modules[name](need, module, module.exports);
      loaded[name] = module;
    }
    return loaded[name].exports;
  };
  // Every hub call answers with a promise, like the desktop's IPC.
  const api = (mod, map) => Object.fromEntries(Object.entries(map).map(([k, fn]) => [k, (...args) => Promise.resolve().then(() => need(mod)[fn](...args))]));
  const streaming = modules && modules.tmdb ? {
    onEscape: listen('stream:escape'),
    sample: id => call('streamSample', id),
    // Kaleido's own player: the stream behind an embed, ready for VLC (see Theater.kt and Relay.kt).
    sniff: url => call('streamSniff', url),
    // No <webview> on Android: the theater's player is a native view laid over its stage box.
    player: {
      open: (id, url, referrer) => N.playerOpen(id, url, referrer || ''),
      place: (id, x, y, w, h) => N.playerPlace(id, x, y, w, h),
      close: id => N.playerClose(id),
      onEvent: listen('stream-player'),
    },
    tmdb: api('tmdb', { setKey: 'setKey', getKey: 'getKey', trending: 'trending', popular: 'popular', topRated: 'topRated', nowPlaying: 'nowPlaying', airingToday: 'airingToday', search: 'search', movieDetails: 'movieDetails', tvDetails: 'tvDetails', seasonDetails: 'seasonDetails', genres: 'genres', discover: 'discover' }),
    providers: api('providers', { list: 'list', getEmbed: 'getEmbed', getAll: 'getAll', check: 'check' }),
    iptv: api('iptv', { categories: 'listCategories', countries: 'listCountries', byCategory: 'categoryChannels', byCountry: 'countryChannels', search: 'search' }),
    radio: api('radio', { top: 'topStations', popular: 'popularStations', search: 'searchStations', byCountry: 'stationsByCountry', byTag: 'stationsByTag', tags: 'topTags', countries: 'topCountries' }),
  } : undefined;

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
      // The hub: its theater, then its own page history, then back to the player (Esc on desktop).
      if (k.shell && k.shell.browseVisible) {
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
    streaming,
  };

  try { setInsets(JSON.parse(N.insets())); } catch (e) {}
})();
