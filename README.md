# geo-dev-skills

Claude skills for building field and map web apps. Two are distilled from apps that were used in the field or
published on the web: **phone-field-sensors** (GPS, compass, camera look direction, tilt, footprints, offline
capture, Android) and **geo-temporal-webapp** (maps and time: timelines, playheads, georeferencing, explorers,
seeded simulations, offline tiles). The third, **phone-sensor-lab**, is experimental: more sensors on top of
phone-field-sensors, tested with simulated sensors but not yet proven in the field.

Every rule was taken from code that shipped and was corrected by a real failure. Each skill says *why* a rule
exists, because the failures it prevents are quiet.

| Skill | Use it for | Distilled from |
|---|---|---|
| `skills/phone-field-sensors` | Compass and camera heading, tilt, GPS smoothing, footprints, IndexedDB capture, video with a 1 s sensor log, camera freeze recovery, ZIP/CSV/GeoJSON/SRT export, Capacitor Android | CropView v3.6, FloodView 1.1, Powai Lake Survey 1.1 |
| `skills/phone-sensor-lab` *(experimental)* | Compass trust (gyroscope vs compass), gravity tilt, stillness, steps and dead reckoning, green cover and sky gap, sound level, external RTK GNSS, Bluetooth sensors and pressure height, AR camera height, NFC plot tags | Built on phone-field-sensors; synthetic tests only |
| `skills/geo-temporal-webapp` | Event timelines, "live now", zone-locked clocks, `?demo=` time, georeferencing schematic maps, map explorers, seeded simulations, offline tiles | LitFest Companion 1.0, Mumbai Epidemic Simulator 1.1, Durga Pujo Map, FloodView/CropView explorers |

## Test apps

| App | What it tests | Open on a phone |
|---|---|---|
| [`apps/look-check`](apps/look-check/) | Camera look direction and tilt against a landmark you pick on the map; flags a magnetically disturbed compass | https://somdeepkundu.github.io/geo-dev-skills-bysomdeep/apps/look-check/ |

## Layout

```
skills/<name>/
  SKILL.md        the rules, with the reasoning (read first)
  references/     deeper notes: the maths, the failure history, test vectors
  scripts/        tests and build helpers, runnable without the app
  assets/template a starter app you copy and rename
```

## Use a skill

Copy the skill folder into your Claude skills directory, or package it as a `.skill` file and install it from
the app. Each template is a static site with no build step:

```bash
cp -r skills/geo-temporal-webapp/assets/template my-app
node skills/geo-temporal-webapp/scripts/vendor_libs.mjs my-app --no-jszip
python3 skills/geo-temporal-webapp/scripts/test_template.py --app my-app
```

## Tests

| Command | What it checks |
|---|---|
| `node skills/phone-field-sensors/scripts/test_sensor_core.mjs` | Heading and tilt maths, gimbal-lock twins, compass engine states (58 checks) |
| `python3 skills/phone-field-sensors/scripts/test_template.py` | Headless capture app with fake sensors, export and share (41 checks) |
| `python3 skills/phone-field-sensors/scripts/test_video_camera.py` | Type grid on small screens, video with the 1 s log, export, camera restart and watchdog, crash recovery (28 checks) |
| `python3 skills/phone-field-sensors/scripts/test_native_bridge.py` | Android download bridge with a mocked Capacitor (4 checks) |
| `python3 skills/phone-field-sensors/scripts/check_export_zip.py <export.zip>` | Flags altitude-as-height, lost-signal headings and other export mistakes |
| `node skills/phone-sensor-lab/scripts/test_sensor_lab.mjs` | Compass trust, gravity tilt, steps, cover, NMEA, decoders (58 checks) |
| `python3 skills/phone-sensor-lab/scripts/test_template.py` | Headless Sensor Lab with a simulated phone, including a metro (27 checks) |
| `python3 apps/look-check/test_look_check.py` | Look Check with simulated Android and iOS sensors and a metro (38 checks) |
| `node skills/geo-temporal-webapp/scripts/test_libs.mjs` | Time, georeferencing and explorer helpers (50 checks) |
| `python3 skills/geo-temporal-webapp/scripts/test_template.py` | Headless timeline app: states, playhead, escaping, CSP, phone width (16 checks) |

## Conventions

- Credit line in every file header: *Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay*.
- Licence: MIT (`LICENSE`). Vendored libraries keep their own licences (`vendor/LICENSES/`, written by the vendor script).
- Versions: a template's `VERSION`, `APP.version` and `package.json` version change together.

## Credits

Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
