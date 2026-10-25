#!/usr/bin/env node
// Node tests for assets/template/sensor-lab.js. Motion data is generated from the W3C rotation matrix
// R = Rz(α)·Rx(β)·Ry(γ), and compass headings from phone-field-sensors' cameraHeading(), so the
// gyro-vs-compass check is tested against physically consistent sensors, not hand-picked numbers.
//   node scripts/test_sensor_lab.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const L = require(path.join(HERE, '..', 'assets', 'template', 'sensor-lab.js'));
const F = require(path.join(HERE, '..', '..', 'phone-field-sensors', 'assets', 'template', 'sensor-core.js'));

let pass = 0, fail = 0;
const ok = (name, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name + (d !== '' ? ` — ${d}` : '')); };
const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;
const D = Math.PI / 180;

// ── rotation helpers (W3C DeviceOrientation, device → world, world = East, North, Up) ──
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const T = A => A[0].map((_, j) => A.map(r => r[j]));
function R(a, b, g) {
  a *= D; b *= D; g *= D;
  const Rz = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
  const Ry = [[Math.cos(g), 0, Math.sin(g)], [0, 1, 0], [-Math.sin(g), 0, Math.cos(g)]];
  return mul(mul(Rz, Rx), Ry);
}
const aig = (a, b, g, sign = 1) => { const r = T(R(a, b, g)); return { x: sign * L.G * r[0][2], y: sign * L.G * r[1][2], z: sign * L.G * r[2][2] }; };
function rotationRate(p0, p1, dt) {                     // device-frame angular velocity, deg/s
  const A = R(...p0), B = R(...p1), W = mul(T(A), B);   // ≈ I + [ω]× dt
  return { beta: (W[2][1] - W[1][2]) / 2 / dt / D, gamma: (W[0][2] - W[2][0]) / 2 / dt / D, alpha: (W[1][0] - W[0][1]) / 2 / dt / D };
}
/* Simulate a pose path: poseAt(t) → [α, β, γ]; compass reads cameraHeading (+ an optional disturbance). */
function simulate(watch, poseAt, { secs = 2.5, hz = 50, disturb = () => 0 } = {}) {
  const dt = 1 / hz; let last = null;
  for (let i = 0; i <= secs * hz; i++) {
    const t = i * dt * 1000, p = poseAt(i * dt), p2 = poseAt(i * dt + dt);
    watch.feedMotion(t, rotationRate(p, p2, dt), aig(...p), dt * 1000);
    watch.feedHeading(t, F.norm360(F.cameraHeading(...p) + disturb(i * dt)));
    last = t;
  }
  return watch.evaluate(last);
}

// ── basics ──
ok('signedDiff wraps', L.signedDiff(10, 350) === 20 && L.signedDiff(350, 10) === -20 && L.signedDiff(180, 0) === 180);

// ── gravity tilt agrees with the orientation tilt for many poses ──
{
  let worst = 0;
  for (const [b, g] of [[0, 0], [30, 0], [70, 0], [90, 0], [45, 30], [10, -60], [120, 20], [-30, 40]]) {
    const a = aig(123, b, g), gt = L.gravityTilt(a.x, a.y, a.z);
    const exact = Math.acos(Math.cos(b * D) * Math.cos(g * D)) / D;      // sensor-core's tiltFrom rounds this to whole degrees
    worst = Math.max(worst, Math.abs(gt - exact));
    if (Math.abs(gt - F.tiltFrom(b, g)) > 0.5) worst = Infinity;
  }
  ok('gravity tilt = acos(cosβ·cosγ) for 8 poses (and within rounding of tiltFrom)', worst < 1e-6, worst.toExponential(1));
  ok('face-up flat → 0°, upright → 90°', near(L.gravityTilt(0, 0, L.G), 0, 1e-9) && near(L.gravityTilt(0, L.G, 0), 90, 1e-9));
  ok('shaking (|a| ≠ g) → null', L.gravityTilt(0, 0, 25) === null && L.gravityTilt(0, 0, 1) === null);
  const pairs = s => [[20, 0], [30, 10], [50, -20], [60, 5], [15, 15], [120, 0], [135, 10], [40, 40], [25, -5], [65, 0], [10, 0]]
    .map(([b, g]) => { const a = aig(0, b, g, s); return { grav: L.gravityTilt(a.x, a.y, a.z), ori: F.tiltFrom(b, g) }; });
  ok('gravitySign: normal data → +1', L.gravitySign(pairs(1)) === 1);
  ok('gravitySign: flipped data → −1', L.gravitySign(pairs(-1)) === -1);
  ok('gravitySign: too few pairs → null', L.gravitySign(pairs(1).slice(0, 3)) === null);
}

// ── stillness ──
{
  const st = L.createStillness();
  for (let i = 0; i < 40; i++) st.push(i * 20, L.G + 0.03 * Math.sin(i), 0.5);
  ok('still phone → still', st.state().still === true, st.state().accStd.toFixed(3));
  const mv = L.createStillness();
  for (let i = 0; i < 40; i++) mv.push(i * 20, L.G + 1.5 * Math.sin(i), 2);
  ok('shaken phone → not still', mv.state().still === false);
  const pan = L.createStillness();
  for (let i = 0; i < 40; i++) pan.push(i * 20, L.G, 30);
  ok('panning (gyro 30°/s) → not still', pan.state().still === false);
  const few = L.createStillness(); few.push(0, L.G, 0);
  ok('not enough data → null, not "still"', few.state().still === null);
}

// ── magnetic-disturbance watch ──
{
  const poses = {
    'upright, turning right 15°/s': t => [270 - 15 * t, 80, 0],
    'tilted and rolled, turning left 20°/s': t => [200 + 20 * t, 40, 25],
    'flat on a table, turning right 30°/s': t => [90 - 30 * t, 0, 0],
    'held still, upright': () => [300, 75, -5]
  };
  for (const [name, f] of Object.entries(poses)) {
    const r = simulate(L.createMagWatch(), f);
    ok(`clean field, ${name} → CLEAN`, r.status === 'CLEAN', `compass ${r.compassDelta.toFixed(2)}°, gyro ${r.gyroDelta.toFixed(2)}°`);
  }
  const turn = simulate(L.createMagWatch(), poses['upright, turning right 15°/s']);
  ok('gyro turn matches compass turn (+30° in 2 s)', near(turn.compassDelta, 30, 0.6) && near(turn.gyroDelta, 30, 0.6), `${turn.compassDelta.toFixed(2)} / ${turn.gyroDelta.toFixed(2)}`);
  const metro = simulate(L.createMagWatch(), poses['held still, upright'], { disturb: t => 12 * t });
  ok('phone still but compass drifts 24° (metro) → DISTURBED', metro.status === 'DISTURBED', `mismatch ${metro.mismatch.toFixed(1)}°`);
  const bent = simulate(L.createMagWatch(), poses['upright, turning right 15°/s'], { disturb: t => -8 * t });
  ok('turning, compass under-reads the turn → DISTURBED', bent.status === 'DISTURBED', `compass ${bent.compassDelta.toFixed(1)} vs gyro ${bent.gyroDelta.toFixed(1)}`);
  // after the disturbance ends, the flag holds for holdMs, then clears
  const w = L.createMagWatch();
  simulate(w, poses['held still, upright'], { disturb: t => 12 * t, secs: 2.5 });
  let t = 2500, r;
  const p = [300, 75, -5], ch = F.cameraHeading(...p) + 30;
  for (let i = 1; i <= 300; i++) { t += 20; w.feedMotion(t, { alpha: 0, beta: 0, gamma: 0 }, aig(...p), 20); w.feedHeading(t, ch); r = w.evaluate(t); if (i === 60) ok('flag holds right after the disturbance', r.status === 'DISTURBED'); }
  ok('flag clears once compass and gyro agree again', r.status === 'CLEAN', r.status);
  const empty = L.createMagWatch().evaluate(1000);
  ok('no data → UNKNOWN, never CLEAN', empty.status === 'UNKNOWN');
  // flipped gravity sign: without setSign the projection is wrong; with setSign(−1) it is right again
  const flipped = L.createMagWatch(); flipped.setSign(-1);
  { const dt = 0.02; let last; for (let i = 0; i <= 125; i++) { const tt = i * dt, q = poses['upright, turning right 15°/s'](tt), q2 = poses['upright, turning right 15°/s'](tt + dt); last = i * 20;
      flipped.feedMotion(last, rotationRate(q, q2, dt), aig(...q, -1), 20); flipped.feedHeading(last, F.cameraHeading(...q)); }
    ok('sign-flipped gravity handled with setSign(−1)', flipped.evaluate(last).status === 'CLEAN'); }
  ok('field check: 45 µT ok, 120 µT not', L.fieldCheck(20, 30, -27).ok === true && L.fieldCheck(80, 80, 40).ok === false);
}

// ── steps and dead reckoning ──
{
  const det = L.createStepDetector(); let steps = [], seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < 500; i++) {                     // 10 s at 50 Hz, 1.8 steps/s
    const t = i * 20, a = L.G + 2.5 * Math.sin(2 * Math.PI * 1.8 * t / 1000) + 0.3 * rnd();
    const s = det.feed(t, a); if (s) steps.push(s);
  }
  ok('walking 1.8 steps/s for 10 s → ~18 steps', steps.length >= 16 && steps.length <= 19, steps.length);
  ok('step length plausible (0.5–0.9 m)', steps.slice(2).every(s => s.len > 0.5 && s.len < 0.9), steps.slice(2, 5).map(s => s.len.toFixed(2)).join(','));
  const quiet = L.createStepDetector(); let q = 0;
  for (let i = 0; i < 500; i++) if (quiet.feed(i * 20, L.G + 0.2 * rnd())) q++;
  ok('standing still → no steps', q === 0, q);
  const pdr = L.createPDR(); pdr.start(19.1334, 72.9133);
  for (let i = 0; i < 10; i++) pdr.step(0.7, 90);
  const east = F.geoDist(19.1334, 72.9133, ...pdr.pos), brg = F.geoBearing(19.1334, 72.9133, ...pdr.pos);
  ok('PDR: 10 × 0.7 m east → 7 m at 90°', near(east, 7, 0.01) && near(brg, 90, 0.1), `${east.toFixed(3)} m, ${brg.toFixed(2)}°`);
  pdr.gps({ lat: 19.1334, lon: 72.9133, acc: 30 });
  ok('PDR: weak GPS fix (±30 m) ignored', near(F.geoDist(19.1334, 72.9133, ...pdr.pos), 7, 0.01));
  pdr.gps({ lat: 19.1334, lon: 72.9133, acc: 4 });
  ok('PDR: good GPS fix pulls 30 % of the way', near(F.geoDist(19.1334, 72.9133, ...pdr.pos), 4.9, 0.05));
  const gj = pdr.geojson();
  ok('PDR: GeoJSON LineString, lon/lat order', gj.geometry.type === 'LineString' && gj.geometry.coordinates[0][0] === 72.9133 && gj.geometry.coordinates.length === 12);
}

// ── sound, images ──
{
  const sine = amp => Float32Array.from({ length: 4800 }, (_, i) => amp * Math.sin(2 * Math.PI * 440 * i / 48000));
  ok('dBFS: full-scale sine −3.0', near(L.dbfs(sine(1)), -3.01, 0.05), L.dbfs(sine(1)).toFixed(2));
  ok('dBFS: 0.1 sine −23.0', near(L.dbfs(sine(0.1)), -23.01, 0.05));
  ok('dBFS: silence floor −120', L.dbfs(new Float32Array(100)) === -120);
  ok('audio constraints turn voice processing off', !L.AUDIO_CONSTRAINTS.autoGainControl && !L.AUDIO_CONSTRAINTS.noiseSuppression && !L.AUDIO_CONSTRAINTS.echoCancellation);
  const img = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } return d; };
  const W = 80, H = 60;
  const crop = img(W, H, (x) => x < W / 2 ? [60, 140, 50] : [120, 90, 60]);         // leaves | soil
  ok('green cover: half crop, half soil → 0.5', near(L.greenCover(crop, W, H).fraction, 0.5, 0.03), L.greenCover(crop, W, H).fraction.toFixed(3));
  const third = img(W, H, (x, y) => y < H / 3 ? [70, 150, 60] : [128, 128, 128]);
  ok('green cover: a third crop on grey → 0.33', near(L.greenCover(third, W, H).fraction, 1 / 3, 0.03));
  ok('green cover: all grey → 0 (no Otsu split invented)', L.greenCover(img(W, H, () => [128, 128, 128]), W, H).fraction === 0);
  ok('green cover: all green → 1', L.greenCover(img(W, H, () => [60, 160, 40]), W, H).fraction === 1);
  const canopy = img(W, H, (x, y) => (y < H / 2) ? [140, 180, 235] : [30, 60, 25]);   // sky | leaves
  ok('sky fraction: half sky → 0.5', near(L.skyFraction(canopy, W, H).fraction, 0.5, 0.03), L.skyFraction(canopy, W, H).fraction.toFixed(3));
  ok('sky fraction: dense dark canopy → 0', L.skyFraction(img(W, H, () => [30, 55, 25]), W, H).fraction === 0);
}

// ── NMEA ──
{
  const cs = body => { let c = 0; for (const ch of body) c ^= ch.charCodeAt(0); return `$${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`; };
  const gga = L.parseNMEA('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47');
  ok('GGA: textbook sentence parsed', gga && near(gga.lat, 48.1173, 1e-4) && near(gga.lon, 11.516667, 1e-5) && gga.sats === 8 && gga.alt === 545.4 && gga.fixLabel === 'GPS');
  ok('bad checksum rejected', L.parseNMEA('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48') === null);
  const rtk = L.parseNMEA(cs('GNGGA,061500.00,1907.9998,N,07254.7980,E,4,24,0.5,14.2,M,-63.1,M,1.0,0001'));
  ok('GNGGA RTK fixed (quality 4), south/west signs', rtk.fixLabel === 'RTK fixed' && near(rtk.lat, 19.13333, 1e-4) && near(rtk.lon, 72.913300, 1e-5));
  ok('S/W hemispheres negative', L.parseNMEA(cs('GPGGA,000000,3351.000,S,15112.000,W,1,05,1.2,10,M,0,M,,')).lat < 0);
  const rd = L.createNmeaReader(), all = [cs('GNGGA,061500.00,1907.9998,N,07254.7980,E,5,18,0.7,14.2,M,-63.1,M,1.0,0001'), cs('GNRMC,061500.00,A,1907.9998,N,07254.7980,E,1.94,87.5,251026,,,D'), cs('GNGST,061500.00,0.9,0.012,0.009,45.0,0.011,0.010,0.025'), '$GNGGA,garbage*00'].join('\r\n') + '\r\n';
  rd.push(all.slice(0, 50)); rd.push(all.slice(50, 120)); rd.push(all.slice(120));
  ok('reader: lines split across chunks reassemble', rd.fix.fixLabel === 'RTK float' && near(rd.fix.speedMs, 1.0, 0.01) && rd.fix.courseDeg === 87.5);
  ok('reader: accuracy only from GST (1.5 cm here)', near(rd.fix.acc, Math.hypot(0.011, 0.010), 1e-9), rd.fix.acc.toFixed(4));
  ok('reader: corrupt line counted, not used', rd.fix.bad === 1);
  const noGst = L.createNmeaReader(); noGst.push(cs('GPGGA,000000,1907.9998,N,07254.7980,E,1,08,0.9,10,M,0,M,,') + '\n');
  ok('no GST → accuracy null (HDOP is not metres)', noGst.fix.acc === null && noGst.fix.hdop === 0.9);
}

// ── Bluetooth ESS, pressure, AR, capabilities ──
{
  const dv = (n, set) => { const v = new DataView(new ArrayBuffer(n)); set(v); return v; };
  ok('ESS temperature sint16 × 0.01', near(L.decodeTemperature(dv(2, v => v.setInt16(0, -1234, true))), -12.34, 1e-9));
  ok('ESS humidity uint16 × 0.01', near(L.decodeHumidity(dv(2, v => v.setUint16(0, 6543, true))), 65.43, 1e-9));
  ok('ESS pressure uint32 × 0.1 Pa', near(L.decodePressure(dv(4, v => v.setUint32(0, 1013250, true))), 101325, 1e-6));
  ok('pressure altitude at p0 = 0', near(L.pressureAltitude(101325), 0, 1e-9));
  ok('1 hPa lower ≈ 8.4 m higher', near(L.heightAbove(101225, 101325), 8.4, 0.2), L.heightAbove(101225, 101325).toFixed(2));
  ok('0.12 hPa ≈ 1 m (a floor step)', near(L.heightAbove(101313, 101325), 1.0, 0.05));
  ok('AR height: 1.52 − 0.04 → 1.48 m', near(L.arHeight(1.52, 0.04), 1.48, 1e-9));
  ok('AR height: below ground or absurd → null', L.arHeight(0.2, 0.5) === null && L.arHeight(50, 0) === null);
  const none = L.capabilities({ navigator: {} });
  ok('capabilities: empty browser → all false', none.every(c => c.ok === false) && none.length >= 12);
  const some = L.capabilities({ navigator: { geolocation: {}, xr: {}, vibrate() {} }, DeviceMotionEvent: function () {} });
  ok('capabilities: probes features, not user agents', some.find(c => c.key === 'xr').ok && some.find(c => c.key === 'motion').ok && !some.find(c => c.key === 'nfc').ok);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
