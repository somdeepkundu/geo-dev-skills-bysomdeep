/* georef.js — put a GPS position on a hand-drawn or schematic map (an SVG campus plan, a scanned
 * venue map) by fitting a transform to calibration points: places where you know both the GPS
 * position and the map position. From the LitFest Companion 1.0 (NCPA campus map, "guided
 * live-location setup"): similarity with 2–3 points, affine with 4+, and the residual of every
 * point in metres, so a bad point shows itself.
 *
 *   const fit = Georef.fit([{id, lat, lon, map:[x, y]}, …], {centre:[lat, lon]});
 *   fit.toMap(lat, lon) → [x, y];  fit.err (mean m), fit.max, fit.worst (id), fit.res {id: m}, fit.mpu (m per map unit)
 *
 * Local coordinates are metres EAST and SOUTH of the centre — the same handedness as an SVG with
 * y pointing down — so no mirror is needed (a similarity can rotate and scale, but cannot mirror).
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Georef = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const R = 6371008, RAD = Math.PI / 180;

  function toLocal(lat, lon, centre) {            // metres east, metres south of centre (equirectangular; fine for a campus)
    return [(lon - centre[1]) * RAD * R * Math.cos(centre[0] * RAD), -(lat - centre[0]) * RAD * R];
  }
  function det3(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }
  function solve3(m, v) {
    const d = det3(m); if (Math.abs(d) < 1e-9) return null;
    return [0, 1, 2].map(c => det3(m.map((row, r) => { const x = row.slice(); x[c] = v[r]; return x; })) / d);
  }
  /* Similarity (scale, rotation, shift) by least squares, with complex numbers. Refuses points that
     are too close together (spread < 400 m², about 20 m): the rotation would be noise. */
  function fitSimilarity(zs, ws) {
    const n = zs.length, zm = [0, 0], wm = [0, 0];
    zs.forEach((z, i) => { zm[0] += z[0] / n; zm[1] += z[1] / n; wm[0] += ws[i][0] / n; wm[1] += ws[i][1] / n; });
    let nr = 0, ni = 0, den = 0;
    zs.forEach((z, i) => {
      const a = z[0] - zm[0], b = z[1] - zm[1], c = ws[i][0] - wm[0], d = ws[i][1] - wm[1];
      nr += c * a + d * b; ni += d * a - c * b; den += a * a + b * b;
    });
    if (den < 400) return null;
    const A = [nr / den, ni / den];
    return { type: 'similarity', m: [A[0], -A[1], wm[0] - (A[0] * zm[0] - A[1] * zm[1]), A[1], A[0], wm[1] - (A[0] * zm[1] + A[1] * zm[0])] };
  }
  /* Affine (lets a schematic map be stretched differently across and down) — only with 4+ points,
     and only if its area scale stays within 0.6–1.6× the similarity's: points nearly in a line make
     the stretch meaningless, so fall back to the similarity. */
  function fitAffine(zs, ws) {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    zs.forEach((z, i) => {
      const r = [z[0], z[1], 1];
      for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) S[a][b] += r[a] * r[b]; bx[a] += r[a] * ws[i][0]; by[a] += r[a] * ws[i][1]; }
    });
    const X = solve3(S, bx), Y = solve3(S, by);
    if (!X || !Y) return null;
    const f = { type: 'affine', m: [X[0], X[1], X[2], Y[0], Y[1], Y[2]] };
    const det = f.m[0] * f.m[4] - f.m[1] * f.m[3], sim = fitSimilarity(zs, ws);
    if (!sim || det <= 0) return null;
    const ss = sim.m[0] * sim.m[4] - sim.m[1] * sim.m[3];
    if (det / ss < 0.6 || det / ss > 1.6) return null;
    return f;
  }
  const apply = (f, z) => [f.m[0] * z[0] + f.m[1] * z[1] + f.m[2], f.m[3] * z[0] + f.m[4] * z[1] + f.m[5]];

  function fit(points, { centre } = {}) {
    if (!points || points.length < 2) return null;
    const c = centre || [points.reduce((s, p) => s + p.lat, 0) / points.length, points.reduce((s, p) => s + p.lon, 0) / points.length];
    const zs = points.map(p => toLocal(p.lat, p.lon, c)), ws = points.map(p => p.map);
    const f = (points.length >= 4 && fitAffine(zs, ws)) || fitSimilarity(zs, ws);
    if (!f) return null;
    f.mpu = 1 / Math.sqrt(Math.abs(f.m[0] * f.m[4] - f.m[1] * f.m[3]));    // metres per map unit
    f.res = {}; f.err = 0; f.max = 0; f.worst = null; f.n = points.length;
    points.forEach((p, i) => {
      const m = apply(f, zs[i]), r = Math.hypot(m[0] - ws[i][0], m[1] - ws[i][1]) * f.mpu;
      f.res[p.id ?? i] = r; f.err += r / points.length;
      if (r > f.max) { f.max = r; f.worst = p.id ?? i; }
    });
    f.centre = c;
    f.toMap = (lat, lon) => apply(f, toLocal(lat, lon, c));
    return f;
  }
  return { fit, fitSimilarity, fitAffine, toLocal, apply };
});
