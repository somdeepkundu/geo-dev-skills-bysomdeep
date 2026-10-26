#!/usr/bin/env python3
"""Headless test of the type grid, video with the 1 s log, camera restart/watchdog and crash recovery.

    python3 scripts/test_video_camera.py [--app DIR] [--shots DIR]

Copies and vendors the template unless --app is given (that folder must already have vendor/).
Fake camera + microphone (--use-fake-device-for-media-stream), mocked GPS, synthetic orientation events.
Checks: every type on screen and tappable at 412 and 360 px; photo; video start/stop; one log row per
second with < 0.3 s drift; mid-clip mark; pieces cleaned up; in-app playback; ZIP has video + .srt +
track GeoJSON + per-second CSV; ↻ restart; ended and frozen camera restart by themselves; restart and
app-hidden while filming save the clip; a clip interrupted by a crash is recovered on reopening.
"""
import asyncio, zipfile, io, json, csv, os, sys, shutil, tempfile, subprocess, threading, functools, argparse, http.server, socketserver
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('--app'); ap.add_argument('--shots'); a = ap.parse_args()
OUT = (a.shots or tempfile.mkdtemp(prefix='fc-video-')) + '/'; os.makedirs(OUT, exist_ok=True)
if a.app: APPDIR = os.path.abspath(a.app)
else:
    APPDIR = os.path.join(tempfile.mkdtemp(prefix='fc-app-'), 'app')
    shutil.copytree(os.path.join(HERE, '..', 'assets', 'template'), APPDIR)
    subprocess.run(['node', os.path.join(HERE, 'vendor_libs.mjs'), APPDIR, '--font', 'atkinson-hyperlegible:400,700'], check=True, stdout=subprocess.DEVNULL)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=APPDIR))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://localhost:{srv.server_address[1]}/'
results = []
def check(name, ok, info=''):
    results.append((ok, name, info)); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(info) if info else ''), flush=True)

SENSORS = """
(() => { if (typeof DeviceOrientationEvent === "undefined") return; let a = 165; setInterval(() => {
  a = (a + 0.3) % 360;
  for (const t of ['deviceorientationabsolute','deviceorientation'])
    window.dispatchEvent(new DeviceOrientationEvent(t, { alpha: a, beta: 65, gamma: 0, absolute: true }));
}, 50); })();
"""

async def new_ctx(b, w, h):
    c = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True,
        permissions=['geolocation', 'camera', 'microphone'], geolocation={'latitude': 19.12710, 'longitude': 72.90530, 'accuracy': 6},
        accept_downloads=True, user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    await c.add_init_script(SENSORS)
    return c

async def enter(pg, name='Night'):
    await pg.goto(URL); await pg.wait_for_timeout(800)
    await pg.tap('#allow'); await pg.wait_for_timeout(300)
    if name:
        await pg.fill('#pname', name); await pg.tap('#start-btn')
    await pg.wait_for_timeout(2500)

async def toast(pg): return await pg.eval_on_selector('#toast', 'e => e.textContent')

async def main():
    async with async_playwright() as p:
        global K
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        c = await new_ctx(b, 412, 892); pg = await c.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await enter(pg)
        await pg.screenshot(path=OUT + 's_cam.png')
        K = await pg.eval_on_selector_all('.tbtn', 'bs => bs.map(b => b.dataset.cls)')
        K1, K2 = K[0], K[-1]

        # 1 · every type visible and tappable
        vw = 412; vh = 892
        boxes = await pg.eval_on_selector_all('.tbtn', 'bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.dataset.cls, r.left, r.right, r.top, r.bottom]; })')
        inside = all(l >= 0 and r <= vw and t >= 0 and bt <= vh for _, l, r, t, bt in boxes)
        check(f'all {len(boxes)} types fully on screen (412 px wide)', len(boxes) >= 1 and inside, [(k, round(r)) for k, l, r, t, bt in boxes])
        for k, *_ in boxes:
            await pg.tap(f'.tbtn[data-cls="{k}"]')
            sel = await pg.eval_on_selector(f'.tbtn[data-cls="{k}"]', 'e => e.getAttribute("aria-checked")')
            if sel != 'true': check('tap selects ' + k, False); break
        else: check('tapping each type selects it', True)
        sh = await pg.eval_on_selector('#shutter', 'e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width/2, r.top + r.height/2).closest("#shutter") !== null; }')
        check('shutter not covered by anything', sh)

        # 2 · photo
        await pg.tap(f'.tbtn[data-cls="{K2}"]'); await pg.tap('#shutter'); await pg.wait_for_timeout(1200)
        n = await pg.evaluate('__field.S.caps.filter(c => c.kind !== "clip").length')
        check('photo saved with picked type', n == 1 and await pg.evaluate('__field.S.caps[0].cls') == K2, await toast(pg))

        # 3 · video 6 s with a mark
        await pg.tap('.mode button[data-mode="video"]'); await pg.tap(f'.tbtn[data-cls="{K1}"]')
        await pg.tap('#shutter'); await pg.wait_for_timeout(3200)
        recOn = await pg.evaluate('!!__field.S.rec')
        check('recording started', recOn, await toast(pg))
        await pg.screenshot(path=OUT + 's_rec.png')
        modeLocked = await pg.eval_on_selector('.mode button[data-mode="photo"]', 'e => e.disabled')
        check('photo/video switch locked while filming', modeLocked)
        await pg.tap(f'.tbtn[data-cls="{K2}"]'); await pg.wait_for_timeout(3300)
        await pg.tap('#shutter'); await pg.wait_for_timeout(2500)
        clip = await pg.evaluate('(() => { const c = __field.S.caps.find(c => c.kind === "clip"); return c && { rows: c.rows.length, dur: c.duration, size: c.size, marks: c.marks, mime: c.mime, audio: c.audio, status: c.status, t: c.rows.map(r => r.t), ta: c.rows.map(r => r.ta), cls: c.rows.map(r => r.cls), hdg: c.rows.map(r => r.hdg) }; })()')
        check('clip saved', bool(clip) and clip['status'] == 'done' and clip['size'] > 10000, clip and {k: clip[k] for k in ('rows', 'dur', 'size', 'mime', 'audio')})
        if clip:
            exp = int(clip['dur']) + 1
            check('one log row per second', abs(clip['rows'] - exp) <= 1 and clip['t'] == list(range(clip['rows'])), f"{clip['rows']} rows for {clip['dur']} s")
            drift = max(abs(ta - t) for t, ta in zip(clip['t'], clip['ta']))
            check('log rows on time (max drift < 0.3 s)', drift < 0.3, round(drift, 3))
            check('mid-clip mark recorded', [m['cls'] for m in clip['marks']] == [K1, K2] and K2 in clip['cls'], clip['marks'])
            check('heading logged every second', all(h is not None for h in clip['hdg']), clip['hdg'])
        parts = await pg.evaluate('__field.store.getParts(__field.S.caps.find(c => c.kind === "clip").id).then(p => p.length)')
        check('temporary pieces cleaned up after stop', parts == 0, parts)

        # 4 · play it back
        await pg.tap('.tab[data-tab="data"]'); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT + 's_data.png', full_page=False)
        await pg.tap('[data-play]'); await pg.wait_for_timeout(2500)
        pl = await pg.evaluate('(() => { const v = document.getElementById("pl-video"); return { ready: v.readyState, w: v.videoWidth, t: v.currentTime, read: document.getElementById("pl-read").textContent }; })()')
        check('clip plays back in the app with live readout', pl['ready'] >= 2 and pl['w'] > 0 and 'HDG' in pl['read'], pl)
        await pg.screenshot(path=OUT + 's_play.png')
        await pg.tap('#pl-close')

        # 5 · export ZIP
        async with pg.expect_download() as dl:
            await pg.tap('#b-zip')
        d = await dl.value; path = await d.path()
        z = zipfile.ZipFile(path); names = [n for n in z.namelist() if not n.endswith('/')]
        vids = [n for n in names if n.startswith('videos/') and not n.endswith('.srt')]
        srts = [n for n in names if n.endswith('.srt')]
        check('ZIP has photo, video, SRT, track, seconds CSV, README',
              any(n.startswith('images/') for n in names) and len(vids) == 1 and len(srts) == 1 and any('video_track.geojson' in n for n in names) and any('video_seconds.csv' in n for n in names) and 'README.txt' in names, names)
        rows = list(csv.DictReader(io.StringIO(z.read([n for n in names if 'video_seconds.csv' in n][0]).decode())))
        check('seconds CSV rows = log rows', len(rows) == clip['rows'], len(rows))
        srt = z.read(srts[0]).decode()
        check('SRT has one caption per second', srt.count('-->') == clip['rows'] and '00:00:00,000 --> 00:00:01,000' in srt, srt.split('\n\n')[0])
        gj = json.loads(z.read([n for n in names if 'video_track.geojson' in n][0]))
        kinds = [f['properties']['kind'] for f in gj['features']]
        check('track GeoJSON: 1 line + per-second points with footprints', kinds.count('video_path') == 1 and kinds.count('video_second') == clip['rows'] and all('fov_polygon' in f for f in gj['features'] if f['properties']['kind'] == 'video_second'))
        vb = z.read(vids[0]); open(OUT + 'clip.' + vids[0].rsplit('.', 1)[1], 'wb').write(vb)
        check('video file in ZIP is the saved size', len(vb) == clip['size'], len(vb))

        # 6 · camera refresh button
        await pg.tap('.tab[data-tab="cam"]'); await pg.wait_for_timeout(300)
        vis = await pg.eval_on_selector('#cam-refresh', 'e => { const r = e.getBoundingClientRect(); return r.width > 30 && document.elementFromPoint(r.left + r.width/2, r.top + r.height/2).closest("#cam-refresh") !== null; }')
        check('refresh button visible and tappable', vis)
        r0 = await pg.evaluate('__field.S.camRestarts')
        await pg.tap('#cam-refresh'); await pg.wait_for_timeout(1500)
        check('refresh button restarts camera', await pg.evaluate('__field.S.camRestarts') == r0 + 1 and await pg.evaluate('document.getElementById("video").videoWidth') > 0, await toast(pg))

        # 7 · watchdog: track ended
        await pg.wait_for_timeout(500)
        await pg.evaluate('__field.S.stream.getVideoTracks()[0].stop()')
        await pg.wait_for_timeout(1500)
        live = await pg.evaluate('__field.S.stream.getVideoTracks()[0].readyState')
        check('ended camera restarts by itself', live == 'live' and await pg.evaluate('__field.S.camRestarts') == r0 + 2, await toast(pg))

        # 8 · watchdog: frozen frames (stream that never paints), after the 15 s auto cool-down
        await pg.evaluate('__field.watch.lastAuto = -1e9')
        await pg.evaluate('(() => { const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64; const s = cv.captureStream(0); const v = document.getElementById("video"); __field.S.stream.getTracks().forEach(t => t.stop()); __field.S.stream = s; v.srcObject = s; })()')
        await pg.wait_for_timeout(6500)
        w = await pg.evaluate('document.getElementById("video").videoWidth')
        check('frozen preview restarts by itself within ~5 s', w > 64 and await pg.evaluate('__field.S.camRestarts') == r0 + 3, (w, await toast(pg)))

        # 9 · recording + camera restart → clip saved first
        await pg.tap('#shutter'); await pg.wait_for_timeout(2500)
        before = await pg.evaluate('__field.S.caps.filter(c => c.kind === "clip").length')
        await pg.tap('#cam-refresh'); await pg.wait_for_timeout(3000)
        after = await pg.evaluate('__field.S.caps.filter(c => c.kind === "clip").length')
        check('refresh while filming saves the clip first', after == before + 1 and not await pg.evaluate('!!__field.S.rec'), await toast(pg))

        # 10 · app hidden while filming → clip saved
        await pg.tap('#shutter'); await pg.wait_for_timeout(2500)
        await pg.evaluate('Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));')
        await pg.wait_for_timeout(2500)
        await pg.evaluate('Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange"));')
        n3 = await pg.evaluate('__field.S.caps.filter(c => c.kind === "clip").length')
        check('leaving the app mid-clip saves it', n3 == after + 1, await toast(pg))

        # 11 · crash mid-clip → recovered on reopen
        await pg.wait_for_timeout(1000)
        await pg.tap('#shutter'); await pg.wait_for_timeout(7000)
        await pg.goto('about:blank'); await pg.wait_for_timeout(300)
        await enter(pg, None)
        await pg.tap('.resume'); await pg.wait_for_timeout(2500)
        rec = await pg.evaluate('__field.S.caps.filter(c => c.kind === "clip").map(c => [c.status, c.size, c.rows.length])')
        check('interrupted clip recovered after reopening', any(s == 'recovered' and sz > 10000 for s, sz, _ in rec), rec)
        check('no page errors', not errs, errs[:3])
        await c.close()

        # 12 · small phone layout
        c2 = await new_ctx(b, 360, 640); p2 = await c2.new_page()
        await enter(p2, 'Small')
        boxes = await p2.eval_on_selector_all('.tbtn, #shutter, .mode button, #cam-refresh', 'bs => bs.map(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)?.closest("button") === b; })')
        check('360×640: every control on screen and tappable', all(boxes), boxes)
        tb = await p2.evaluate('(() => { const t = document.getElementById("tilt").getBoundingClientRect(), d = document.getElementById("types").getBoundingClientRect(); return [t.bottom, d.top]; })()')
        check('360×640: tilt gauge clear of the dock', tb[0] < tb[1], tb)
        await p2.tap('.mode button[data-mode="video"]'); await p2.tap('#shutter'); await p2.wait_for_timeout(2200)
        await p2.screenshot(path=OUT + 's_small_rec.png')
        await p2.tap('#shutter'); await p2.wait_for_timeout(1500)
        await c2.close(); await b.close()
    bad = [r for r in results if not r[0]]
    print(f'\n{len(results) - len(bad)}/{len(results)} checks passed · screenshots in {OUT}')
    sys.exit(1 if bad else 0)

asyncio.run(main())
