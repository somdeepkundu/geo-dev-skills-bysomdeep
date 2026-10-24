// Build www/ (the Capacitor Android bundle) from the SAME index.html that GitHub Pages serves.
// From CropView v3 (scripts/build-www.mjs). If the web app already vendors its libraries (vendor/),
// the build only copies files and injects native-bridge.js; if it still loads CDN URLs, list each
// swap below — the build fails loudly when a pattern is missing, so a renamed CDN link can't slip
// into the offline app unnoticed.
//   npm run build:www && npx cap sync android && npx cap open android
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';

const OUT = 'www';
const COPY = ['app.js', 'style.css', 'sensor-core.js', 'field-store.js', 'manifest.json', 'icons', 'vendor'];
const swaps = [
  // [/https:\/\/unpkg\.com\/leaflet@[\d.]+\/dist\/leaflet\.js/, 'vendor/leaflet/leaflet.js'],
  [/<\/body>/, '<script src="native-bridge.js"></script>\n</body>'],
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let html = readFileSync('index.html', 'utf8');
for (const [re, rep] of swaps) {
  if (!re.test(html)) throw new Error(`build-www: pattern not found in index.html: ${re}`);
  html = html.replace(re, rep);
}
writeFileSync(`${OUT}/index.html`, html);
for (const f of COPY) if (existsSync(f)) cpSync(f, `${OUT}/${f}`, { recursive: true });
cpSync('native/native-bridge.js', `${OUT}/native-bridge.js`);
console.log('www/ built — offline bundle ready for `npx cap sync android`.');
