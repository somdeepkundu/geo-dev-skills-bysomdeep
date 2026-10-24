# Capture, storage and export

Source: FloodView 1.0–1.1.1 `index.html` (IndexedDB, resume, ZIP, share, CSV guard, wake lock) and its
`SECURITY-AUDIT.md`; CropView v3 export naming. Implementation: `assets/template/field-store.js` + `app.js`.

## The capture instant

```js
async function capture(cls) {
  if (busy) return;                         // one capture at a time
  // guards: GPS fix, accuracy ≤ 30 m, video ready
  // 1. read EVERYTHING synchronously: time, position, heading, tilt, footprint, aim, travel, tags
  // 2. draw the video frame to a canvas
  // 3. only now await: thumbnail, toBlob(jpeg, .85), store.putPhoto, store.putCap, session update
}
```
The record must describe the instant of the tap. Reading the heading after `await canvas.toBlob()` gives the
direction the phone pointed half a second later — while the user is already lowering it.

Record fields worth keeping (template `cap`): `id` (`PREFIX-<ms>`), `imgName`, `timestamp` (ISO UTC),
`project`, `lat`, `lon`, `altitude`, `accuracy`, `gpsSamples`, `heading` (null if no fix), `headingSrc`,
`signal`, `platform`, `tilt`, `camH`, `hfov`, `travelBrg`, `lookRel`, `lookSide`, `fp {w,d,farCapped}`,
`ring` (footprint polygon), `aim {lat,lon,dist,unc}`, `cls`, `note`, `thumb` (320 px data URL, for lists only).

File names: `{Survey}_{ID}_{YYYYMMDDHHMMSS UTC}_{lat 5dp with p}_{lon}.jpg`, e.g.
`Loni_East_FC-1792870844088_20261024194044_18p19611_74p90600.jpg`. Survey names are sanitised with
`replace(/[^a-zA-Z0-9_\-.]/g, '_')` so they are safe in every file system and ZIP tool.

## IndexedDB

Database with three object stores:

| store | key | value |
|---|---|---|
| `caps` | `id` (keyPath), index `project` | the record (with the small thumbnail) |
| `photos` | capture id (out-of-line key) | the full-resolution JPEG `Blob` |
| `sessions` | `name` (keyPath) | `{name, notes, camH, started, updated, count}` |

- Call `navigator.storage.persist()` after opening, so the browser does not evict the origin's data under
  storage pressure; show `navigator.storage.estimate().usage` in the Data tab.
- Wrap each operation in its own transaction and resolve on `oncomplete` (not `onsuccess`), reject on
  `onerror`/`onabort` — a quota error then surfaces as a failed capture toast instead of a silent loss.
- If `indexedDB.open` throws or is blocked (some private windows), switch to an in-memory store and show a red
  "In memory only — export before closing" line. Don't block the survey.
- Keep blobs out of `localStorage` (5 MB, strings only). CropView's web build kept full images only in memory
  (`full: null` in storage), so closing the tab lost them — FloodView moved them to IndexedDB.

**Resume**: on the session screen, list saved sessions with `count > 0`, newest first (name · count · date ·
camera height). Picking one restores name, notes, camera height and start time, and reloads its captures.
Starting a new survey with an existing name continues it.

## ZIP export (JSZip, DEFLATE level 6)

```
{Survey}_{App}_{YYYY-MM-DD}.zip
├── images/            full-resolution JPEGs, named as in the records
├── data/
│   ├── {Survey}_captures_points.geojson       Point per photo (observer), all properties,
│   │                                          plus a top-level "fov_polygon" member per feature
│   ├── {Survey}_captures_footprints.geojson   Polygon per photo (for sampling satellite pixels)
│   └── {Survey}_captures.csv                  same records as a table
└── README.txt          what every field means, units, conventions, credit
```

Property names stay the same across CropView and FloodView where the meaning is the same
(`heading_deg`, `heading_source`, `tilt_deg_from_nadir`, `camera_height_m`, `hfov_deg`, `gps_accuracy_m`,
`footprint_width_m`, `footprint_depth_m`, `aim_*`, `travel_bearing_deg`, `look_side`), so one Explorer reads
both. `metadata` carries `app`, `version`, `project`, `notes`, `session_started`, `exported`, `captures`.
Features in chronological order. Missing photos are counted and reported, not silently skipped.

## Share on Android: two taps

`navigator.share({files})` needs transient user activation. Building a ZIP of 50 photos takes longer than
the activation window, so the share started at the end of the first tap fails ("Permission denied" /
`NotAllowedError`). Pattern (`createSharer` in `field-store.js`):

1. Tap 1: build the ZIP, wrap it in a `File`, try `navigator.share`.
2. If that throws anything other than `AbortError` (user cancelled), keep the File, relabel the button
   **Tap to share** and toast "ZIP ready — tap Share once more".
3. Tap 2: if the data key is unchanged (survey name + capture ids + edit stamps), call `navigator.share`
   immediately — nothing awaited before it.
4. Show the Share button only if `navigator.canShare({files:[new File(['x'],'t.zip',{type:'application/zip'})]})`;
   otherwise fall back to a download.

## CSV

```js
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // formula injection guard
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
```
Only strings are guarded, so negative numbers stay numbers. Quote on `;` too — Excel in many European
locales uses it as the separator.

## Security (FloodView 1.1.1 audit, short form)

Map what comes in (files opened in an explorer, saved sessions, names and notes typed in the app, sensors),
follow it to where it is shown, and fix each sink: escape every text value (`& < > " '`), JSON-quote ids put in
`onclick` attributes, use class/enum values only as lookup keys, guard CSV cells, add a CSP. Photos and data
stay on the phone; no accounts, no uploads, no tracking.

## Wake lock

`navigator.wakeLock.request('screen')` when a survey starts; the lock is released when the tab hides, so
re-request on `visibilitychange` → visible while a survey is active. Wrap in try/catch: unsupported browsers
just don't get it.
