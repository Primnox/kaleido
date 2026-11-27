// The theater plays third-party embed pages in a <webview>. Lock those guests down: their own
// session, no preload or Node, https only, no pop-ups, no hijacking the page, and no ad networks.
const { session, webContents } = require('electron');

const PARTITION = 'persist:kaleido-stream';

// Ad networks and ad-tag URL shapes, shared with the Android app (see adblock.json for why each).
const ADS = require('./adblock.json');
const AD_HOST = new RegExp(`(^|\\.)(${ADS.hosts.map(h => h.replace(/\./g, '\\.')).join('|')})$`, 'i');
const AD_URLS = ADS.patterns.map(p => new RegExp(p));
const isAd = url => AD_HOST.test(hostOf(url)) || AD_URLS.some(r => r.test(url));

const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };

// Some embeds only play inside someone's iframe and leave for another site when they find
// themselves at the top (2Embed). The theater frames those in this exact page, as a data: URL.
const FRAME_MARK = '<!--kaleido-frame-->';
function framePage(url) {
  const src = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>${FRAME_MARK}<meta name="viewport" content="width=device-width,initial-scale=1">`
    + '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>'
    + `<iframe src="${src}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`)}`;
}
// Only a page framePage() made, around an https player, may stand in for an https src.
function isFramePage(src) {
  if (!/^data:text\/html;charset=utf-8,/.test(src || '')) return false;
  let html;
  try { html = decodeURIComponent(src.slice(src.indexOf(',') + 1)); } catch { return false; }
  const m = /<iframe src="([^"]*)"/.exec(html);
  return html.startsWith(`<!doctype html>${FRAME_MARK}`) && !!m && /^https:\/\//i.test(m[1].replace(/&amp;/g, '&')) && framePage(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')) === src;
}

function setup(win) {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(ses.getUserAgent().replace(/\s(kaleido|Electron)\/\S+/gi, ''));
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: isAd(d.url) }));
  require('./sniff').observe(ses);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'fullscreen'));

  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    // Embeds start on their own (the hub's silent trailer previews rely on it); sound stays opt-in.
    prefs.autoplayPolicy = 'no-user-gesture-required';
    if (params.partition !== PARTITION || !(/^https:\/\//i.test(params.src || '') || isFramePage(params.src))) e.preventDefault();
  });

  win.webContents.on('did-attach-webview', (e, guest) => {
    let fullscreen = false;
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Ad scripts love top.location = '...'; the player's own page never needs to leave its host.
    guest.on('will-navigate', (ev, url) => { if (hostOf(url) !== hostOf(guest.getURL())) ev.preventDefault(); });
    guest.on('enter-html-full-screen', () => { fullscreen = true; });
    guest.on('leave-html-full-screen', () => { fullscreen = false; });
    // Keys go to the guest while it has focus; hand Esc back so the theater can close.
    guest.on('before-input-event', (ev, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !fullscreen) win.webContents.send('stream:escape');
    });
  });
}

// Ambient glow: average the colours along each edge of what the guest is showing. Only answers for
// stream guests hosted by the asking window. Letterbox bars are skipped so films don't glow black.
async function sample(sender, id) {
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed() || wc.hostWebContents !== sender || wc.session !== session.fromPartition(PARTITION)) return null;
  const shot = await wc.capturePage();
  if (shot.isEmpty()) return null;
  const W = 32, H = 18;
  const px = shot.resize({ width: W, height: H, quality: 'good' }).toBitmap(); // BGRA
  const lum = (x, y) => { const i = (y * W + x) * 4; return px[i] * 0.07 + px[i + 1] * 0.72 + px[i + 2] * 0.21; };
  const rowLum = y => { let s = 0; for (let x = 0; x < W; x++) s += lum(x, y); return s / W; };
  let top = 0, bottom = H - 1;
  while (top < H / 2 && rowLum(top) < 10) top++;
  while (bottom > H / 2 && rowLum(bottom) < 10) bottom--;
  if (bottom - top < 4) return { dark: true };
  const avg = (x0, x1, y0, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; b += px[i]; g += px[i + 1]; r += px[i + 2]; n++; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  const band = Math.max(1, Math.round((bottom - top) / 4));
  return {
    t: avg(0, W - 1, top, top + band - 1),
    b: avg(0, W - 1, bottom - band + 1, bottom),
    l: avg(0, 5, top, bottom),
    r: avg(W - 6, W - 1, top, bottom),
    c: avg(8, W - 9, top, bottom),
  };
}

module.exports = { setup, sample, framePage, isFramePage, PARTITION };
