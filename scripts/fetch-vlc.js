// Downloads the official VLC build from videolan.org, checks its SHA-256 and unpacks it to vendor/vlc.
// Kaleido loads libvlc.dll and its plugins from there; nothing is installed system wide.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = process.env.KALEIDO_VLC_VERSION || '3.0.24';
const base = `https://download.videolan.org/pub/videolan/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`;
const vendor = path.join(__dirname, '..', 'vendor');
const zip = path.join(vendor, 'vlc.zip');
const target = path.join(vendor, 'vlc');

(async () => {
  if (fs.existsSync(path.join(target, 'libvlc.dll'))) return console.log(`VLC already in ${target}`);
  fs.mkdirSync(vendor, { recursive: true });
  console.log(`Downloading ${base}`);
  const res = await fetch(base);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const expected = (await (await fetch(`${base}.sha256`)).text()).trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (expected !== actual) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
  fs.writeFileSync(zip, buf);
  execFileSync('tar', ['-xf', zip, '-C', vendor]);
  fs.renameSync(path.join(vendor, `vlc-${VERSION}`), target);
  fs.unlinkSync(zip);
  console.log(`VLC ${VERSION} ready in ${target}`);
})().catch(e => { console.error(e.message); process.exit(1); });
