# Changelog

## 1.1.0 — 2026-10-25

### phone-sensor-lab 0.1.0 (new, experimental)
- Compass trust: gyroscope turn vs compass turn over 2 s flags magnetic disturbance (metro, vehicles, rebar).
- Gravity tilt as a second opinion, with the vector's sign learned from still moments, never assumed.
- Stillness gate; step detection and pedestrian dead reckoning nudged by good GPS fixes.
- Green cover (ExG + Otsu) and sky gap from camera frames; relative sound level with a silent-input fallback.
- NMEA parser with checksums for external RTK receivers over Web Serial; Bluetooth environmental-sensing
  decoders and barometric height differences; WebXR camera height; NFC plot tags (the last two untested).
- Tests: 58 Node checks, 27 headless app checks. Not yet field-proven.

### apps
- Look Check 1.0: aim at a landmark, compare camera direction with the true bearing; tilt checks; CSV export.
- Look Check 1.1: badge shows COMPASS · CLEAN / DISTURBED from phone-sensor-lab; `heading_trust` in exports.

## 1.0.0 — 2026-10-25

First release. Two skills, each with a starter template, tests and a reference set.

### phone-field-sensors
- Camera heading from the full rotation matrix, with the gimbal-lock twin and the near-vertical fallback.
- Tilt from `acos(cos β · cos γ)`; no invented defaults; hold last value on a null reading.
- Platform chosen from the event (`webkitCompassHeading` or an absolute event), not from the API's presence.
- Compass engine with watchdog, resync and a no-data warning.
- GPS inverse-variance smoothing, travel bearing kept as metadata, footprint and aim-point maths.
- IndexedDB capture store, resumable sessions, ZIP export, two-tap Android share, CSV formula guard.
- Capacitor download bridge (`native-bridge.js`) and build script.
- Tests: 58 sensor-core checks, 39+ headless app checks, 4 native-bridge checks, export checker.

### geo-temporal-webapp
- `timekit.js`: zone-locked clock with DST-safe conversion, `?demo=` override, `stateAt`, snapping playhead
  with FOLLOW/PREVIEW, accessible slider, fixed-timestep loop, Mulberry32.
- `georef.js`: similarity and affine fit from GPS calibration points, metres residuals, leave-one-out
  `worstLoo` to name the bad point.
- `explorer-kit.js`: escaping, CSV cells, colour modes, legends, screen-space spreading, review audit trail.
- Event Timeline starter app with offline service worker, capped tile cache and strict CSP.
- Tests: 50 library checks, 16 headless app checks.
