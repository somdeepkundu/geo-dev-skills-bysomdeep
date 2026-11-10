/* Road Check — logs road roughness while you ride, from the phone's accelerometer and GPS.
 * The maths is in road-core.js; storage in ride-store.js; geo helpers, the CSV guard, downloads and the
 * two-tap share come from the phone-field-sensors skill, loaded straight from the skill folder.
 * A web page cannot read sensors with the phone locked, so the screen is kept on and can be blacked out.
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License */
(function () {
  'use strict';
  const APP = { name: 'Road Check', version: '0.1.0' };
  const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const F = window.FieldSensors, FS = window.FieldStore, RC = window.RoadCore;
  const $ = id => document.getElementById(id);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const COLOR = { smooth: '#2b6cb0', fair: '#d9a400', rough: '#e2711d', 'very rough': '#8f1d4f', none: '#8a8f8a' };
  const WEIGHT = { smooth: 4, fair: 5, rough: 6, 'very rough': 7, none: 3 };   // rougher is also thicker, not only redder
  const LABEL = { smooth: 'Smooth', fair: 'Fair', rough: 'Rough', 'very rough': 'Very rough', none: 'No score' };
  const NCOL = RC.RAW_COLS.length, CHUNK_MS = 10000, CHUNK_ROWS = 1500, TRACE_MS = 10000, TRACE_MAX = 8;
  const MOUNT_NOTE = {
    'handlebar mount': 'Best. The phone feels what the frame feels.',
    'fixed to body or dashboard': 'Good, as long as it cannot rattle.',
    'pocket or bag': 'Your body soaks up most of the shake. Fine for finding big bumps, not for comparing roads.'
  };
  const store = window.RideStore.open();
  const demoParam = new URLSearchParams(location.search).get('demo');
  let R = null;                 // the ride being recorded
  let shown = null;             // the ride on the summary screen

  document.querySelectorAll('.ver').forEach(e => { e.textContent = APP.version; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* ── small helpers ── */
  let toastT = 0;
  function toast(msg, kind) { const t = $('toast'); t.textContent = msg; t.className = 'show ' + (kind || ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, kind === 'err' ? 6000 : 3200); }
  const pad = n => String(n).padStart(2, '0');
  const fmtDist = m => !isNum(m) ? '—' : m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
  const fmtDur = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
  const fmtWhen = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const slug = s => (String(s).normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'ride').slice(0, 40);
  const picked = name => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
  const view = id => { ['home', 'ride', 'done'].forEach(v => { $(v).hidden = v !== id; }); window.scrollTo(0, 0); };
  function defaultName() { const d = new Date(); return 'Ride ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function legend(el, extra) {
    el.innerHTML = ['smooth', 'fair', 'rough', 'very rough', 'none'].map(c =>
      `<li><i style="background:${COLOR[c]};height:${WEIGHT[c]}px"></i>${LABEL[c]}${extra ? ' <b>' + F.esc(extra(c)) + '</b>' : ''}</li>`).join('');
  }

  /* ── Home ── */
  $('rideName').value = defaultName();
  document.querySelectorAll('input[name="mount"]').forEach(i => i.addEventListener('change', () => { $('mountNote').textContent = MOUNT_NOTE[picked('mount')]; }));
  legend($('legend'));

  async function refreshRides() {
    await store.ready;
    const rides = await store.listRides();
    for (const r of rides) if (r.status === 'recording' && !(R && R.ride.id === r.id)) {      // the tab died mid-ride
      r.status = 'interrupted'; r.ended = r.updated || r.started;
      r.sum = RC.summarise(await store.segsFor(r.id)); delete r.sum.worst;
      await store.putRide(r);
    }
    $('ridesEmpty').hidden = rides.length > 0;
    $('rides').innerHTML = rides.map(r => {
      const by = (r.sum && r.sum.by_class_m) || {}, tot = (r.sum && r.sum.distance_m) || 0;
      const bar = tot ? Object.keys(COLOR).map(c => by[c] ? `<i style="flex:${by[c]};background:${COLOR[c]}"></i>` : '').join('') : '';
      const tag = r.status === 'interrupted' ? ' <em>interrupted</em>' : r.demo ? ' <em>demo</em>' : '';
      return `<li><button type="button" data-id="${F.esc(r.id)}"><span class="r-name">${F.esc(r.name)}${tag}</span>
        <span class="r-meta">${F.esc(fmtWhen(r.started))} · ${fmtDist(tot)}</span><span class="r-bar">${bar}</span></button></li>`;
    }).join('');
  }
  $('rides').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) showRide(b.dataset.id); });
  $('backBtn').addEventListener('click', () => { view('home'); refreshRides(); });

  /* ── Start. Permission first, synchronously inside the tap (phone-field-sensors rule 4). ── */
  $('startBtn').addEventListener('click', () => begin(false));
  $('demoBtn').addEventListener('click', () => begin(true, 1));

  function begin(demo, speedup) {
    let perm = 'not needed';
    if (!demo) {
      try {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
          perm = 'asked';
          DeviceMotionEvent.requestPermission().then(r => { perm = r; if (R) R.ride.device.motion_permission = r; if (r !== 'granted') toast('Motion sensors are blocked. Allow them in the site settings, then start again.', 'err'); })
            .catch(() => { if (R) R.ride.device.motion_permission = 'error'; });
        }
      } catch (e) { perm = 'error'; }
    }
    const now = Date.now(), keep = $('rawKeep').value;
    const ride = {
      id: 'r' + now, name: demo ? 'Demo ride' : ($('rideName').value.trim() || defaultName()),
      vehicle: demo ? 'motorbike' : picked('vehicle'), mount: demo ? 'handlebar mount' : picked('mount'),
      started: now, ended: null, updated: now, status: 'recording', demo: !!demo, app: APP.name + ' ' + APP.version,
      settings: Object.assign({}, RC.DEFAULTS, { raw_keep_min: keep === 'all' ? null : +keep }),
      device: { user_agent: navigator.userAgent, motion_permission: perm, gyroscope: false, gps_speed: false, wake_lock: null, simulated: !!demo },
      bumps: [], pauses: [], sum: null
    };
    R = { ride, vert: RC.createVertical(), seg: RC.createSegmenter(), live: [], rate: [], lastMotion: 0, lastFix: 0, fix: null, speed: null,
      chunk: null, metas: [], layers: null, map: null, watchId: null, hiddenAt: null, lastSave: now, demoStop: null, warned: {} };
    store.ready.then(() => { store.putRide(ride); if (store.mem) toast('This browser is not saving to disk. Export the ride before closing.', 'err'); });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    view('ride'); initRideMap(); sizeTrace(); holdWake();
    if (demo) R.demoStop = startDemo(speedup || 1);
    else {
      window.addEventListener('devicemotion', onMotion, true);
      if (navigator.geolocation) R.watchId = navigator.geolocation.watchPosition(onPos, e => { warnOnce('gps', 'GPS: ' + e.message); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      else toast('No location access in this browser', 'err');
    }
    requestAnimationFrame(loop);
  }
  function warnOnce(key, msg) { if (R && !R.warned[key]) { R.warned[key] = 1; toast(msg, 'err'); } }

  /* ── Screen: keep it on. A page cannot run sensors behind a locked screen. ── */
  let wakeLock = null;
  async function holdWake() {
    if (!R) return;
    if (!('wakeLock' in navigator)) { R.ride.device.wake_lock = false; warnOnce('wake', "This browser can't keep the screen on. Set the phone's screen timeout to the longest setting."); return; }
    try { if (document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); if (R) R.ride.device.wake_lock = true; } }
    catch (e) { if (R) R.ride.device.wake_lock = false; }
  }
  document.addEventListener('visibilitychange', () => {
    if (!R) return;
    if (document.visibilityState === 'hidden') { R.hiddenAt = Date.now(); flushChunk(); saveRide(); }
    else {
      holdWake();
      if (R.hiddenAt) {
        const gap = Date.now() - R.hiddenAt; R.ride.pauses.push({ from: new Date(R.hiddenAt).toISOString(), seconds: Math.round(gap / 1000) }); R.hiddenAt = null;
        if (gap > 3000) toast('Nothing was logged for ' + fmtDur(gap / 1000) + ' while the screen was off.', 'err');
      }
    }
  });
  window.addEventListener('pagehide', () => { if (R) { flushChunk(); saveRide(); } });
  window.addEventListener('beforeunload', e => { if (R) { e.preventDefault(); e.returnValue = ''; } });

  /* ── Sensors in ── */
  function evTime(e) {                       // event time on the wall clock; fall back if the browser's is off
    const now = Date.now(), t = performance.timeOrigin + e.timeStamp;
    return isNum(t) && Math.abs(t - now) < 1500 ? t : now;
  }
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    feedMotion(evTime(e), a ? a.x : null, a ? a.y : null, a ? a.z : null, e.rotationRate);
  }
  function onPos(p) {
    const c = p.coords, now = Date.now();
    feedFix({ t: isNum(p.timestamp) && Math.abs(p.timestamp - now) < 3000 ? p.timestamp : now, lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: c.speed });
  }

  function feedMotion(t, ax, ay, az, rr) {
    if (!R) return;
    const v = R.vert.push(t, ax, ay, az);
    if (!v) return;                                                    // no reading: nothing is invented
    R.lastMotion = t; R.rate.push(t);
    const gyro = rr && isNum(rr.alpha) && isNum(rr.beta) && isNum(rr.gamma);
    if (gyro) R.ride.device.gyroscope = true;
    if (v.ready) { R.seg.pushMotion(t, v.av, v.al, gyro ? RC.yawRate(rr, v.up) : null); R.live.push({ t, av: v.av }); }
    let c = R.chunk;
    if (!c) c = R.chunk = { buf: new Float32Array(CHUNK_ROWS * NCOL), n: 0, t0: t, t1: t, idle: 0, other: 0 };
    const o = c.n * NCOL, b = c.buf;
    b[o] = t - c.t0; b[o + 1] = ax; b[o + 2] = ay; b[o + 3] = az;
    b[o + 4] = gyro ? rr.alpha : NaN; b[o + 5] = gyro ? rr.beta : NaN; b[o + 6] = gyro ? rr.gamma : NaN; b[o + 7] = v.ready ? v.av : NaN;
    c.n++; c.t1 = t;
    if (t - c.t0 >= CHUNK_MS || c.n >= CHUNK_ROWS) { flushChunk(); saveRide(); }
  }

  function feedFix(fix) {
    if (!R) return;
    R.fix = fix; R.lastFix = fix.t;
    if (isNum(fix.speed)) R.ride.device.gps_speed = true;
    const res = R.seg.pushFix(fix);
    R.speed = res.state === 'idle' ? 0 : isNum(res.speed) ? res.speed : null;
    if (R.chunk) { if (res.state === 'idle') R.chunk.idle++; else R.chunk.other++; }
    for (const s of res.closed) { store.putSeg(R.ride.id, s).catch(storeFail); drawSeg(R.layers, s); }
    for (const b of res.bumps) drawBump(R.layers, b);
    if (R.map && isNum(fix.lat) && (!isNum(fix.acc) || fix.acc <= RC.DEFAULTS.maxAcc)) {
      R.layers.me.setLatLng([fix.lat, fix.lon]);
      if (!$('dim').hidden) return;
      R.map.setView([fix.lat, fix.lon], R.map.getZoom(), { animate: false });
    }
  }
  function storeFail() { warnOnce('store', 'Could not save to the phone. Free some space, and export this ride when you stop.'); }

  /* ── Raw readings: 10 s chunks straight to storage. Chunks recorded entirely at a standstill are dropped,
        and with a keep-window set, old chunks go too unless a sharp bump is in or beside them. ── */
  function flushChunk() {
    const c = R && R.chunk; if (!c || !c.n) return;
    R.chunk = null;
    if (c.idle > 0 && c.other === 0) return;
    const rec = { ride: R.ride.id, t0: c.t0, t1: c.t1, n: c.n, data: c.buf.slice(0, c.n * NCOL).buffer };
    const ride = R;
    store.putChunk(rec).then(id => {
      ride.metas.push({ id, t0: rec.t0, t1: rec.t1 });
      const keep = ride.ride.settings.raw_keep_min;
      if (!keep) return;
      const drop = RC.prunable(ride.metas, ride.seg.bumps.map(b => b.t_first), rec.t1, keep * 60000);
      if (drop.length) { ride.metas = ride.metas.filter(m => !drop.includes(m.id)); return store.dropChunks(drop); }
    }).catch(storeFail);
  }
  function saveRide() {
    if (!R) return;
    const r = R.ride; r.updated = Date.now();
    r.bumps = R.seg.bumps.map(b => Object.assign({}, b));
    r.sum = RC.summarise(R.seg.segments); delete r.sum.worst;
    store.putRide(r).catch(storeFail);
  }

  /* ── Maps ── */
  function makeMap(el) {
    const map = L.map(el, { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([19.1334, 72.9133], 17);
    L.tileLayer(OSM, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const layers = { segs: L.layerGroup().addTo(map), bumps: L.layerGroup().addTo(map) };
    return { map, layers };
  }
  function drawSeg(layers, s) {
    const c = s.class || 'none';
    return L.polyline(s.coords.map(p => [p[1], p[0]]), { color: COLOR[c], weight: WEIGHT[c], opacity: 0.92, lineCap: 'butt', dashArray: s.class ? null : '5 5' }).addTo(layers.segs);
  }
  function drawBump(layers, b) {
    L.circleMarker([b.lat, b.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#1b1f1c', fillOpacity: 1 }).addTo(layers.bumps);
  }
  let rideMap = null, doneMap = null;
  function initRideMap() {
    if (!rideMap) rideMap = makeMap('map');
    rideMap.layers.segs.clearLayers(); rideMap.layers.bumps.clearLayers();
    if (!rideMap.layers.me) rideMap.layers.me = L.circleMarker([19.1334, 72.9133], { radius: 7, color: '#fff', weight: 2, fillColor: '#1f4d3a', fillOpacity: 1 }).addTo(rideMap.map);
    R.map = rideMap.map; R.layers = rideMap.layers;
    setTimeout(() => rideMap.map.invalidateSize(), 60);
  }

  /* ── Live screen ── */
  const trace = $('trace'), tctx = trace.getContext('2d');
  let css = null;
  function sizeTrace() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3), w = trace.clientWidth, h = trace.clientHeight;
    if (w && h) { trace.width = Math.round(w * dpr); trace.height = Math.round(h * dpr); }
    const s = getComputedStyle(document.documentElement);
    css = { ink: s.getPropertyValue('--ink').trim(), line: s.getPropertyValue('--line').trim(), bad: COLOR['very rough'] };
  }
  window.addEventListener('resize', () => { if (R) sizeTrace(); });
  function drawTrace(now) {
    const W = trace.width, H = trace.height, mid = H / 2, sy = (H / 2 - 4) / TRACE_MAX, dpr = W / (trace.clientWidth || W);
    tctx.clearRect(0, 0, W, H);
    tctx.lineWidth = dpr; tctx.strokeStyle = css.line; tctx.setLineDash([]);
    tctx.beginPath(); tctx.moveTo(0, mid); tctx.lineTo(W, mid); tctx.stroke();
    tctx.strokeStyle = css.bad; tctx.globalAlpha = 0.55; tctx.setLineDash([6 * dpr, 6 * dpr]);
    for (const k of [-1, 1]) { const y = mid - k * RC.DEFAULTS.bumpThr * sy; tctx.beginPath(); tctx.moveTo(0, y); tctx.lineTo(W, y); tctx.stroke(); }
    tctx.globalAlpha = 1; tctx.setLineDash([]);
    if (!R.live.length) return;
    tctx.strokeStyle = css.ink; tctx.lineWidth = 1.6 * dpr; tctx.lineJoin = 'round';
    tctx.beginPath();
    let first = true;
    for (const p of R.live) {
      const x = W - (now - p.t) / TRACE_MS * W, y = mid - Math.max(-TRACE_MAX, Math.min(TRACE_MAX, p.av)) * sy;
      if (first) { tctx.moveTo(x, y); first = false; } else tctx.lineTo(x, y);
    }
    tctx.stroke();
  }
  /* "now" on the clock the readings carry (the demo can run faster than the wall clock) */
  const dataNow = () => R.demoStop ? R.demoNow() : Date.now();

  let lastText = 0, lastTrace = 0, lastDimMove = 0;
  function loop(ts) {
    if (!R) return;
    requestAnimationFrame(loop);
    const now = dataNow(), dim = !$('dim').hidden;
    while (R.live.length && now - R.live[0].t > TRACE_MS) R.live.shift();
    while (R.rate.length && now - R.rate[0] > 1000) R.rate.shift();
    if (!dim && ts - lastTrace > 45) { lastTrace = ts; drawTrace(now); }
    if (ts - lastText < (dim ? 1000 : 250)) return;
    lastText = ts;

    const el = fmtDur((Date.now() - R.ride.started) / 1000), sp = isNum(R.speed) ? Math.round(R.speed * 3.6) : null;
    let s2 = 0, n = 0;
    for (let i = R.live.length - 1; i >= 0 && now - R.live[i].t <= 1000; i--) { s2 += R.live[i].av * R.live[i].av; n++; }
    const rms = n >= 10 ? Math.sqrt(s2 / n) : null;
    const scoring = rms !== null && isNum(R.speed) && R.speed >= RC.DEFAULTS.slowSpeed;
    const cls = scoring ? RC.classOf(rms * Math.pow(RC.DEFAULTS.refSpeed / R.speed, RC.DEFAULTS.speedExp)) : null;

    // state, most serious first
    const st = R.seg.state, started = Date.now() - R.ride.started;
    let label, kind;
    if (now - R.lastMotion > 3000 && started > 3000) { label = 'NO MOTION DATA'; kind = 'bad'; if (started > 5000) warnOnce('motion', 'No accelerometer readings. Check that motion sensors are allowed for this site in the browser settings.'); }
    else if (!R.lastFix) { label = 'WAITING FOR GPS'; kind = 'warn'; }
    else if (now - R.lastFix > 6000) { label = 'GPS LOST'; kind = 'warn'; }
    else if (st === 'gps_weak') { label = 'GPS WEAK'; kind = 'warn'; }
    else if (st === 'moving') { label = 'LOGGING'; kind = 'ok'; }
    else { label = 'STANDING'; kind = ''; }

    if (dim) {
      $('dimElapsed').textContent = el; $('dimSpeed').textContent = sp === null ? '—' : sp;
      $('dimWord').textContent = kind === 'ok' ? (cls ? LABEL[cls].toLowerCase() : 'logging') : label.toLowerCase();
      if (ts - lastDimMove > 45000) { lastDimMove = ts; $('dimBox').style.transform = `translate(${Math.round((Math.random() - .5) * 60)}px, ${Math.round((Math.random() - .5) * 120)}px)`; }
      return;
    }
    $('elapsed').textContent = el;
    $('state').textContent = label; $('state').className = 'badge ' + kind;
    $('speed').textContent = sp === null ? '—' : sp;
    $('shake').textContent = rms === null ? '—' : rms.toFixed(1);
    const w = $('shakeWord');
    w.textContent = cls ? 'm/s² · ' + LABEL[cls].toLowerCase() : rms !== null && st !== 'moving' ? 'm/s² · not scored while standing' : rms !== null && !scoring ? 'm/s² · too slow to score' : 'm/s²';
    w.style.color = cls ? COLOR[cls] : '';
    $('dist').textContent = fmtDist(R.seg.distance);
    $('bumps').textContent = R.seg.bumps.length;
    $('hz').textContent = R.rate.length ? R.rate.length + '/s' : '—';
    $('gps').textContent = R.fix && isNum(R.fix.acc) ? '± ' + Math.round(R.fix.acc) + ' m' : '—';
    $('gps').className = R.fix && R.fix.acc > 15 ? 'warn' : '';
  }

  /* ── Dim: a black screen that ignores touches. Hold the ring for 2 s to come back. ── */
  let holdT = 0;
  $('dimBtn').addEventListener('click', () => {
    $('dim').hidden = false; lastText = 0;
    try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    if (!R.warned.dimTip) { R.warned.dimTip = 1; toast('Turn the brightness down too. Hold the ring 2 s to wake.'); }
  });
  function wake() {
    $('dim').hidden = true; $('holdBtn').classList.remove('holding'); lastText = 0;
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
    if (R && R.map) { R.map.invalidateSize(); if (R.fix) R.map.setView([R.fix.lat, R.fix.lon], R.map.getZoom(), { animate: false }); }
  }
  const hold = $('holdBtn');
  const holdStart = e => { e.preventDefault(); clearTimeout(holdT); hold.classList.add('holding'); holdT = setTimeout(wake, 2000); };
  const holdEnd = () => { clearTimeout(holdT); hold.classList.remove('holding'); };
  hold.addEventListener('pointerdown', holdStart);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => hold.addEventListener(n, holdEnd));
  hold.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) holdStart(e); });
  hold.addEventListener('keyup', holdEnd);
  ['touchstart', 'touchmove', 'contextmenu'].forEach(n => $('dim').addEventListener(n, e => e.preventDefault(), { passive: false }));

  /* ── End ── */
  let endArm = 0;
  $('endBtn').addEventListener('click', () => {
    const b = $('endBtn');
    if (Date.now() - endArm > 3500) { endArm = Date.now(); b.textContent = 'Tap again to end'; b.classList.add('armed'); setTimeout(() => { if (b.classList.contains('armed')) { b.textContent = 'End ride'; b.classList.remove('armed'); endArm = 0; } }, 3500); return; }
    endRide();
  });
  async function endRide() {
    const ride = R; if (!ride) return;
    const b = $('endBtn'); b.textContent = 'End ride'; b.classList.remove('armed'); endArm = 0;
    if (ride.demoStop) ride.demoStop();
    window.removeEventListener('devicemotion', onMotion, true);
    if (ride.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(ride.watchId);
    const fin = ride.seg.finish();
    try { for (const s of fin.closed) await store.putSeg(ride.ride.id, s); } catch (e) { storeFail(); }
    flushChunk(); saveRide();
    ride.ride.status = 'done'; ride.ride.ended = Date.now();
    try { await store.putRide(ride.ride); } catch (e) { storeFail(); }
    R = null;
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
    $('rideName').value = defaultName();
    showRide(ride.ride.id);
  }

  /* ── Summary ── */
  async function showRide(id) {
    await store.ready;
    const ride = await store.getRide(id); if (!ride) { toast('That ride is no longer stored.', 'err'); return; }
    const segs = await store.segsFor(id), sum = RC.summarise(segs);
    shown = { ride, segs };
    view('done');
    $('doneName').textContent = ride.name;
    $('doneWhen').textContent = fmtWhen(ride.started) + ' · ' + ride.vehicle + ', ' + ride.mount + (ride.demo ? ' · simulated' : '') + (ride.status === 'interrupted' ? ' · interrupted' : '');
    const moving = segs.reduce((s, x) => s + x.moving_s, 0);
    $('dDist').textContent = fmtDist(sum.distance_m); $('dTime').textContent = fmtDur(moving); $('dBumps').textContent = (ride.bumps || []).length;
    const by = sum.by_class_m, tot = sum.distance_m;
    $('shareBar').innerHTML = tot ? Object.keys(COLOR).map(c => by[c] ? `<i style="flex:${by[c]};background:${COLOR[c]}"></i>` : '').join('') : '';
    legend($('doneLegend'), c => tot ? Math.round(by[c] / tot * 100) + '%' : '—');
    const notes = [];
    if (!segs.length) notes.push('No stretches were logged. The ride needs GPS and at least 20 m of movement.');
    notes.push('The classes use starting thresholds (index 1.0, 2.0 and 3.5) that are not calibrated yet. Compare rides made on the same vehicle with the same mount.');
    if (ride.mount === 'pocket or bag') notes.push('The phone was in a pocket or bag, so the shake is damped.');
    const lost = (ride.pauses || []).reduce((s, p) => s + p.seconds, 0);
    if (lost > 3) notes.push('Logging stopped ' + ride.pauses.length + ' time' + (ride.pauses.length > 1 ? 's' : '') + ' (' + fmtDur(lost) + ' in all) while the screen was off or the app was in the background.');
    if (store.mem) notes.push('This browser is not saving to disk: export now, before closing the page.');
    $('doneNote').textContent = notes.join(' ');

    if (!doneMap) doneMap = makeMap('doneMap');
    doneMap.layers.segs.clearLayers(); doneMap.layers.bumps.clearLayers();
    const lines = segs.map(s => drawSeg(doneMap.layers, s));
    (ride.bumps || []).forEach(b => drawBump(doneMap.layers, b));
    setTimeout(() => { doneMap.map.invalidateSize(); if (lines.length) doneMap.map.fitBounds(L.featureGroup(lines).getBounds().pad(0.12), { animate: false }); }, 60);

    $('worstEmpty').hidden = sum.worst.length > 0;
    $('worst').innerHTML = sum.worst.map(s => `<li><button type="button" data-seg="${s.seg}"><i style="background:${COLOR[s.class]}"></i>
      <span><b>${s.index.toFixed(1)}</b> ${LABEL[s.class].toLowerCase()}</span>
      <small>${Math.round(s.speed_kmh)} km/h · ${s.bumps} bump${s.bumps === 1 ? '' : 's'} · ${new Date(s.t_start).toLocaleTimeString()}</small></button></li>`).join('');
    $('shareBtn').textContent = 'Share';
  }
  $('worst').addEventListener('click', e => {
    const b = e.target.closest('button[data-seg]'); if (!b || !shown) return;
    const s = shown.segs.find(x => x.seg === +b.dataset.seg); if (!s) return;
    const mid = s.coords[Math.floor(s.coords.length / 2)];
    doneMap.map.setView([mid[1], mid[0]], 18, { animate: false });
    $('doneMap').scrollIntoView({ block: 'center' });
  });
  let delArm = 0;
  $('delBtn').addEventListener('click', async () => {
    const b = $('delBtn');
    if (Date.now() - delArm > 3500) { delArm = Date.now(); b.textContent = 'Tap again to delete for good'; setTimeout(() => { b.textContent = 'Delete this ride'; }, 3500); return; }
    delArm = 0; b.textContent = 'Delete this ride';
    await store.deleteRide(shown.ride.id); shown = null; view('home'); refreshRides(); toast('Ride deleted');
  });

  /* ── Export ── */
  async function buildZip() {
    const { ride, segs } = shown, chunks = await store.chunksFor(ride.id), base = slug(ride.name);
    const zip = new JSZip(), sum = RC.summarise(segs);
    zip.file(`data/${base}_segments.geojson`, JSON.stringify(RC.segmentsGeoJSON(ride, segs)));
    zip.file(`data/${base}_bumps.geojson`, JSON.stringify(RC.bumpsGeoJSON(ride, ride.bumps || [])));
    zip.file(`data/${base}_segments.csv`, RC.segmentsCSV(ride, segs));
    const raw = ['time_unix_ms,' + RC.RAW_COLS.slice(1).join(',') + '\n'];
    let rows = 0; for (const c of chunks) { raw.push(RC.rawCSVRows(c)); rows += c.n; }
    zip.file(`raw/${base}_raw.csv`, raw.join(''));
    delete sum.worst;
    zip.file('ride.json', JSON.stringify(Object.assign(RC.rideMeta(ride), { summary: sum, raw_rows: rows }), null, 2));
    zip.file('README.txt', readme(ride, segs.length, rows));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const d = new Date(ride.started), stamp = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z';
    return { blob, name: `RoadCheck_${base}_${stamp}.zip` };
  }
  function readme(ride, nSeg, rows) {
    const o = ride.settings;
    return [
      `${ride.app} — ${ride.name}`,
      `Vehicle: ${ride.vehicle}. Phone: ${ride.mount}.${ride.demo ? ' SIMULATED RIDE, not a measurement.' : ''}`,
      `${nSeg} stretches, ${rows} raw readings.`,
      '',
      'data/*_segments.geojson, *_segments.csv — one row per stretch of road (20 m of travel).',
      '  class               smooth | fair | rough | very rough; empty when the stretch could not be scored',
      `  index               rms_v x (${(o.refSpeed * 3.6).toFixed(0)} km/h / speed)^${o.speedExp}. Breaks at ${o.classBreaks.join(', ')}. NOT CALIBRATED: starting values.`,
      '  rms_v, peak_v       up-down shake in m/s2 (gravity removed, any phone pose): root-mean-square and largest',
      `  bumps               sharp hits above ${o.bumpThr} m/s2 in the stretch`,
      '  speed_kmh           length / moving time; speed_source says whether the phone gave GPS speed or it came from fixes',
      '  rms_lateral         shake across the vertical, m/s2',
      '  heading_deg         direction of travel; turn_deg is the change from the previous stretch (+ = right)',
      '  curve_radius_gps_m  from that change; noisy at 20 m. curve_radius_gyro_m = speed / turn rate, better when there is a gyroscope',
      '  turn_rate_dps       mean gyroscope turn about the vertical, deg/s (reads about cos(lean) low on a leaning bike)',
      '  rate_hz, max_gap_ms how many readings per second, and the longest silence between two readings',
      `  flags               slow (< ${(o.slowSpeed * 3.6).toFixed(0)} km/h, not scored), low_rate, gps_weak (worse than 15 m), gps_gap, partial`,
      '',
      'data/*_bumps.geojson — one point per sharp hit, placed along the line between two GPS fixes (good to about one second of travel).',
      '',
      'raw/*_raw.csv — every reading. time_unix_ms; ax, ay, az = acceleration including gravity in the phone\'s axes, m/s2;',
      '  rot_* = gyroscope deg/s (blank without one); vertical = up-down shake used for the scores (blank while the gravity average settles).',
      o.raw_keep_min ? `  Only the last ${o.raw_keep_min} minutes were kept, plus the readings around each bump.` : '  All of the ride was kept, except time spent standing.',
      '',
      'ride.json — settings, device and the pauses when the screen was off (nothing is logged then).',
      'Compare roads only between rides on the same vehicle, tyre pressure and mount.',
      'Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay'
    ].join('\n') + '\n';
  }
  $('zipBtn').addEventListener('click', async () => {
    const b = $('zipBtn'); b.disabled = true; b.textContent = 'Packing…';
    try { const z = await buildZip(); FS.download(z.blob, z.name); toast('Saved ' + z.name, 'ok'); }
    catch (e) { toast('Export failed: ' + e.message, 'err'); }
    b.disabled = false; b.textContent = 'Export ZIP';
  });
  const sharer = FS.createSharer({ build: buildZip, keyOf: () => shown ? shown.ride.id + ':' + shown.ride.ended : '',
    onLabel: again => { $('shareBtn').textContent = again ? 'Tap to share' : 'Share'; }, onToast: toast });
  $('shareBtn').addEventListener('click', () => { sharer.share().catch(e => toast('Share failed: ' + e.message, 'err')); });

  /* ── Demo ride: a made-up road fed through the same code path as real sensors. ── */
  function startDemo(speedup) {
    const G = 9.81, T0 = Date.now(), w0 = performance.now(), PITCH = 55 * Math.PI / 180, ride = R;
    let simT = 0, s = 0, lat = 19.1334, lon = 72.9133, hdg = 78, nextFix = 0, stopLeft = 6, v = 0, seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    const patches = [[120, 240, 2.6], [400, 450, 5.2], [620, 760, 1.6], [900, 1010, 3.6]];
    const holes = [185, 428, 436, 700, 955, 1180]; let hi = 0, ring = 0;
    ride.demoNow = () => T0 + simT * 1000;
    const timer = setInterval(() => {
      const target = (performance.now() - w0) / 1000 * speedup; let guard = 0;
      while (simT < target && guard++ < 4000 && R === ride) {
        const dt = 1 / 60;
        const p = patches.find(q => s >= q[0] && s < q[1]), amp = p ? p[2] : 0.45;
        let want = p && p[2] > 4 ? 5 : p ? 7.5 : 9.5;                      // ride slower on bad road
        if (s > 320 && stopLeft > 0) { want = 0; if (v < 0.3) stopLeft -= dt; }   // a signal
        v += Math.max(-3.5 * dt, Math.min(2.2 * dt, want - v)); if (v < 0) v = 0;
        const turn = s > 520 && s < 600 ? 14 * (v / 9) : s > 820 && s < 880 ? -18 * (v / 9) : 0;
        let a = v > 0.5 ? amp * (v / 9) * (1.4 * rnd() + 0.9 * Math.sin(simT * 71) + 0.5 * Math.sin(simT * 163)) : 0.08 * rnd();
        if (hi < holes.length && s >= holes[hi]) { hi++; ring = 0.09; a += 11; }
        if (ring > 0) { a += 5 * Math.sin(ring * 220) * (ring / 0.09); ring -= dt; }
        const g = G + a, yaw = -turn;
        feedMotion(T0 + simT * 1000, 0.25, g * Math.sin(PITCH), g * Math.cos(PITCH), { alpha: yaw * Math.cos(PITCH), beta: 0, gamma: yaw * Math.sin(PITCH) });
        if (simT >= nextFix) { nextFix += 1; feedFix({ t: T0 + simT * 1000, lat: lat + rnd() * 2e-6, lon: lon + rnd() * 2e-6, acc: 4 + Math.abs(rnd()) * 3, speed: v }); }
        [lat, lon] = F.geoDest(lat, lon, v * dt, hdg); hdg += turn * dt; s += v * dt; simT += dt;
      }
    }, 16);
    return () => clearInterval(timer);
  }

  refreshRides();
  if (demoParam) begin(true, Math.max(1, Math.min(30, +demoParam || 1)));
  window.__roadCheck = { APP, feedMotion, feedFix, state: () => R, store };     // for the headless test
})();
