/* explorer-kit.js — helpers for a map explorer of field data, from the FloodView Explorer 1.1 and the
 * CropView Data Explorer v2.1–2.3 (both read many ZIPs at once, colour points by class, value or time
 * with a live legend, fan out overlapping points, and keep the original field labels when reviewing).
 * Browser (window.ExplorerKit) and Node. Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExplorerKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Escaping: every string that came from a file is untrusted ── */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsq = s => esc(JSON.stringify(String(s)));      // a safe string literal inside onclick="…"
  function csvCell(v) {                                 // quote when needed; neutralise =,+,-,@ formulas
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;

  /* ── Colour ── */
  const PALETTE = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f87171', '#818cf8', '#fb923c', '#4ade80', '#e879f9', '#facc15', '#fb7185', '#2dd4bf', '#c084fc', '#60a5fa'];
  function categoryColours(palette = PALETTE) {          // stable colour per category, in order of first sight
    const map = {};
    return name => { const k = name ?? '∅'; if (!map[k]) map[k] = palette[Object.keys(map).length % palette.length]; return map[k]; };
  }
  const ramp = t => `hsl(${240 - 240 * t},80%,55%)`;   // blue → red, for time, direction, tilt
  function stopsRamp(stops) {                           // multi-stop ramp, e.g. light → dark blue for depth
    const rgb = h => [1, 3, 5].map(k => parseInt(h.substr(k, 2), 16));
    return t => {
      const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, a = rgb(stops[i]), b = rgb(stops[i + 1]);
      return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',') + ')';
    };
  }
  function range(list, fn) { const v = list.map(fn).filter(x => x !== null && isFinite(x)); return v.length ? { mn: Math.min(...v), mx: Math.max(...v) } : null; }
  function niceTicks(mn, mx, count, intOnly) {           // 1-2-5 ticks inside [mn, mx]
    const span = mx - mn; if (span <= 0) return [mn];
    let step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = (span / count) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    if (intOnly) step = Math.max(1, Math.round(step));
    const out = []; for (let v = Math.ceil(mn / step) * step; v <= mx + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  /* A colour mode is {kind:'category'|'continuous'|'time', value(rec), label, colourOf?, ramp?, fmt?}.
     colourer() returns rec → colour for the CURRENT list (ranges are recomputed from what is visible),
     legend() returns the HTML for the bottom legend: chips with counts, or a gradient bar with ticks. */
  function colourer(mode, list, none = '#94a3b8') {
    if (mode.kind === 'category') return r => { const v = mode.value(r); return v === null || v === undefined ? none : mode.colourOf(v); };
    const rg = range(list, mode.value), rp = mode.ramp || ramp;
    return r => { const v = mode.value(r); if (v === null || v === undefined || !rg) return none; return rp(rg.mx === rg.mn ? 0.5 : (v - rg.mn) / (rg.mx - rg.mn)); };
  }
  function legend(mode, list, { none = '#94a3b8', width = 320, fmt } = {}) {
    if (!list.length) return '';
    const title = `<div class="lg-title">${esc(mode.label)}<small>${list.length} shown</small></div>`;
    if (mode.kind === 'category') {
      const counts = new Map(); list.forEach(r => { const v = mode.value(r) ?? null; counts.set(v, (counts.get(v) || 0) + 1); });
      const chips = [...counts].sort((a, b) => b[1] - a[1]).map(([v, n]) =>
        `<span class="lg-chip"><i style="background:${v === null ? none : mode.colourOf(v)}"></i>${esc(v === null ? 'none' : (mode.name ? mode.name(v) : v))}<em>${n}</em></span>`).join('');
      return title + `<div class="lg-chips">${chips}</div>`;
    }
    const rg = range(list, mode.value), rp = mode.ramp || ramp, f = fmt || mode.fmt || (v => String(Math.round(v)));
    if (!rg) return title + `<div class="lg-chips"><span class="lg-chip"><i style="background:${none}"></i>no values</span></div>`;
    const stops = []; for (let t = 0; t <= 1.0001; t += 0.1) stops.push(`${rp(t)} ${(t * 100).toFixed(0)}%`);
    const target = Math.max(3, Math.min(8, Math.floor(width / (mode.kind === 'time' ? 110 : 60))));
    const vals = mode.kind === 'time' ? Array.from({ length: target - 1 }, (_, i) => rg.mn + (rg.mx - rg.mn) * (i + 1) / target) : niceTicks(rg.mn, rg.mx, target, false);
    const gap = ((mode.kind === 'time' ? 70 : 48) / width) * 100;
    const ticks = [{ v: rg.mn, p: 0 }, ...vals.map(v => ({ v, p: rg.mx === rg.mn ? 50 : (v - rg.mn) / (rg.mx - rg.mn) * 100 })).filter(t => t.p > gap && t.p < 100 - gap), ...(rg.mx > rg.mn ? [{ v: rg.mx, p: 100 }] : [])];
    const tk = ticks.map(t => `<span class="lg-tick" style="left:${t.p}%;transform:translateX(${t.p === 0 ? '0' : t.p === 100 ? '-100%' : '-50%'})">${esc(f(t.v))}</span>`).join('');
    const nNone = list.filter(r => { const v = mode.value(r); return v === null || v === undefined; }).length;
    return title + `<div class="lg-scale"><div class="lg-bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="lg-ticks">${tk}</div></div>` +
      (nNone ? `<span class="lg-chip"><i style="background:${none}"></i>none<em>${nNone}</em></span>` : '');
  }

  /* ── Fan out points that overlap on screen ──
     Group points within `th` px of each other (screen space, so it adapts to zoom) and place each
     group on a ring around the group's first point; draw a leader line to the true position.
     Input [{id, x, y}] in px; output {id: [x, y]} only for points that moved. */
  function computeSpread(pts, th = 14) {
    const groups = [];
    pts.forEach(p => {
      let g = groups.find(g => Math.abs(g.x - p.x) < th && Math.abs(g.y - p.y) < th);
      if (!g) { g = { x: p.x, y: p.y, items: [] }; groups.push(g); }
      g.items.push(p);
    });
    const out = {};
    groups.forEach(g => {
      const n = g.items.length; if (n < 2) return;
      const r = Math.max(18, n * 20 / (2 * Math.PI) * 1.1);
      g.items.forEach((p, k) => { const a = 2 * Math.PI * k / n - Math.PI / 2; out[p.id] = [g.x + r * Math.cos(a), g.y + r * Math.sin(a)]; });
    });
    return out;
  }

  /* ── Review with an audit trail ──
     Keep the label the field team gave next to the reviewed one. When a reviewed file is reopened,
     field_<key> is read back, so the original survives any number of review rounds. */
  function keepOriginal(rec, keys, props = {}) {
    rec.field = {};
    keys.forEach(k => { rec.field[k] = props['field_' + k] !== undefined ? props['field_' + k] : rec[k]; });
    return rec;
  }
  const isChanged = (rec, keys) => !!rec.field && keys.some(k => (rec[k] ?? null) !== (rec.field[k] ?? null));
  function auditColumns(rec, keys) {
    const o = {}; keys.forEach(k => { o['field_' + k] = rec.field ? (rec.field[k] ?? null) : null; });
    o.review_changed = isChanged(rec, keys); return o;
  }

  /* Find the features file inside a field ZIP (FloodView / CropView / phone-field-sensors layout). */
  const POINTS_RE = /_captures_points\.geojson$/i;
  function findPointsFile(names) { return names.find(k => POINTS_RE.test(k)) || names.find(k => /\.geojson$/i.test(k)) || null; }

  return { esc, jsq, csvCell, num, PALETTE, categoryColours, ramp, stopsRamp, range, niceTicks, colourer, legend,
           computeSpread, keepOriginal, isChanged, auditColumns, findPointsFile };
});
