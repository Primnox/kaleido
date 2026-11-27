// A local relay between VLC and a sniffed stream. Many stream hosts only answer requests that carry
// the embed player's Origin (VLC can send a referrer and user agent, but not that), so VLC asks
// 127.0.0.1 and the relay asks the host with exactly the headers the player used. Playlists are
// rewritten so every variant, key and segment comes through here too; segments dressed up as web
// pages (page-1.html) are handed over as plain data.
//
// Each stream gets an unguessable token; only URLs reached through that stream's playlists carry it.
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');
const { session } = require('electron');

const streams = new Map(); // token -> { headers, at }
let server = null;
let port = 0;
const TTL = 12 * 60 * 60 * 1000;

const enc = u => Buffer.from(u).toString('base64url');
const dec = s => Buffer.from(s, 'base64url').toString('utf8');
const relayed = (token, url, tail = '') => `http://127.0.0.1:${port}/r/${token}/${enc(url)}${tail}`;

function start() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => handle(req, res).catch(err => {
      if (process.env.KALEIDO_DEBUG) console.log('[relay]', req.url && req.url.slice(0, 60), err && err.message);
      try { res.writeHead(502); res.end(); } catch {}
    }));
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
}

// headers: { referer, origin, 'user-agent' }. Returns the URL for VLC.
async function register(url, headers) {
  await start();
  const now = Date.now();
  for (const [k, v] of streams) if (now - v.at > TTL) streams.delete(k);
  const token = crypto.randomBytes(18).toString('base64url');
  const clean = {};
  for (const [k, v] of Object.entries(headers || {})) if (v) clean[k] = v;
  streams.set(token, { headers: clean, at: now });
  return relayed(token, url, '/index.m3u8');
}

function rewrite(text, base, token) {
  const abs = u => { try { return relayed(token, new URL(u, base).href); } catch { return u; } };
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${abs(u)}"`);
    return abs(t);
  }).join('\n');
}

// PNG, JPEG or GIF magic at the start of what should be video.
const disguised = b => b.length > 8 && ((b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38));
// The first offset where MPEG-TS sync bytes (0x47) repeat every 188 bytes.
function tsStart(b) {
  for (let i = 1; i + 188 * 3 < b.length; i++) {
    if (b[i] === 0x47 && b[i + 188] === 0x47 && b[i + 376] === 0x47 && b[i + 564] === 0x47) return i;
  }
  return 0;
}

async function handle(req, res) {
  const m = /^\/r\/([\w-]+)\/([\w-]+)/.exec(req.url || '');
  const s = m && streams.get(m[1]);
  if (!s || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404); res.end(); return; }
  let target;
  try { target = dec(m[2]); if (!/^https?:\/\//i.test(target)) throw new Error(); } catch { res.writeHead(400); res.end(); return; }
  const headers = { ...s.headers };
  if (req.headers.range) headers.range = req.headers.range;
  const ses = session.fromPartition(require('./guest').PARTITION);
  const up = await ses.fetch(target, { headers, redirect: 'follow' });
  const type = (up.headers.get('content-type') || '').toLowerCase();
  const small = Number(up.headers.get('content-length') || 0) < 4e6;
  if (/mpegurl/.test(type) || /\.m3u8(\?|$)/i.test(target) || (/^text\/plain/.test(type) && small)) {
    const text = await up.text();
    if (text.trimStart().startsWith('#EXTM3U')) {
      const body = Buffer.from(rewrite(text, up.url || target, m[1]));
      res.writeHead(up.status, { 'content-type': 'application/vnd.apple.mpegurl', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(up.status, { 'content-type': 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : text);
    return;
  }
  const out = { 'content-type': /^text\/html|^image\//.test(type) || !type ? 'application/octet-stream' : type };
  // Segments wearing a fake image header (VidZee puts a PNG in front of each): hand VLC only the
  // MPEG-TS that follows it.
  if (!req.headers.range && (/^image\//.test(type) || small) && up.body) {
    const buf = Buffer.from(await up.arrayBuffer());
    const at = disguised(buf) ? tsStart(buf) : 0;
    const body = at > 0 ? buf.subarray(at) : buf;
    res.writeHead(up.status, { 'content-type': at > 0 ? 'video/mp2t' : out['content-type'], 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  for (const k of ['content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(k); if (v) out[k] = v; }
  res.writeHead(up.status, out);
  if (req.method === 'HEAD' || !up.body) { res.end(); return; }
  const body = Readable.fromWeb(up.body);
  req.on('close', () => body.destroy());
  body.on('error', () => res.destroy());
  body.pipe(res);
}

module.exports = { register };
