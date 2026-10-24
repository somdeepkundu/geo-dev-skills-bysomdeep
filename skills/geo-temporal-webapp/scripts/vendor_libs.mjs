#!/usr/bin/env node
// Copy Leaflet, JSZip and a font into <app>/vendor/ so the app needs no CDN and works offline.
// Uses `npm pack` (only the npm registry is contacted), so it works where CDNs are blocked.
//
//   node vendor_libs.mjs <app-dir> [--no-leaflet] [--no-jszip] [--font atkinson-hyperlegible:400,700] [--font fraunces:600]
//
// Prints the vendored paths, ready to paste into the service worker's SHELL list.
// Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PINS = { leaflet: '1.9.4', jszip: '3.10.1' };   // the versions FloodView and CropView ship
const args = process.argv.slice(2);
const app = args.find(a => !a.startsWith('--') && !/^[a-z0-9-]+:[\d,]+$/.test(a));
if (!app) { console.error('usage: node vendor_libs.mjs <app-dir> [--no-leaflet] [--no-jszip] [--font name:400,700]'); process.exit(2); }
const fonts = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--font' && args[i + 1]) fonts.push(args[++i]);
const want = { leaflet: !args.includes('--no-leaflet'), jszip: !args.includes('--no-jszip') };

const vendor = path.join(app, 'vendor');
mkdirSync(path.join(vendor, 'LICENSES'), { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'vendor-'));
const out = [];

function fetchPkg(spec) {
  const dir = mkdtempSync(path.join(tmp, 'p-'));
  const tgz = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', dir], { encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', path.join(dir, tgz), '-C', dir]);
  return path.join(dir, 'package');
}
function licence(pkgDir, name) {
  const f = readdirSync(pkgDir).find(n => /^licen[cs]e/i.test(n));
  if (f) cpSync(path.join(pkgDir, f), path.join(vendor, 'LICENSES', name + '.txt'));
}

if (want.leaflet) {
  const p = fetchPkg('leaflet@' + PINS.leaflet);
  const dst = path.join(vendor, 'leaflet');
  mkdirSync(path.join(dst, 'images'), { recursive: true });
  for (const f of ['leaflet.js', 'leaflet.css']) { cpSync(path.join(p, 'dist', f), path.join(dst, f)); out.push('vendor/leaflet/' + f); }
  for (const f of readdirSync(path.join(p, 'dist', 'images'))) { cpSync(path.join(p, 'dist', 'images', f), path.join(dst, 'images', f)); out.push('vendor/leaflet/images/' + f); }
  licence(p, 'leaflet');
}
if (want.jszip) {
  const p = fetchPkg('jszip@' + PINS.jszip);
  cpSync(path.join(p, 'dist', 'jszip.min.js'), path.join(vendor, 'jszip.min.js'));
  out.push('vendor/jszip.min.js');
  licence(p, 'jszip');
}
if (fonts.length) {
  const fdir = path.join(vendor, 'fonts');
  mkdirSync(fdir, { recursive: true });
  let css = '/* Vendored by vendor_libs.mjs from @fontsource (latin + latin-ext). */\n';
  for (const spec of fonts) {
    const [name, ws] = spec.split(':');
    const p = fetchPkg('@fontsource/' + name);
    for (const w of (ws || '400').split(',')) {
      const cssFile = path.join(p, `${w}.css`);
      if (!existsSync(cssFile)) { console.error(`! ${name} has no weight ${w}`); continue; }
      // ${w}.css holds one @font-face per subset, each with its unicode-range; keep latin + latin-ext
      const blocks = readFileSync(cssFile, 'utf8').split(/(?=\/\*)/).filter(b => new RegExp(`-latin(-ext)?-${w}-normal \\*/`).test(b));
      for (let block of blocks) {
        // woff2 only (every browser that runs these apps reads it), flat paths
        block = block.replace(/src:\s*url\(\.\/files\/([^)]+\.woff2)\)\s*format\('woff2'\)(,\s*url\([^)]+\)\s*format\('woff'\))?/g,
          (m, file) => { cpSync(path.join(p, 'files', file), path.join(fdir, file)); out.push('vendor/fonts/' + file); return `src: url(./${file}) format('woff2')`; });
        css += block.trim() + '\n';
      }
    }
    licence(p, 'font-' + name);
  }
  writeFileSync(path.join(fdir, 'fonts.css'), css);
  out.unshift('vendor/fonts/fonts.css');
}
rmSync(tmp, { recursive: true, force: true });
console.log('Vendored into ' + vendor + ':\n' + [...new Set(out)].map(f => "  './" + f + "',").join('\n'));
