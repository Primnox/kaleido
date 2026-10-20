// Prepares everything the installers carry next to the app, in staging/:
//   engine/kaleido-engine      the Rust libVLC host (built if missing)
//   vlc/                       Windows: VLC trimmed to what libVLC uses, with a fresh plugin cache
//                              macOS: VLC.app's lib and plugins folders
//                              Linux: none, the system's libVLC is used
//   ffmpeg/ffmpeg              for previews, posters, clips, dialogue search and skip silence
//   licenses/                  VLC and FFmpeg licence texts and where their source lives
// KALEIDO_ENGINE_BIN points at a cross-compiled engine (for example the Intel build on Apple Silicon).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'staging');
const VLC = path.join(ROOT, 'vendor', 'vlc');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const EXE = IS_WIN ? '.exe' : '';
// The standalone VLC app, its browser plugin, installer bits, skins, translations and its own Qt
// interface are not needed by libVLC inside Kaleido.
const SKIP = new Set(['vlc.exe', 'axvlc.dll', 'npvlc.dll', 'msi', 'skins', 'locale', 'vlc-cache-gen.exe', 'gui', 'Documentation.url', 'New_Skins.url', '.build']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.has(name)) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
const size = dir => fs.readdirSync(dir).reduce((n, f) => {
  const p = path.join(dir, f);
  const st = fs.lstatSync(p);
  return n + (st.isDirectory() ? size(p) : st.size);
}, 0);

if ((IS_WIN || IS_MAC) && !fs.existsSync(path.join(VLC, '.build'))) {
  console.log('VLC is missing, fetching it first');
  execFileSync(process.execPath, [path.join(__dirname, 'fetch-vlc.js')], { stdio: 'inherit' });
}
const engine = process.env.KALEIDO_ENGINE_BIN ? path.resolve(ROOT, process.env.KALEIDO_ENGINE_BIN) : path.join(ROOT, 'engine', 'target', 'release', `kaleido-engine${EXE}`);
if (!fs.existsSync(engine)) execFileSync('cargo', ['build', '--release', '--manifest-path', path.join(ROOT, 'engine', 'Cargo.toml')], { stdio: 'inherit' });

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'engine'), { recursive: true });
fs.copyFileSync(engine, path.join(STAGE, 'engine', `kaleido-engine${EXE}`));
fs.chmodSync(path.join(STAGE, 'engine', `kaleido-engine${EXE}`), 0o755);

if (IS_WIN) {
  copyDir(VLC, path.join(STAGE, 'vlc'));
  fs.rmSync(path.join(STAGE, 'vlc', 'plugins', 'plugins.dat'), { force: true });
  // Rebuild the plugin cache for the trimmed set so VLC starts without rescanning every launch.
  execFileSync(path.join(VLC, 'vlc-cache-gen.exe'), [path.join(STAGE, 'vlc', 'plugins')], { stdio: 'inherit' });
} else if (IS_MAC) {
  fs.mkdirSync(path.join(STAGE, 'vlc'), { recursive: true });
  // cp -R keeps the dylib symlinks intact.
  execFileSync('cp', ['-R', path.join(VLC, 'lib'), path.join(VLC, 'plugins'), path.join(STAGE, 'vlc')]);
  fs.rmSync(path.join(STAGE, 'vlc', 'plugins', 'gui'), { recursive: true, force: true });
}

const ffmpeg = require('ffmpeg-static');
fs.mkdirSync(path.join(STAGE, 'ffmpeg'), { recursive: true });
fs.copyFileSync(ffmpeg, path.join(STAGE, 'ffmpeg', `ffmpeg${EXE}`));
fs.chmodSync(path.join(STAGE, 'ffmpeg', `ffmpeg${EXE}`), 0o755);

const lic = path.join(STAGE, 'licenses');
fs.mkdirSync(lic, { recursive: true });
if (fs.existsSync(path.join(VLC, 'COPYING.txt'))) fs.copyFileSync(path.join(VLC, 'COPYING.txt'), path.join(lic, 'VLC-COPYING.txt'));
for (const f of fs.readdirSync(path.dirname(ffmpeg))) {
  if (/license|readme/i.test(f) && /ffmpeg/i.test(f)) fs.copyFileSync(path.join(path.dirname(ffmpeg), f), path.join(lic, f.replace(/\.exe/, '')));
}
const news = path.join(VLC, 'NEWS.txt');
const vlcVersion = (fs.existsSync(news) && (/VLC media player ([\d.]+)/.exec(fs.readFileSync(news, 'utf8')) || [])[1]) || '3.0.24';
fs.writeFileSync(path.join(lic, 'THIRD-PARTY.txt'), [
  'Kaleido is MIT licensed. It uses two programs by other projects, unchanged:',
  '',
  process.platform === 'linux'
    ? 'VLC (libVLC and its plugins) by VideoLAN, from your system packages, under the GNU GPL v2 and LGPL v2.1.'
    : `VLC ${vlcVersion} (libVLC and its plugins) by VideoLAN, under the GNU GPL v2 and LGPL v2.1.`,
  `  Source: https://download.videolan.org/pub/videolan/vlc/${vlcVersion}/`,
  '',
  'FFmpeg (via the ffmpeg-static package), under the GNU GPL v3.',
  '  Source: https://ffmpeg.org/download.html',
  '',
  'Both run as separate programs that Kaleido starts; Kaleido does not link to them.',
  '',
].join(IS_WIN ? '\r\n' : '\n'));

const vlcSize = fs.existsSync(path.join(STAGE, 'vlc')) ? `${(size(path.join(STAGE, 'vlc')) / 1e6).toFixed(0)} MB` : 'system';
console.log(`staged for ${process.platform}: engine, vlc (${vlcSize}), ffmpeg (${(fs.statSync(path.join(STAGE, 'ffmpeg', `ffmpeg${EXE}`)).size / 1e6).toFixed(0)} MB), licenses`);
