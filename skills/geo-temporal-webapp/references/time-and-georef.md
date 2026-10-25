# Time, playhead and georeferencing: the reasoning

Source: `docs/litfest/assets/js/app.js` (LitFest Companion 1.0), `docs/epidemic-sim/` (Mumbai Epidemic Simulator
1.1), NCPA campus map setup in LitFest. The libraries are `assets/template/lib/timekit.js` and `georef.js`.

## Why the clock is zone-locked

A phone shows its own zone. A festival in Mumbai viewed from London at 10:00 local would say "not started" when
it is live. `Intl.DateTimeFormat` with `timeZone` fixes the zone; `zoned()` turns a wall time in that zone into
epoch milliseconds with two passes, so the answer holds on either side of a DST change.

| Call | Expected |
|---|---|
| `zoned('2026-03-15', 9, 0)` in America/New_York | 13:00 UTC (EDT) |
| `zoned('2026-01-15', 9, 0)` in America/New_York | 14:00 UTC (EST) |
| `zoned('2026-10-25', 10, 0)` in Asia/Kolkata | 04:30 UTC |

## Demo time

`?demo=2026-10-25T15:10` sets the clock to that moment and lets it run on. `?demo=15:10` uses the default
date. Anything else is ignored. The banner must stay visible while a demo is active.

## Playhead behaviour

- Inside the window at load: FOLLOW, at now.
- Outside the window at load: PREVIEW, at the busiest time (most items live at once), so the first view is useful.
- User move: PREVIEW. Back within half a step of now: FOLLOW again.
- `tick()` moves a followed playhead only when the minute changes, so the list does not repaint every second.

## Georeferencing in practice

Choose calibration points that are far apart and easy to find on both maps: entrances, corners, a tree
line's end. Four is the practical minimum for an affine fit; use five or six and let the residuals show
the bad one.

Leave-one-out (`fit.worstLoo`) was checked on a synthetic campus with one point moved 80 m:

| Points | Fit | `worstLoo` | Largest residual |
|---|---|---|---|
| 3 | similarity | p1 (wrong) | p0 (innocent) |
| 4 | affine | p2 (correct) | p0 (innocent) |
| 5 | affine | p2 (correct) | p0 |
| 6 | affine | p2 (correct) | p3 |

Three points cannot identify the bad point, because a similarity has no spare equations to test them with.
Ask for a fourth. The residual column shows why the largest residual is not enough: a wrong point makes
innocent points look wrong too.

## Handedness

Local coordinates are metres east and south of the centre. That matches SVG (y down), so there is no
mirror. A transform fitted from correct points can rotate and scale but cannot reflect; if a fitted map
looks mirrored, a calibration point has the wrong map coordinates.
