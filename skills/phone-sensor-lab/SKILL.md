---
name: phone-sensor-lab
description: Experimental add-ons to phone-field-sensors using open web APIs and open-source tools. Covers compass trust (gyroscope vs compass to flag magnetic disturbance in a metro, beside a car or over rebar), gravity tilt as a second opinion with sign check, a stillness gate for captures, step counting and pedestrian dead reckoning where GPS drops, green cover and sky gap from camera frames (ExG and Otsu), relative sound level, external GNSS and RTK receivers over Web Serial (NMEA with checksum), Bluetooth environmental sensors and barometric height, camera height from WebXR hit test, and NFC tags on survey plots. Use it whenever a task mentions magnetic interference or an untrustworthy compass, accelerometer, gyroscope, rotationRate, devicemotion, step counting, dead reckoning, canopy or crop cover from a photo, a noise map, an RTK or external GPS receiver, NMEA, Web Serial, Web Bluetooth sensors, barometer or pressure height, WebXR or AR measurement, Web NFC, or asks what other phone sensors could be used.
license: MIT
---

# Phone sensor lab: more sensors, and how far to trust them

**Status: experimental (0.1.0).** Unlike phone-field-sensors, nothing here has shipped in a field app yet.
Every function is tested in Node with physically consistent synthetic data (58 checks), and the starter app
with simulated sensors in a headless browser (27 checks). Treat each rule as a hypothesis to confirm outdoors;
when one is confirmed or corrected in the field, record it in `references/techniques.md` and bump the version.

This skill sits **on top of phone-field-sensors**: it reuses its `sensor-core.js` (compass engine, camera
heading, tilt, GPS smoothing, geo maths, CSV guard) and `field-store.js` (downloads), and adds `sensor-lab.js`.
Read phone-field-sensors first for the heading, tilt and permission rules; they all still apply.

| File | What it is |
|---|---|
| `assets/template/sensor-lab.js` | All techniques as pure functions and small state machines. Browser (`window.SensorLab`) and Node. |
| `assets/template/index.html`, `app.js`, `style.css` | Sensor Lab: one card per technique, each started by its own tap. |
| `scripts/assemble_app.py` | Builds a runnable app: this template + the two files from phone-field-sensors + vendored Leaflet. |
| `scripts/test_sensor_lab.mjs` | Node tests (58). Motion data comes from the W3C rotation matrix, so compass, gyro and gravity agree. |
| `scripts/test_template.py` | Headless app test with a simulated phone, including a "metro" (27). |
| `references/platform-support.md` | Which API works where, with sources. Read before promising a feature. |
| `references/techniques.md` | The maths and the reasoning behind each technique. |
| `references/open-source-tools.md` | Open-source apps and tools to validate readings and process exports. |

```bash
python3 <skill>/scripts/assemble_app.py my-lab          # needs phone-field-sensors next to this skill
node <skill>/scripts/test_sensor_lab.mjs
python3 <skill>/scripts/test_template.py --app my-lab
```

## Rules that apply to every module

**1. Probe features, never user agents.** `SensorLab.capabilities()` checks what the browser actually exposes and
the app shows it as a list. A feature that is missing says so in plain words, with what would enable it.

**2. One tap per permission.** Motion (`compass.start()`), camera, microphone, Bluetooth, serial, NFC and AR each
need a user gesture; start each from its own button, and call the permission API before any `await`.

**3. Never turn "no data" into a number.** A dead microphone is not "−120 dB, very quiet", an unknown field is not
"clean", a missing heading is not north. Every module has an explicit unknown state, and exports keep it.

**4. Record how a value was measured next to the value.** `audio_input: raw|processed`, `fix: RTK fixed`, the tilt
when a cover photo was taken, the trust state of the heading. A number without its conditions cannot be compared.

## Compass trust (the reason this skill exists)

**5. Flag magnetic disturbance by comparing the compass with the gyroscope.** The compass is magnetic, the
gyroscope is not. `createMagWatch()` integrates the turn about the vertical from `devicemotion.rotationRate`
(projected on the gravity "up" vector, so it works in any pose) and compares it with the compass's change over
2 s. More than 8° apart → `DISTURBED`, held for 3 s so the badge doesn't flicker. In a metro carriage, beside a
vehicle or over rebar, the compass moves while the phone does not: this catches it. Tested in four poses
(upright, tilted and rolled, flat, still) with exact agreement in a clean field.

**6. A constant offset is invisible to every self-check.** If a steel carriage shifts north by a fixed 30°, compass
and gyroscope still change together. Only an external reference catches that: a landmark (the Look Check app in
`apps/look-check`) or a known direction such as a straight track on imagery. Say so to users; don't let a green
badge imply "correct".

**7. Use the raw magnetometer only as a bonus.** Field strength outside 25–65 µT means metal nearby, but in Chrome
`Magnetometer` is behind `#enable-generic-sensor-extra-classes` and iOS has none, so the gyroscope check is the
one that works on ordinary phones. The app reads µT only when the API exists.

**8. Gravity tilt is a second opinion, and its sign must be learned, not assumed.** `acos(az/|a|)` from
`accelerationIncludingGravity` should equal the orientation tilt. Some browsers have reported this vector with the
opposite sign; `gravitySign()` compares the two tilts while the phone is still and decides +1 or −1, refusing
to decide near 90° where both signs give the same answer. Until it decides, the app says "learning sign".

**9. Gate captures on stillness.** Still = acceleration size barely varies (σ ≤ 0.15 m/s²) and the gyroscope reads
under 5°/s for 0.6 s. A photo taken mid-pan has the heading of a different moment.

**10. Use event timestamps, not `e.interval`.** The magnetic watch integrates with the time between events, so it
doesn't depend on the unit a browser reports the interval in.

## Movement

**11. Steps: peaks of the smoothed acceleration size, at least 0.3 s apart.** Step length (Weinberg)
`K·(aMax − aMin)^¼` with K ≈ 0.48 to start; calibrate K on a measured 20 m walk. No heading, no step direction:
a step without a heading is counted but not placed.

**12. Dead reckoning bridges GPS gaps; it doesn't replace GPS.** A fix within ±10 m pulls the track 30 % of the
way toward GPS; weaker fixes are ignored. Export both lines (`method: pedestrian dead reckoning` and `GPS`) so
the difference is visible. Drift grows with distance; a disturbed compass bends the track, so check rule 5.

## Camera, sound and light

**13. Green cover = share of pixels with ExG = 2g − r − b above an Otsu threshold, never below 0.05.** On a
uniform frame Otsu has nothing to split; the floor stops a grey frame becoming "50 % green". Record the tilt:
cover is only comparable straight down (tilt < 30°). Shares within a frame survive auto-exposure.

**14. Sky gap = share of bright pixels (luminance, or blue for blue sky) above Otsu, never below 90.** Point
straight up (tilt > 150°) under the canopy. It is a gap fraction, not leaf area; converting to LAI needs a model.

**15. Sound is relative dBFS, raw input first.** Turn off echo cancellation, noise suppression and automatic gain
(`AUDIO_CONSTRAINTS`), or every place sounds equally loud. If the raw input is exact digital silence for 2 s, fall
back to the processed stream and label the reading `processed`. Calibrate an offset against a sound-level meter
before calling anything dB(A). Connect the analyser through a muted gain node so the graph keeps running.

## External devices

**16. External GNSS: parse NMEA with checksums, trust only GST for accuracy.** GGA gives the fix type (4 = RTK
fixed, 5 = RTK float), satellites and HDOP; GST gives 1-σ errors in metres. Without GST, accuracy stays null:
HDOP is not metres. Lines arrive split across serial chunks; `createNmeaReader()` reassembles them and counts
corrupt lines instead of using them. Web Serial: Chrome desktop (USB) and Chrome 137+ on Android (Bluetooth
RFCOMM only). The paste box lets you test the parser with a receiver's log.

**17. Bluetooth sensors: use the standard Environmental Sensing service when the sensor has it.** Temperature
sint16 × 0.01 °C, humidity uint16 × 0.01 %, pressure uint32 × 0.1 Pa, little-endian. Others need their own decoder.
No Web Bluetooth on iOS.

**18. Pressure gives height differences, not altitude.** About 8.3 m per hPa near sea level. Set a reference
reading on the spot, then read heights relative to it (flood marks, embankments, floors) within minutes, before
the weather changes the pressure. Check a sensor on a staircase of known height before trusting its decimetres.

**19. AR camera height: viewer y − hit y in a `local` space.** WebXR `immersive-ar` with `hit-test` (Chrome on
ARCore phones). This replaces the typed camera height H in phone-field-sensors' footprint maths. **Untested** even
headless (no XR in headless Chromium): verify on a phone against a tape measure before using it.

**20. NFC tags make permanent plots findable and measure GPS repeatability.** Write `{app, id, lat, lon, acc}` as a
JSON text record; on each revisit, log the visit and how far today's GPS is from the stored point. Validate every
field read from a tag (it is outside data). Chrome on Android only. **Untested** headless.

## Adding compass trust to a phone-field-sensors app

```js
const watch = SensorLab.createMagWatch();
const compass = FieldSensors.createCompass({ onChange: s => { if (s.heading !== null) watch.feedHeading(performance.now(), s.heading); } });
addEventListener('devicemotion', e => watch.feedMotion(performance.now(), e.rotationRate, e.accelerationIncludingGravity), true);
// in the render loop:  const trust = watch.evaluate(performance.now()).status;   // CLEAN | DISTURBED | UNKNOWN
// in the capture record: heading_trust: trust  — and show "COMPASS · DISTURBED" instead of a green badge
```
`apps/look-check` in this repository does exactly this.

## Before you ship anything from here

- Run both test scripts. Then test the feature outdoors and write what you saw into `references/techniques.md`.
- Compass trust: walk past a parked car holding the phone still; the badge must turn to disturbed and back.
- Steps: walk a measured 20 m three times; calibrate K; check the track bends where you turned.
- Cover: compare with a few hand-classified photos before reporting percentages.
- Anything marked untested above stays behind a clear "experimental" label in the UI.
