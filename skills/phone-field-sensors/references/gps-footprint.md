# Position, ground footprint and the crosshair point

Source: CropView v3.2+ GPS smoothing and v3.1/v3.2 footprint geometry; FloodView 1.0 crosshair point and
the accuracy-0 fix. Implementation: `sensor-core.js` (`createGpsSmoother`, `footprint`, `footprintRing`,
`aimPoint`, `createTravelBearing`).

## GPS

```js
navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
```

**Smoothing ("drop-worst inverse-variance")** — keep the last 6 raw fixes; with 3 or more, sort by accuracy
and drop the worst; average the rest with weight `1/acc²`. Report the *best* used accuracy and the sample count
(`± 3.8 m ×5`). It removes the occasional 80 m jump without lagging a walking user much.

**Accuracy 0** — external GNSS receivers and mock-location apps can report `accuracy: 0`; `1/0²` is Infinity
and the position becomes NaN. Clamp to `max(acc, 0.5)`; treat a non-finite accuracy as 50 m.

**Thresholds** (both apps): `≤ 12 m` = locked (⊕, green); `12–30 m` = weak (amber, capture allowed with a
"weak GPS" note); `> 30 m` = capture refused ("move to open sky"). Show the GPS status as a ring with a short
accuracy history so people learn to wait.

**Altitude** is GPS altitude above the ellipsoid/sea level. Export it as `altitude_m` and never use it for geometry.

## Travel bearing (metadata only)

Update only when the user moved at least `max(3 m, accuracy)` with accuracy < 25 m; fresh for 6 s. Export
`travel_bearing_deg`, `look_rel_travel_deg = ((heading − travel + 540) % 360) − 180` and `look_side`:
`|rel| ≤ 30` AHEAD, `≥ 150` BEHIND, otherwise LEFT/RIGHT. Useful for windshield surveys ("crop on the left
side of the road"); never a substitute for the compass.

## Footprint geometry

Inputs: camera height above ground `H` (m), tilt from nadir `t`, horizontal FOV `hfov` (65° default for phone
main cameras), sensor aspect 9/16, cap `tMax = 85°`.

```
v      = 2·atan(tan(hfov/2) · 9/16)          vertical FOV, through the tangent (not hfov × 9/16)
tNear  = max(t − v/2, 0);  tFar = min(t + v/2, tMax)
if tNear ≥ tMax → no footprint (the whole frame is at or above the horizon cap)
near   = H·tan(tNear);  far = H·tan(tFar);  centre = H·tan(min(t, tMax))
halfW(r) = √(H² + r²) · tan(hfov/2)          slant range, not ground range
farCapped = (t + v/2) > tMax
```

Worked numbers from `footprint()`, H = 1.5 m, hfov 65° (v ≈ 39.4°):

| tilt | near | far | width at centre | farCapped |
|---|---|---|---|---|
| 20° | 0.0 m | 1.2 m | 2.0 m | no |
| 50° | 0.9 m | 4.1 m | 3.0 m | no |
| 70° | 1.8 m | 17.1 m (clipped) | 5.6 m | yes |
| 88° | 3.8 m | 17.1 m (clipped) | 21.9 m | yes |
| 110° | — | — | — | no footprint |

Mistakes this replaced (CropView v3.0): `H = GPS altitude` (footprints ~430× too large at 650 m), width from
ground range instead of slant range, depth `gd·tan(v)`, `vFOV = hFOV × 9/16`, and `|| 5` / `|| 3` invented
dimensions when the geometry was undefined. Footprints from v3.0 exports are not trustworthy.

The polygon (`footprintRing`) is the four corners near-left, far-left, far-right, near-right, built with
spherical destination points along the heading and ±90° from it, closed, as a GeoJSON `[lon, lat]` ring.

## Crosshair aim point

```
dist = H·tan(t)                    (only for t < 85°)
aim  = destination(lat, lon, dist, heading)
unc  = hypot( H·sec²(t)·2°·π/180 ,  dist·tan 10° )       geometry-only ±, metres
```

The radial term is the derivative of `H·tan t` for a 2° tilt error; the side term is a 10° heading error.
Add `gps_accuracy_m` for the total. At H 1.5 m: 50° → 1.8 m ± 0.3 m; 70° → 4.1 m ± 0.9 m; 80° → 8.5 m ± 2.3 m —
which is why the tilt guide's green band is 40–80°. FloodView uses the aim point as the water-edge position, so
people can tag the waterline from dry ground; traced edges split at gaps > 150 m or > 20 min.

## Geodesy

Spherical formulas with `R = 6371008.8 m` (turf.js's mean radius); FloodView replaced turf.js (560 KB) with
three functions verified identical to turf over 20 000 random cases: `geoDist` (haversine), `geoBearing`,
`geoDest`. Good to well under GPS accuracy at survey distances.

## Map display

- Live cone: a fixed **~90 px** wedge — length `90 × metres-per-pixel` where
  `mpp = 156543.03392·cos(lat)/2^zoom` — so the direction is readable at every zoom; plus a ray 15 % longer.
- The true footprint dashed over it, and the aim point as a small circle.
- Colour all three by signal: green OK, amber STALE, red LOST.
- Saved captures: footprint polygon (16 % fill), observer pin, dashed line to the aim point.
