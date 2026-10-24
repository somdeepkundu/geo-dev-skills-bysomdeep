# Testing sensor apps without a phone

Source: FloodView `tests/` (test_capture.py 38 checks, test_post.py, test_explorer.py, test_offline.py),
and this skill's `scripts/test_template.py` and `scripts/test_sensor_core.mjs`.

## Two layers

1. **Unit tests of the math and the engine in Node** (`test_sensor_core.mjs`): heading vectors, gimbal twins,
   tilt, GPS smoothing with accuracy 0, travel bearing expiry, footprint, aim point, CSV guard, and the compass
   engine driven by a fake `window` (an `EventTarget`), a fake clock and manual `tick()`s — Chrome 151
   permission path, null-alpha latch, relative alpha ignored, iOS heading, stuck / dead stream resync,
   denied, no data, visibility resync. Runs in under a second; run it on every change.
2. **End-to-end in headless Chromium** (`test_template.py`, Playwright for Python): the real page, real
   IndexedDB, real service worker, real downloads.

## Playwright setup that works

```python
b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
ctx = b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True,
    geolocation={'latitude': 18.196, 'longitude': 74.906, 'accuracy': 5},
    permissions=['geolocation', 'camera', 'accelerometer', 'gyroscope', 'magnetometer'],
    accept_downloads=True, service_workers='allow')
```

- The fake device gives a 1920×1080 test-pattern camera, so `videoWidth > 0` and captures produce real JPEGs.
- **Sensor permissions**: current Chromium has `DeviceOrientationEvent.requestPermission` and
  `DeviceMotionEvent.requestPermission`. Without `accelerometer`/`gyroscope`/`magnetometer` in the context
  they answer `denied` — useful for the blocked-sensors test, wrong for everything else.
- Prove the permission is requested inside the tap: wrap the real function in an init script and record
  `navigator.userActivation.isActive` at the moment it is called; expect `[true]`.
- Move the user: `ctx.set_geolocation({...})`, then wait > 1 s for `watchPosition` to fire.
- Orientation: dispatch synthetic events every 60 ms from the page:
  ```js
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {alpha:270, beta:70, gamma:0, absolute:true}));
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha:270, beta:70, gamma:0, absolute:false}));
  window.dispatchEvent(new DeviceMotionEvent('devicemotion', {}));
  ```
  Reference pose: **α 270, β 70, γ 0 → heading 90°, tilt 70°, aim 1.5·tan 70° = 4.12 m east**.
- iOS-shaped events can't be built with the constructor (`webkitCompassHeading` is not an init field):
  `const e = new Event('deviceorientation'); Object.assign(e, {alpha, beta, gamma, webkitCompassHeading: 123, webkitCompassAccuracy: -1}); window.dispatchEvent(e);`
- Watchdog: stop dispatching; after 3.3 s expect `STALE·HOLD`, after 9 s `SIGNAL LOST`, heading unchanged.
- Share sheet: stub `navigator.canShare`/`navigator.share`, record `navigator.userActivation.isActive` per call,
  and slow `JSZip.prototype.generateAsync` by > 5 s so the first tap's activation really expires.
- Offline: load once, wait for `navigator.serviceWorker.controller`, then `ctx.set_offline(True)` and reload;
  check `typeof L`, `typeof JSZip`, the core, and `document.fonts.check('16px "Your Font"')`.
- ZIP: `with pg.expect_download() as d: pg.click(...)`, save, open with `zipfile`, assert on the GeoJSON and CSV.

## Pitfalls met while building these tests

- **Serve with a threaded server** (`socketserver.ThreadingTCPServer`). A single-threaded `TCPServer` stalls
  once the page and the service worker fetch at the same time, and the test hangs before its first check.
- **`page.evaluate` must not return a function.** `evaluate("X.prototype.f = function(){…}")` returns the
  function and the call never comes back; end the snippet with `; 0`.
- Map tiles fail in a sandbox without internet — expected; don't assert on tile requests.
- Run Python with `-u` (or `flush=True`) when logging to a file, or a hang shows no output at all.
- Each `phone()` context starts with empty storage; reuse the same context to test resume after reload.

## What headless cannot tell you

A real magnetometer near a car, a magnetic case or a steel roof; iOS Safari's actual prompt; a real Android
share sheet; GPS multipath under trees. Before a release, one outdoor check on an Android phone and an iPhone:
1. Stand in the open, wait for ± 12 m.
2. Aim at a landmark whose bearing you know (a road, a tower, a building corner on the satellite map) and
   compare the HDG chip; draw a figure-8 if it is more than ~10° off.
3. Hold the phone upright and turn slowly through 360°: the cone must turn smoothly with no 180° jumps.
4. Background the app for a minute and come back: SRC must return to COMPASS without a reload.
5. Take three photos, kill the browser, reopen: resume must show them; export and share the ZIP.
