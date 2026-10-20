// electron-builder afterPack hook. Without a Developer ID the macOS app is ad-hoc signed, which
// Apple Silicon requires before it will run anything (the engine and FFmpeg included).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${app}`);
};
