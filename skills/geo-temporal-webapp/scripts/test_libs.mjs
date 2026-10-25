#!/usr/bin/env node
// Node tests for assets/template/lib/{timekit,georef,explorer-kit}.js. No browser needed.
//   node scripts/test_libs.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'template', 'lib');
const TimeKit = require(path.join(LIB, 'timekit.js'));
const Georef = require(path.join(LIB, 'georef.js'));
const EK = require(path.join(LIB, 'explorer-kit.js'));

let pass = 0, fail = 0;
const ok = (name, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name + (d !== '' ? ` — ${d}` : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const MIN = 60000, H = 3600000;

// ── timekit ──
{
  const clk = TimeKit.makeClock('Asia/Kolkata', { now: () => Date.UTC(2026, 9, 25, 4, 30), search: '' });
  ok('zoned: 10:00 IST is 04:30 UTC', clk.zoned('2026-10-25', 10, 0) === Date.UTC(2026, 9, 25, 4, 30));
  ok('fmtTime in zone', /10:00/.test(clk.fmtTime(Date.UTC(2026, 9, 25, 4, 30))), clk.fmtTime(Date.UTC(2026, 9, 25, 4, 30)));
  // the phone is on UTC; the clock must still say the event's time
  ok('minuteOfDay in zone', clk.minuteOfDay(Date.UTC(2026, 9, 25, 4, 30)) === 600);
  const ny = TimeKit.makeClock('America/New_York', { now: () => 0, search: '' });
  ok('DST: 09:00 New York in March (EDT, after 2 Mar) is 13:00 UTC', ny.zoned('2026-03-15', 9, 0) === Date.UTC(2026, 2, 15, 13, 0));
  ok('DST: 09:00 New York in January (EST) is 14:00 UTC', ny.zoned('2026-01-15', 9, 0) === Date.UTC(2026, 0, 15, 14, 0));
  const dm = TimeKit.makeClock('Asia/Kolkata', { now: () => Date.UTC(2020, 0, 1), search: '?demo=2026-10-25T15:10', defaultDate: '2026-10-25' });
  ok('demo: pretends it is 15:10 event time', dm.isDemo() && dm.minuteOfDay(dm.now()) >= 910 && dm.minuteOfDay(dm.now()) < 911);
  const dm2 = TimeKit.makeClock('Asia/Kolkata', { now: () => 0, search: '?demo=15:10', defaultDate: '2026-10-25' });
  ok('demo HH:MM uses defaultDate', dm2.dateOf(dm2.now()) === '2026-10-25');
  const bad = TimeKit.makeClock('Asia/Kolkata', { now: () => 0, search: '?demo=junk' });
  ok('demo: junk value ignored', !bad.isDemo());

  const it = { start: 100, end: 200 };
  ok('stateAt before/soon/live/done', TimeKit.stateAt(it, 0, 50) === 'later' && TimeKit.stateAt(it, 60, 50) === 'soon' &&
     TimeKit.stateAt(it, 150) === 'live' && TimeKit.stateAt(it, 200) === 'done');
  ok('stateAt end is exclusive (done at end)', TimeKit.stateAt({ start: 0, end: 10 }, 10) === 'done');
  ok('snap rounds to step and clamps', TimeKit.snap(7 * MIN, 5 * MIN, 0, 1e9) === 5 * MIN && TimeKit.snap(-3 * MIN, 5 * MIN, 0, 1e9) === 0 && TimeKit.snap(1e9, 5 * MIN, 0, H) === H);

  // playhead: FOLLOW inside the window, PREVIEW outside
  let now = Date.UTC(2026, 9, 25, 10, 0);
  const clock = TimeKit.makeClock('UTC', { now: () => now, search: '' });
  const P = TimeKit.makePlayhead({ clock, lo: Date.UTC(2026, 9, 25, 9, 0), hi: Date.UTC(2026, 9, 25, 12, 0), step: 5 * MIN });
  P.init([]);
  ok('playhead follows now when inside window', P.follow && P.t === now);
  now += 2 * MIN; P.tick();
  P.backToNow(); const before = P.t; now += 30 * 1000; P.tick();
  ok('tick: no move within the same minute', P.t === before);
  now += MIN; P.tick();
  ok('tick: moves to now after a minute boundary', P.t === now);
  P.set(Date.UTC(2026, 9, 25, 11, 0), true);
  ok('user move → PREVIEW', P.follow === false && P.t === Date.UTC(2026, 9, 25, 11, 0));
  now = Date.UTC(2026, 9, 25, 10, 0); P.set(Date.UTC(2026, 9, 25, 10, 2), true);
  ok('moving back within half a step of now re-enters FOLLOW', P.follow === true);
  const outside = TimeKit.makeClock('UTC', { now: () => Date.UTC(2026, 0, 1), search: '' });
  const Q = TimeKit.makePlayhead({ clock: outside, lo: Date.UTC(2026, 9, 25, 9, 0), hi: Date.UTC(2026, 9, 25, 12, 0) });
  Q.init([{ start: Date.UTC(2026, 9, 25, 10, 0), end: Date.UTC(2026, 9, 25, 11, 0) }, { start: Date.UTC(2026, 9, 25, 10, 30), end: Date.UTC(2026, 9, 25, 10, 45) }]);
  ok('outside window: preview starts at busiest time', !Q.follow && Q.t >= Date.UTC(2026, 9, 25, 10, 30) && Q.t < Date.UTC(2026, 9, 25, 10, 45), new Date(Q.t).toISOString());

  // fixed-timestep loop: step count is independent of frame timing
  let pending = null;
  globalThis.requestAnimationFrame = cb => { pending = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { pending = null; };
  const count = (frames) => {
    let steps = 0; const loop = TimeKit.fixedStepLoop({ dt: 0.1, step: () => steps++, maxSteps: 1e9 });
    loop.start(); let t = 1000;
    pending(t);                                   // first frame sets the clock
    for (const dt of frames) { t += dt; const cb = pending; cb(t); }
    loop.stop();
    return steps;
  };
  const a = count(Array(60).fill(1000 / 60)), b = count(Array(120).fill(1000 / 120));
  ok('fixed step: 60 Hz and 120 Hz runs agree to one step per second', Math.abs(a - b) <= 1, `${a} vs ${b}`);
  ok('fixed step: ~10 steps per second at dt 0.1', near(a, 10, 1), String(a));
  const r = TimeKit.mulberry32(42), r2 = TimeKit.mulberry32(42);
  ok('mulberry32: same seed, same sequence', [1, 2, 3, 4].every(() => r() === r2()));
  const u = Array.from({ length: 2000 }, TimeKit.mulberry32(7));
  ok('mulberry32: values in [0,1) with mean near 0.5', u.every(v => v >= 0 && v < 1) && near(u.reduce((s, v) => s + v, 0) / u.length, 0.5, 0.03));
}

// ── georef ──
{
  // synthetic campus: map units are 1 unit = 2 m, metres east/south of centre
  const c = [19.1, 72.8];
  const truth = [[0, 0], [120, 40], [-60, 90], [30, -70], [200, 150]];   // map coords (pixels)
  const mpu = 2, rot = 0.3;
  const pt = (m, i) => {
    const [x, y] = m; // metres east, south
    const east = x * mpu * Math.cos(rot) - y * mpu * Math.sin(rot), south = x * mpu * Math.sin(rot) + y * mpu * Math.cos(rot);
    const lat = c[0] - south / 111195, lon = c[1] + east / (111195 * Math.cos(c[0] * Math.PI / 180));
    return { id: 'p' + i, lat, lon, map: [x, y] };
  };
  const pts = truth.map(pt);
  const f = Georef.fit(pts, { centre: c });
  ok('georef: 5 points → affine', f && f.type === 'affine', f && f.type);
  ok('georef: near-zero error on exact data', f && f.err < 0.01, f && f.err);
  const q = f.toMap(pts[3].lat, pts[3].lon);
  ok('georef: toMap recovers a known point', near(q[0], truth[3][0], 0.01) && near(q[1], truth[3][1], 0.01), q.map(v => v.toFixed(2)).join(','));
  ok('georef: metres per map unit ≈ 2', near(f.mpu, mpu, 0.02), f.mpu.toFixed(3));
  const s = Georef.fit(pts.slice(0, 2), { centre: c });
  ok('georef: 2 points → similarity', s && s.type === 'similarity');
  ok('georef: 1 point → null', Georef.fit(pts.slice(0, 1), { centre: c }) === null);
  const nearly = [pts[0], pts[0], pts[1]].map((p, i) => ({ ...p, id: 'n' + i }));
  ok('georef: points too close (<20 m) refused', Georef.fit(nearly.slice(0, 2), { centre: c }) === null);
  // a bad calibration point shows up as the worst residual
  const bad = pts.map((p, i) => i === 2 ? { ...p, map: [p.map[0] + 40, p.map[1]] } : p);
  const fb = Georef.fit(bad, { centre: c });
  ok('georef: leave-one-out names the bad point (largest residual may not)', fb && fb.worstLoo === 'p2', fb && `${fb.worstLoo}, loo=${fb.loo.p2.toFixed(0)} m`);
  ok('georef: bad point leave-one-out error ≈ its 80 m offset', fb && near(fb.loo.p2, 80, 2), fb && fb.loo.p2.toFixed(1));
  ok('georef: no mirror (east stays east)', (() => { const a = Georef.toLocal(c[0], c[1] + 0.001, c); return a[0] > 0 && near(a[1], 0, 1e-6); })());
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]].map((m, i) => { const p = pt(m, i); return { ...p, lat: p.lat, lon: p.lon }; });
  const sim = Georef.fitSimilarity(sq.map(p => Georef.toLocal(p.lat, p.lon, c)), sq.map(p => p.map));
  ok('georef: similarity fit returns type', sim && sim.type === 'similarity');
}

// ── explorer-kit ──
{
  const K = EK;
  ok('esc: escapes HTML', K.esc('<img onerror="x">') === '&lt;img onerror=&quot;x&quot;&gt;');
  ok('csvCell: formula guard on text', K.csvCell('=HYPERLINK("x")').startsWith("\"'=") || K.csvCell('=1+1') === "'=1+1");
  ok('csvCell: numbers untouched', K.csvCell(-5) === '-5');
  ok('csvCell: quotes and separators', K.csvCell('a,"b"') === '"a,""b"""');
  ok('csvCell: null → empty', K.csvCell(null) === '');
  ok('num: NaN and empty → null', K.num('') === null && K.num('x') === null && K.num('3.5') === 3.5);
  const cat = K.categoryColours();
  ok('categoryColours: stable per name', cat('A') === cat('A') && cat('A') !== cat('B'));
  ok('niceTicks: 1-2-5 steps', JSON.stringify(K.niceTicks(0, 97, 5)) === '[0,20,40,60,80]', JSON.stringify(K.niceTicks(0, 97, 5)));
  ok('niceTicks: intOnly', K.niceTicks(0, 3, 4, true).every(Number.isInteger));
  ok('range ignores non-finite', JSON.stringify(K.range([{ v: 1 }, { v: null }, { v: 5 }], r => r.v)) === '{"mn":1,"mx":5}');
  const recs = [{ d: 1 }, { d: 3 }, { d: 9 }];
  const mode = { kind: 'continuous', value: r => r.d, label: 'Depth' };
  const col = K.colourer(mode, recs);
  ok('colourer: min is blue, max is red', col(recs[0]) === 'hsl(240,80%,55%)' && col(recs[2]) === 'hsl(0,80%,55%)', col(recs[0]));
  ok('colourer: legend has a scale', K.legend(mode, recs).includes('lg-bar') && K.legend(mode, recs).includes('9'));
  const catMode = { kind: 'category', value: r => r.k, colourOf: cat, label: 'Class' };
  ok('legend: category chips with counts', /<em>2<\/em>/.test(K.legend(catMode, [{ k: 'a' }, { k: 'a' }, { k: 'b' }])));
  const sp = K.computeSpread([{ id: 1, x: 10, y: 10 }, { id: 2, x: 11, y: 12 }, { id: 3, x: 300, y: 300 }]);
  ok('computeSpread: overlapping pair fanned out, lone point not', sp[1] && sp[2] && sp[3] === undefined);
  ok('computeSpread: fanned points are apart', Math.hypot(sp[1][0] - sp[2][0], sp[1][1] - sp[2][1]) > 10);
  const rec = K.keepOriginal({ class: 'Crop', depth: 2 }, ['class', 'depth']);
  rec.class = 'Rice';
  const audit = K.auditColumns(rec, ['class', 'depth']);
  ok('keepOriginal + audit: original kept, change flagged', audit.field_class === 'Crop' && audit.review_changed === true && audit.field_depth === 2 && audit.review_changed === true);
  const reopened = K.keepOriginal({ class: 'Rice', depth: 2 }, ['class', 'depth'], { field_class: 'Crop', field_depth: 2 });
  ok('keepOriginal: reopened file keeps the field label', reopened.field.class === 'Crop');
  ok('findPointsFile prefers *_captures_points.geojson', K.findPointsFile(['a.geojson', 'site_captures_points.geojson']) === 'site_captures_points.geojson');
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
