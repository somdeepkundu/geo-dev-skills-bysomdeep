/* Event Timeline 1.0.0 — the starter app for geo-temporal-webapp.
   One function (TimeKit.stateAt) decides every item's state, so the list, the map pins, the
   timeline bars and the legend can never disagree. Edit APP and data/events.json to make it yours. */
(function () {
  'use strict';
  const APP = { version: '1.0.0', dataUrl: 'data/events.json', soonMin: 60, stepMin: 5 };
  const MIN = TimeKit.MIN;
  const STATE = { live: '#15803d', soon: '#b45309', later: '#64748b', done: '#94a3b8' };
  const WORD = { live: 'Live', soon: 'Soon', later: 'Later', done: 'Done' };
  const $ = id => document.getElementById(id);
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  /* The file is data from outside: check the shape, drop bad rows, never trust strings as HTML. */
  function validate(d) {
    const rows = [], dropped = [];
    if (!d || !DAY.test(d.date) || typeof d.timeZone !== 'string' || !HM.test(d.window?.start) || !HM.test(d.window?.end))
      throw new Error('events.json: date, timeZone and window are required');
    (d.items || []).forEach(it => {
      const good = typeof it.id === 'string' && typeof it.title === 'string' && HM.test(it.start) && HM.test(it.end) &&
        it.start < it.end && Array.isArray(it.place) && it.place.length === 2 && it.place.every(Number.isFinite) &&
        Math.abs(it.place[0]) <= 90 && Math.abs(it.place[1]) <= 180;
      (good ? rows : dropped).push(it);
    });
    if (dropped.length) console.warn('events.json: skipped', dropped.length, 'bad item(s)');
    return { ...d, items: rows };
  }

  async function main() {
    let data;
    try {
      const res = await fetch(APP.dataUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = validate(await res.json());
    } catch (e) {
      $('footNote').textContent = 'Could not load the event data (' + e.message + ').';
      return;
    }
    $('eventName').textContent = data.event || 'Event';
    document.title = (data.event || 'Event') + ' · Timeline';
    $('zoneLabel').textContent = data.timeZone;

    const clock = TimeKit.makeClock(data.timeZone, { locale: 'en-IN', defaultDate: data.date });
    const at = s => clock.zoned(data.date, +s.slice(0, 2), +s.slice(3, 5));
    const items = data.items.map(it => ({ ...it, startMs: at(it.start), endMs: at(it.end) }));
    const lo = at(data.window.start), hi = at(data.window.end);
    const soonMs = APP.soonMin * MIN;
    const stateOf = it => TimeKit.stateAt({ start: it.startMs, end: it.endMs }, P.t, soonMs);
    const P = TimeKit.makePlayhead({ clock, lo, hi, step: APP.stepMin * MIN, onChange: render });

    if (clock.isDemo()) {
      $('demoBanner').hidden = false;
      $('demoBanner').textContent = 'Demo time: showing ' + clock.fmtTime(clock.now()) + ' on the event day. Remove ?demo= to use the real clock.';
    }
    $('clockMode').textContent = data.timeZone;

    /* ── Map ── */
    const map = L.map('map', { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    if (items.length) map.fitBounds(L.latLngBounds(items.map(i => i.place)).pad(0.25));
    const pins = new Map();
    items.forEach(it => {
      const m = L.circleMarker(it.place, { radius: 9, color: '#fff', weight: 2, fillOpacity: 1, fillColor: STATE.later });
      const tip = document.createElement('span'); tip.textContent = it.title;   // textContent: file text is never HTML
      m.bindTooltip(tip);
      m.on('click', () => select(it));
      m.addTo(map); pins.set(it.id, m);
    });

    /* ── Timeline ── */
    const track = $('track');
    const bars = $('trackBars');
    const pct = t => (t - P.lo) / (P.hi - P.lo) * 100;
    const barEls = items.map(it => {
      const b = document.createElement('div'); b.className = 'bar';
      b.style.left = pct(it.startMs) + '%'; b.style.width = Math.max(0.6, pct(it.endMs) - pct(it.startMs)) + '%';
      b.setAttribute('title', it.title); bars.appendChild(b); return b;
    });
    const ticks = $('ticks');
    const every = (window.innerWidth < 520 ? 120 : 60) * MIN;   // two-hour labels on phones, so they don't collide
    for (let t = lo; t <= hi; t += every) {
      const s = document.createElement('span'); s.style.left = pct(t) + '%';
      s.textContent = clock.fmtTime(t); ticks.appendChild(s);
    }

    /* ── List ── */
    const list = $('items');
    const rows = items.map(it => {
      const li = document.createElement('li'); li.className = 'item'; li.tabIndex = 0;
      const time = document.createElement('span'); time.className = 'when';
      time.textContent = clock.fmtTime(it.startMs) + ' – ' + clock.fmtTime(it.endMs);
      const title = document.createElement('span'); title.className = 'title'; title.textContent = it.title;
      const chip = document.createElement('span'); chip.className = 'chip';
      li.append(time, title, chip);
      li.addEventListener('click', () => select(it));
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it); } });
      list.appendChild(li); return { li, chip };
    });

    function select(it) {
      P.set(Math.max(lo, it.startMs), true);
      const m = pins.get(it.id); if (m) map.panTo(m.getLatLng());
    }

    /* ── Playhead ── */
    const sync = { fn: () => {} };
    function render() {
      const states = items.map(stateOf);
      $('phTime').textContent = clock.fmtTime(P.t);
      $('phMode').textContent = P.follow ? 'Following now' : 'Previewing ' + clock.fmtDate(P.t);
      $('nowBtn').disabled = P.follow || !P.canFollow();
      $('thumb').style.left = pct(P.t) + '%';
      sync.fn();
      items.forEach((it, i) => {
        const s = states[i];
        rows[i].li.dataset.state = s; rows[i].chip.textContent = WORD[s];
        barEls[i].className = 'bar ' + s;
        const m = pins.get(it.id); if (m) m.setStyle({ fillColor: STATE[s] });
      });
      $('legend').innerHTML = ExplorerKit.legend(
        { kind: 'category', label: 'State at this time', value: (r) => r.state, colourOf: s => STATE[s], name: s => WORD[s] },
        items.map((it, i) => ({ state: states[i] })));
    }
    sync.fn = TimeKit.bindSlider(track, P, { format: t => clock.fmtTime(t) });
    P.init(items);
    $('nowBtn').addEventListener('click', () => P.backToNow());

    setInterval(() => {
      $('clockNow').textContent = clock.fmtTime(clock.now());
      P.tick();
    }, 1000);
    $('clockNow').textContent = clock.fmtTime(clock.now());
    $('footNote').textContent = 'Times are in ' + data.timeZone + '. Map © OpenStreetMap contributors.';
    setTimeout(() => map.invalidateSize(), 150);
  }

  // The CSP in index.html forbids inline scripts, so the service worker is registered from here.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', main);
})();
