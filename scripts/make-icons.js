// Renders assets/logo.svg into PNGs and a Windows .ico, using Electron's own renderer.
// Run with: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const PNG_SIZES = [32, 64, 128, 256, 512];

// ICO with PNG-compressed entries (supported by Windows since Vista).
function buildIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = head.length + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const svg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg')).toString('base64');
  const sizes = [...new Set([...ICO_SIZES, ...PNG_SIZES])];
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,${svg}';
    await img.decode();
    const out = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png');
    }
    return out;
  })()`);
  const png = s => Buffer.from(urls[s].split(',')[1], 'base64');
  for (const s of PNG_SIZES) fs.writeFileSync(path.join(ROOT, 'assets', `icon-${s}.png`), png(s));
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), buildIco(ICO_SIZES.map(size => ({ size, data: png(size) }))));
  console.log(`icon.ico (${ICO_SIZES.join(', ')}) and icon-{${PNG_SIZES.join(',')}}.png written`);
  app.quit();
});
