// Unit tests for assets/template/sensor-core.js — run: node scripts/test_sensor_core.mjs
// No dependencies. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const F = require(path.join(here, '..', 'assets', 'template', 'sensor-core.js'));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? ' — ' + JSON.stringify(detail) : ''));
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const angNear = (a, b, tol = 1e-6) => F.angDiff(a, b) <= tol;

/* ── heading ── */
check('alpha 270, beta 70 → camera looks east (90°)', angNear(F.cameraHeading(270, 70, 0), 90), F.cameraHeading(270, 70, 0));
for (const a of [0, 45, 90, 180, 300]) {
  check(`upright (beta 90, gamma 0), alpha ${a} → 360 − alpha`, angNear(F.cameraHeading(a, 90, 0), (360 - a) % 360));
}
// Gimbal lock: (α, β, γ) and (α+180, 180−β, γ−180) are the SAME physical rotation.
// Chrome can jump between them when the phone is upright. The matrix heading must not move;
// a heading built from alpha alone flips by 180°.
{
  const h1 = F.cameraHeading(40, 88, 10), h2 = F.cameraHeading(220, 92, -170);
  check('gimbal-lock twin rotations give the same heading', angNear(h1, h2, 1e-9), [h1, h2]);
  check('…while 360 − alpha would flip by 180°', F.angDiff(360 - 40, 360 - 220) === 180);
}
check('near nadir falls back to phone-top direction', angNear(F.cameraHeading(30, 0, 0), 330), F.cameraHeading(30, 0, 0));
check('heading continuous across nadir fallback edge', F.angDiff(F.cameraHeading(30, 9.5, 0), F.cameraHeading(30, 10.5, 0)) < 1);

/* ── tilt ── */
check('tilt: beta 70 → 70', F.tiltFrom(70, 0) === 70);
check('tilt: flat, camera down → 0 (not a default 45)', F.tiltFrom(0, 0) === 0);
check('tilt: landscape aimed 45° down (beta 0, gamma −45) → 45', F.tiltFrom(0, -45) === 45);
check('tilt: above horizon stays above (beta 120 → 120)', F.tiltFrom(120, 0) === 120);
check('tilt: null beta → null (caller holds last value)', F.tiltFrom(null, 0) === null);
check('tilt: NaN gamma → null', F.tiltFrom(30, NaN) === null);

/* ── GPS smoothing ── */
{
  const g = F.createGpsSmoother(6);
  const fix = g.push({ latitude: 19.1334, longitude: 72.9133, accuracy: 0, altitude: null });
  check('accuracy 0 does not produce NaN', isFinite(fix.lat) && isFinite(fix.lon), fix);
  g.push({ latitude: 19.1335, longitude: 72.9134, accuracy: 4 });
  const bad = g.push({ latitude: 19.20, longitude: 72.99, accuracy: 120 });
  check('worst fix dropped once 3+ samples', bad.samples === 2 && near(bad.lat, 19.1334, 2e-4), bad);
  for (let i = 0; i < 10; i++) g.push({ latitude: 19.1334, longitude: 72.9133, accuracy: 5 });
  check('buffer capped at 6', g.size === 6);
}

/* ── travel bearing is metadata ── */
{
  let t = 0; const tb = F.createTravelBearing({ now: () => t });
  tb.update({ lat: 19, lon: 72, acc: 5 }); t = 1000;
  tb.update({ lat: 19.0001, lon: 72, acc: 5 });               // ~11 m north
  check('travel bearing north after moving 11 m', angNear(tb.get(), 0, 0.01), tb.get());
  t = 8000; check('travel bearing expires after 6 s', tb.get() === null);
  check('look side: camera 90° right of travel → RIGHT', F.lookSide(F.lookRelTravel(90, 0)) === 'RIGHT');
  check('look side: 170° → BEHIND', F.lookSide(F.lookRelTravel(170, 0)) === 'BEHIND');
}

/* ── footprint and aim ── */
{
  const fp = F.footprint({ camH: 1.5, tilt: 70, hfov: 65 });
  check('footprint centre range = H·tan(tilt)', near(fp.gd, 1.5 * Math.tan(70 * F.D2R)), fp.gd);
  check('70° tilt: top of a 65° frame passes 85°, so the far edge is clipped', fp.farCapped === true);
  check('50° tilt: whole frame below the cap, not clipped', F.footprint({ camH: 1.5, tilt: 50 }).farCapped === false);
  const fp88 = F.footprint({ camH: 1.5, tilt: 88 });
  check('near-horizon footprint kept, far edge clipped at 85°', fp88 && fp88.farCapped && near(fp88.far, 1.5 * Math.tan(85 * F.D2R)));
  check('frame entirely above cap → no footprint', F.footprint({ camH: 1.5, tilt: 110 }) === null);
  check('no tilt yet → no footprint', F.footprint({ camH: 1.5, tilt: null }) === null);
  const ring = F.footprintRing(19.1334, 72.9133, 90, fp);
  check('footprint ring closed, 5 vertices, east of observer', ring.length === 5 && ring[0] === ring[4] && ring.every(p => p[0] > 72.9133));
  const a = F.aimPoint(16.6912, 74.2439, 90, { camH: 1.5, tilt: 70 });
  check('aim distance = H·tan(tilt)', near(a.dist, 1.5 * Math.tan(70 * F.D2R), 1e-9), a.dist);
  check('aim point east of observer', a.lon > 74.2439 && near(a.lat, 16.6912, 1e-6));
  const expUnc = Math.hypot(1.5 / Math.cos(70 * F.D2R) ** 2 * (2 * F.D2R), a.dist * Math.tan(10 * F.D2R));
  check('aim ± = hypot(H·sec²t·2°, dist·tan10°)', near(a.unc, expUnc, 1e-9), a.unc);
  check('no aim at/above 85°', F.aimPoint(16.69, 74.24, 90, { camH: 1.5, tilt: 85 }) === null);
}

/* ── CSV formula guard ── */
check('csv: =SUM() neutralised', F.csvCell('=SUM(A1)') === "'=SUM(A1)");
check('csv: @cmd neutralised', F.csvCell('@cmd') === "'@cmd");
check('csv: number −5 untouched', F.csvCell(-5) === '-5');
check('csv: comma quoted', F.csvCell('a,b') === '"a,b"');
check('csv: quotes doubled', F.csvCell('say "hi", ok') === '"say ""hi"", ok"');

/* ── compass engine (fake window, fake clock) ── */
function rig({ withPermission = false, permAnswer = 'granted' } = {}) {
  let t = 1_000_000;
  const win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  win.DeviceOrientationEvent = withPermission ? { requestPermission: () => Promise.resolve(permAnswer) } : {};
  win.DeviceMotionEvent = {};
  const warns = [];
  const c = F.createCompass({ window: win, document: doc, now: () => t, onWarn: w => warns.push(w) });
  const fire = (type, props) => { const e = new Event(type); Object.assign(e, props); win.dispatchEvent(e); };
  const advance = ms => { const end = t + ms; while (t < end) { t = Math.min(end, t + 1000); c.tick(); } };
  return { c, S: c.state, fire, advance, warns, doc, setT: v => { t = v; }, getT: () => t };
}
// Monkey-patch setInterval so start() doesn't keep Node alive; ticks are driven manually.
const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};

{
  // Chrome 151+: Android now HAS requestPermission. Must still take Android events.
  const r = rig({ withPermission: true });
  await r.c.start();
  r.fire('deviceorientationabsolute', { alpha: 270, beta: 70, gamma: 0, absolute: true });
  check('Android with requestPermission (Chrome 151+) still gets a heading', angNear(r.S.heading, 90) && r.S.platform === 'android', r.S);
  check('…and tilt', r.S.tilt === 70);
  check('…SRC COMPASS, signal OK', r.S.src === 'COMPASS' && r.S.signal === 'OK');
  check('permission recorded', r.S.perm === 'granted');
  r.advance(3000);
  check('no event for 3 s → STALE·HOLD, last heading held', r.S.src === 'STALE·HOLD' && angNear(r.S.heading, 90));
  r.advance(6000);
  check('no event for 9 s → SIGNAL LOST, still holding last heading', r.S.src === 'SIGNAL LOST' && r.S.signal === 'LOST' && angNear(r.S.heading, 90));
}
{
  const r = rig();
  r.c.start();
  r.fire('deviceorientationabsolute', { alpha: null, beta: 70, gamma: 0, absolute: true });
  check('alpha null absolute event: no heading, no latch', r.S.heading === null && r.S.gotAbsolute === false);
  r.fire('deviceorientation', { alpha: 270, beta: 70, gamma: 0, absolute: true });
  check('…so a later absolute deviceorientation still works', angNear(r.S.heading, 90));
}
{
  const r = rig();
  r.c.start();
  r.fire('deviceorientation', { alpha: 123, beta: 45, gamma: 0, absolute: false });
  check('relative alpha is never used as a compass', r.S.heading === null, r.S.heading);
  check('…but its tilt is used', r.S.tilt === 45);
  r.fire('deviceorientation', { alpha: 123, beta: null, gamma: 0, absolute: false });
  check('null beta holds last good tilt', r.S.tilt === 45);
}
{
  const r = rig({ withPermission: true });
  r.c.start();
  r.fire('deviceorientation', { alpha: 10, beta: 80, gamma: 0, webkitCompassHeading: 123, webkitCompassAccuracy: 12 });
  check('iOS: webkitCompassHeading used as is', angNear(r.S.heading, 123) && r.S.platform === 'ios' && r.S.src === 'COMPASS');
  r.fire('deviceorientation', { alpha: 10, beta: 80, gamma: 0, webkitCompassHeading: 125, webkitCompassAccuracy: -1 });
  check('iOS accuracy −1 → COMPASS·LOW-CONF, amber', r.S.src === 'COMPASS·LOW-CONF' && r.S.signal === 'STALE');
}
{
  const r = rig();
  r.c.start();
  for (let i = 0; i < 9; i++) { r.fire('deviceorientationabsolute', { alpha: 200, beta: 70, gamma: 0, absolute: true }); r.advance(1000); }
  check('frozen value with live events (stuck) → silent resync', r.S.resyncs >= 1, r.S.resyncs);
}
{
  const r = rig();
  r.c.start();
  r.fire('deviceorientationabsolute', { alpha: 200, beta: 70, gamma: 0, absolute: true });
  const before = r.S.resyncs;
  for (let i = 0; i < 4; i++) { r.fire('devicemotion', {}); r.advance(1000); }
  check('orientation dead but motion alive → resync', r.S.resyncs > before, [before, r.S.resyncs]);
}
{
  const r = rig({ withPermission: true, permAnswer: 'denied' });
  await r.c.start();
  r.advance(9000);
  check('permission denied → SENSORS BLOCKED + warning', r.S.src === 'SENSORS BLOCKED' && r.warns.includes('denied'), [r.S.src, r.warns]);
}
{
  const r = rig();
  r.c.start();
  r.advance(6000);
  check('no events at all for 5 s → one "nodata" warning', r.warns.filter(w => w === 'nodata').length === 1 && r.S.src === 'NO SENSOR DATA');
}
{
  const r = rig();
  r.c.start();
  r.fire('deviceorientationabsolute', { alpha: 0, beta: 90, gamma: 0, absolute: true });
  r.setT(r.getT() + 10_000);                              // past the resync cooldown
  const n = r.S.resyncs;
  r.doc.dispatchEvent(new Event('visibilitychange'));     // tab comes back to the front
  check('returning to the tab resyncs the listeners', r.S.resyncs === n + 1 && r.S.gotAbsolute === false);
  r.c.stop(); r.c.start();
  check('stop/start keeps the last heading', r.S.running === true && angNear(r.S.heading, 0));
}

globalThis.setInterval = realSI; globalThis.clearInterval = realCI;
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
