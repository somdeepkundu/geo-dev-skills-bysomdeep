/* timekit.js — time for map apps: a clock locked to one time zone, a ?demo= override,
 * item state at a playhead, a snapping slider, a fixed-timestep loop and a seeded RNG.
 *
 * From the LitFest Companion 1.0 (docs/litfest/assets/js/app.js: Intl clock, ?demo=, stateAt,
 * follow/preview playhead, 5-minute snapping slider with keyboard + ARIA) and the Mumbai Epidemic
 * Simulator 1.1 (docs/epidemic-sim: Mulberry32, fixed-timestep accumulator in requestAnimationFrame).
 * Browser (window.TimeKit) and Node. Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimeKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MIN = 60000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* A clock that always shows the EVENT's time zone, whatever the phone is set to.
     A visitor flying in, or a phone left on UTC, must still see "live now" correctly. */
  function makeClock(timeZone, opts = {}) {
    const realNow = opts.now || (() => Date.now());
    const dtf = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    function parts(ms) { const p = {}; dtf.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return p; }
    function offsetMs(ms) {                // zone offset at instant ms (handles DST zones too)
      const p = parts(ms);
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
    }
    /* Wall time in the zone → epoch ms. Two passes, so it is right across a DST change. */
    function zoned(dateStr, h = 0, m = 0) {
      const [y, mo, d] = dateStr.split('-').map(Number);
      const guess = Date.UTC(y, mo - 1, d, h, m);
      let t = guess - offsetMs(guess);
      const o2 = offsetMs(t); if (guess - o2 !== t) t = guess - o2;
      return t;
    }
    /* ?demo=2026-10-25T15:10 or ?demo=15:10 pretends it is that moment, then the clock runs on.
       Lets you test "live" states months before the event, and share a link that shows them. */
    let demo = null;
    try {
      const q = opts.demo !== undefined ? opts.demo : new URLSearchParams((opts.search ?? (typeof location !== 'undefined' ? location.search : ''))).get('demo');
      const m = q && q.match(/^(?:(\d{4}-\d{2}-\d{2})T)?(\d{1,2}):(\d{2})$/);
      if (m) demo = { t0: zoned(m[1] || opts.defaultDate || dateOf(realNow()), +m[2], +m[3]), real0: realNow() };
    } catch (e) { /* no URL access (file:// in some browsers) */ }
    function now() { return demo ? demo.t0 + (realNow() - demo.real0) : realNow(); }
    function dateOf(ms) { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; }
    function minuteOfDay(ms) { const p = parts(ms); return (+p.hour) * 60 + (+p.minute) + (+p.second) / 60; }
    const tf = new Intl.DateTimeFormat(opts.locale || 'en-IN', { timeZone, hour: 'numeric', minute: '2-digit' });
    const df = new Intl.DateTimeFormat(opts.locale || 'en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
    return { timeZone, now, zoned, dateOf, minuteOfDay, offsetMs, isDemo: () => !!demo,
             fmtTime: ms => tf.format(new Date(ms)), fmtDate: ms => df.format(new Date(ms)),
             setLocale(loc) { this.fmtTime = ms => new Intl.DateTimeFormat(loc, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); } };
  }

  /* One function decides an item's state at any playhead time — the list, the map pins and the
     timeline bars all call it, so they can never disagree. */
  function stateAt(item, t, soonMs = 60 * MIN) {
    if (t >= item.end) return 'done';
    if (t >= item.start) return 'live';
    if (item.start - t <= soonMs) return 'soon';
    return 'later';
  }
  function snap(t, stepMs, lo, hi) { return clamp(Math.round(t / stepMs) * stepMs, lo, hi); }

  /* The playhead: FOLLOW tracks the real clock ("Now"); any user move switches to PREVIEW, and moving
     back within half a step of now re-enters follow. */
  function makePlayhead({ clock, lo, hi, step = 5 * MIN, onChange = () => {} }) {
    const P = { t: lo, follow: false, lo, hi, step };
    const inWindow = () => { const n = clock.now(); return n >= P.lo && n <= P.hi; };
    function busiest(items) {                     // a sensible preview time when the event isn't on today
      let best = P.lo, bestN = -1;
      for (let t = P.lo; t <= P.hi; t += step) { const n = items.filter(i => t >= i.start && t < i.end).length; if (n > bestN) { bestN = n; best = t; } }
      return best;
    }
    P.init = items => { if (inWindow()) { P.follow = true; P.t = clock.now(); } else { P.follow = false; P.t = busiest(items || []); } onChange(P); };
    P.set = (t, byUser) => {
      t = snap(t, step, P.lo, P.hi);
      if (byUser) { P.follow = false; if (inWindow() && Math.abs(t - clock.now()) < step / 2 + 1) P.follow = true; }
      if (t !== P.t || byUser) { P.t = t; onChange(P); }
    };
    P.backToNow = () => { P.follow = true; P.t = clock.now(); onChange(P); };
    P.tick = () => { if (P.follow && inWindow()) { const n = clock.now(); if (Math.floor(n / MIN) !== Math.floor(P.t / MIN)) { P.t = n; onChange(P); } } };
    P.canFollow = inWindow;
    return P;
  }

  /* A track element as an accessible slider: pointer drag with snapping, and keys —
     ←/→ one step, Shift+←/→ 30 min, PageUp/PageDown 1 h, Home/End the ends.
     The element needs role="slider" tabindex="0" aria-label in the HTML. */
  function bindSlider(track, P, { format, bigStep = 30 * MIN, pageStep = 60 * MIN } = {}) {
    const timeAt = x => { const r = track.getBoundingClientRect(); return P.lo + clamp((x - r.left) / r.width, 0, 1) * (P.hi - P.lo); };
    let drag = null;
    track.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      try { track.setPointerCapture(e.pointerId); } catch (x) {}
      drag = true; P.set(timeAt(e.clientX), true);
    });
    track.addEventListener('pointermove', e => { if (drag) P.set(timeAt(e.clientX), true); });
    ['pointerup', 'pointercancel'].forEach(t => track.addEventListener(t, () => { drag = null; }));
    track.addEventListener('keydown', e => {
      const k = e.key; let t = null;
      if (k === 'ArrowRight' || k === 'ArrowUp') t = P.t + (e.shiftKey ? bigStep : P.step);
      else if (k === 'ArrowLeft' || k === 'ArrowDown') t = P.t - (e.shiftKey ? bigStep : P.step);
      else if (k === 'PageUp') t = P.t + pageStep; else if (k === 'PageDown') t = P.t - pageStep;
      else if (k === 'Home') t = P.lo; else if (k === 'End') t = P.hi;
      if (t === null) return;
      e.preventDefault(); P.set(t, true);
    });
    track.setAttribute('aria-valuemin', P.lo); track.setAttribute('aria-valuemax', P.hi);
    return function sync() {                        // call after every change
      track.setAttribute('aria-valuenow', Math.round(P.t));
      track.setAttribute('aria-valuetext', format ? format(P.t) : String(P.t));
    };
  }

  /* Fixed-timestep simulation inside requestAnimationFrame. The model always advances in steps of
     `dt`, however fast the screen refreshes, so a run is identical on a 60 Hz laptop and a 120 Hz
     phone, and a seed reproduces it exactly. Frame time is capped at 0.5 s (a background tab coming
     back does not fast-forward), and at most `maxSteps` per frame so the page never locks up. */
  function fixedStepLoop({ dt, step, rate = () => 1, onFrame = () => {}, done = () => false, maxSteps = 300 }) {
    let raf = null, last = null, acc = 0, running = false;
    function frame(ts) {
      if (!running) return;
      if (last === null) last = ts;
      acc += Math.min(0.5, (ts - last) / 1000) * rate(); last = ts;
      let n = 0;
      while (acc >= dt && !done() && n < maxSteps) { step(); acc -= dt; n++; }
      onFrame(n);
      if (done()) { stop(); return; }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; last = null; acc = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }
    return { start, stop, get running() { return running; }, _frame: frame };
  }

  /* Mulberry32: tiny, fast, good enough for agent models and sample data; same seed → same run. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  return { MIN, clamp, makeClock, stateAt, snap, makePlayhead, bindSlider, fixedStepLoop, mulberry32 };
});
