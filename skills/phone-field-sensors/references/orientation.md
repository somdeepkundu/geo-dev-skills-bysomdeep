# Look direction and tilt — derivation, bug history, variants

Source: CropView v3.6 `index.html` (heading fusion, compass core) and FloodView 1.1 `index.html`
(the same code, "copied unchanged"). The implementation is `assets/template/sensor-core.js`.

## Contents
1. The rotation matrix and the camera axis
2. Why `360 − alpha` fails, with numbers
3. Tilt
4. Event wiring per platform
5. The compass engine: states, timings, resync
6. Bug history (CropView v1 → v3.2.1)
7. Variant: a "which way am I facing" beam on a navigation map (Pujo Map)
8. Test vectors

## 1. The rotation matrix and the camera axis

The W3C DeviceOrientation angles are intrinsic Z-X'-Y'' rotations: `R = Rz(α)·Rx(β)·Ry(γ)`, mapping device
coordinates to Earth coordinates (x = East, y = North, z = Up). The rear camera looks along device **−z**, so
its direction in the world is `−R[:,2]`:

```
R[:,2] = ( cosα·sinγ + sinα·sinβ·cosγ ,  sinα·sinγ − cosα·sinβ·cosγ ,  cosβ·cosγ )
camera = −R[:,2]
east   = −(cosα·sinγ + cosγ·sinα·sinβ)
north  =   cosα·cosγ·sinβ − sinα·sinγ
up     = −cosβ·cosγ
heading = atan2(east, north)     (degrees clockwise from north)
tilt from nadir = acos(−up) = acos(cosβ·cosγ)
```

`hypot(east, north)` is the sine of the angle between the camera axis and the vertical. Below 0.17 (≈10°)
the horizontal direction is noise, so use the phone's **top edge** (device +y) instead:
`atan2(−cosβ·sinα, cosα·cosβ)`. That is what a user means by "facing" when the phone lies flat.

`alpha` on Android's `deviceorientationabsolute` increases **counter-clockwise** (it is a rotation about Up).
CropView v1 used it raw and the heading was mirrored. The matrix form needs no sign juggling.

## 2. Why `360 − alpha` fails

`360 − alpha (+ screen angle)` equals the camera heading only when β ≈ 90° **and** γ ≈ 0, or for the
phone-top direction when the phone is flat. In the field the phone is upright (β ≈ 90°), which is exactly
where Z-X-Y Euler angles are singular. These two triples are the same rotation:

| α | β | γ | `360 − α` | matrix heading |
|---|---|---|---|---|
| 40 | 88 | 10 | 320 | 309.99 |
| 220 | 92 | −170 | 140 | 309.99 |

Chrome may switch between the two forms from one event to the next as the phone passes upright; a heading
from α alone flips by 180°, the matrix heading does not move (`test_sensor_core.mjs` checks this). The
matrix also needs **no screen-orientation correction**: it describes a physical axis, not the screen.

## 3. Tilt

`tilt = round(acos(clamp(cosβ·cosγ, −1, 1)))` — 0° straight down, 90° horizon, >90° sky.
Return `null` if β or γ is null/NaN; the caller keeps the last good tilt. Rejected forms and their failures:

| Old code | Failure |
|---|---|
| `Math.abs(e.beta)` | ignores γ: a landscape phone aimed 45° down reads β ≈ 0 → "flat" |
| `Math.abs(...)` | sky and ground both positive — can't tell a crop from clouds |
| `e.beta || 45` | a real β = 0 (camera straight down) becomes 45°; a missing reading becomes 45° |

A check worth running on field data: if most tilts are exactly 45°, a default is leaking in
(`scripts/check_export_zip.py` flags it).

## 4. Event wiring per platform

| Platform | What arrives | Use |
|---|---|---|
| Android Chrome | `deviceorientationabsolute` (α absolute, true-north-referenced, OS-fused) | heading via matrix, tilt |
| Android Chrome | `deviceorientation`, `absolute: false` | tilt only — α is relative to an arbitrary start |
| Some Android browsers | `deviceorientation`, `absolute: true` | heading via matrix, only if no absolute stream is alive |
| iOS Safari | `deviceorientation` with `webkitCompassHeading` (+ `webkitCompassAccuracy`) | heading as is; tilt from β/γ |

Rules:
- Attach **both** listeners, always, with `capture: true`. Never branch on the API to guess the platform.
- Set `platform` from the first real event: `webkitCompassHeading` → `ios`; an absolute event or a β → `android`.
- `DeviceOrientationEvent.requestPermission` exists on iOS **and** on Chrome ≥ 151 Android; current Chromium
  also has `DeviceMotionEvent.requestPermission`. Ask for both wherever they exist, from inside the tap.
  Answer `denied` → state `SENSORS BLOCKED` and a toast naming the setting
  (Android Chrome: ⋮ › Settings › Site settings › Motion sensors).
- iOS `webkitCompassAccuracy` is in degrees; `< 0` or `> 40` → `COMPASS·LOW-CONF`, amber.

## 5. The compass engine

`createCompass()` in `sensor-core.js`. State is a plain object the UI reads every frame.

| `src` (badge) | `signal` | Meaning |
|---|---|---|
| `COMPASS` | OK (green) | a valid reading in the last 2.5 s |
| `COMPASS·LOW-CONF` | STALE (amber) | iOS says accuracy is poor — calibrate |
| `STALE·HOLD` | STALE (amber) | no valid reading for 2.5–8 s; last value held; resync attempted |
| `SIGNAL LOST` | LOST (red) | no valid reading for 8 s (events were seen earlier) |
| `NO SENSOR DATA` | LOST (red) | no orientation event ever arrived |
| `SENSORS BLOCKED` | LOST (red) | permission denied |

Watchdog (every 1 s, independent of events): stuck = value unchanged (>0.15° counts as change) for 6 s
while events still arrive; dead = no valid reading for 2.5 s while `devicemotion` still beats. Either →
`resync()`: detach and re-attach both listeners and clear the `gotAbsolute` latch, at most once per 5 s
(`force` for the manual recalibrate). `visibilitychange` → visible also resyncs: backgrounding the tab is the
commonest trigger for a frozen Android stream.

Rendering: one `requestAnimationFrame` loop lerps the displayed angle (`lerpAngle(disp, heading, 0.2)`, the
short way round) and redraws the rose every frame and the map cone at most every 120 ms. Never redraw only
inside the event handler — a stalled stream would freeze the UI with no hint.

Design references CropView cites: flutter_compass (trust the OS-fused absolute stream, corroborate with a
second live sensor), Camera-Overlay-Android (continuous low-pass redraw), open-sensor-platform (explicit
confidence state instead of one opaque number).

## 6. Bug history (CropView)

| Version | Bug | Symptom in the field | Fix |
|---|---|---|---|
| v1 | Android absolute α used raw | heading mirrored (east ↔ west) | matrix heading |
| v2 | trusted every event, redrew only on events | cone froze on some phones | validation + watchdog + rAF loop (v3.0) |
| v3.0 | `e.alpha \|\| 0` | cone snapped to north | reject invalid readings |
| v3.0 | `gotAbsolute` latched on the bare event | one bad event killed the fallback forever | latch after validation, reset on resync |
| v3.0 | tilt `abs(beta \|\| 45)` | landscape = flat; sky = crop; fake 45° | `acos(cosβ·cosγ)` (v3.1) |
| v3.0 | footprint from GPS altitude | footprints ~430× too big at 650 m | camera height above ground (v3.1) |
| v3.0 | rose used compass, cone used fused heading | rose and cone disagreed | one heading for both (v3.1) |
| v2–v3.1 | GPS travel bearing overrode / "calibrated" the compass | every shot from a car got the road's direction | travel bearing as metadata only (v3.2) |
| v3.1 | `360 − α + screenAngle` | 180° flips with the phone upright | full rotation matrix (before v3.6) |
| v3.2.0 | platform guessed from `requestPermission` | Chrome 151 Android: heading 0, tilt 45, SIGNAL LOST | platform from events (v3.2.1) |

## 7. Variant: a facing beam on a navigation map

The Mumbai Durga Pujo Map (v1.9+, `docs/pujo-map/index.html`) reuses the same `camHeading` matrix function,
the same validation and the same watchdog idea, compactly: a conic-gradient beam on the "you are here" marker,
rotated through a CSS variable, opacity lowered when the stream is stale (`html.hdg-stale`), resubscribe when
quiet for 2.5 s. Differences that make sense for navigation, not for capture:
- the flat-phone fallback adds `screenAngle()` so the beam follows the top of the **screen** in landscape;
- the beam and per-row direction arrows only show with a real GPS fix (not a hand-picked spot), because a
  bearing from the wrong origin is worse than none;
- paint only when the rounded angle changes (`Math.round(disp*2)/2`), to save battery.
That variant shipped but was tested with simulated events, not outdoors; treat it as unverified in landscape.

## 8. Test vectors

| α | β | γ | heading | tilt | Why it matters |
|---|---|---|---|---|---|
| 270 | 70 | 0 | 90 | 70 | the FloodView/CropView test pose (camera east) |
| a | 90 | 0 | 360 − a | 90 | upright, no roll |
| 40 / 220 | 88 / 92 | 10 / −170 | 309.99 / 309.99 | 88 / 88 | gimbal twins |
| 30 | 0 | 0 | 330 | 0 | flat: phone-top fallback |
| 0 | 0 | −45 | 90 | 45 | rolled 45°: camera looks east and down (v3.0 said tilt 0) |
| 135 | 88 | 0 | 225 | 88 | near horizon: no aim point, far edge clipped |
