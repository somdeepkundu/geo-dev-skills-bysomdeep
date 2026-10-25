# Explorer and simulation: the reasoning

Sources: FloodView Explorer 1.1 and CropView Data Explorer v2.1–2.3 (many field ZIPs, colour by class, value or
time, legend, spreading, review with audit trail); `docs/epidemic-sim/` (fixed-timestep loop, seeded runs).
The code is `assets/template/lib/explorer-kit.js` and `timekit.js`.

## Colour modes

A mode is `{kind, value(rec), label, colourOf?, ramp?, fmt?}`.

- `category`: a stable colour per class in order of first sight. The legend shows counts, largest first.
- `continuous`: the ramp runs over the range of **what is on screen**, so filtering re-scales the colours.
- `time`: the same as continuous, with ticks spaced for dates. `ramp` default is blue (earliest) to red (latest).
- Missing values get a neutral grey and a count in the legend, never a silent colour.

## Spreading overlapping points

`computeSpread` groups points that fall within `th` pixels (default 14) on screen, then sets each group on a ring
whose radius grows with the group size. It works in screen space so it adapts to zoom. Recompute on every
zoom or move. Draw a thin leader line from the ring to the true position, so a fanned point is never mistaken
for a moved one.

## Review and the audit trail

`keepOriginal(rec, keys, props)` stores the field label as `field_<key>` the first time, and reads it back from
the file on later reopenings. `auditColumns(rec, keys)` writes those columns plus `review_changed` on export.
This is how a reviewed FloodView export still shows what the field team wrote.

## Exports

Build CSV cells with `csvCell()` only. It quotes separators and quotes, and neutralises formulas. Excel in many
European locales uses `;` as the separator, so a `;` in a cell is quoted too.

## Seeded simulations

- Same seed, same run. Put the seed in the URL and on screen.
- Step the model at a fixed `dt` (0.1 in the Epidemic Simulator). Frame rate changes how often the screen
  updates, not what the model does.
- Cap a frame at 0.5 s of model time and at 300 steps, so a background tab does not fast-forward and a slow
  phone does not lock up.
- Test with `node scripts/test_libs.mjs`: two runs at 60 Hz and 120 Hz agree to one step per second.
