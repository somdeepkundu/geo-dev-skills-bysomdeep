---
name: geo-temporal-webapp
description: Build static web apps (GitHub Pages, offline PWA) that put things on a map and in time — an event timeline with a live playhead, items that go done/live/soon/later, a clock locked to the event's time zone with a ?demo= override, map pins that always agree with the list, georeferencing a schematic map from GPS calibration points, a multi-file field-data explorer with colour modes and legends, seeded simulations on a fixed timestep, and offline Leaflet tiles. Distilled from LitFest Companion, Mumbai Epidemic Simulator, Durga Pujo Map and the FloodView/CropView explorers. Use it whenever a task touches a timeline or playhead, what is on now, time zones or DST, a demo time, Leaflet or OpenStreetMap basemaps, offline tile caching, georeferencing a hand-drawn map, a map explorer for ZIP or CSV files, legends and colour ramps, seeded simulations, service-worker versioning, even if the user only says my time slider is wrong.
license: MIT
---

# Geo-temporal web apps: a map that knows what time it is

Every rule here shipped in a public app and was corrected by a real failure. Each rule says *why*, because
the failure it prevents is quiet: the app still loads, and it shows the wrong thing at the wrong time.

The working code is in `assets/template/lib/` (three dependency-free libraries, browser and Node) and the
starter app in `assets/template/`. Reuse them rather than rewriting the logic.

| File | What it is |
|---|---|
| `lib/timekit.js` | Zone-locked clock, `?demo=`, `stateAt`, snapping playhead (FOLLOW / PREVIEW), accessible slider, fixed-timestep loop, Mulberry32. |
| `lib/georef.js` | Similarity or affine fit from GPS ↔ map calibration points, residuals in metres, leave-one-out check. |
| `lib/explorer-kit.js` | Escaping, safe CSV cells, category/continuous/time colour modes, legends, spreading overlapping points, review audit trail. |
| `index.html`, `app.js`, `style.css` | Event Timeline: timeline bars, list, map pins and legend all driven by one state function. |
| `sw.js`, `manifest.json`, `icons/`, `data/events.json` | Offline shell, tile cache with a cap, install metadata, sample data. |
| `scripts/vendor_libs.mjs` | Copies Leaflet and JSZip from npm into `vendor/` (no CDN at run time). |
| `scripts/test_libs.mjs` | Node tests for the three libraries (50 checks). |
| `scripts/test_template.py` | Headless browser test of the starter app (16 checks, includes escaping and CSP). |

## Start a new app from the template

```bash
cp -r <skill>/assets/template my-app
node <skill>/scripts/vendor_libs.mjs my-app --no-jszip      # Leaflet 1.9.4 → my-app/vendor/
python3 <skill>/scripts/make_icons.py my-app                 # icon.svg → 192/512 PNG
# edit data/events.json (or your own data), APP in app.js, colours in style.css, name in manifest.json
node <skill>/scripts/test_libs.mjs                           # the libraries
python3 <skill>/scripts/test_template.py --app my-app        # the app, headless
```

Serve over HTTPS (GitHub Pages) or `localhost`; service workers do not run over plain HTTP.

## The time rules

**1. Every item's state comes from one function: `TimeKit.stateAt(item, t, soonMs)`.** It returns
`done` (t ≥ end), `live` (start ≤ t < end), `soon` (starts within `soonMs`), or `later`. The list, the
map pins, the timeline bars and the legend all call it, so they can never disagree. The LitFest app
had the list and the map compute states separately, and they drifted apart during a live event.
*End is exclusive*: at exactly `end` an item is done.

**2. The clock is locked to the event's time zone, not the phone's.** Use
`makeClock('Asia/Kolkata')` and format with `Intl` in that zone. A visitor abroad or a phone left on UTC
must still see "live now" correctly. Convert wall-clock times with `clock.zoned(date, h, m)`, which does
two passes so it is right across DST changes (test it: New York 09:00 is 13:00 UTC in March, 14:00 in January).

**3. Test "live" months ahead with `?demo=`.** `?demo=2026-10-25T15:10` (or `?demo=15:10` on the event day)
pretends it is that moment, and the clock then runs on from there. Show a visible banner when it is active,
so a shared demo link can never be mistaken for the real time. A demo must never be the default.

**4. The playhead has two modes.** FOLLOW tracks the real clock ("Now"). Any user move switches to PREVIEW.
Moving back within half a step of now re-enters FOLLOW. Outside the event window, start in PREVIEW at the
busiest time, not at a dead time. Keep the "Now" button disabled while already following.

**5. Snap the slider, and make it a real control.** Snap to 5 minutes (`snap`), so the list does not flicker
on every pixel. The track is `role="slider"` with `aria-valuetext` (a human time, not a number), and keys:
←/→ one step, Shift for 30 minutes, PageUp/PageDown an hour, Home/End the ends.

**6. Simulations run on a fixed timestep.** `fixedStepLoop({dt: 0.1, step, onFrame})` advances the model in
equal steps however fast the screen refreshes, so a 60 Hz laptop and a 120 Hz phone produce the same run.
Cap a frame at 0.5 s (a background tab coming back must not fast-forward) and cap steps per frame (the page
must not lock up). The Epidemic Simulator used this.

**7. Seed every random run.** `mulberry32(seed)` gives the same sequence for the same seed. Show the seed in
the UI and let the URL carry it, so a result can be reproduced and shared. Never use `Math.random()` for a
result someone will cite.

## The georeferencing rules

**8. Use calibration points to put GPS on a schematic map.** Walk to 4+ known places, record GPS, and
pair each with its position on the SVG or scanned map. `Georef.fit(points)` returns `toMap(lat, lon)`.
Two or three points fit a similarity (scale, rotation, shift); four or more fit an affine transform (it can
stretch across and down differently). Affine is accepted only if its area scale stays within 0.6–1.6× the
similarity's, so nearly collinear points cannot produce a wild stretch.

**9. Check the fit before trusting it.** `fit.err` (mean metres), `fit.max`, `fit.res` (per point) and
`fit.mpu` (metres per map unit) are shown to the user. If `err` is more than a few metres, re-take the
worst point.

**10. Name the bad point with leave-one-out, not the largest residual.** One wrong calibration point spreads
its error over every residual, so the largest residual can point at an innocent place. `fit.worstLoo` refits
without each point and measures how well the rest predict it. Verified: with one point 80 m off, `worstLoo`
named it at 4, 5 and 6 points. With only 3 points it cannot tell which one is wrong (the note in the
reference file explains why), so ask for a fourth point.

**11. Local coordinates are metres east and south of a centre, like SVG (y points down).** That means no
mirror step, and a similarity can rotate and scale but never mirror. A reflected map is a data bug, not a
projection choice.

## The explorer rules (many field files on one map)

**12. Every string from a file is untrusted.** `esc()` for HTML, `jsq()` for values inside `onclick="…"`, and
never `innerHTML` with file text. The starter test loads `<img onerror>` as a title and checks that it shows
as text. Use `textContent` for labels and tooltips.

**13. Neutralise CSV formulas on export.** `csvCell()` prefixes `= + - @` tab and CR with an apostrophe and
quotes separators. A field name like `=HYPERLINK(...)` otherwise runs in Excel when someone opens the export.

**14. Colour by one mode at a time, and say which.** `categoryColours()` gives a stable colour per class in
order of first sight (the same class is the same colour after reload). `colourer(mode, list)` recomputes the
range from the points on screen, so the ramp always uses the full range of what is visible. Use `ramp` for
time, direction and tilt (blue to red), and `stopsRamp` for multi-stop scales such as depth. `legend()`
draws counts for categories and a gradient with nice ticks for values; always show the legend.

**15. Spread points that overlap on screen, not in data.** `computeSpread(pts, th)` works in screen pixels,
so it adapts to zoom, and returns offsets for the points that moved. Draw a leader line to the true position.

**16. Review without losing the original label.** `keepOriginal(rec, keys, props)` keeps the field team's
label in `field_<key>`, and `auditColumns` writes `review_changed` on export. Reopening a reviewed file
reads `field_*` back, so the original survives any number of review rounds (FloodView and CropView Explorer).

## The basemap and offline rules

**17. Use OpenStreetMap for tiles, with Esri as the alternative, and not CARTO without a key.** CARTO's basemap
hosts now need an API key (check the current terms before relying on unkeyed tiles). The FloodView and CropView explorers
still reference `basemaps.cartocdn.com`; replace those when you touch them. Show the attribution every time.

**18. Vendor Leaflet and everything else.** `vendor_libs.mjs` copies Leaflet 1.9.4 (and JSZip 3.10.1) from
npm, so the app loads with no CDN, works offline and passes a strict CSP. Keep the licence files it copies.

**19. Cache tiles with a cap.** Every tile seen online is kept, up to 3000, oldest dropped first. A map
browsed before going out still shows offline. The shell is cached on install; pages are network-first with
a 4 s timeout so a weak signal never hangs the page.

**20. Bump `VERSION` whenever a cached file changes.** `sw.js` VERSION, `APP.version` and `package.json` version
must match. The activate step deletes old shell caches, so a stale page never mixes with a new script.

**21. Keep CSP strict and move inline scripts out.** The template's CSP (`script-src 'self'`) blocks inline
scripts, including the service-worker registration, which is why `app.js` registers the worker. The test
catches a CSP violation as a page error, so this breaks loudly, not quietly.

## Design rules

**22. The time must be readable at a glance.** The big clock, the playhead time and the state word on each item
are what a visitor needs in a crowd: state by word and colour together, never colour alone. Use
Atkinson Hyperlegible or a system font, and at least 16 px body text on phones.

**23. Test at phone width.** `test_template.py` runs at 390 px and fails on horizontal scroll. Tick labels
collide at that width, so the template labels every two hours below 520 px. Look at a screenshot before you ship.

## Before you ship

- `node scripts/test_libs.mjs` and `python3 scripts/test_template.py --app <app>` both pass.
- Time check: a `?demo=` at a "soon" and a "live" moment, and a day outside the window.
- Offline check: load once online, then switch the network off and reload.
- Tiles: check the attribution and that no CARTO URL remains.
- Version bumped in `sw.js`, `APP.version` and `package.json`; CHANGELOG updated.
- Data file: at least one bad row is dropped and reported in the console.
