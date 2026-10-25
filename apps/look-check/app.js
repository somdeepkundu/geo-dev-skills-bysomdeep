/* Look Check — a field test of camera look direction and tilt.
 * Built only from the phone-field-sensors skill: sensor-core.js (compass engine, cameraHeading,
 * tilt, GPS smoothing, geo maths, CSV guard) and field-store.js (download), loaded straight from
 * the skill folder, so this page always tests the skill's current code.
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License */
(function () {
  'use strict';
  const APP = { name: 'Look Check', version: '1.0.0', logKey: 'look-check-log-v1' };
  const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const WINDOW_MS = 1000;        // a recording averages this much of the latest readings
  const NEAR_M = 50;             // closer than this, GPS error swamps the true bearing
  const F = window.FieldSensors, FS = window.FieldStore;
  const $ = id => document.getElementById(id);

  const S = { fix: null, target: null, map: null, tile: null, sat: true, centred: false, layers: {}, log: [], samples: [], raw: {} };
  const gps = F.createGpsSmoother(6);
  const compass = F.createCompass({
    onChange: st => { if (st.heading !== null) S.samples.push({ t: Date.now(), h: st.heading, tilt: st.tilt }); },
    onWarn: w => toast(w === 'denied'
      ? 'Motion sensors are blocked. Allow them in the site settings, then tap Recalibrate.'
      : 'No compass data from this phone yet. Tap Recalibrate and move the phone.', 'err')
  });
  const C = compass.state;

  /* Everything that needs the tap happens synchronously, permission first (rule 4). */
  $('startBtn').addEventListener('click', () => {
    compass.start();
    startRaw();
    startGPS();
    startCamera();
    $('startCard').hidden = true; $('main').hidden = false;
    initMap();
    requestAnimationFrame(loop);
  });
  $('recalBtn').addEventListener('click', () => { compass.recalibrate(); toast('Recalibrating: draw a slow figure-8 with the phone', 'ok'); });

  /* ── Sensors ── */
  function startGPS() {
    if (!navigator.geolocation) { toast('No location access in this browser', 'err'); return; }
    navigator.geolocation.watchPosition(p => { const g = gps.push(p.coords); if (g) S.fix = g; },
      e => toast('GPS: ' + e.message, 'err'), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }
  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      $('video').srcObject = s; $('camMsg').hidden = true;
    } catch (e) { $('camMsg').textContent = 'Camera unavailable (' + e.name + '). The test still works without it.'; }
  }
  /* Raw values and event rates for the debug panel. Listening here does not touch the compass engine. */
  const rate = { abs: [], ori: [], mot: [] };
  function startRaw() {
    const mark = (k) => { const t = Date.now(); rate[k].push(t); while (rate[k].length && t - rate[k][0] > 1000) rate[k].shift(); };
    addEventListener('deviceorientationabsolute', e => { mark('abs'); S.raw.abs = { a: e.alpha, b: e.beta, g: e.gamma }; }, true);
    addEventListener('deviceorientation', e => {
      mark('ori'); S.raw.ori = { a: e.alpha, b: e.beta, g: e.gamma, absolute: e.absolute };
      if (e.webkitCompassHeading !== undefined) S.raw.ios = { h: e.webkitCompassHeading, acc: e.webkitCompassAccuracy };
    }, true);
    addEventListener('devicemotion', () => mark('mot'), true);
  }

  /* ── Averaging: circular mean of the last second, and how far it wobbled ── */
  function recent() {
    const t = Date.now(); S.samples = S.samples.filter(s => t - s.t <= 5000);
    return S.samples.filter(s => t - s.t <= WINDOW_MS);
  }
  function circMean(list) {
    let x = 0, y = 0; list.forEach(h => { x += Math.cos(h * F.D2R); y += Math.sin(h * F.D2R); });
    return F.norm360(Math.atan2(y, x) / F.D2R);
  }
  function averaged() {
    const w = recent(); if (!w.length) return null;
    const h = circMean(w.map(s => s.h));
    const tilts = w.map(s => s.tilt).filter(v => v !== null);
    return { h, spread: Math.max(...w.map(s => F.angDiff(s.h, h))), n: w.length,
             tilt: tilts.length ? tilts.reduce((a, b) => a + b, 0) / tilts.length : null };
  }
  const signed = (a, b) => ((a - b + 540) % 360) - 180;   // a − b in (−180, 180]: + means a is clockwise of b

  /* ── Target geometry ── */
  function targetInfo() {
    const g = S.fix, t = S.target; if (!g || !t) return null;
    const dist = F.geoDist(g.lat, g.lon, t.lat, t.lon);
    const brg = F.geoBearing(g.lat, g.lon, t.lat, t.lon);
    // where you stand is uncertain by ±acc metres; seen from the target that is ±atan(acc/dist)
    const unc = Math.atan2(g.acc, Math.max(dist, 0.1)) / F.D2R;
    return { dist, brg, unc };
  }

  /* ── Render loop (decoupled from events, as in the skill template) ── */
  let last = 0;
  function loop(ts) {
    if (ts - last > 150) { last = ts; render(); }
    requestAnimationFrame(loop);
  }
  const card = a => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'][Math.round(a / 45) % 8];
  const fmt = (v, d = 0) => v === null || v === undefined || !isFinite(v) ? '—' : (+v).toFixed(d);
  function chip(id, text, cls) { const e = $(id); e.textContent = text; e.className = 'chip' + (cls ? ' ' + cls : ''); }
  function render() {
    const h = C.heading, t = C.tilt, g = S.fix, sigCls = C.signal === 'OK' ? 'ok' : C.signal === 'STALE' ? 'warn' : 'bad';
    $('src').textContent = C.src; $('src').className = 'badge ' + sigCls;
    $('hdg').textContent = h === null ? '—' : String(Math.round(h)).padStart(3, '0') + '°';
    $('hdgCard').textContent = h === null ? 'waiting for compass' : card(h) + ' · clockwise from true north';
    $('tilt').textContent = t === null ? '—' : Math.round(t) + '°';
    $('tiltWord').textContent = t === null ? 'waiting' : (t < 20 ? 'pointing down' : t < 80 ? 'at the ground ahead' : t <= 100 ? 'at the horizon' : 'at the sky') + ' · 0° = straight down';
    chip('plat', 'platform ' + C.platform);
    chip('perm', 'permission ' + C.perm, C.perm === 'denied' ? 'bad' : '');
    chip('gps', g ? `GPS ± ${g.acc.toFixed(1)} m` : 'GPS …', !g ? 'warn' : g.acc <= 12 ? 'ok' : g.acc <= 30 ? 'warn' : 'bad');

    const ti = targetInfo();
    $('cmpEmpty').hidden = !!ti; $('cmpGrid').hidden = !ti;
    if (ti) {
      $('tBrg').textContent = fmt(ti.brg) + '°';
      $('tUnc').textContent = '± ' + fmt(ti.unc, 1) + '° from GPS';
      $('tDist').textContent = ti.dist < 1000 ? fmt(ti.dist) + ' m' : fmt(ti.dist / 1000, 2) + ' km';
      $('tWarn').textContent = ti.dist < NEAR_M ? 'too close: pick a farther landmark' : '';
      $('tWarn').className = ti.dist < NEAR_M ? 'warn' : '';
      const e = h === null ? null : signed(h, ti.brg), ae = e === null ? null : Math.abs(e);
      const er = e === null ? null : Math.round(e) || 0;      // `|| 0` turns −0 into 0
      $('tErr').textContent = er === null ? '—' : (er > 0 ? '+' : '') + er + '°';
      $('tErr').className = ae === null ? '' : ae <= 5 ? 'ok' : ae <= 15 ? 'warn' : 'bad';
      $('tSide').textContent = e === null ? '' : ae < 1 ? 'on target' : e > 0 ? 'compass reads right of true' : 'compass reads left of true';
    }
    $('recBtn').disabled = !(ti && h !== null);
    updMap(ti);
    if ($('raw').closest('details').open) renderRaw();
  }
  function renderRaw() {
    const r = S.raw, row = (k, v) => `<dt>${F.esc(k)}</dt><dd>${F.esc(v)}</dd>`;
    $('raw').innerHTML = [
      row('absolute α β γ', r.abs ? `${fmt(r.abs.a, 1)} ${fmt(r.abs.b, 1)} ${fmt(r.abs.g, 1)}` : 'none'),
      row('orientation α β γ', r.ori ? `${fmt(r.ori.a, 1)} ${fmt(r.ori.b, 1)} ${fmt(r.ori.g, 1)} (absolute: ${r.ori.absolute})` : 'none'),
      row('iOS compass', r.ios ? `${fmt(r.ios.h, 1)}° (accuracy ${fmt(r.ios.acc)}°)` : 'not sent'),
      row('events per second', `absolute ${rate.abs.length} · orientation ${rate.ori.length} · motion ${rate.mot.length}`),
      row('engine', `abs ${C.absCount} · ori ${C.oriCount} · resyncs ${C.resyncs} · low confidence ${C.lowConfidence}`),
      row('position', S.fix ? `${S.fix.lat.toFixed(6)}, ${S.fix.lon.toFixed(6)} (${S.fix.samples} fixes)` : 'none')
    ].join('');
  }

  /* ── Map: you, the live beam, the target and the true line ── */
  function initMap() {
    S.map = L.map('map', { zoomControl: true }).setView([20.5, 78.9], 5);
    setTiles();
    S.map.on('click', e => {
      S.target = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (!S.layers.target) S.layers.target = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#c2410c', fillOpacity: 1 }).addTo(S.map);
      else S.layers.target.setLatLng(e.latlng);
      render();
    });
    setTimeout(() => S.map.invalidateSize(), 100);
  }
  function setTiles() {
    if (S.tile) S.map.removeLayer(S.tile);
    S.tile = L.tileLayer(S.sat ? SAT : OSM, { maxZoom: 20, maxNativeZoom: S.sat ? 18 : 19,
      attribution: S.sat ? 'Esri, Maxar, Earthstar Geographics' : '© OpenStreetMap contributors' }).addTo(S.map);
    $('layerBtn').textContent = S.sat ? 'Imagery' : 'Streets'; $('layerBtn').setAttribute('aria-pressed', String(S.sat));
  }
  $('layerBtn').addEventListener('click', () => { S.sat = !S.sat; setTiles(); });
  $('centreBtn').addEventListener('click', () => { if (S.fix) S.map.setView([S.fix.lat, S.fix.lon], 18); else toast('Waiting for GPS', 'err'); });
  function line(key, ll, style) {
    if (!S.layers[key]) S.layers[key] = L.polyline(ll, Object.assign({ interactive: false }, style)).addTo(S.map);
    else { S.layers[key].setLatLngs(ll); S.layers[key].setStyle(style); }
  }
  function updMap(ti) {
    const g = S.fix; if (!S.map || !g) return;
    if (!S.layers.me) S.layers.me = L.circleMarker([g.lat, g.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#1d4ed8', fillOpacity: 1, interactive: false }).addTo(S.map);
    else S.layers.me.setLatLng([g.lat, g.lon]);
    if (!S.centred) { S.map.setView([g.lat, g.lon], 17); S.centred = true; }
    const mpp = 156543.03392 * Math.cos(g.lat * F.D2R) / Math.pow(2, S.map.getZoom());
    const len = Math.max(ti ? ti.dist * 1.15 : 0, 120 * mpp);
    if (ti) line('truth', [[g.lat, g.lon], [S.target.lat, S.target.lon]], { color: '#c2410c', weight: 2, dashArray: '6 5' });
    if (C.heading !== null) {
      const col = C.signal === 'OK' ? '#15803d' : C.signal === 'STALE' ? '#b45309' : '#b91c1c';
      line('beam', [[g.lat, g.lon], F.geoDest(g.lat, g.lon, len, C.heading)], { color: col, weight: 3 });
    }
  }

  /* ── Recording ── */
  function base() {
    const g = S.fix;
    return { time: new Date().toISOString(), lat: g ? g.lat : null, lon: g ? g.lon : null, gps_acc_m: g ? g.acc : null,
             heading_source: C.src, platform: C.platform, permission: C.perm,
             alpha: S.raw.abs ? S.raw.abs.a : S.raw.ori ? S.raw.ori.a : null,
             beta: S.raw.ori ? S.raw.ori.b : null, gamma: S.raw.ori ? S.raw.ori.g : null,
             ios_heading: S.raw.ios ? S.raw.ios.h : null, ios_accuracy: S.raw.ios ? S.raw.ios.acc : null };
  }
  $('recBtn').addEventListener('click', () => {
    const a = averaged(), ti = targetInfo();
    if (!a || !ti) { toast('Need a compass reading and a target', 'err'); return; }
    const e = signed(a.h, ti.brg);
    add(Object.assign(base(), { kind: 'aim', heading_deg: a.h, heading_spread_deg: a.spread, samples: a.n,
      target_lat: S.target.lat, target_lon: S.target.lon, target_bearing_deg: ti.brg, target_bearing_unc_deg: ti.unc,
      distance_m: ti.dist, error_deg: e, tilt_deg: a.tilt }));
    toast(`Recorded: error ${e > 0 ? '+' : ''}${e.toFixed(1)}°` + (a.spread > 5 ? ' (the phone moved; hold steadier)' : ''), Math.abs(e) <= 5 ? 'ok' : '');
  });
  function tiltCheck(expected) {
    const a = averaged();
    if (!a || a.tilt === null) { toast('No tilt reading yet', 'err'); return; }
    add(Object.assign(base(), { kind: 'tilt', tilt_deg: a.tilt, tilt_expected_deg: expected, tilt_error_deg: a.tilt - expected, heading_deg: a.h, samples: a.n }));
    toast(`Tilt ${a.tilt.toFixed(1)}° (expected ${expected}°)`, Math.abs(a.tilt - expected) <= 3 ? 'ok' : '');
  }
  $('flatBtn').addEventListener('click', () => tiltCheck(0));
  $('upBtn').addEventListener('click', () => tiltCheck(90));

  function add(rec) { S.log.unshift(rec); save(); renderLog(); }
  function save() { try { localStorage.setItem(APP.logKey, JSON.stringify(S.log)); } catch (e) { /* private mode: keep in memory */ } }
  function load() { try { S.log = JSON.parse(localStorage.getItem(APP.logKey) || '[]'); if (!Array.isArray(S.log)) S.log = []; } catch (e) { S.log = []; } }
  function renderLog() {
    const aims = S.log.filter(r => r.kind === 'aim'), tilts = S.log.filter(r => r.kind === 'tilt');
    const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
    const parts = [];
    if (aims.length) {
      const errs = aims.map(r => r.error_deg);
      parts.push(`${aims.length} aim${aims.length > 1 ? 's' : ''}: average error ${fmt(mean(errs), 1)}°, typical size ${fmt(mean(errs.map(Math.abs)), 1)}°, worst ${fmt(Math.max(...errs.map(Math.abs)), 1)}°`);
    }
    if (tilts.length) parts.push(`${tilts.length} tilt check${tilts.length > 1 ? 's' : ''}: worst ${fmt(Math.max(...tilts.map(r => Math.abs(r.tilt_error_deg))), 1)}° off`);
    $('summary').textContent = parts.length ? parts.join(' · ') : 'No readings yet.';
    $('log').innerHTML = S.log.slice(0, 50).map(r => {
      const when = new Date(r.time).toLocaleTimeString();
      if (r.kind === 'aim') {
        const ae = Math.abs(r.error_deg), cls = ae <= 5 ? 'ok' : ae <= 15 ? 'warn' : 'bad';
        return `<li><span class="when">${F.esc(when)}</span> Aim <b class="${cls}">${r.error_deg > 0 ? '+' : ''}${fmt(r.error_deg, 1)}°</b>
          <small>read ${fmt(r.heading_deg)}° · true ${fmt(r.target_bearing_deg)}° ± ${fmt(r.target_bearing_unc_deg, 1)}° · ${fmt(r.distance_m)} m · wobble ${fmt(r.heading_spread_deg, 1)}° · ${F.esc(r.platform)}</small></li>`;
      }
      const te = Math.abs(r.tilt_error_deg), cls = te <= 3 ? 'ok' : te <= 8 ? 'warn' : 'bad';
      return `<li><span class="when">${F.esc(when)}</span> Tilt <b class="${cls}">${fmt(r.tilt_deg, 1)}°</b>
        <small>expected ${r.tilt_expected_deg}° · off by ${fmt(r.tilt_error_deg, 1)}°</small></li>`;
    }).join('');
  }
  const COLS = ['time', 'kind', 'heading_deg', 'heading_spread_deg', 'samples', 'target_bearing_deg', 'target_bearing_unc_deg', 'error_deg',
    'distance_m', 'tilt_deg', 'tilt_expected_deg', 'tilt_error_deg', 'lat', 'lon', 'gps_acc_m', 'target_lat', 'target_lon',
    'heading_source', 'platform', 'permission', 'alpha', 'beta', 'gamma', 'ios_heading', 'ios_accuracy'];
  function csv() {
    const round = v => typeof v === 'number' ? +v.toFixed(7) : v;
    return [COLS.join(','), ...[...S.log].reverse().map(r => COLS.map(k => F.csvCell(round(r[k]))).join(','))].join('\n');
  }
  $('csvBtn').addEventListener('click', () => {
    if (!S.log.length) { toast('No readings yet', 'err'); return; }
    FS.download(csv(), `look-check_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, 'text/csv');
  });
  $('clearBtn').addEventListener('click', () => {
    if (!S.log.length) return;
    if (!confirm('Clear all readings on this phone?')) return;
    S.log = []; save(); renderLog();
  });

  let tt;
  function toast(m, cls) { const e = $('toast'); e.textContent = m; e.className = 'show' + (cls ? ' ' + cls : ''); clearTimeout(tt); tt = setTimeout(() => { e.className = ''; }, 3200); }

  $('ver').textContent = APP.version;
  load(); renderLog();
  window.__look = { S, C, compass, csv, averaged, targetInfo, signed, APP };   // for tests and the console
})();
