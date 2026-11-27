// Finds the video stream behind an embed player, so Kaleido's own player (VLC) can play it: the
// embed page loads in a hidden, muted window under the theater's guest rules, and the first HLS
// playlist (or long MP4) it asks for is the film. What VLC needs to fetch it like the page did
// (referrer, user agent, origin) comes from the request's own headers. Subtitles the page loads
// along the way come too.
const { BrowserWindow } = require('electron');

const active = new Map(); // webContents id -> sniff state

const header = (headers, name) => {
  if (!headers) return '';
  const k = Object.keys(headers).find(h => h.toLowerCase() === name);
  const v = k ? headers[k] : '';
  return Array.isArray(v) ? v[0] : v || '';
};
const pathOf = url => { try { return new URL(url).pathname; } catch { return ''; } };

// Installed once on the guest session by guest.setup (a session takes one listener per event).
function observe(ses) {
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (d, cb) => {
    const s = active.get(d.webContentsId);
    if (s) s.sent.set(d.id, d.requestHeaders);
    cb({});
  });
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, cb) => {
    const s = active.get(d.webContentsId);
    if (s) s.received(d);
    cb({});
  });
}

function kindOf(d) {
  if (d.statusCode < 200 || d.statusCode >= 300) return null;
  const type = header(d.responseHeaders, 'content-type').toLowerCase();
  const path = pathOf(d.url).toLowerCase();
  if (/mpegurl/.test(type) || /\.m3u8$/.test(path)) return 'hls';
  if (/dash\+xml/.test(type) || /\.mpd$/.test(path)) return 'dash';
  // Scrub-bar preview images come as .vtt too; those are not subtitles.
  if (/text\/vtt|subrip/.test(type) || /\.(vtt|srt)$/.test(path)) return /thumb|sprite|preview|storyboard/.test(path) ? null : 'sub';
  // Some hosts dress the playlist up as plain text or a download; look inside those.
  if (/^text\/plain|octet-stream/.test(type) && !/\.(js|css|json|wasm|png|jpe?g|gif|webp|svg|woff2?|ttf|ico|ts|m4s|aac|mp3|vfs|vfm|html?)$/.test(path)) return 'maybe';
  if (/^video\/(mp4|webm|x-matroska)/.test(type) || /\.(mp4|mkv|webm)$/.test(path)) {
    // Ad clips are short: only a file of more than 40 MB counts as the film.
    const range = /\/(\d+)\s*$/.exec(header(d.responseHeaders, 'content-range'));
    const size = Number(range ? range[1] : header(d.responseHeaders, 'content-length')) || 0;
    return size > 40e6 ? 'file' : null;
  }
  return null;
}

// The first bytes of a disguised response: every HLS playlist starts with #EXTM3U.
async function looksLikeHls(ses, url, sent) {
  const headers = { range: 'bytes=0-63' };
  for (const k of ['referer', 'origin', 'user-agent']) { const v = header(sent, k); if (v) headers[k] = v; }
  try {
    const res = await ses.fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    return !!value && Buffer.from(value).toString('utf8').trimStart().startsWith('#EXTM3U');
  } catch { return false; }
}

// Resolves { url, kind, referrer, userAgent, origin, subs: [{ url, label }], took } or null.
function sniff(pageUrl, { timeout = 22000, log = null } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const w = new BrowserWindow({
      show: false, width: 1280, height: 720,
      webPreferences: { partition: require('./guest').PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
    });
    const wc = w.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
    wc.on('will-navigate', (ev, u) => { if (hostOf(u) !== hostOf(wc.getURL())) ev.preventDefault(); });
    let found = null, done = false, clicker = null, settle = null;
    const subs = [];
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      clearTimeout(settle);
      clearInterval(clicker);
      active.delete(wc.id);
      if (!w.isDestroyed()) w.destroy();
      resolve(result);
    };
    const state = {
      sent: new Map(),
      received(d) {
        const kind = kindOf(d);
        if (log) log({ url: d.url, status: d.statusCode, type: header(d.responseHeaders, 'content-type'), kind });
        if (!kind) return;
        const h = state.sent.get(d.id) || {};
        if (kind === 'sub') {
          if (!subs.some(s => s.url === d.url)) subs.push({ url: d.url, label: decodeURIComponent(pathOf(d.url).split('/').pop() || 'Subtitles') });
          return;
        }
        if (found) return;
        if (kind === 'maybe') { if (probes++ < 12) looksLikeHls(wc.session, d.url, h).then(yes => { if (yes) take(d.url, 'hls', h); }); return; }
        take(d.url, kind, h);
      },
    };
    let probes = 0;
    const take = (url, kind, h) => {
      if (found || done) return;
      found = { url, kind, referrer: header(h, 'referer'), userAgent: header(h, 'user-agent'), origin: header(h, 'origin') };
      // A moment more for subtitle files, which players often fetch right after the playlist.
      settle = setTimeout(() => finish({ ...found, subs, took: Date.now() - started }), 1500);
    };
    active.set(wc.id, state);
    const limit = setTimeout(() => finish(null), timeout);
    // Some players wait for a click on their big play button: give them one, now and then.
    wc.once('did-finish-load', () => {
      const click = () => {
        if (done || found || w.isDestroyed()) return;
        for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: 640, y: 360, button: 'left', clickCount: 1 });
      };
      setTimeout(click, 2500);
      clicker = setInterval(click, 4000);
    });
    wc.on('render-process-gone', () => finish(null));
    wc.loadURL(pageUrl).catch(() => {});
  });
}

module.exports = { observe, sniff };
