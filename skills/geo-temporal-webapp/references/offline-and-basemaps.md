# Offline, service worker and basemaps

Source: `docs/litfest/sw.js`, FloodView `sw.js`, `docs/pujo-map` (SW `pujo-1.12.2`), and the template's `sw.js`.

## Versioning

One version string, three places: `sw.js` `VERSION`, `APP.version` in `app.js`, and `package.json` `version`.
The activate step deletes every cache whose name is not the current one (except the tile cache), so an old
shell never mixes with a new script. When a page fails to update, check that the version was bumped.

## Strategy

- Shell (HTML, JS, CSS, data, icons, vendored libraries): cached on install. Pages network-first with a 4 s
  timeout, falling back to the cached page. Everything else cache-first.
- Tiles: fetched and kept as they are seen, capped at 3000 entries with oldest dropped first. The cap runs
  after each insert, not on a timer.
- A request that fails with no cache returns a network error, which Leaflet shows as a grey tile. That is
  correct offline behaviour.

## Basemaps

- OpenStreetMap (`tile.openstreetmap.org`): the default. Keep the attribution, and respect OSM's tile usage policy
  (cache, don't hammer, identify your app in production).
- Esri World Imagery (`server.arcgisonline.com`): satellite option. Keep its attribution text.
- CARTO (`basemaps.cartocdn.com`): needs a key on current terms. The FloodView and CropView explorers still reference
  it; replace those URLs when you touch those apps.

The sandbox used to test this skill blocks `tile.openstreetmap.org`. Tile failures there are expected and
are not counted as test failures.
