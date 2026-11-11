# Road Check

Logs how rough a road is while you ride, from the phone's accelerometer and GPS. **Experimental (0.2.0):**
tested with simulated sensors only; the class thresholds are starting values and not calibrated.

**Open it on a phone:** https://somdeepkundu.github.io/geo-dev-skills-bysomdeep/apps/road-check/

## How to use

1. Fix the phone firmly to the handlebar (not a magnetic mount with play in it; a loose phone measures its own rattle).
2. While stopped: name the ride, pick the vehicle and where the phone is, tap **Start ride**, allow motion and location.
3. Tap **Dim screen**. The screen goes black and ignores touches; hold the ring for 2 s to wake it.
   A web page cannot read sensors behind a locked screen, so the screen stays on instead. Turn the brightness down.
4. Ride. At the end, wake the screen and tap **End ride** twice.
5. **Export ZIP** (or the **ZIP** button on any saved ride) and open `data/*_segments.geojson` in QGIS, styled by `class`.
6. To analyse with an LLM: **Copy LLM prompt**, paste it into a chat, attach the ZIP. The same brief is inside the ZIP as `PROMPT.md`;
   `datapackage.json` explains every column. The brief tells the model to look up road type, surface, speed breakers and rain
   (OpenStreetMap, Open-Meteo) and to say what it could not fetch. The app itself fetches nothing.

*No bike right now?* **Play a demo ride** feeds a made-up road through the same code.

## What it measures

- **Up-down shake**: acceleration projected on the gravity direction, so the phone's pose in the mount does not matter.
- **20 m stretches by distance, not time**, so a fast and a slow pass over the same road give the same pieces.
- Per stretch: RMS and peak shake, sharp bumps (> 4 m/s²), speed, turn and curve radius (GPS, and gyroscope if present).
- **Index** = RMS × (30 km/h ÷ speed). The exponent 1 is a first guess. Classes break at 1.0, 2.0 and 3.5.
- **No score** under 10 km/h or with fewer than 20 readings a second. The RMS is still recorded; the index is empty, never 0.
- Standing time is dropped. A GPS silence over 5 s, or a jump, ends a stretch instead of drawing a line through it.
- Raw readings are stored every 10 s (a crash loses at most that), optionally only the last 30 or 5 minutes plus every bump.

## Limits

- The numbers depend on the vehicle, tyres, suspension and mount. Compare rides made with the same setup.
- Chrome sends about 60 readings a second: one every 14 cm at 30 km/h. Enough for potholes, not for fine texture.
- If the screen turns off or the app goes to the background, logging stops; the pause is recorded and shown.
- A bump's position is good to about one second of travel.
- Logging with the phone truly locked needs the Android build (Capacitor with a foreground service). Not done yet.

## Offline

- **The app works with no network** once it has been opened once online. The home screen says so ("Works offline · saved 16 files").
  If it says anything else, connect and reload. The folder is self-contained (`lib/` holds the shared sensor code), and a missing file fails the
  install instead of leaving a half-copy.
- **Sensors, GPS, storage, ZIP export and Copy LLM prompt need no network.**
- **The street map behind the route needs internet** unless saved: **Save the map around me** (home screen, over wifi) stores about 1.5 km around you
  at zooms 15 to 17 (at most 220 tiles, a few at a time). Tiles you have viewed are also kept (up to 2500). Offline, the route lines still draw on a blank map.
- Tiles are stored as real responses of their true size, never as opaque ones: an opaque tile counts as several MB against the phone's storage quota and
  can make saving the ride itself fail (found by the test; the skill templates had the same flaw and are fixed).
- A new version installs in the background and loads after the ride; it never reloads the page mid-ride.

## Files

`road-core.js` maths (browser and Node) · `ride-store.js` IndexedDB · `app.js`, `index.html`, `style.css` · `sw.js` offline.
`lib/` is a copy of `sensor-core.js` and `field-store.js` from `skills/phone-field-sensors` (geo maths, CSV guard, download, two-tap share); a test fails if it drifts.

```bash
node apps/road-check/test_road_core.mjs       # 77 checks on synthetic rides
python3 apps/road-check/test_road_check.py    # 92 checks with a simulated phone (includes the offline run: worker on, network off) (Playwright)
```

Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
