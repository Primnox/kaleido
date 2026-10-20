import { DOODLES } from './js/doodles.js';

const VERSION = '0.1.0';
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
document.querySelectorAll('[data-dl]').forEach(a => {
  a.href = a.dataset.dl === 'portable' ? `${RELEASE}/Kaleido-${VERSION}-Portable.exe` : `${RELEASE}/Kaleido-Setup-${VERSION}.exe`;
});

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
