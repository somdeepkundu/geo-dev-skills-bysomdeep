# Look Check

A field test for camera look direction and tilt, built only from the
[phone-field-sensors](../../skills/phone-field-sensors/) skill. It loads `sensor-core.js` and `field-store.js`
straight from the skill folder, so it always tests the skill's current code.

**Open it on a phone:** https://somdeepkundu.github.io/geo-dev-skills-bysomdeep/apps/look-check/

## How to test

1. Tap **Start sensors** and allow motion, location and camera.
2. Tap a far landmark on the map (100 m or more away: a tower, a building corner, the end of a tree line).
   The imagery layer makes landmarks easier to pick.
3. Point the camera at it with the crosshair, hold still, tap **Record aim**. The app averages the last second of
   readings and notes how much they wobbled.
4. Repeat from three or four spots, and with the phone in portrait and landscape.
5. Lay the phone flat on a table, rear camera down, and tap **Flat on table**; hold it upright and tap **Upright**.
6. **Export CSV** to keep the readings.

## Reading the results

- **Compass error** is the camera direction minus the true bearing. `+` means the compass reads to the right
  (clockwise) of the landmark. Within ±5° is good for a phone; ±15° is usable for a rough direction; worse
  means calibrate (figure-8) or move away from metal, cars and rebar.
- **± from GPS** is how much the true bearing itself is uncertain because your position is: `atan(GPS accuracy /
  distance)`. Pick farther landmarks to shrink it.
- **Average error** across many aims is a fixed offset (often local magnetic interference or declination
  handling); **typical size** is the scatter.
- **Wobble** above 5° means the phone moved while recording.
- **Raw sensor data** shows α β γ, iOS compass accuracy and event rates, for bug reports.

## Test

```bash
python3 apps/look-check/test_look_check.py     # 33 checks with synthetic sensors (Playwright)
```

No service worker: this is a test page, used online. Readings stay in the browser (localStorage) until exported.

Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
