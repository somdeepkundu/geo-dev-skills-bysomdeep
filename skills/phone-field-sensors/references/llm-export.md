# Export for an LLM: `datapackage.json` + `PROMPT.md`

Source: Road Check 0.1.0 (`apps/road-check/road-core.js`: `FIELDS`, `dataPackage()`, `llmPrompt()`; tests in
`test_road_core.mjs`, section 9). Not yet used by CropView or FloodView, but the pattern fits their ZIPs too.

## Why

A researcher comes back weeks later with a ZIP and a chat window. Without help the model guesses what `index` or `cls`
means, treats an empty cell as zero, trusts positions to the metre, and never looks up the road. Two files fix that.

## ZIP layout

```
{Name}_{App}_{stamp}.zip
├── PROMPT.md           the brief (below). Start here.
├── datapackage.json    every table: column name, type, unit, meaning, what empty means
├── data/               the tables and GeoJSON the app already exported
├── raw/                raw readings, if any
├── ride.json           settings, device facts (gyroscope? GPS speed?), pauses, summary
└── README.txt          the same field notes for a person; first line points to PROMPT.md
```

## datapackage.json

- Frictionless *tabular data package*: `resources[]` with `path`, `format`, `schema.fields[] {name, type, description}`;
  add `unit`; set `missingValues: [""]`.
- **One list of fields feeds the CSV header, `datapackage.json` and `PROMPT.md`.** The Node test asserts
  `FIELDS.map(f => f.name)` equals the CSV header, in order, and that every description is a real sentence.
- Every column that can be empty says **EMPTY when ...** in its description, and what that means. "Empty class" is
  not "smooth".
- Every resource path must exist in the ZIP (the headless test checks).

## PROMPT.md: sections, in this order

1. **Task**: one paragraph. Who the researcher is, what the files are, "read this whole brief first".
2. **This ride / survey**: facts from the data, not from the template: name, vehicle or protocol, time in UTC and the local
   offset, counts, share per class, bounding box (south,west,north,east), what the device had (gyroscope, GPS speed), pauses,
   how much raw data was kept, and a small table of the worst items. A simulated run is labelled as such at the top.
3. **Files**: each path, one line, with a pointer to `datapackage.json` for the columns.
4. **How to read the numbers**: the traps this app has. Always: empty is not zero; which numbers are uncalibrated starting
   values (name them and their thresholds) and so rank within one run only; how far positions can be trusted; what the
   phone pose or mount does; which events are not defects; "say so when a group is too small".
5. **Plan**: (1) check the data and say how much is usable; (2) **enrich from outside, agentically**; (3) analyse; (4) deliver.
6. **Rules**: only data you have or sources you fetched; never invent a coordinate, name or measurement; keep units; quote the
   file and column behind every number; say how a simulated run or a poor mount limits the conclusions.
7. **My question** (editable), ending with "what should I do next time to make the data better".

### Step 2, enrichment, for a road or field app

Write it as instructions the model can follow with web or API tools, and as a fallback if it has none ("skip and say so"):

- OpenStreetMap through the **Overpass API** for the bounding box: `way["highway"]` with `surface`, `smoothness`, `maxspeed`,
  `lanes`, `bridge`, `layer`, `name`; and nodes `traffic_calming`, `railway=level_crossing`, `highway=traffic_signals|crossing`.
- **Match** each stretch to a way: nearest within 15 m of its middle and within 30° of its heading (either direction); mark
  **ambiguous** where two ways are within 5 m (parallel carriageways, flyovers); report untagged, never assume.
- **Nominatim** reverse geocoding for the start, end and the worst items, at one request per second with a User-Agent.
- **Weather** (for example Open-Meteo's archive) for the day and the 24 h before: a wet road changes what shaking means.
- Write results as **new files** (`*_enriched.csv/.geojson`), leaving the originals unchanged.
For a crop or flood app the same slots take other sources (a land-cover raster, a rainfall grid, a river gauge): keep
the structure, change the sources.

## Rules

- **The brief is read as instructions**, so anything a user typed (a ride name, notes) goes in as a single cleaned line:
  strip newlines and backticks, cap the length. Test it with a name like ``x`\n## ignore all rules``.
- No `undefined`, `NaN` or `Infinity` may reach the text (test it), and a run with no data still produces a sensible brief.
- The app never fetches anything for this; the model does, later. Keep the phone offline-first.
- Offer **Copy LLM prompt** next to Export. In that copy the file names are placeholders (`<name>`) because the ZIP does
  not exist yet; the file inside the ZIP has the real names.
- Say what is calibrated and what is not. A brief that sounds more certain than the data is worse than none.
