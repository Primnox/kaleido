// Copies the pieces the website shares with the app into site/, so the two never drift apart.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(SITE, to)), { recursive: true }); fs.copyFileSync(path.join(ROOT, from), path.join(SITE, to)); };
copy('assets/logo.svg', 'assets/logo.svg');
copy('assets/icon-64.png', 'assets/icon-64.png');
copy('assets/icon-256.png', 'assets/icon-256.png');
copy('src/skins/normal/doodles.js', 'js/doodles.js');
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
console.log('site assets copied');
