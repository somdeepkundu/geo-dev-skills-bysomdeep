/* Sensor Lab — starter app for the phone-sensor-lab skill (experimental).
 * Uses sensor-core.js + field-store.js from phone-field-sensors and sensor-lab.js from this skill.
 * Every module starts from its own button, because each permission (motion, camera, microphone,
 * Bluetooth, serial, NFC, AR) must be asked inside a tap.
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License */
(function () {
  'use strict';
  const APP = { name: 'Sensor Lab', version: '0.1.0' };
  const F = window.FieldSensors, FS = window.FieldStore, L = window.SensorLab;
  const $ = id => document.getElementById(id);
  const fmt = (v, d = 0) => v === null || v === undefined || !isFinite(v) ? '—' : (+v).toFixed(d);
  const S = { fix: null, log: [], gravSign: 1, pairs: [] };
  const badge = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = 'badge' + (cls ? ' ' + cls : ''); };
  function record(module, fields) {
    const g = S.fix;
    S.log.unshift(Object.assign({ time: new Date().toISOString(), module, lat: g ? g.lat : null, lon: g ? g.lon : null, gps_acc_m: g ? g.acc : null }, fields));
    renderLog();
  }

  /* ── Capabilities ── */
  const caps = L.capabilities(window);
  $('caps').innerHTML = caps.map(c => `<li class="${c.ok ? 'ok' : 'no'}"><span aria-hidden="true">${c.ok ? '●' : '○'}</span>${F.esc(c.label)}${c.note ? `<small>${F.esc(c.note)}</small>` : ''}<em>${c.ok ? 'yes' : 'no'}</em></li>`).join('');
  const can = k => caps.find(c => c.key === k).ok;
  $('labVer').textContent = 'v' + APP.version + ' · experimental';

  /* ── GPS (shared) ── */
  const gps = F.createGpsSmoother(6), gpsTrack = [];
  function startGPS() {
    if (!navigator.geolocation || S.gpsOn) return; S.gpsOn = true;
    navigator.geolocation.watchPosition(p => {
      const g = gps.push(p.coords); if (!g) return; S.fix = g;
      if (walk.on) { walk.pdr.gps(g); gpsTrack.push([g.lat, g.lon]); drawTrack(); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }

  /* ── 1. Compass trust: magnetic watch, gravity cross-check, stillness, field strength ── */
  const watch = L.createMagWatch(), still = L.createStillness();
  const compass = F.createCompass({ onChange: st => { if (st.heading !== null) watch.feedHeading(performance.now(), st.heading); } });
  const C = compass.state;
  const steps = L.createStepDetector();
  let lastStatus = 'UNKNOWN';
  $('motionBtn').addEventListener('click', () => {
    compass.start();                                     // permission inside the tap, before anything else
    startGPS();
    addEventListener('devicemotion', onMotion, true);
    if (can('magnetometer')) startMagnetometer();
    $('motionBtn').hidden = true; $('trustKv').hidden = false; $('trustHint').hidden = false;
    $('walkBtn').disabled = false;
    setInterval(updTrust, 250);
  });
  function onMotion(e) {
    const t = performance.now(), a = e.accelerationIncludingGravity, rr = e.rotationRate;
    if (!a || a.x === null) return;
    // timestamps, not e.interval: don't depend on the unit a browser reports it in
    watch.feedMotion(t, rr, a);
    const aMag = Math.hypot(a.x, a.y, a.z);
    still.push(t, aMag, L.gyroMagnitude(rr));
    S.gravTilt = L.gravityTilt(a.x, a.y, a.z, { sign: S.gravSign });
    if (walk.on) { const s = steps.feed(t, aMag); if (s) onStep(s); }
    // learn the gravity sign from still moments (some browsers report the vector inverted)
    if (S.signKnown !== true && C.tilt !== null && still.state().still) {
      S.pairs.push({ grav: L.gravityTilt(a.x, a.y, a.z), ori: C.tilt }); if (S.pairs.length > 60) S.pairs.shift();
      const sg = L.gravitySign(S.pairs);
      if (sg) { S.gravSign = sg; watch.setSign(sg); S.signKnown = true; }
    }
  }
  function startMagnetometer() {
    try {
      const m = new Magnetometer({ frequency: 10 });
      m.addEventListener('reading', () => { S.field = L.fieldCheck(m.x, m.y, m.z); });
      m.addEventListener('error', () => { S.field = null; });
      m.start();
    } catch (e) { S.field = null; }
  }
  function updTrust() {
    const r = watch.evaluate(performance.now()), st = still.state(), h = C.heading;
    $('kHdg').textContent = h === null ? '— (no compass yet)' : `${Math.round(h)}° · ${C.src}`;
    $('kMis').textContent = r.mismatch === null ? 'turn or hold the phone for 2 s…' : `compass ${fmt(r.compassDelta, 1)}°, gyroscope ${fmt(r.gyroDelta, 1)}° in 2 s (off by ${fmt(r.mismatch, 1)}°)`;
    $('kTiltO').textContent = C.tilt === null ? '—' : C.tilt + '°';
    const dTilt = S.gravTilt !== null && S.gravTilt !== undefined && C.tilt !== null ? Math.abs(S.gravTilt - C.tilt) : null;
    $('kTiltG').textContent = S.gravTilt === null || S.gravTilt === undefined ? '— (phone moving)' : `${fmt(S.gravTilt)}°` + (dTilt !== null ? (dTilt > 5 && st.still ? ` · differs by ${fmt(dTilt)}°, check the sensors` : ' · agrees') : '') + (S.signKnown ? '' : ' · learning sign');
    $('kStill').textContent = st.still === null ? '…' : st.still ? 'yes · good moment to capture' : `no · moving (${fmt(st.gyroMax)}°/s)`;
    $('kStill').className = st.still ? 'ok' : '';
    $('kField').textContent = S.field ? `${fmt(S.field.magnitude)} µT · ${S.field.ok ? 'normal for Earth' : 'abnormal: metal or a magnet nearby'}` : can('magnetometer') ? 'waiting' : 'not exposed by this browser (the gyroscope check above still works)';
    const status = C.heading === null ? 'NO COMPASS' : r.status;
    badge('magBadge', status === 'CLEAN' ? 'compass clean' : status === 'DISTURBED' ? 'compass disturbed' : status === 'UNKNOWN' ? 'checking' : 'no compass',
      status === 'CLEAN' ? 'ok' : status === 'DISTURBED' ? 'bad' : 'warn');
    if (status === 'DISTURBED' && lastStatus !== 'DISTURBED' && navigator.vibrate) navigator.vibrate(80);   // a nudge, Android only
    lastStatus = status;
  }

  /* ── 2. Steps and dead reckoning ── */
  const walk = { on: false, pdr: L.createPDR(), dist: 0, map: null };
  $('walkBtn').addEventListener('click', () => {
    if (walk.on) { walk.on = false; $('walkBtn').textContent = 'Start walk'; badge('walkBadge', 'stopped');
      record('walk', { steps: steps.count, distance_m: +walk.dist.toFixed(1), k: +$('kInput').value }); return; }
    if (!S.fix) { toast('Waiting for a GPS fix to start from', 'err'); return; }
    walk.on = true; walk.dist = 0; gpsTrack.length = 0;
    walk.pdr = L.createPDR(); walk.pdr.start(S.fix.lat, S.fix.lon); gpsTrack.push([S.fix.lat, S.fix.lon]);
    walk.startSteps = steps.count;
    $('walkBtn').textContent = 'Stop walk'; badge('walkBadge', 'walking', 'ok');
    initMap(); drawTrack();
  });
  function onStep(s) {
    const K = parseFloat($('kInput').value) || 0.48, len = s.len * K / 0.48;
    const h = C.heading; if (h === null) return;           // no heading, no step direction: don't invent one
    walk.pdr.step(len, h); walk.dist += len;
    $('steps').textContent = steps.count - walk.startSteps; $('dist').textContent = fmt(walk.dist, 1) + ' m';
    if (S.fix) $('gpsGap').textContent = fmt(F.geoDist(S.fix.lat, S.fix.lon, ...walk.pdr.pos), 1) + ' m';
    drawTrack();
  }
  function initMap() {
    if (walk.map) return;
    walk.map = L_map();
    setTimeout(() => walk.map.invalidateSize(), 100);
  }
  function L_map() {
    const m = window.L.map('map', { zoomControl: true }).setView(S.fix ? [S.fix.lat, S.fix.lon] : [20.5, 78.9], S.fix ? 18 : 5);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    walk.pdrLine = window.L.polyline([], { color: '#15803d', weight: 4 }).addTo(m);
    walk.gpsLine = window.L.polyline([], { color: '#1d4ed8', weight: 2, dashArray: '5 5' }).addTo(m);
    return m;
  }
  function drawTrack() { if (!walk.map) return; walk.pdrLine.setLatLngs(walk.pdr.track); walk.gpsLine.setLatLngs(gpsTrack); }

  /* ── 3. Green cover and sky gap from the camera ── */
  const cam = { mode: 'green', last: null, timer: null };
  document.querySelectorAll('.seg-b').forEach(b => b.addEventListener('click', () => {
    cam.mode = b.dataset.mode;
    document.querySelectorAll('.seg-b').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $('camWhat').textContent = cam.mode === 'green' ? 'green cover' : 'sky gap';
  }));
  $('camBtn').addEventListener('click', async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      $('video').srcObject = s; badge('camBadge', 'live', 'ok'); $('camBtn').hidden = true; $('camRec').disabled = false;
      cam.timer = setInterval(analyse, 400);
    } catch (e) { badge('camBadge', 'blocked', 'bad'); toast('Camera: ' + e.name, 'err'); }
  });
  function analyse() {
    const v = $('video'); if (!v.videoWidth) return;
    const c = $('mask'), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    const r = cam.mode === 'green' ? L.greenCover(d, c.width, c.height, { step: 1 }) : L.skyFraction(d, c.width, c.height, { step: 1 });
    // paint the mask: classified pixels keep their colour, the rest goes dark
    for (let i = 0; i < d.length; i += 4) {
      const s = d[i] + d[i + 1] + d[i + 2];
      const hit = cam.mode === 'green' ? (s ? (2 * d[i + 1] - d[i] - d[i + 2]) / s : 0) > r.threshold
        : Math.max(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]), d[i + 2]) > r.threshold;
      if (!hit) { d[i] = d[i] * 0.15; d[i + 1] = d[i + 1] * 0.15; d[i + 2] = d[i + 2] * 0.15; }
    }
    ctx.putImageData(img, 0, 0);
    cam.last = { mode: cam.mode, fraction: r.fraction, threshold: r.threshold, tilt: C.tilt };
    $('camPct').textContent = r.fraction === null ? '—' : Math.round(r.fraction * 100) + ' %';
    $('camThr').textContent = cam.mode === 'green' ? 'ExG > ' + fmt(r.threshold, 2) : 'brightness > ' + fmt(r.threshold);
  }
  $('camRec').addEventListener('click', () => {
    if (!cam.last) return;
    const okAim = cam.mode === 'green' ? (C.tilt === null || C.tilt < 30) : (C.tilt === null || C.tilt > 150);
    record(cam.mode === 'green' ? 'green_cover' : 'sky_gap', { value_pct: +(cam.last.fraction * 100).toFixed(1), threshold: +cam.last.threshold.toFixed(3), tilt_deg: C.tilt });
    if (!okAim) toast(cam.mode === 'green' ? 'Recorded, but point straight down for comparable cover' : 'Recorded, but point straight up for the sky gap', 'err');
  });

  /* ── 4. Sound level ──
     Raw input (voice processing off) first. Exact digital silence for 2 s means a dead raw path, not a
     quiet place: fall back to the processed stream and label it, because automatic gain makes those
     levels incomparable. Never report a dead input as "−120 dB, very quiet". */
  const snd = { min: Infinity, max: -Infinity, now: null, mode: null, an: null, stream: null, timer: null };
  async function openMic(ac, raw) {
    if (snd.stream) snd.stream.getTracks().forEach(t => t.stop());
    snd.stream = await navigator.mediaDevices.getUserMedia({ audio: raw ? L.AUDIO_CONSTRAINTS : true, video: false });
    const an = ac.createAnalyser(); an.fftSize = 2048; ac.createMediaStreamSource(snd.stream).connect(an);
    const mute = ac.createGain(); mute.gain.value = 0; an.connect(mute).connect(ac.destination);   // keep the graph pulled; silent
    if (ac.state === 'suspended') await ac.resume();
    snd.an = an; snd.mode = raw ? 'raw' : 'processed'; snd.min = Infinity; snd.max = -Infinity; snd.now = null; snd.silentSince = performance.now();
    badge('sndBadge', raw ? 'live · raw' : 'live · processed', raw ? 'ok' : 'warn');
    if (!raw) toast('Raw microphone input was silent; using processed input. Levels are not comparable between places.', 'err');
  }
  $('sndBtn').addEventListener('click', async () => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();       // created inside the tap
      await openMic(ac, true);
      const buf = new Float32Array(2048);
      $('sndBtn').hidden = true; $('sndRec').disabled = false;
      snd.timer = setInterval(() => {
        snd.an.getFloatTimeDomainData(buf); const db = L.dbfs(buf);
        if (db > -120) snd.silentSince = null;
        else if (snd.mode === 'raw' && snd.silentSince !== null && performance.now() - snd.silentSince > 2000) { openMic(ac, false).catch(() => {}); return; }
        snd.now = snd.now === null ? db : snd.now * 0.7 + db * 0.3;
        snd.min = Math.min(snd.min, snd.now); snd.max = Math.max(snd.max, snd.now);
        $('sndNow').textContent = fmt(snd.now) + ' dB'; $('sndMin').textContent = fmt(snd.min); $('sndMax').textContent = fmt(snd.max);
        $('sndBar').style.width = Math.max(0, Math.min(100, (snd.now + 90) / 90 * 100)) + '%';
      }, 100);
    } catch (e) { badge('sndBadge', 'blocked', 'bad'); toast('Microphone: ' + e.name, 'err'); }
  });
  $('sndRec').addEventListener('click', () => record('sound', { dbfs: +fmt(snd.now, 1), dbfs_min: +fmt(snd.min, 1), dbfs_max: +fmt(snd.max, 1), audio_input: snd.mode }));

  /* ── 5. External GNSS (NMEA) ── */
  const nmea = L.createNmeaReader();
  function showGnss() {
    const f = nmea.fix, row = (k, v) => `<dt>${k}</dt><dd>${F.esc(v)}</dd>`;
    $('gnssKv').innerHTML = row('Fix', f.fixLabel || '—') + row('Position', f.lat === null ? '—' : `${f.lat.toFixed(8)}, ${f.lon.toFixed(8)}`) +
      row('Accuracy', f.acc === null ? 'not sent (needs GST)' : (f.acc < 1 ? fmt(f.acc * 100, 1) + ' cm' : fmt(f.acc, 2) + ' m')) +
      row('Satellites', f.sats === null ? '—' : `${f.sats} · HDOP ${fmt(f.hdop, 1)}`) + row('Rejected lines', String(f.bad));
    badge('gnssBadge', f.fixLabel || 'no fix', f.fix === 4 ? 'ok' : f.fix === 5 || f.fix === 2 ? 'warn' : f.fix ? '' : 'bad');
  }
  $('nmeaBtn').addEventListener('click', () => {
    nmea.push($('nmeaIn').value.replace(/\r?\n?$/, '\n')); showGnss();
    if (nmea.fix.lat !== null) record('gnss', { fix: nmea.fix.fixLabel, gnss_lat: nmea.fix.lat, gnss_lon: nmea.fix.lon, gnss_acc_m: nmea.fix.acc, sats: nmea.fix.sats });
  });
  $('serialBtn').addEventListener('click', async () => {
    if (!navigator.serial) { toast('This browser has no serial access (Chrome desktop, or Chrome 137+ on Android over Bluetooth)', 'err'); return; }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: +$('baud').value });
      badge('gnssBadge', 'connected', 'warn');
      const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) { nmea.push(value); showGnss(); } }
    } catch (e) { if (e.name !== 'NotFoundError') toast('Receiver: ' + e.message, 'err'); }
  });

  /* ── 6. Bluetooth environmental sensor ── */
  const ble = { t: null, h: null, p: null, ref: null };
  function showBle() {
    const row = (k, v) => `<dt>${k}</dt><dd>${F.esc(v)}</dd>`;
    $('bleKv').innerHTML = row('Temperature', ble.t === null ? '—' : fmt(ble.t, 2) + ' °C') + row('Humidity', ble.h === null ? '—' : fmt(ble.h, 1) + ' %') +
      row('Pressure', ble.p === null ? '—' : fmt(ble.p / 100, 2) + ' hPa') +
      row('Height vs reference', ble.ref === null || ble.p === null ? 'set a reference first' : fmt(L.heightAbove(ble.p, ble.ref), 2) + ' m');
  }
  $('bleBtn').addEventListener('click', async () => {
    if (!navigator.bluetooth) { toast('No Web Bluetooth here (Chrome on Android or desktop; not iOS)', 'err'); return; }
    try {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [L.ESS.service] }] });
      const svc = await (await dev.gatt.connect()).getPrimaryService(L.ESS.service);
      badge('bleBadge', dev.name || 'connected', 'ok');
      for (const [key, uuid, dec] of [['t', L.ESS.temperature, L.decodeTemperature], ['h', L.ESS.humidity, L.decodeHumidity], ['p', L.ESS.pressure, L.decodePressure]]) {
        try {
          const ch = await svc.getCharacteristic(uuid);
          ble[key] = dec(await ch.readValue()); showBle();
          if (ch.properties.notify) { ch.addEventListener('characteristicvaluechanged', e => { ble[key] = dec(e.target.value); showBle(); }); await ch.startNotifications(); }
        } catch (e) { /* this sensor lacks that characteristic */ }
      }
      $('refBtn').disabled = ble.p === null;
    } catch (e) { if (e.name !== 'NotFoundError') toast('Sensor: ' + e.message, 'err'); }
  });
  $('refBtn').addEventListener('click', () => { ble.ref = ble.p; showBle(); record('pressure_reference', { pressure_pa: ble.p }); });

  /* ── 7. Camera height with WebXR hit test (Chrome on ARCore phones) ── */
  (async () => {
    let ok = false;
    try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { ok = false; }
    $('arBtn').disabled = !ok; badge('arBadge', ok ? 'available' : 'not here', ok ? 'ok' : '');
    $('arMsg').textContent = ok ? 'Point the camera at the ground a few metres ahead; tap to record.' : 'Needs Chrome on an Android phone with Google Play Services for AR.';
  })();
  $('arBtn').addEventListener('click', async () => {
    try {
      const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('arOverlay') } });
      $('arOverlay').hidden = false;
      const gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true });
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      const local = await session.requestReferenceSpace('local'), viewer = await session.requestReferenceSpace('viewer');
      const source = await session.requestHitTestSource({ space: viewer });
      let h = null;
      session.addEventListener('select', () => { if (h !== null) { record('ar_height', { camera_height_m: +h.toFixed(2) }); toast('Camera height ' + h.toFixed(2) + ' m', 'ok'); } });
      $('arEnd').onclick = () => session.end();
      session.addEventListener('end', () => { $('arOverlay').hidden = true; });
      session.requestAnimationFrame(function frame(t, xf) {
        const pose = xf.getViewerPose(local), hits = xf.getHitTestResults(source);
        gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer); gl.clear(gl.COLOR_BUFFER_BIT);
        if (pose && hits.length) { h = L.arHeight(pose.transform.position.y, hits[0].getPose(local).transform.position.y); }
        $('arNow').textContent = h === null ? 'aim at the ground' : h.toFixed(2) + ' m above the ground';
        xf.session.requestAnimationFrame(frame);
      });
    } catch (e) { toast('AR: ' + e.message, 'err'); }
  });

  /* ── 8. NFC point tags (Chrome on Android) ── */
  (function () {
    const ok = 'NDEFReader' in window;
    $('nfcWrite').disabled = $('nfcScan').disabled = !ok;
    badge('nfcBadge', ok ? 'available' : 'not here', ok ? 'ok' : '');
    if (!ok) return;
    $('nfcWrite').addEventListener('click', async () => {
      if (!S.fix) { toast('Wait for GPS before writing a point', 'err'); return; }
      const label = $('nfcLabel').value.trim() || 'point';
      const pt = { app: 'sensor-lab', id: label.replace(/[^\w.-]/g, '_'), lat: +S.fix.lat.toFixed(7), lon: +S.fix.lon.toFixed(7), acc: +S.fix.acc.toFixed(1), written: new Date().toISOString() };
      try { await new NDEFReader().write({ records: [{ recordType: 'text', data: JSON.stringify(pt) }] }); record('nfc_write', { tag_id: pt.id }); toast('Tag written: ' + pt.id, 'ok'); }
      catch (e) { toast('NFC: ' + e.message, 'err'); }
    });
    $('nfcScan').addEventListener('click', async () => {
      try {
        const r = new NDEFReader(); await r.scan(); badge('nfcBadge', 'scanning', 'warn');
        r.addEventListener('reading', ev => {
          for (const rec of ev.message.records) {
            if (rec.recordType !== 'text') continue;
            let pt; try { pt = JSON.parse(new TextDecoder(rec.encoding || 'utf-8').decode(rec.data)); } catch (e) { continue; }
            if (!pt || pt.app !== 'sensor-lab' || typeof pt.lat !== 'number' || typeof pt.lon !== 'number') continue;
            const d = S.fix ? F.geoDist(S.fix.lat, S.fix.lon, pt.lat, pt.lon) : null;
            record('nfc_visit', { tag_id: String(pt.id).slice(0, 40), tag_lat: pt.lat, tag_lon: pt.lon, offset_m: d === null ? null : +d.toFixed(1) });
            toast(`Visited ${String(pt.id).slice(0, 40)}` + (d === null ? '' : ` · GPS says ${d.toFixed(1)} m from the tag's point`), 'ok');
            if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
          }
        });
      } catch (e) { toast('NFC: ' + e.message, 'err'); }
    });
  })();

  /* ── Log and export ── */
  function renderLog() {
    if (!S.log.length) { $('log').innerHTML = '<li class="empty">Nothing recorded yet.</li>'; return; }
    $('log').innerHTML = S.log.slice(0, 40).map(r => {
      const extra = Object.entries(r).filter(([k]) => !['time', 'module', 'lat', 'lon', 'gps_acc_m'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v === null ? '—' : typeof v === 'number' ? +v.toFixed(Math.abs(v) < 1000 && /lat|lon/.test(k) ? 7 : 2) : v}`).join(' · ');
      return `<li><span class="when">${F.esc(new Date(r.time).toLocaleTimeString())}</span> <b>${F.esc(r.module.replace(/_/g, ' '))}</b><small>${F.esc(extra)}</small></li>`;
    }).join('');
  }
  $('csvBtn').addEventListener('click', () => {
    if (!S.log.length) { toast('Nothing recorded yet', 'err'); return; }
    const cols = [...new Set(S.log.flatMap(r => Object.keys(r)))];
    const csv = [cols.join(','), ...[...S.log].reverse().map(r => cols.map(k => F.csvCell(r[k])).join(','))].join('\n');
    FS.download(csv, `sensor-lab_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, 'text/csv');
  });
  $('gjBtn').addEventListener('click', () => {
    if (walk.pdr.track.length < 2) { toast('Walk a few steps first', 'err'); return; }
    const fc = { type: 'FeatureCollection', features: [walk.pdr.geojson(),
      { type: 'Feature', properties: { method: 'GPS' }, geometry: { type: 'LineString', coordinates: gpsTrack.map(p => [p[1], p[0]]) } }] };
    FS.download(JSON.stringify(fc, null, 2), 'sensor-lab_track.geojson', 'application/geo+json');
  });

  let tt;
  function toast(m, cls) { const e = $('toast'); e.textContent = m; e.className = 'show' + (cls ? ' ' + cls : ''); clearTimeout(tt); tt = setTimeout(() => { e.className = ''; }, 3500); }
  window.__lab = { S, C, watch, still, steps, walk, nmea, ble, cam, snd, caps, record };   // tests and console
})();
