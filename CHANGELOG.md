# Changelog

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
