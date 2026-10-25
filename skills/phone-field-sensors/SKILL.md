---
name: phone-field-sensors
description: Build phone web apps (PWA or Capacitor) that read GPS position, compass heading, camera look direction and tilt from the browser's DeviceOrientation and Geolocation APIs, for field data capture, geotagged photos with direction, ground-truth surveys, compass beams on maps, crosshair aim points and camera ground footprints. Distilled from CropView and FloodView, field-tested on Android Chrome and iOS Safari. Use it whenever a task touches deviceorientation, deviceorientationabsolute, webkitCompassHeading, alpha/beta/gamma, compass or heading bugs (wrong, mirrored, frozen or flipped direction, SIGNAL LOST), phone tilt or pitch, DeviceOrientationEvent.requestPermission, GPS smoothing or accuracy, camera FOV cones or footprints on a map, offline photo capture with IndexedDB and ZIP/GeoJSON/CSV export, Android share-sheet failures, Playwright tests with fake sensors, or wrapping such an app in Capacitor, even if the user only says which way the phone points or my compass is wrong.
license: MIT
---

# Phone field sensors: position, look direction, tilt, footprint

Every rule here shipped in **CropView v3.6** (crop capture, `somdeepkundu/cropview-v3`) and **FloodView 1.1**
(flood ground truthing, `somdeepkundu/floodview`, which copies CropView's sensor core unchanged), and was
corrected after real field failures. Each rule says *why*, because the failure it prevents is silent: the app
keeps running and records a confident, wrong direction.

The working code is in `assets/template/` — reuse it rather than rewriting the sensor logic:

| File | What it is |
|---|---|
| `sensor-core.js` | Pure math + the compass engine (watchdog, resync, platform detection). Browser and Node. |
| `field-store.js` | IndexedDB photo store, resumable sessions, ZIP export, two-tap share, wake lock. |
| `index.html`, `app.js`, `style.css` | A working capture app: HUD, compass ring, tilt bar, crosshair, live map cone, export. |
| `sw.js`, `manifest.json`, `icons/` | Offline service worker and install metadata. |
| `../capacitor/` | `native-bridge.js` and `build-www.mjs` for the Android build. |

## Start a new app from the template

```bash
cp -r <skill>/assets/template my-app
node <skill>/scripts/vendor_libs.mjs my-app --font atkinson-hyperlegible:400,700   # Leaflet, JSZip, font → my-app/vendor/
# rename APP / CLASSES in app.js, colours in style.css, name in manifest.json, then:
python3 <skill>/scripts/make_icons.py my-app                                          # icon.svg → 192/512 PNG
python3 <skill>/scripts/test_template.py --app my-app                                 # headless end-to-end test
node <skill>/scripts/test_sensor_core.mjs                                             # math + compass engine
```

Serve over HTTPS (GitHub Pages) or `localhost`: sensors, camera and the service worker are blocked on plain HTTP.
If you change the sensor rules, update `test_sensor_core.mjs` in the same commit.

## Look direction: the rules

**1. Camera heading comes from the full rotation matrix, not `360 − alpha`.**
The rear camera looks along device −z. With W3C `R = Rz(α)·Rx(β)·Ry(γ)` (world = East, North, Up):
```js
east  = -(cosA*sinG + cosG*sinA*sinB);   north = cosA*cosG*sinB - sinA*sinG;
heading = atan2(east, north)             // clockwise from north
```
Why: a phone held upright to photograph a field (β ≈ 90°) is at the Euler angles' gimbal lock. Chrome can
report (α, β, γ) or its twin (α+180, 180−β, γ−180) — the same physical pose — and a heading built from α
alone jumps 180°. The matrix is continuous through it and needs no screen-rotation correction.
When `hypot(east, north) < 0.17` (camera within ~10° of straight down or up) the horizontal direction is
undefined; fall back to the phone-top direction `atan2(-cosB*sinA, cosA*cosB)`. `cameraHeading()` does both.

**2. Tilt from nadir = `acos(cos β · cos γ)`** (0° = straight down, 90° = horizon, >90° = sky).
Why: CropView v3.0 used `Math.abs(e.beta || 45)` — landscape shots read as flat (γ ignored), sky and crop
looked the same (abs), and a real β = 0 became 45°. **Never invent a default.** On a null or NaN reading,
hold the last good value; before the first reading, tilt and heading are `null` and the UI says so.

**3. Listen to both `deviceorientationabsolute` and `deviceorientation`, always, and let the *event* say
which platform it is.** `webkitCompassHeading` present → iOS (already clockwise from north; use it as is,
and treat `webkitCompassAccuracy` < 0 or > 40 as low confidence). An absolute event → Android.
Why: until v3.2.0 the app decided "iPhone" from `typeof DeviceOrientationEvent.requestPermission`.
Chrome 151 (July 2026) shipped that API on Android, so every updated Android phone took the iOS branch,
waited for `webkitCompassHeading` forever and dropped every reading — heading stuck at 0, tilt stuck at
the 45° default, SIGNAL LOST. Current Chromium also has `DeviceMotionEvent.requestPermission`.

**4. Call `requestPermission()` synchronously inside the tap handler, before any `await`.**
The prompt only appears with live user activation; one `await` before it (even `await db.ready`) and it
silently resolves `denied`. Ask wherever the API exists (iOS and Android alike). The template's
"Allow and continue" button calls `compass.start()` first thing; GPS and the session form come after.

**5. Never use relative `alpha` as a compass.** Chrome's plain `deviceorientation` with `absolute !== true`
is relative to wherever the phone pointed when the page loaded. Use its β/γ for tilt only.

**6. Validate every reading; latch only after validation.** `e.alpha || 0` turned a null reading into due
north. Latching `gotAbsolute` on the bare event (v3.0) let one null absolute event block the fallback for
good. In the engine, every valid heading passes one funnel (`applyHeading`); nothing else writes it.

**7. Never let the GPS travel bearing become the camera heading.** v2–v3.1 swapped in the GPS bearing
after ≥ 3 m of movement and "auto-calibrated" a compass offset from it. From a vehicle, or walking and
shooting sideways, every capture got the road's direction and the offset kept dragging the compass. Keep
travel as metadata only: `travel_bearing_deg`, `look_rel_travel_deg`, `look_side` (AHEAD/LEFT/RIGHT/BEHIND).

**8. Watch the stream's health and be honest about it.** Some Android builds keep firing events with a
frozen value, or stop after the tab was backgrounded. The engine runs a watchdog every second:
- no valid reading for **2.5 s** → `STALE·HOLD` (amber), try a silent resync;
- no valid reading for **8 s** → `SIGNAL LOST` / `SENSORS BLOCKED` / `NO SENSOR DATA` (red), still holding the last value;
- events arriving but the value unchanged (±0.15°) for **6 s** → stuck → resync (5 s cooldown);
- orientation silent but `devicemotion` alive → dead stream → resync;
- `visibilitychange` back to visible → resync;
- nothing at all 5 s after start → one toast with the fix.

Render from a `requestAnimationFrame` loop (angle-lerp 0.2), not from event handlers, so the rose and map
cone stay live between events and their colour changes even when nothing fires. Show the source in an
**SRC badge** and export it as `heading_source` with every record. A red badge and a held value beats a
confident cone pointing the wrong way.

**9. Tap the compass = recalibrate:** re-ask permission (still inside the tap), force a resync, and tell the
user to draw a slow figure-8 with the phone.

Bug history with symptoms, and the map-beam variant used in the Pujo Map: `references/orientation.md`.

## Position and ground geometry

- `watchPosition(..., {enableHighAccuracy: true, maximumAge: 0, timeout: 15000})`.
- Smooth with the last **6** fixes: once there are 3+, drop the worst; average the rest weighted 1/acc².
  Clamp accuracy below **0.5 m** to 0.5 m — external GNSS and mock-location apps report 0, which gives an
  infinite weight and a NaN position (FloodView 1.0.0 fix).
- Show `± acc` with ⊕ at ≤ 12 m; **refuse captures above ± 30 m** with "move to open sky".
- **Footprint** uses camera height **above ground** `H` (default 1.5 m, editable per survey, 0.2–60 m),
  never GPS altitude — v3.0 used altitude above sea level and every footprint at 650 m elevation came out
  ~430× too large. Ground range `r = H·tan(tilt)`; half-width `√(H²+r²)·tan(hfov/2)`; vertical FOV from
  the horizontal through the tangent; **clip the far edge at 85°**, drop the footprint only if the frame's
  near edge is past 85°.
- **Crosshair aim point**: `H·tan(tilt)` along the heading, with a geometry-only ± =
  `hypot(H·sec²t·2°, dist·tan10°)` (2° tilt, 10° heading error); add GPS accuracy for the total. Show it
  under the crosshair (`AIM 4.1 m ± 0.9 m`). Undefined at ≥ 85°. A tilt guide band of 40–80° keeps it reliable.
- On the map, draw the look cone as a fixed ~90 px wedge (always visible at any zoom), the true footprint
  dashed, and the aim point; colour all three by signal state.

Formulas, worked numbers and the export field list: `references/gps-footprint.md`.

## Capture, storage, export

- **Read every sensor value synchronously at the tap, then await** the photo encode and the database —
  otherwise the record describes where the phone pointed half a second later.
- Photos as full-resolution Blobs in **IndexedDB** (`caps`, `photos`, `sessions` stores) and call
  `navigator.storage.persist()`. Sessions are keyed by survey name and listed for **resume** after a
  reload, closed tab or dead battery. If IndexedDB fails (some private windows), keep going in memory and
  say "export before closing". (CropView kept full images only in memory on the web; FloodView fixed that.)
- **ZIP export**: `images/{Survey}_{ID}_{UTC}_{lat}_{lon}.jpg`, `data/*_captures_points.geojson` (with a
  `fov_polygon` member, so CropView/FloodView explorers read it), `*_captures_footprints.geojson`,
  `*_captures.csv`, `README.txt` explaining every field.
- **Android share needs a fresh tap.** Building a ZIP outlasts the tap's activation, and `navigator.share`
  then fails with "Permission denied". First tap builds and tries; on failure keep the File and relabel the
  button **Tap to share**; the second tap calls `share()` with nothing awaited before it (FloodView 1.0.2).
- **CSV formula guard**: prefix cells starting with `= + - @` tab or CR with `'` (FloodView 1.1.1 audit).
- Keep the screen awake with the Wake Lock API during a survey; re-acquire on `visibilitychange`.

Details: `references/storage-export.md`. Check a field export: `python3 scripts/check_export_zip.py survey.zip`.

## Offline and security

Vendor Leaflet, JSZip and the font into `vendor/` (`scripts/vendor_libs.mjs`), precache them in `sw.js`
(network-first for HTML with a 4 s timeout, cache-first for files, a capped tile cache of 3000), and bump
`VERSION` in `sw.js` with every change. Add a Content-Security-Policy meta (scripts from self only; images
from self and the tile servers). Escape every string that came from a user or a file. More on service
workers, basemaps and versioning in the sibling skill **geo-temporal-webapp**.

## Field tips (put them in the app's help)

- Compass off? Tap it and draw a slow **figure-8**, away from metal.
- **No magnetic phone mounts or magnetic cases** — the magnet bends every reading.
- **Inside a car** the body and engine pull the compass; hold the phone out of the window. The recorded
  heading is still the camera's, never the road's.
- Wait in the open for ± 12 m; buildings, trees and car roofs make GPS worse.
- Keep tilt in the green band (40–80°) when the crosshair point matters.
- Set the camera height when you stand on a bund, bridge or roof — it scales every footprint.

## Testing

`scripts/test_template.py` drives headless Chromium with a fake camera (`--use-fake-device-for-media-stream`),
mocked GPS, the **sensor permissions** `accelerometer`, `gyroscope`, `magnetometer` (without them the real
`requestPermission()` answers `denied`), and synthetic `DeviceOrientationEvent`s at 60 ms. Reference
vector: **α 270, β 70, γ 0 → heading 90 (east), tilt 70**. It also checks the permission is requested
with live user activation, the watchdog states, relative-only and iOS-shaped streams, blocked sensors, IndexedDB
survival across reload, ZIP contents, the two-tap share, and an offline reload. Serve the app with a
*threaded* server — a single-threaded one deadlocks once the service worker and page fetch in parallel.
Headless cannot test a real magnetometer: always do one outdoor check on Android and iPhone before release.
How-to and patterns: `references/testing.md`.

## Android app (Capacitor)

One `index.html` serves GitHub Pages and the APK. `build-www.mjs` copies the web files into `www/` and injects
`native-bridge.js`, which reroutes `<a download>` (ignored by the Android WebView) to
`@capacitor/filesystem` + `@capacitor/share`. Build with **Java 21**. The **`appId` can never change** after the
first Play Store upload — choose it once (CropView: `in.ac.iitb.ctara.cropview`). See `references/capacitor-android.md`.

## Before you ship

- [ ] Heading from `cameraHeading()`, tilt from `tiltFrom()`; no `|| 0`, no `|| 45`, no `360 - alpha`.
- [ ] Both orientation events attached; platform from events; permission asked first thing in the tap.
- [ ] SRC badge visible; `heading_source` and `camera_height_m` in every exported record.
- [ ] Captures refused above ± 30 m; footprint from camera height, far edge clipped at 85°.
- [ ] Photos in IndexedDB with `persist()`; resume works after reload; two-tap share; CSV guard.
- [ ] `test_sensor_core.mjs` and `test_template.py --app` pass; one outdoor check on a real phone.
- [ ] Version bumped in `sw.js`, `app.js` and `package.json` together; CHANGELOG entry.
