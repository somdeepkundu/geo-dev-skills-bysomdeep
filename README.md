# geo-dev-skills

Two Claude skills for building field and map web apps, distilled from apps that were used in the field or
published on the web: **phone-field-sensors** (GPS, compass, camera look direction, tilt, footprints, offline
capture, Android) and **geo-temporal-webapp** (maps and time: timelines, playheads, georeferencing, explorers,
seeded simulations, offline tiles).

Every rule was taken from code that shipped and was corrected by a real failure. Each skill says *why* a rule
exists, because the failures it prevents are quiet.

| Skill | Use it for | Distilled from |
|---|---|---|
| `skills/phone-field-sensors` | Compass and camera heading, tilt, GPS smoothing, footprints, IndexedDB capture, ZIP/CSV/GeoJSON export, Capacitor Android | CropView v3.6, FloodView 1.1 |
| `skills/geo-temporal-webapp` | Event timelines, "live now", zone-locked clocks, `?demo=` time, georeferencing schematic maps, map explorers, seeded simulations, offline tiles | LitFest Companion 1.0, Mumbai Epidemic Simulator 1.1, Durga Pujo Map, FloodView/CropView explorers |

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
| `python3 skills/phone-field-sensors/scripts/test_template.py` | Headless capture app with fake sensors, export and share (39+ checks) |
| `python3 skills/phone-field-sensors/scripts/test_native_bridge.py` | Android download bridge with a mocked Capacitor (4 checks) |
| `python3 skills/phone-field-sensors/scripts/check_export_zip.py <export.zip>` | Flags altitude-as-height, lost-signal headings and other export mistakes |
| `node skills/geo-temporal-webapp/scripts/test_libs.mjs` | Time, georeferencing and explorer helpers (50 checks) |
| `python3 skills/geo-temporal-webapp/scripts/test_template.py` | Headless timeline app: states, playhead, escaping, CSP, phone width (16 checks) |

## Conventions

- Credit line in every file header: *Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay*.
- Licence: MIT (`LICENSE`). Vendored libraries keep their own licences (`vendor/LICENSES/`, written by the vendor script).
- Versions: a template's `VERSION`, `APP.version` and `package.json` version change together.

## Credits

Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
