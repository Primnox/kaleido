import { DOODLES } from './js/doodles.js';

const VERSION = '0.3.1';
const RELEASE = `https://github.com/Primnox/kaleido/releases/download/v${VERSION}`;
const THEMES = [
  ['tungsten', 'Tungsten', '#120c08', '#f0c98a'],
  ['daylight', 'Daylight', '#f3eee5', '#d9583b'],
  ['neon', 'Neon', '#090a14', '#4fe3ff'],
  ['forest', 'Forest', '#0b120d', '#c8e39a'],
  ['rose', 'Rose', '#120a0e', '#f3a6b8'],
  ['mono', 'Mono', '#0a0a0a', '#ffffff'],
];

// The moving doodles from the app's home page; the projector throws the demo film onto its screen.
const art = document.getElementById('doodles');
art.innerHTML = DOODLES;
const poster = art.querySelector('.dd-poster');
if (poster) poster.setAttribute('href', 'media/still.jpg');

// Direct download links to the release files.
const FILES = {
  setup: `Kaleido-Setup-${VERSION}.exe`,
  portable: `Kaleido-${VERSION}-Portable.exe`,
  'mac-arm64': `Kaleido-${VERSION}-mac-arm64.dmg`,
  'mac-x64': `Kaleido-${VERSION}-mac-x64.dmg`,
  deb: `Kaleido-${VERSION}-linux-amd64.deb`,
  appimage: `Kaleido-${VERSION}-linux-x86_64.AppImage`,
  'android-arm64': `Kaleido-${VERSION}-android-arm64-v8a.apk`,
  'android-v7': `Kaleido-${VERSION}-android-armeabi-v7a.apk`,
};
document.querySelectorAll('[data-dl]').forEach(a => { a.href = `${RELEASE}/${FILES[a.dataset.dl]}`; });

// The hero button offers the build for the visitor's own system.
(async () => {
  const ua = navigator.userAgent;
  let os = /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'mac' : /Linux|X11/.test(ua) ? 'linux' : 'windows';
  let key = { android: 'android-arm64', mac: 'mac-arm64', linux: 'deb', windows: 'setup' }[os];
  let label = { android: 'Download for Android', mac: 'Download for Mac', linux: 'Download for Linux', windows: 'Download for Windows' }[os];
  if (os === 'mac' && navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try { const { architecture } = await navigator.userAgentData.getHighEntropyValues(['architecture']); if (architecture === 'x86') key = 'mac-x64'; } catch {}
  }
  const hero = document.getElementById('heroDownload');
  hero.textContent = label;
  hero.href = `${RELEASE}/${FILES[key]}`;
  document.querySelector(`.platform[data-os="${os}"]`)?.classList.add('yours');
})();

// Theme picker: recolours the page and swaps the app screenshot to the same theme.
const shot = document.getElementById('themeShot');
const swatches = document.querySelector('.swatches');
function setTheme(id, save = true) {
  document.documentElement.dataset.theme = id;
  swatches.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === id)));
  shot.style.opacity = '0';
  setTimeout(() => { shot.src = `media/home-${id}.jpg`; shot.onload = () => { shot.style.opacity = '1'; }; }, 200);
  if (save) try { localStorage.setItem('kaleido-theme', id); } catch {}
}
THEMES.forEach(([id, name, bg, accent]) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.type = 'button';
  b.dataset.id = id;
  b.setAttribute('role', 'radio');
  b.innerHTML = `<i style="background:linear-gradient(135deg, ${bg} 50%, ${accent} 50%)"></i>${name}`;
  b.addEventListener('click', () => setTheme(id));
  swatches.append(b);
});
let saved = 'tungsten';
try { saved = localStorage.getItem('kaleido-theme') || saved; } catch {}
setTheme(THEMES.some(t => t[0] === saved) ? saved : 'tungsten', false);

// Sections rise in as they come into view.
const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
