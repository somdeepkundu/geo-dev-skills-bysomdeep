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
    module.exports = factory(require('./lib/sensor-core.js'));
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

  /* ── Export for a person or an LLM ──────────────────────────────
     FIELDS is the single description of the segments table: the CSV header, datapackage.json and PROMPT.md
     are all made from it, so they cannot disagree (the Node test checks this). */
  const FIELDS = [
    ['ride', 'string', '', 'Ride name as typed by the rider.'],
    ['vehicle', 'string', '', 'motorbike | scooter | bicycle | car.'],
    ['mount', 'string', '', 'Where the phone was. "handlebar mount" is the most faithful; "pocket or bag" damps the shake.'],
    ['seg', 'integer', '', 'Stretch number, in riding order from 0. Stretches are 20 m of travel, not 20 s.'],
    ['class', 'string', '', 'smooth | fair | rough | very rough, from index. EMPTY when the stretch was not scored (never means smooth).'],
    ['index', 'number', 'm/s2', 'Roughness score = rms_v x (30 km/h / speed)^1. EMPTY when not scored. Uncalibrated: compare only within one vehicle and mount.'],
    ['rms_v', 'number', 'm/s2', 'Root-mean-square of the up-down shake (gravity removed). Always present when readings exist, even if slow.'],
    ['peak_v', 'number', 'm/s2', 'Largest single up-down reading in the stretch.'],
    ['bumps', 'integer', '', 'Sharp hits (>= 4 m/s2 up-down, merged within 0.25 s) inside the stretch.'],
    ['speed_kmh', 'number', 'km/h', 'Stretch length / moving time. See speed_source.'],
    ['length_m', 'number', 'm', '20 for full stretches; shorter for the last one (flag "partial") or one cut by a GPS gap.'],
    ['rms_lateral', 'number', 'm/s2', 'Shake across the vertical (sideways and fore-aft together).'],
    ['heading_deg', 'number', 'deg', 'Direction of travel, clockwise from north, from the stretch ends. EMPTY under 2 m.'],
    ['turn_deg', 'number', 'deg', 'Change of heading from the previous stretch; positive = right turn. EMPTY for the first stretch.'],
    ['curve_radius_gps_m', 'number', 'm', 'Radius of the bend from GPS heading change. EMPTY on straights (< 3 deg). Noisy at 20 m.'],
    ['turn_rate_dps', 'number', 'deg/s', 'Mean gyroscope turn rate about the vertical; positive = anticlockwise seen from above. EMPTY without a gyroscope.'],
    ['curve_radius_gyro_m', 'number', 'm', 'speed / turn rate. EMPTY on straights (< 2 deg/s) or without a gyroscope. Better than the GPS radius.'],
    ['rate_hz', 'number', 'Hz', 'Motion readings per second inside the stretch. Below 20 the stretch is not scored.'],
    ['max_gap_ms', 'number', 'ms', 'Longest silence between two motion readings in the stretch.'],
    ['n', 'integer', '', 'Number of motion readings used.'],
    ['gps_acc_max_m', 'number', 'm', 'Worst GPS accuracy (1 sigma radius) among the fixes in the stretch.'],
    ['speed_source', 'string', '', 'gps = speed reported by the phone; fixes = distance between fixes / time.'],
    ['flags', 'string', '', 'Space-separated: slow (< 10 km/h, not scored), low_rate, gps_weak (worse than 15 m), gps_gap, partial.'],
    ['t_start', 'datetime', '', 'Start of the stretch, UTC, ISO 8601.'],
    ['t_end', 'datetime', '', 'End of the stretch, UTC, ISO 8601.'],
    ['lat_start', 'number', 'deg', 'Latitude of the stretch start, WGS84.'], ['lon_start', 'number', 'deg', 'Longitude of the stretch start, WGS84.'],
    ['lat_end', 'number', 'deg', 'Latitude of the stretch end, WGS84.'], ['lon_end', 'number', 'deg', 'Longitude of the stretch end, WGS84.']
  ].map(([name, type, unit, description]) => ({ name, type, unit, description }));
  const RAW_FIELDS = [
    ['time_unix_ms', 'integer', 'ms', 'Reading time, Unix epoch milliseconds (UTC).'],
    ['ax', 'number', 'm/s2', 'Acceleration including gravity, phone x axis (to the right of the screen).'],
    ['ay', 'number', 'm/s2', 'Same, phone y axis (towards the top of the screen).'],
    ['az', 'number', 'm/s2', 'Same, phone z axis (out of the screen). Axes are the phone\'s, not the bike\'s.'],
    ['rot_alpha', 'number', 'deg/s', 'Gyroscope about z. EMPTY without a gyroscope.'],
    ['rot_beta', 'number', 'deg/s', 'Gyroscope about x. EMPTY without a gyroscope.'],
    ['rot_gamma', 'number', 'deg/s', 'Gyroscope about y. EMPTY without a gyroscope.'],
    ['vertical', 'number', 'm/s2', 'Up-down shake used for the scores. EMPTY during the first 1.6 s while gravity settles.']
  ].map(([name, type, unit, description]) => ({ name, type, unit, description }));

  const clean = (v, n = 60) => String(v == null ? '' : v).replace(/[\r\n\t`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  function dataPackage(ride, files) {
    const fld = list => ({ fields: list.map(f => Object.assign({ name: f.name, type: f.type === 'datetime' ? 'datetime' : f.type, description: f.description }, f.unit ? { unit: f.unit } : {})), missingValues: [''] });
    return {
      profile: 'tabular-data-package', name: 'road-check-' + clean(ride.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: 'Road Check ride: ' + clean(ride.name), description: 'Road roughness from a phone accelerometer and GPS. Start with PROMPT.md.',
      created: new Date().toISOString(), licenses: [], contributors: [{ title: 'Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay', role: 'author' }],
      resources: [
        { name: 'segments', path: files.segmentsCSV, format: 'csv', mediatype: 'text/csv', description: 'One row per 20 m of travel.', schema: fld(FIELDS) },
        { name: 'segments-geo', path: files.segmentsGeo, format: 'geojson', description: 'The same stretches as LineStrings; properties repeat the CSV columns.' },
        { name: 'bumps', path: files.bumpsGeo, format: 'geojson', description: 'One point per sharp hit: bump, peak_v (m/s2), speed_kmh, seg, time. Position good to about one GPS interval (1 s of travel).' },
        { name: 'raw', path: files.raw, format: 'csv', mediatype: 'text/csv', description: 'Every motion reading kept. See ride.json settings.raw_keep_min.', schema: fld(RAW_FIELDS) },
        { name: 'ride', path: 'ride.json', format: 'json', description: 'Settings, device facts, pauses (periods with no logging) and the summary.' }
      ]
    };
  }

  /* PROMPT.md: a ready-to-paste brief for a future LLM session. The model gets the facts of this ride, how to read
     the numbers without fooling itself, and a plan that includes looking things up (road type, surface, speed
     breakers, rain) when it has tools for that. Nothing here is fetched by the app: the phone stays offline-first. */
  function llmPrompt(ride, segs, bumps, extra = {}) {
    const sum = summarise(segs), by = sum.by_class_m, tot = sum.distance_m || 0;
    let w = 180, s = 90, e = -180, n = -90;
    for (const g of segs) for (const c of g.coords) { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
    const bbox = segs.length ? [s - 0.0003, w - 0.0003, n + 0.0003, e + 0.0003].map(v => v.toFixed(5)).join(',') : null;
    const pct = k => tot ? Math.round(by[k] / tot * 100) + '%' : 'n/a';
    const mid = g => { const c = g.coords[Math.floor(g.coords.length / 2)]; return c[1].toFixed(5) + ', ' + c[0].toFixed(5); };
    const worst = sum.worst.map(g => `| ${g.seg} | ${g.class} | ${g.index.toFixed(2)} | ${Math.round(g.speed_kmh)} | ${g.bumps} | ${mid(g)} |`).join('\n');
    const t0 = segs.length ? iso(segs[0].t_start) : iso(ride.started), t1 = segs.length ? iso(segs[segs.length - 1].t_end) : iso(ride.ended);
    const o = ride.settings || DEFAULTS, f = extra.files || {}, gyro = ride.device && ride.device.gyroscope;
    const off = ride.device && isNum(ride.device.utc_offset_min) ? ride.device.utc_offset_min : null;
    return `# Task: analyse one road-roughness ride logged by a phone

You are helping a researcher (Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay) understand the condition of the roads on one ride.
The attached files are the output of the Road Check web app. Read this whole brief first, then the files, then work through the plan.
${ride.demo ? '\n> **THIS IS A SIMULATED DEMO RIDE, not a measurement of any real road.** Say so in every output.\n' : ''}
## This ride
- Name: ${clean(ride.name)} · vehicle: ${ride.vehicle} · phone: ${ride.mount}
- Time (UTC): ${t0} to ${t1}${off !== null ? ` · local time = UTC${off >= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}` : ''}
- Scored distance ${Math.round(sum.scored_m)} m of ${Math.round(tot)} m in ${segs.length} stretches; sharp bumps ${(bumps || []).length}; mean index ${sum.mean_index === null ? 'n/a' : sum.mean_index.toFixed(2)}
- Share of distance: smooth ${pct('smooth')} · fair ${pct('fair')} · rough ${pct('rough')} · very rough ${pct('very rough')} · not scored ${pct('none')}
- Area: bounding box south,west,north,east = ${bbox || 'none (no stretches were logged)'}
- Gyroscope: ${gyro ? 'yes' : 'no (turn-rate columns are empty)'} · GPS speed from phone: ${ride.device && ride.device.gps_speed ? 'yes' : 'no (speed from fixes)'}
- Logging pauses (screen off / app in background): ${(ride.pauses || []).length}${(ride.pauses || []).length ? ' (' + ride.pauses.map(p => p.seconds + ' s at ' + p.from).join('; ') + ')' : ''}
- Raw readings: ${extra.rawRows != null ? extra.rawRows + ' rows' : 'see raw file'}${o.raw_keep_min ? `; only the last ${o.raw_keep_min} min plus the readings around each bump were kept` : '; all kept except time standing still'}

Roughest stretches (full list is in the CSV):

| seg | class | index | km/h | bumps | lat, lon (middle) |
|---|---|---|---|---|---|
${worst || '| – | – | – | – | – | – |'}

## Files
- \`${f.segmentsCSV || 'data/*_segments.csv'}\` — the main table, one row per 20 m of travel. **Column meanings, units and what an empty cell means are in \`datapackage.json\`** (read it; do not guess).
- \`${f.segmentsGeo || 'data/*_segments.geojson'}\` — same stretches as lines. \`${f.bumpsGeo || 'data/*_bumps.geojson'}\` — one point per sharp hit.
- \`${f.raw || 'raw/*_raw.csv'}\` — every motion reading, for checking a stretch in detail.
- \`ride.json\` — settings, device facts, pauses, summary. \`README.txt\` — the same field notes in plain text.

## How to read the numbers (do not skip)
1. **An empty cell means "not measured", never zero.** An empty \`index\`/\`class\` means the stretch could not be scored (too slow, too few readings), not that the road is smooth. Do not fill or average over them as if they were 0.
2. **\`index\` is not calibrated.** It is \`rms_v × (${(o.refSpeed * 3.6).toFixed(0)} km/h ÷ speed)^${o.speedExp}\`, with class breaks at ${o.classBreaks.join(', ')}. These are starting guesses. Use it to rank stretches **within this ride** (or with rides on the same vehicle, tyres and mount), not as an absolute standard such as IRI. If you want an absolute scale, say what reference data you would need.
3. **Shake depends on speed.** The speed adjustment (exponent ${o.speedExp}) is a first guess. Check it (plan step 3d) before trusting comparisons between fast and slow stretches.
4. **Mount matters:** "${ride.mount}". A pocket or bag damps the shake and hides small defects; a handlebar mount sees what the frame sees.
5. **Positions:** stretches follow the GPS track (± \`gps_acc_max_m\`). A bump's position is good to about one second of travel (${ride.device && ride.device.gps_speed ? 'about 10 m at 36 km/h' : 'a few to 15 m'}). Do not claim a pothole is "at" a coordinate more precisely than that.
6. **Sharp bumps are not all defects.** Speed breakers, rumble strips, level crossings, expansion joints and manhole covers also produce them. Decide which with evidence (plan step 2), not by size alone.
7. Express uncertainty. With under about 5 stretches in a group, say the group is too small to compare.

## Plan
**1. Check the data first.** Confirm rate_hz is near 60 on scored stretches; list stretches with flags (slow, low_rate, gps_weak, gps_gap, partial) and the pauses; say how much of the ride is usable. Stop and report if less than half is scored.

**2. Enrich with outside information, if you have internet or API tools.** Do this agentically: fetch what you can, record each source and the query, and skip (and say you skipped) what you cannot reach. Do not invent values.
- *Road type and surface (OpenStreetMap, Overpass API).* Query the bounding box above, e.g.
  \`[out:json][timeout:60];way["highway"](${bbox || 'S,W,N,E'});out tags geom;\`
  Keep \`highway\`, \`surface\`, \`smoothness\`, \`maxspeed\`, \`lanes\`, \`bridge\`, \`tunnel\`, \`layer\`, \`name\`, \`ref\`.
  Match each stretch to a way: nearest way within 15 m of the stretch's middle whose direction is within 30° of \`heading_deg\` (either way along the road). If two ways qualify within 5 m of each other (parallel carriageways, a flyover over a road), mark the stretch **ambiguous** rather than guessing. Many roads have no \`surface\` tag: report "untagged", do not assume.
- *Features that explain bumps (same API).* \`node["traffic_calming"](bbox); node["railway"="level_crossing"](bbox); node["highway"~"traffic_signals|crossing"](bbox);\` and ways with \`bridge=yes\`. A sharp bump within 15 m of one of these is "probably designed or structural"; the rest are "unexplained", the candidates for defects.
- *Place names.* Reverse-geocode the start, end and the roughest stretches (OpenStreetMap Nominatim: one request per second, identify yourself in the User-Agent) so findings can be written as "on X Road near Y".
- *Weather.* Hourly rain for the ride day and the 24 h before (for example Open-Meteo archive: \`https://archive-api.open-meteo.com/v1/archive\` with latitude, longitude, the dates, \`hourly=precipitation\`, \`timezone=auto\`). Wet roads hide or exaggerate defects and monsoon damage is real; mention it if it rained.
- *Anything else you can find that is relevant* (a ward or municipal road register, recent resurfacing news, traffic volume). Cite it.
Write the enriched table as **new files** (for example \`segments_enriched.csv\` and \`.geojson\` with columns such as \`osm_highway\`, \`osm_surface\`, \`osm_smoothness\`, \`osm_name\`, \`match_quality\`, \`near_feature\`). Leave the original files unchanged.

**3. Analyse.**
 a. Roughness by road type and by surface: distance-weighted mean index, share per class, number of stretches. Mark groups with < 5 stretches as low confidence.
 b. Compare what you measured with the OSM \`surface\` / \`smoothness\` tags: list disagreements both ways (tagged "asphalt" but very rough; tagged "bad" but smooth). The map may be out of date; say so rather than declaring either wrong.
 c. Bumps: split into explained (near a speed breaker, crossing, joint) and unexplained; rank the unexplained by \`peak_v\` and check each in the raw file (a real pothole is a short sharp event followed by ringing; a long rough patch is texture).
 d. Check the speed adjustment: within one road type, regress log(rms_v) on log(speed_kmh) for scored and slow stretches alike. The slope is the speed exponent the data suggest (the app assumes ${o.speedExp}). If it is clearly different, recompute the index with it, report both, and do not overwrite the original.
 e. Curves: are rough stretches mostly on bends (high \`rms_lateral\`, small \`curve_radius_*\`)? If so, lean may be inflating the shake there.
 f. Anything surprising: a stretch that is very rough on an otherwise smooth road is the most useful finding.

**4. Deliver.**
 - A short written summary (under 300 words) for a non-expert: how good or bad was this route, where, and what to look at first.
 - A ranked list of the 10 stretches most worth inspecting: coordinates, road name and type, index, speed, bumps, your evidence, and a confidence (high / medium / low).
 - A table by road type and surface, and a map (or GeoJSON ready for QGIS) coloured by class.
 - "What I could not do and why", and "what extra data would make this stronger" (for example the same road ridden twice, a second vehicle, a few photographed defects to calibrate against).

## Rules
- Use only the data here and sources you actually fetched. Never fabricate a coordinate, a road name or a measurement.
- Keep units: m/s², km/h, m. Report numbers with sensible rounding.
- Quote the file and column behind every number you rely on.
- If the ride is simulated or the mount is a pocket, say how that limits the conclusions.

## My question (edit before sending)
Give me the full analysis above for this ride. Then tell me what I should do on my next ride to make the data better.
`;
  }
  const pad2 = v => String(v).padStart(2, '0');

  return { DEFAULTS, CLASSES, RAW_COLS, classOf, createVertical, yawRate, createSegmenter, summarise, prunable,
    segmentsGeoJSON, bumpsGeoJSON, segmentsCSV, rawCSVRows, rideMeta, FIELDS, RAW_FIELDS, dataPackage, llmPrompt };
});
