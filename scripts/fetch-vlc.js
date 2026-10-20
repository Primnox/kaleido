// Downloads the official VLC build from videolan.org, checks its SHA-256 and unpacks what libVLC
// needs into vendor/vlc. Kaleido loads libVLC and its plugins from there; nothing is installed.
//   Windows: the win64 zip, as is.
//   macOS:   the arm64 or intel64 dmg; VLC.app/Contents/MacOS/{lib,plugins} are copied out.
//   Linux:   nothing to fetch, Kaleido uses the system's libVLC (the .deb depends on it).
// KALEIDO_ARCH=arm64|x64 picks the macOS build when packaging for the other architecture.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = process.env.KALEIDO_VLC_VERSION || '3.0.24';
const ARCH = process.env.KALEIDO_ARCH || process.arch;
const vendor = path.join(__dirname, '..', 'vendor');
const target = path.join(vendor, 'vlc');
const marker = path.join(target, '.build');
const build = `${process.platform}-${ARCH}-${VERSION}`;

async function download(url) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const expected = (await (await fetch(`${url}.sha256`)).text()).trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (expected !== actual) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
  return buf;
}

(async () => {
  if (process.platform === 'linux') {
    console.log('Linux uses the system VLC. Install it with: sudo apt install vlc');
    return;
  }
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === build) return console.log(`VLC ${build} already in ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(vendor, { recursive: true });

  if (process.platform === 'win32') {
    const zip = path.join(vendor, 'vlc.zip');
    fs.writeFileSync(zip, await download(`https://download.videolan.org/pub/videolan/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`));
    // Windows' own tar (bsdtar) reads zips; a GNU tar from Git Bash would take "D:\" for a remote host.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', vendor]);
    fs.renameSync(path.join(vendor, `vlc-${VERSION}`), target);
    fs.unlinkSync(zip);
  } else if (process.platform === 'darwin') {
    const flavour = ARCH === 'arm64' ? 'arm64' : 'intel64';
    const dmg = path.join(os.tmpdir(), `vlc-${VERSION}-${flavour}.dmg`);
    fs.writeFileSync(dmg, await download(`https://download.videolan.org/pub/videolan/vlc/${VERSION}/macosx/vlc-${VERSION}-${flavour}.dmg`));
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'vlcmnt-'));
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, dmg]);
    try {
      const app = path.join(mnt, 'VLC.app', 'Contents');
      fs.mkdirSync(target, { recursive: true });
      execFileSync('cp', ['-R', path.join(app, 'MacOS', 'lib'), path.join(app, 'MacOS', 'plugins'), target]);
      for (const f of ['COPYING', 'COPYING.txt']) {
        const p = path.join(app, 'Resources', f);
        if (fs.existsSync(p)) fs.copyFileSync(p, path.join(target, 'COPYING.txt'));
      }
    } finally {
      execFileSync('hdiutil', ['detach', mnt, '-force']);
      fs.rmSync(dmg, { force: true });
    }
  } else throw new Error(`no VLC download for ${process.platform}`);

  fs.writeFileSync(marker, build);
  console.log(`VLC ${build} ready in ${target}`);
})().catch(e => { console.error(e.message); process.exit(1); });
