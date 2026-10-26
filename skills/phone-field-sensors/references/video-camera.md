# Video with a 1-second sensor log, camera recovery, capture controls

Source: Powai Lake Survey 1.1 (`somdeepkundu/cropview-v3/users/tanmay`, Oct 2026), built from this
template and then fixed after its first night out. Implementation: `assets/template/app.js`
(`startRec`, `tick`, `sampleRow`, `stopRec`, `recoverClips`, `watch`, `restartCamera`) and
`field-store.js` (`putPart`, `getParts`, `joinParts`). Test: `scripts/test_video_camera.py` (28 checks).

## Capture controls: a grid, never a sideways row

The first build put one `flex: 1` button per class in a row. With seven classes on a 412 px phone, four
buttons sat off-screen. The row had no `overflow-x`, so it couldn't be swiped either, and nothing logged an
error. Rules:

- Classes are a **grid** of `min(4, n)` columns (`--cols` set from `CLASSES.length`). Seven fit in two rows;
  two fill one row.
- **Pick a type, then press one shutter.** The picked type stays lit (`aria-checked`, saved in
  localStorage), so a photo is still one tap. The same shutter starts and stops video, which keeps the
  class buttons free to mark moments during a clip.
- A **Photo | Video** switch sits beside the shutter and is disabled while a clip is recording.
- Labels never break mid-word. Use `overflow-wrap: normal`, centred text, a coloured top edge instead of a
  dot (more room), and 11 px type below 380 px wide. Test 320, 360, 393 and 412 px: every control must be
  inside the viewport, and `elementFromPoint` at its centre must return it.

## Video recording

```js
const mr = new MediaRecorder(new MediaStream([...camStream.getVideoTracks(), ...micTracks]),
  { mimeType, videoBitsPerSecond: 5e6 });
mr.ondataavailable = e => { if (e.data.size) writes = writes.then(() => store.putPart(id, ++seq, e.data)); };
mr.start(3000);                         // a piece every 3 s
```

- **WebM before MP4.** In Chromium (153, Oct 2026) `video/mp4` recording ignores the timeslice. After
  8 s it had emitted only a 1222-byte header, and forcing `videoKeyFrameIntervalDuration: 2000` still
  gave the first media at 8 s. A crash would lose the whole take, and memory grows with clip length.
  `video/webm;codecs=vp9,opus` delivered a piece at 3, 6 and 9 s. So the order is vp9 → vp8 → webm →
  mp4 variants. Safari only records MP4.
- **Pieces go to IndexedDB as they arrive** (`photos` store, key `<id>#000001`, …). A clip record with
  `status: 'recording'` is written as soon as recording starts. On stop, `joinParts()` glues the pieces into
  one Blob under `<id>` and deletes them. On the next survey open, `recoverClips()` glues any clip still
  marked `recording` (the app was killed) and marks it `recovered`. No schema change is needed: the
  pieces share the photo store, and clips are `caps` records with `kind: 'clip'`.
- **Microphone is optional.** Ask for audio at the first recording, separately from the camera. If it's
  refused, record without sound and don't ask again this session.
- **Stop when the page hides** (`visibilitychange` → hidden). iOS kills capture anyway, and Android may
  freeze it. Save what was filmed and say why in the toast.
- **Cap clip length** (10 min ≈ 300–400 MB at 5 Mbps) and show elapsed time, rows logged and MB in a REC
  badge.
- WebM and fragmented MP4 from `MediaRecorder` carry no duration in the header, so some players show the
  length late or seek slowly. Say so in README.txt; the timestamps and captions are still exact.

## The once-a-second log

- **Self-correcting timer**: after row *n*, schedule the next at `t0 + n·1000 − performance.now()`. A
  `setInterval(…, 1000)` drifts and bunches up after a slow frame. `t0` is set when the recorder's
  `start` event fires, not when the button was tapped.
- Each row: `t` (nominal second; row *n* covers *n* to *n*+1 s), `ta` (when the sensors were actually
  read; the test requires `|ta − t| < 0.3 s`), `utc`, `lat`, `lon`, `acc`, `alt`, `gpsAge` (seconds since
  the last GPS update), `hdg`, `src`, `sig`, `tilt`, `aim`, `fp`, `ring` and `cls` (the type picked at
  that second).
- **Tapping a type while filming marks that moment**: it is pushed to `marks` and shows in each later
  row's `cls`.
- Persist `rows` into the clip record every 5 s, so a recovered clip keeps most of its log.
- Same GPS gate as photos: no start without a fix or above ± 30 m. During the clip, weak fixes are logged
  with their accuracy, not dropped.

## Export

```
videos/{Survey}_{ID}_{UTC}.webm|mp4      the clip
videos/{Survey}_{ID}_{UTC}.srt           same base name, so VLC loads it: one caption per second
data/{Survey}_video_track.geojson        per clip: LineString (path) + Point per second with fov_polygon
data/{Survey}_video_seconds.csv          one row per second of every clip
```

SRT caption: `19.13464N 72.90613E ±3 m · HDG 165° S · tilt 74° · aim 5.2 m · Viewpoint`.
Per-second property names match the photo export (`heading_deg`, `tilt_deg_from_nadir`, `aim_*`,
`footprint_*`, `camera_height_m`), plus `clip_id`, `video`, `t_s`, `t_actual_s`, `utc` and `gps_age_s`.
Videos are added to `files` as Blobs. `FieldStore.buildZip` still pulls only photos by id.

In the app, the Data tab plays a clip in an overlay. On `timeupdate`, the line under the video shows
row `floor(currentTime)`.

## Camera watchdog and the ↻ button

After a long session on Android Chrome, the preview can freeze: the track stays `live` but no new frames
arrive. After the app has been in the background, the track can also end. Nothing throws. Rules:

- **Always show a small ↻ button** under the compass. It stops every track, calls `getUserMedia` again,
  `play()`s, and toasts "Camera restarted". If the restart fails, a second tap within 10 s reloads the
  page.
- **Watchdog** in the render loop, only while the camera tab is visible: if `video.currentTime` hasn't
  changed for **4 s**, or the track's `readyState` is `ended`, restart automatically (at most once every
  15 s) and toast "Camera had frozen — restarted". If the video is paused, call `play()`. Reset the
  timer on tab switch and on `visibilitychange` → visible. Also restart on visible if the track has
  ended.
- **Save a running clip before any restart** (`stopRec('camera')`). The recorder's video track dies
  with the stream.
- Show the camera state on the Data tab (`1920×1080 · live · restarts 2`). It's the first thing to ask
  for when someone reports a freeze.

Test both freeze paths headlessly: `track.stop()` for an ended track, and swapping `srcObject` for
`canvas.captureStream(0)` (a stream that never paints) for a frozen one.

## Updates reaching the phone

`sw.js` serves app files cache-first. A pushed fix installs in the background, but the open page keeps
the old `app.js`. In `app.js`, listen for `controllerchange`: reload at once if no survey is open, and
otherwise toast "App updated — close and reopen it". Skip the reload on the very first install (no
controller at page load). A phone running a build without this listener needs to be closed and opened
once by hand.
