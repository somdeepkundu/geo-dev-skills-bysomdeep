/* road-core.js — road roughness from a phone's accelerometer and GPS. Pure functions and small state
 * machines; no DOM. Browser (window.RoadCore) and Node.
 *
 *   vertical shake   acceleration projected on the gravity direction, so the phone's pose in the mount
 *                    does not matter. Gravity is a slow average of the same sensor (time constant 0.8 s).
 *   segments         the ride is cut every 20 m of travel (not every N seconds), so a fast and a slow pass
 *                    over the same road produce the same pieces.
 *   per segment      RMS and peak of the vertical shake, sharp bumps, speed, turn, and a speed-adjusted
 *                    index = RMS × (30 km/h ÷ speed)^p. The exponent p = 1 is a first guess: calibrate it.
 *   no score         a segment ridden under 10 km/h, or with too few readings, has index null. Never 0.
 *
 * Geo maths, the CSV guard and escaping come from phone-field-sensors' sensor-core.js.
 * Status: experimental. Tested with synthetic rides only (scripts in this folder).
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../skills/phone-field-sensors/assets/template/sensor-core.js'));
  } else root.RoadCore = factory(root.FieldSensors);
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';
  const isNum = v => typeof v === 'number' && isFinite(v);
  const KMH = 3.6;

  const DEFAULTS = {
    segLen: 20,            // m of travel per segment
    gravTau: 0.8,          // s, time constant of the gravity average
    idleSpeed: 0.8,        // m/s: below this the bike is standing; nothing is logged into segments
    slowSpeed: 10 / KMH,   // m/s: below this a segment gets no score (shake no longer reflects the road)
    refSpeed: 30 / KMH,    // m/s: the speed the index is adjusted to
    speedExp: 1,           // index = rms × (refSpeed / speed)^speedExp
    bumpThr: 4.0,          // m/s² of vertical shake that counts as a sharp bump (about 0.4 g)
    bumpGapMs: 250,        // readings this close together are one bump
    maxFixGapMs: 5000,     // a longer silence from GPS ends the segment instead of guessing the path
    maxAcc: 30,            // m: fixes worse than this are not used for position
    maxSpeed: 70,          // m/s (250 km/h): a faster hop between two fixes is a GPS jump, not travel
    minHz: 20,             // fewer readings per second than this: no score
    classBreaks: [1.0, 2.0, 3.5]   // index → smooth | fair | rough | very rough. Starting values, uncalibrated.
  };
  const CLASSES = ['smooth', 'fair', 'rough', 'very rough'];
  function classOf(index, breaks = DEFAULTS.classBreaks) {
    if (!isNum(index)) return null;
    let i = 0; while (i < breaks.length && index >= breaks[i]) i++;
    return CLASSES[i];
  }

  /* ── Vertical shake ─────────────────────────────────────────────
     Feed accelerationIncludingGravity (m/s²). Returns the part along gravity with gravity removed (av),
     the part across it (al), and `ready` once the gravity average has settled.
     The sign of av depends on the browser's sign convention for this vector; RMS and peaks do not. */
  function createVertical({ tau = DEFAULTS.gravTau } = {}) {
    let g = null, tPrev = null, warm = 0;
    return {
      push(tMs, ax, ay, az) {
        if (!isNum(ax) || !isNum(ay) || !isNum(az) || !isNum(tMs)) return null;
        if (g === null) { g = [ax, ay, az]; tPrev = tMs; return { av: 0, al: 0, ready: false, up: unit(g) }; }
        const dt = Math.min(Math.max((tMs - tPrev) / 1000, 0), 0.25); tPrev = tMs;
        const k = 1 - Math.exp(-dt / tau);
        g[0] += k * (ax - g[0]); g[1] += k * (ay - g[1]); g[2] += k * (az - g[2]);
        const gm = Math.hypot(g[0], g[1], g[2]);
        if (gm < 1) return null;                          // free fall or a dead sensor: no direction to project on
        const dx = ax - g[0], dy = ay - g[1], dz = az - g[2];
        const av = (dx * g[0] + dy * g[1] + dz * g[2]) / gm;
        const al = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - av * av));
        warm += dt;
        return { av, al, ready: warm >= 2 * tau, up: [g[0] / gm, g[1] / gm, g[2] / gm] };
      }
    };
  }
  const unit = v => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
  /* Turn rate about the vertical, °/s, from devicemotion.rotationRate (alpha about z, beta about x, gamma
     about y). On a leaning bike `up` is the bike's own up, so this reads low by cos(lean): 6 % at 20°. */
  function yawRate(rr, up) {
    if (!rr || !up || !isNum(rr.alpha) || !isNum(rr.beta) || !isNum(rr.gamma)) return null;
    return rr.beta * up[0] + rr.gamma * up[1] + rr.alpha * up[2];
  }

  /* ── Segments ───────────────────────────────────────────────────
     pushMotion(t, av, al, yaw) for every motion reading; pushFix({t, lat, lon, acc, speed}) for every GPS
     fix (t in ms on the same clock). Readings wait until the next fix, then are spread along the straight
     line between the two fixes by time. A bump's position is therefore good to about one GPS interval. */
  function createSegmenter(opts = {}) {
    const o = Object.assign({}, DEFAULTS, opts);
    let buf = [], prev = null, cur = null, prevHeading = null, idx = 0;
    let lastBump = null, movingM = 0, idleMs = 0, state = 'waiting';
    const segs = [], bumps = [];

    const open = (t, lat, lon) => ({ t0: t, lat0: lat, lon0: lon, len: 0, movMs: 0, n: 0, s2: 0, l2: 0, peak: 0, bumps: 0,
      yawSum: 0, yawN: 0, accMax: 0, maxDt: 0, lastT: null, coords: [[lon, lat]], speedSrc: null });

    function add(s, fix, lat, lon, v) {
      const c = cur; c.n++; c.s2 += s.av * s.av; c.l2 += s.al * s.al;
      const a = Math.abs(s.av); if (a > c.peak) c.peak = a;
      if (isNum(s.yaw)) { c.yawSum += s.yaw; c.yawN++; }
      if (c.lastT !== null && s.t - c.lastT > c.maxDt) c.maxDt = s.t - c.lastT;
      c.lastT = s.t;
      if (a >= o.bumpThr) {
        if (lastBump && s.t - lastBump.t <= o.bumpGapMs) { if (a > lastBump.peak) lastBump.peak = a; lastBump.t = s.t; }
        else { lastBump = { t: s.t, t_first: s.t, peak: a, lat, lon, speed: v, seg: idx }; bumps.push(lastBump); c.bumps++; out.bumps.push(lastBump); }
      }
    }
    function close(t, lat, lon, partial) {
      const c = cur; cur = null;
      if (!c) return;
      c.coords.push([lon, lat]);
      const sec = c.movMs / 1000, speed = sec > 0 ? c.len / sec : null, hz = sec > 0 ? c.n / sec : null;
      const rms = c.n ? Math.sqrt(c.s2 / c.n) : null;
      const heading = c.len >= 2 ? F.geoBearing(c.lat0, c.lon0, lat, lon) : null;
      let turn = null;
      if (heading !== null && prevHeading !== null) turn = ((heading - prevHeading + 540) % 360) - 180;   // + = right
      if (heading !== null) prevHeading = heading;
      const yaw = c.yawN ? c.yawSum / c.yawN : null;
      const flags = [];
      if (partial) flags.push(partial);
      if (speed !== null && speed < o.slowSpeed) flags.push('slow');
      if (hz === null || hz < o.minHz) flags.push('low_rate');
      if (c.accMax > 15) flags.push('gps_weak');
      const scored = rms !== null && speed !== null && !flags.includes('slow') && !flags.includes('low_rate');
      const index = scored ? rms * Math.pow(o.refSpeed / speed, o.speedExp) : null;
      const seg = {
        seg: idx++, t_start: c.t0, t_end: t, length_m: c.len, moving_s: sec,
        speed_kmh: speed === null ? null : speed * KMH, speed_source: c.speedSrc,
        n: c.n, rate_hz: hz, max_gap_ms: c.maxDt,
        rms_v: rms, peak_v: c.n ? c.peak : null, rms_lateral: c.n ? Math.sqrt(c.l2 / c.n) : null, bumps: c.bumps,
        index, class: classOf(index, o.classBreaks),
        heading_deg: heading, turn_deg: turn,
        curve_radius_gps_m: turn !== null && Math.abs(turn) >= 3 ? c.len / (Math.abs(turn) * Math.PI / 180) : null,
        turn_rate_dps: yaw,
        curve_radius_gyro_m: yaw !== null && speed !== null && Math.abs(yaw) >= 2 ? speed / (Math.abs(yaw) * Math.PI / 180) : null,
        gps_acc_max_m: c.accMax || null, flags, coords: c.coords
      };
      segs.push(seg); out.closed.push(seg);
    }
    let out = { closed: [], bumps: [] };

    function pushMotion(t, av, al, yaw) {
      if (!isNum(t) || !isNum(av)) return;
      buf.push({ t, av, al: isNum(al) ? al : 0, yaw });
      if (buf.length > 3000) buf.splice(0, buf.length - 3000);       // GPS silent: keep the last ~50 s only
    }

    function pushFix(fix) {
      out = { closed: [], bumps: [], state };
      if (!fix || !isNum(fix.lat) || !isNum(fix.lon) || !isNum(fix.t)) return out;
      const acc = isNum(fix.acc) ? fix.acc : null;
      if (acc !== null && acc > o.maxAcc) { state = out.state = 'gps_weak'; return out; }
      if (!prev) { prev = fix; buf = []; state = out.state = 'ready'; return out; }
      const dtMs = fix.t - prev.t;
      if (dtMs <= 0) return out;
      if (dtMs > o.maxFixGapMs) {                                    // GPS was away: do not draw a line through it
        if (cur) { if (cur.len >= o.segLen / 2) close(prev.t, prev.lat, prev.lon, 'gps_gap'); else cur = null; }
        prevHeading = null; prev = fix; buf = []; state = out.state = 'gps_gap'; return out;
      }
      const d = F.geoDist(prev.lat, prev.lon, fix.lat, fix.lon);
      if (d / (dtMs / 1000) > o.maxSpeed) {                          // GPS jumped: start again from the new place
        if (cur) { if (cur.len >= o.segLen / 2) close(prev.t, prev.lat, prev.lon, 'gps_gap'); else cur = null; }
        prevHeading = null; prev = fix; buf = []; state = out.state = 'gps_gap'; return out;
      }
      const hasSpeed = isNum(fix.speed) && fix.speed >= 0;
      const v = hasSpeed ? fix.speed : d / (dtMs / 1000);
      out.speed = v;
      if (v < o.idleSpeed || d < 0.05) {                             // standing: drop these readings (trims stops)
        idleMs += dtMs; buf = buf.filter(s => s.t > fix.t); prev = fix; state = out.state = 'idle'; return out;
      }
      state = out.state = 'moving';
      const leg = buf.filter(s => s.t <= fix.t); buf = buf.filter(s => s.t > fix.t);
      const at = f => [prev.lat + (fix.lat - prev.lat) * f, prev.lon + (fix.lon - prev.lon) * f];
      const frac = t => Math.min(1, Math.max(0, (t - prev.t) / dtMs));
      if (!cur) cur = open(prev.t, prev.lat, prev.lon);
      let f = 0, i = 0;
      for (;;) {
        cur.speedSrc = hasSpeed ? 'gps' : 'fixes';
        if (acc !== null && acc > cur.accMax) cur.accMax = acc;
        const need = o.segLen - cur.len, left = d * (1 - f);
        if (left < need) {
          for (; i < leg.length; i++) { const p = at(frac(leg[i].t)); add(leg[i], fix, p[0], p[1], v); }
          cur.len += left; cur.movMs += dtMs * (1 - f); cur.coords.push([fix.lon, fix.lat]);
          break;
        }
        const f2 = f + need / d, tSplit = prev.t + f2 * dtMs, p2 = at(f2);
        for (; i < leg.length && leg[i].t <= tSplit; i++) { const p = at(frac(leg[i].t)); add(leg[i], fix, p[0], p[1], v); }
        cur.len += need; cur.movMs += dtMs * (f2 - f);
        close(tSplit, p2[0], p2[1], null);
        cur = open(tSplit, p2[0], p2[1]); f = f2;
      }
      movingM += d; prev = fix;
      return out;
    }
    /* close() always appends its end point; a segment that ended exactly on a fix would repeat it. */
    const dedupe = seg => { const c = seg.coords, n = c.length; if (n > 2 && c[n - 1][0] === c[n - 2][0] && c[n - 1][1] === c[n - 2][1]) c.pop(); return seg; };

    function finish() {
      out = { closed: [], bumps: [], state: 'ended' };
      if (cur && cur.len >= 5 && prev) close(prev.t, prev.lat, prev.lon, 'partial'); else cur = null;
      out.closed.forEach(dedupe);
      return out;
    }
    return {
      pushMotion,
      pushFix: fix => { const r = pushFix(fix); r.closed.forEach(dedupe); return r; },
      finish,
      get segments() { return segs; }, get bumps() { return bumps; },
      get distance() { return movingM; }, get idleMs() { return idleMs; }, get state() { return state; },
      options: o
    };
  }

  /* ── Summary ── */
  function summarise(segs) {
    const by = { smooth: 0, fair: 0, rough: 0, 'very rough': 0, none: 0 };
    let dist = 0, scored = 0, wsum = 0, bumps = 0;
    for (const s of segs) {
      dist += s.length_m; bumps += s.bumps;
      if (s.class) { by[s.class] += s.length_m; scored += s.length_m; wsum += s.index * s.length_m; } else by.none += s.length_m;
    }
    const worst = segs.filter(s => isNum(s.index)).sort((a, b) => b.index - a.index).slice(0, 5);
    return { distance_m: dist, scored_m: scored, by_class_m: by, mean_index: scored ? wsum / scored : null, bumps, worst };
  }

  /* ── Raw data: which stored chunks may be dropped ───────────────
     keepMs = how much recent raw data to keep (null keeps everything). A chunk older than that survives
     only if a sharp bump falls inside it or within padMs of its edges. Returns the ids to delete. */
  function prunable(chunks, bumpTimes, nowMs, keepMs, padMs = 2000) {
    if (!isNum(keepMs)) return [];
    return chunks.filter(c => c.t1 < nowMs - keepMs && !bumpTimes.some(t => t >= c.t0 - padMs && t <= c.t1 + padMs)).map(c => c.id);
  }

  /* ── Export ── */
  const r = (v, d) => isNum(v) ? +v.toFixed(d) : null;
  const iso = t => isNum(t) ? new Date(t).toISOString() : null;
  function segProps(s) {
    return { seg: s.seg, class: s.class, index: r(s.index, 3), rms_v: r(s.rms_v, 3), peak_v: r(s.peak_v, 2), bumps: s.bumps,
      speed_kmh: r(s.speed_kmh, 1), length_m: r(s.length_m, 1), rms_lateral: r(s.rms_lateral, 3),
      heading_deg: r(s.heading_deg, 1), turn_deg: r(s.turn_deg, 1), curve_radius_gps_m: r(s.curve_radius_gps_m, 0),
      turn_rate_dps: r(s.turn_rate_dps, 2), curve_radius_gyro_m: r(s.curve_radius_gyro_m, 0),
      rate_hz: r(s.rate_hz, 1), max_gap_ms: r(s.max_gap_ms, 0), n: s.n, gps_acc_max_m: r(s.gps_acc_max_m, 1),
      speed_source: s.speed_source, flags: s.flags.join(' '), t_start: iso(s.t_start), t_end: iso(s.t_end) };
  }
  const rideProps = ride => ({ ride: ride.name, vehicle: ride.vehicle, mount: ride.mount });
  function segmentsGeoJSON(ride, segs) {
    return { type: 'FeatureCollection', name: 'road_segments', ride: rideMeta(ride),
      features: segs.map(s => ({ type: 'Feature', properties: Object.assign(segProps(s), rideProps(ride)),
        geometry: { type: 'LineString', coordinates: s.coords.map(c => [+c[0].toFixed(7), +c[1].toFixed(7)]) } })) };
  }
  function bumpsGeoJSON(ride, bumps) {
    return { type: 'FeatureCollection', name: 'sharp_bumps', ride: rideMeta(ride),
      features: bumps.map((b, i) => ({ type: 'Feature',
        properties: Object.assign({ bump: i + 1, peak_v: r(b.peak, 2), speed_kmh: r(b.speed * KMH, 1), seg: b.seg, time: iso(b.t_first) }, rideProps(ride)),
        geometry: { type: 'Point', coordinates: [+b.lon.toFixed(7), +b.lat.toFixed(7)] } })) };
  }
  function rideMeta(ride) {
    return { name: ride.name, vehicle: ride.vehicle, mount: ride.mount, started: iso(ride.started), ended: iso(ride.ended),
      app: ride.app, settings: ride.settings, device: ride.device, pauses: ride.pauses || [] };
  }
  function segmentsCSV(ride, segs) {
    const cols = ['seg', 'class', 'index', 'rms_v', 'peak_v', 'bumps', 'speed_kmh', 'length_m', 'rms_lateral', 'heading_deg', 'turn_deg',
      'curve_radius_gps_m', 'turn_rate_dps', 'curve_radius_gyro_m', 'rate_hz', 'max_gap_ms', 'n', 'gps_acc_max_m', 'speed_source', 'flags', 't_start', 't_end'];
    const head = ['ride', 'vehicle', 'mount'].concat(cols, ['lat_start', 'lon_start', 'lat_end', 'lon_end']);
    const rows = segs.map(s => {
      const p = segProps(s), a = s.coords[0], b = s.coords[s.coords.length - 1];
      return [ride.name, ride.vehicle, ride.mount].concat(cols.map(c => p[c]), [a[1].toFixed(7), a[0].toFixed(7), b[1].toFixed(7), b[0].toFixed(7)]).map(F.csvCell).join(',');
    });
    return [head.join(',')].concat(rows).join('\n') + '\n';
  }
  /* Raw chunk layout: Float32, RAW_COLS values per reading. t is ms since the chunk's t0 (kept in its record). */
  const RAW_COLS = ['t_ms', 'ax', 'ay', 'az', 'rot_alpha', 'rot_beta', 'rot_gamma', 'vertical'];
  function rawCSVRows(chunk) {
    const a = new Float32Array(chunk.data), n = RAW_COLS.length, lines = [];
    for (let i = 0; i + n <= a.length; i += n) {
      const row = [Math.round(chunk.t0 + a[i])];
      for (let j = 1; j < n; j++) row.push(Number.isNaN(a[i + j]) ? '' : a[i + j].toFixed(j >= 4 && j <= 6 ? 2 : 3));
      lines.push(row.join(','));
    }
    return lines.length ? lines.join('\n') + '\n' : '';
  }

  return { DEFAULTS, CLASSES, RAW_COLS, classOf, createVertical, yawRate, createSegmenter, summarise, prunable,
    segmentsGeoJSON, bumpsGeoJSON, segmentsCSV, rawCSVRows, rideMeta };
});
