// Kaleido main process: window, the libVLC engine process, dialogs and persistence.
// Playback itself happens in engine/ (Rust + libVLC); this file only supervises it.
const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ENGINE = process.env.KALEIDO_ENGINE || path.join(ROOT, 'engine', 'target', 'release', 'kaleido-engine.exe');
const VLC_DIR = process.env.KALEIDO_VLC || path.join(ROOT, 'vendor', 'vlc');
const FFMPEG = process.env.KALEIDO_FFMPEG || 'ffmpeg';

const VIDEO_EXT = 'mp4 m4v mkv webm avi mov wmv flv mpg mpeg ts m2ts mts 3gp 3g2 ogv vob divx f4v rm rmvb asf mxf'.split(' ');
const AUDIO_EXT = 'mp3 m4a aac flac wav ogg oga opus wma alac aiff aif ape mka wv'.split(' ');
const SUB_EXT = 'srt vtt ass ssa sub idx smi'.split(' ');
const MEDIA_EXT = new Set([...VIDEO_EXT, ...AUDIO_EXT]);
const extOf = p => path.extname(p).slice(1).toLowerCase();
const isUrl = p => /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

let win;
let quitting = false;

// ---------- persistence ----------
const storeFile = () => path.join(app.getPath('userData'), 'kaleido.json');
let store = {};
let storeDirty = false;
function loadStore() {
  try { store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { store = {}; }
}
function flushStore() {
  if (!storeDirty) return;
  storeDirty = false;
  try { fs.writeFileSync(storeFile(), JSON.stringify(store)); } catch (e) { console.error('store write failed', e); }
}
setInterval(flushStore, 3000);

// ---------- libVLC engine process ----------
const engineToken = crypto.randomBytes(16).toString('hex');
let engineProc = null;
let enginePort = 0;
let engineReady = null;

function startEngine() {
  engineReady = new Promise((resolve, reject) => {
    if (!fs.existsSync(ENGINE)) return reject(new Error(`Engine not built: ${ENGINE}. Run "npm run build:engine".`));
    if (!fs.existsSync(path.join(VLC_DIR, 'libvlc.dll'))) return reject(new Error(`libVLC not found in ${VLC_DIR}. Run "npm run fetch:vlc".`));
    const proc = spawn(ENGINE, ['--vlc', VLC_DIR, '--token', engineToken], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    engineProc = proc;
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      const m = /PORT (\d+)/.exec(buf);
      if (m && !enginePort) { enginePort = Number(m[1]); resolve({ port: enginePort, token: engineToken }); }
    });
    proc.stderr.on('data', d => console.error('[engine]', String(d).trim()));
    proc.on('error', reject);
    proc.on('exit', code => {
      if (engineProc !== proc) return;
      engineProc = null;
      enginePort = 0;
      reject(new Error(`engine exited (${code})`));
      // A crash inside a VLC module should never take the app down: restart and let the UI reconnect.
      if (!quitting) setTimeout(() => {
        startEngine();
        engineReady.then(info => win && win.webContents.send('engine-restarted', info)).catch(() => {});
      }, 400);
    });
  });
  engineReady.catch(e => console.error(String(e.message || e)));
}

// ---------- ffmpeg helpers (optional, only for seek-bar previews and recent-file posters) ----------
let ffmpegOk = null;
function run(bin, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', d => out.push(d));
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      const b = Buffer.concat(out);
      code === 0 || b.length ? resolve(b) : reject(new Error(`exit ${code}`));
    });
  });
}
async function hasFfmpeg() {
  if (ffmpegOk === null) ffmpegOk = await run(FFMPEG, ['-version'], { timeout: 5000 }).then(() => true, () => false);
  return ffmpegOk;
}

const jobQueue = [];
let jobsRunning = 0;
function queued(fn) {
  return new Promise((resolve, reject) => { jobQueue.push({ fn, resolve, reject }); pump(); });
}
function pump() {
  while (jobsRunning < 3 && jobQueue.length) {
    const { fn, resolve, reject } = jobQueue.shift();
    jobsRunning++;
    fn().then(resolve, reject).finally(() => { jobsRunning--; pump(); });
  }
}

async function grabFrame(file, t, width = 320) {
  if (isUrl(file) || !(await hasFfmpeg())) return null;
  return queued(async () => {
    const buf = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, t).toFixed(2), '-i', file,
      '-frames:v', '1', '-an', '-sn', '-vf', `scale=${width}:-2`, '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { timeout: 10000 });
    return buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
  }).catch(() => null);
}

async function poster(file, t) {
  if (isUrl(file)) return null;
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return null;
  const key = crypto.createHash('sha1').update(`${file}|${stat.mtimeMs}|${Math.round(t)}`).digest('hex');
  const dir = path.join(app.getPath('userData'), 'posters');
  const out = path.join(dir, `${key}.jpg`);
  try { return `data:image/jpeg;base64,${(await fsp.readFile(out)).toString('base64')}`; } catch {}
  let url = await grabFrame(file, t, 480);
  if (!url && t > 1) url = await grabFrame(file, 1, 480);
  if (url) {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(out, Buffer.from(url.split(',')[1], 'base64')).catch(() => {});
  }
  return url;
}

// ---------- durations and colour barcodes for the library, cached per file version ----------
const FFPROBE = process.env.KALEIDO_FFPROBE || 'ffprobe';
let mediaCache = null;
let mediaCacheTimer = null;
const mediaCachePath = () => path.join(app.getPath('userData'), 'media-cache.json');
function cacheEntry(key) {
  if (!mediaCache) { try { mediaCache = JSON.parse(fs.readFileSync(mediaCachePath(), 'utf8')); } catch { mediaCache = {}; } }
  return (mediaCache[key] = mediaCache[key] || {});
}
function saveMediaCache() {
  clearTimeout(mediaCacheTimer);
  mediaCacheTimer = setTimeout(() => fsp.writeFile(mediaCachePath(), JSON.stringify(mediaCache)).catch(() => {}), 1000);
}
async function fileKey(file) {
  const st = await fsp.stat(file).catch(() => null);
  return st && crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex');
}

async function duration(file) {
  if (isUrl(file)) return 0;
  const key = await fileKey(file);
  if (!key) return 0;
  const c = cacheEntry(key);
  if (c.duration != null) return c.duration;
  const out = await queued(() => run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 15000 })).catch(() => '');
  c.duration = parseFloat(String(out)) || 0;
  saveMediaCache();
  return c.duration;
}

// One pass over keyframes only (fast even for feature films): each keyframe averaged to a single
// pixel, then binned into `cols` columns by timestamp. Returns base64 RGB triplets.
let barcodeChain = Promise.resolve();
function barcode(file, cols = 240) {
  const job = barcodeChain.then(async () => {
    if (isUrl(file) || !(await hasFfmpeg())) return null;
    const key = await fileKey(file);
    if (!key) return null;
    const c = cacheEntry(key);
    if (c.barcode && c.barcodeCols === cols) return c.barcode;
    const dur = await duration(file);
    if (!dur) return null;
    const pass = vf => new Promise(resolve => {
      const pre = vf ? [] : ['-skip_frame', 'nokey'];
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'info', ...pre, '-i', file, '-an', '-sn', '-dn',
        '-vf', `${vf || ''}scale=1:1:flags=area,showinfo`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
      const out = [];
      const times = [];
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), 120000);
      p.stdout.on('data', d => out.push(d));
      p.stderr.on('data', d => {
        err += d;
        let i;
        while ((i = err.indexOf('\n')) >= 0) {
          const line = err.slice(0, i);
          err = err.slice(i + 1);
          const m = /pts_time:\s*([\d.]+)/.exec(line);
          if (m && line.includes('showinfo')) times.push(Number(m[1]));
        }
      });
      p.on('error', () => resolve({ colors: Buffer.alloc(0), times: [] }));
      p.on('close', () => { clearTimeout(timer); resolve({ colors: Buffer.concat(out), times }); });
    });
    let { colors, times } = await pass(null);
    // Short clips have too few keyframes for a useful barcode, so decode them fully at a low rate.
    if (times.length < 24 && dur < 900) ({ colors, times } = await pass(`fps=${(cols / dur).toFixed(4)},`));
    const n = Math.min(times.length, Math.floor(colors.length / 3));
    if (!n) return null;
    const res = Buffer.alloc(cols * 3);
    let k = 0;
    for (let i = 0; i < cols; i++) {
      const t = ((i + 0.5) / cols) * dur;
      while (k + 1 < n && times[k + 1] <= t) k++;
      colors.copy(res, i * 3, k * 3, k * 3 + 3);
    }
    c.barcode = res.toString('base64');
    c.barcodeCols = cols;
    saveMediaCache();
    return c.barcode;
  });
  barcodeChain = job.catch(() => null);
  return job.catch(() => null);
}

// ---------- file discovery ----------
async function expand(paths, depth = 0) {
  const out = [];
  for (const p of paths) {
    if (isUrl(p)) { out.push(p); continue; }
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      if (depth > 3) continue;
      const names = (await fsp.readdir(p).catch(() => [])).sort(collator.compare);
      out.push(...await expand(names.map(n => path.join(p, n)), depth + 1));
    } else if (MEDIA_EXT.has(extOf(p)) || SUB_EXT.includes(extOf(p))) out.push(p);
  }
  return out;
}

async function siblings(file) {
  if (isUrl(file)) return [file];
  const dir = path.dirname(file);
  const names = await fsp.readdir(dir).catch(() => []);
  const kind = AUDIO_EXT.includes(extOf(file)) ? AUDIO_EXT : VIDEO_EXT;
  return names.filter(n => kind.includes(extOf(n))).sort(collator.compare).map(n => path.join(dir, n));
}

// ---------- dialogue: every subtitle line, so you can search what people say ----------
const TEXT_SUBS = ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'];
const dialogueCache = new Map();
function parseCues(text) {
  const ts = s => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s || '');
    return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : null;
  };
  const out = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const start = ts(a);
    const end = ts(z);
    const line = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (start != null && line) out.push({ start, end: end ?? start + 2, text: line });
  }
  return out;
}
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
async function dialogue(file) {
  if (isUrl(file) || !(await hasFfmpeg())) return null;
  const key = await fileKey(file);
  if (!key) return null;
  if (dialogueCache.has(key)) return dialogueCache.get(key);
  let result = null;
  // A subtitle file next to the video wins, English first.
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const sidecars = (await fsp.readdir(dir).catch(() => []))
    .filter(n => SUB_EXT.includes(extOf(n)) && n.toLowerCase().startsWith(base))
    .sort((a, b) => Number(/\b(en|eng|english)\b/i.test(b)) - Number(/\b(en|eng|english)\b/i.test(a)));
  for (const n of sidecars) {
    const p = path.join(dir, n);
    const raw = ['ass', 'ssa'].includes(extOf(n))
      ? String(await run(FFMPEG, ['-v', 'error', '-i', p, '-f', 'srt', 'pipe:1']).catch(() => ''))
      : decodeText(await fsp.readFile(p));
    const cues = parseCues(raw);
    if (cues.length) { result = { source: n, cues }; break; }
  }
  // Otherwise the first text subtitle track inside the file, English first.
  if (!result) {
    const probe = JSON.parse(String(await run(FFPROBE, ['-v', 'error', '-select_streams', 's', '-show_entries', 'stream=index,codec_name:stream_tags=language,title', '-of', 'json', file]).catch(() => '{}')) || '{}');
    const streams = (probe.streams || []).filter(s => TEXT_SUBS.includes(s.codec_name));
    streams.sort((a, b) => Number(/^en/i.test((b.tags || {}).language || '')) - Number(/^en/i.test((a.tags || {}).language || '')));
    for (const s of streams.slice(0, 2)) {
      const raw = String(await run(FFMPEG, ['-v', 'error', '-i', file, '-map', `0:${s.index}`, '-f', 'srt', 'pipe:1'], { timeout: 180000 }).catch(() => ''));
      const cues = parseCues(raw);
      if (cues.length) { result = { source: ((s.tags || {}).title || (s.tags || {}).language || 'subtitles'), cues }; break; }
    }
  }
  dialogueCache.set(key, result);
  return result;
}

// ---------- silence: long quiet stretches, for skipping dead air in lectures and recordings ----------
async function silences(file) {
  if (isUrl(file) || !(await hasFfmpeg())) return null;
  const key = await fileKey(file);
  if (!key) return null;
  const c = cacheEntry(key);
  if (c.silences) return c.silences;
  const found = await new Promise(resolve => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostats', '-vn', '-sn', '-dn', '-i', file, '-af', 'silencedetect=noise=-38dB:d=1.5', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 300000);
    p.stderr.on('data', d => { err += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      clearTimeout(timer);
      const out = [];
      let start = null;
      for (const m of err.matchAll(/silence_(start|end): ([\d.]+)/g)) {
        if (m[1] === 'start') start = Number(m[2]);
        else if (start != null) { out.push([start, Number(m[2])]); start = null; }
      }
      resolve(out);
    });
  });
  if (found) { c.silences = found; saveMediaCache(); }
  return found;
}

// ---------- clips: a frame accurate mp4 of a stretch you liked ----------
async function saveClip(file, start, end, name) {
  if (isUrl(file) || !(await hasFfmpeg())) throw new Error('Saving clips needs ffmpeg');
  const dir = path.join(app.getPath('videos'), 'Kaleido clips');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = t => { const s = Math.floor(t); return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`; };
  const safe = String(name || 'clip').replace(/[^\w.\- ()]+/g, '_').slice(0, 80);
  const out = path.join(dir, `${safe} ${stamp(start)} to ${stamp(end)}.mp4`);
  await run(FFMPEG, ['-v', 'error', '-y', '-ss', start.toFixed(3), '-i', file, '-t', (end - start).toFixed(3),
    '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-vf', "scale='min(1920,iw)':-2", '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-dn', '-map_chapters', '-1', '-movflags', '+faststart', out], { timeout: 600000 });
  return out;
}

function argvFiles(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(a => a !== '.' && !a.startsWith('-') && (isUrl(a) || fs.existsSync(a)));
}

// ---------- IPC ----------
const filters = [
  { name: 'Media', extensions: [...MEDIA_EXT] },
  { name: 'Video', extensions: VIDEO_EXT },
  { name: 'Audio', extensions: AUDIO_EXT },
  { name: 'All files', extensions: ['*'] },
];

ipcMain.handle('engine:info', () => engineReady);
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? [] : expand(r.filePaths);
});
ipcMain.handle('dialog:openSubtitle', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: SUB_EXT }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('media:expand', (e, paths) => expand(paths));
ipcMain.handle('media:siblings', (e, file) => siblings(file));
ipcMain.handle('media:thumb', (e, file, t, w) => grabFrame(file, t, w));
ipcMain.handle('media:poster', (e, file, t) => poster(file, t));
ipcMain.handle('media:duration', (e, file) => duration(file));
ipcMain.handle('media:barcode', (e, file, cols) => barcode(file, cols));
ipcMain.handle('media:dialogue', (e, file) => dialogue(file));
ipcMain.handle('media:silences', (e, file) => silences(file));
ipcMain.handle('clip:save', (e, file, start, end, name) => saveClip(file, start, end, name));
ipcMain.handle('library:scan', async (e, folders) => {
  const files = await expand(folders.filter(f => fs.existsSync(f)));
  return files.filter(f => MEDIA_EXT.has(extOf(f))).slice(0, 800).map(f => ({ path: f, name: path.basename(f), folder: path.basename(path.dirname(f)) }));
});
ipcMain.handle('library:defaults', () => [app.getPath('videos')].filter(p => fs.existsSync(p)));
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('media:stat', async (e, file) => {
  if (isUrl(file)) return null;
  const st = await fsp.stat(file).catch(() => null);
  return st && { size: st.size, modified: st.mtimeMs };
});
ipcMain.handle('store:get', () => store);
ipcMain.on('store:set', (e, data) => { store = data; storeDirty = true; });
ipcMain.handle('shot:path', async (e, name) => {
  const dir = path.join(app.getPath('pictures'), 'Kaleido');
  await fsp.mkdir(dir, { recursive: true });
  const safe = String(name || 'snapshot').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return path.join(dir, `${safe} ${stamp}.png`);
});
ipcMain.handle('shell:showItem', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:initialFiles', () => argvFiles(process.argv));
ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:toggleMaximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:setFullScreen', (e, v) => win.setFullScreen(!!v));
ipcMain.handle('win:setAlwaysOnTop', (e, v) => win.setAlwaysOnTop(!!v, 'floating'));
ipcMain.handle('win:resize', (e, w, h) => {
  if (win.isFullScreen() || win.isMaximized()) return;
  win.setContentSize(Math.max(420, Math.round(w)), Math.max(260, Math.round(h)), true);
});
// Mini player: a small always-on-top window in the corner of the screen it is on, and back again.
let beforeMini = null;
ipcMain.handle('win:mini', (e, on) => {
  if (on && !beforeMini) {
    if (win.isFullScreen()) win.setFullScreen(false);
    beforeMini = { bounds: win.getBounds(), maximized: win.isMaximized(), top: win.isAlwaysOnTop() };
    if (beforeMini.maximized) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = 480, h = 270;
    win.setMinimumSize(320, 180);
    win.setAlwaysOnTop(true, 'floating');
    win.setBounds({ x: area.x + area.width - w - 24, y: area.y + area.height - h - 24, width: w, height: h }, true);
    return true;
  }
  if (!on && beforeMini) {
    const b = beforeMini;
    beforeMini = null;
    win.setMinimumSize(420, 260);
    win.setAlwaysOnTop(b.top, 'floating');
    win.setBounds(b.bounds, true);
    if (b.maximized) win.maximize();
  }
  return false;
});
ipcMain.handle('win:state', () => ({ fullscreen: win.isFullScreen(), maximized: win.isMaximized(), alwaysOnTop: win.isAlwaysOnTop() }));

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 420, minHeight: 260,
    frame: false, backgroundColor: '#000000', show: false, title: 'Kaleido',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(ROOT, 'src', 'index.html'), process.env.KALEIDO_SKIN ? { query: { skin: process.env.KALEIDO_SKIN } } : undefined);
  win.once('ready-to-show', () => win.show());
  if (process.env.KALEIDO_DEBUG) attachDebug();
  const send = (ch, v) => () => win.webContents.send(ch, v);
  win.on('enter-full-screen', send('fullscreen', true));
  win.on('leave-full-screen', send('fullscreen', false));
  win.on('maximize', send('maximized', true));
  win.on('unmaximize', send('maximized', false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // No application menu: its hidden accelerators (Ctrl+M minimise, Ctrl+R reload, Ctrl+plus zoom) would
  // steal the player's own shortcuts. F12 still opens the developer tools when running from source.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
  win.webContents.on('will-navigate', e => e.preventDefault());
}

// Dev only: KALEIDO_DEBUG=<dir> mirrors renderer console to stdout, lets a script capture
// window screenshots there, and KALEIDO_SCRIPT=<file> runs that script after load.
function attachDebug() {
  const dir = process.env.KALEIDO_DEBUG;
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (e, ...args) => {
    const level = args.length ? args[0] : e.level;
    const message = args.length ? args[1] : e.message;
    const src = args.length ? `${args[3]}:${args[2]}` : `${e.sourceId}:${e.lineNumber}`;
    console.log(`[renderer ${level}] ${message} (${src})`);
  });
  ipcMain.handle('debug:capture', async (e, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    return true;
  });
  ipcMain.handle('debug:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('debug:system', (e, ev) => win.webContents.send('system', ev));
  if (process.env.KALEIDO_SCRIPT) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.executeJavaScript(fs.readFileSync(process.env.KALEIDO_SCRIPT, 'utf8')).catch(err => console.log('[script error]', err));
    });
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const files = argvFiles(argv);
    if (files.length) win.webContents.send('open-files', files);
  });
  app.setAppUserModelId('app.kaleido.player');
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Locking the PC or putting it to sleep pauses the film; the UI decides what to say when you return.
    const system = ev => () => win && win.webContents.send('system', ev);
    powerMonitor.on('lock-screen', system('away'));
    powerMonitor.on('suspend', system('away'));
    powerMonitor.on('unlock-screen', system('back'));
    powerMonitor.on('resume', system('back'));
    loadStore();
    startEngine();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    quitting = true;
    if (engineProc) try { engineProc.kill(); } catch {}
    flushStore();
  });
}
