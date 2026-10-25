#!/usr/bin/env python3
"""Headless end-to-end test of the starter capture app (assets/template).

Copies the template to a temp folder, vendors Leaflet/JSZip/font into it, serves it, and drives
headless Chromium with a fake camera, mocked GPS and synthetic orientation events — the same
event types a phone sends. Modelled on FloodView's tests/test_capture.py.

    python3 scripts/test_template.py [--app DIR] [--shots DIR]

--app DIR  test an existing app folder instead of the template (it must already have vendor/)
--shots    where screenshots go (default: a temp folder, printed at the end)
Needs: python3 -m pip install playwright && python3 -m playwright install chromium; node + npm.
"""
import sys, os, json, math, shutil, tempfile, threading, subprocess, zipfile, argparse, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('--app'); ap.add_argument('--shots'); a = ap.parse_args()
OUT = a.shots or tempfile.mkdtemp(prefix='fc-shots-'); os.makedirs(OUT, exist_ok=True)
if a.app:
    APP = os.path.abspath(a.app)
else:
    APP = os.path.join(tempfile.mkdtemp(prefix='fc-app-'), 'app')
    shutil.copytree(os.path.join(HERE, '..', 'assets', 'template'), APP)
    subprocess.run(['node', os.path.join(HERE, 'vendor_libs.mjs'), APP, '--font', 'atkinson-hyperlegible:400,700'], check=True, stdout=subprocess.DEVNULL)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=APP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://localhost:{srv.server_address[1]}'
print('serving', APP, 'at', BASE, flush=True)

LAT, LON = 18.1960, 74.9060           # a field near Loni, Maharashtra
checks, errors = [], []
def check(name, cond, detail=''):
    checks.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''))

# Chromium now ships DeviceOrientationEvent.requestPermission (and DeviceMotionEvent's) on Android too.
# Wrap the real one to record whether the app called it while the tap's user activation was still live,
# i.e. synchronously, before any await. The browser answers from the context's sensor permissions.
PERM_SPY = """
window.__perm = [];
const __rp = DeviceOrientationEvent.requestPermission;
if (typeof __rp === 'function') DeviceOrientationEvent.requestPermission = function () { window.__perm.push(navigator.userActivation.isActive); return __rp.call(this); };
"""
SENSORS = ['accelerometer', 'gyroscope', 'magnetometer']
ORI = """(o => { window.__ori = o; clearInterval(window.__oriTimer);
  window.__oriTimer = setInterval(() => { const v = window.__ori; if (!v) return;
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {alpha:v.alpha, beta:v.beta, gamma:v.gamma, absolute:true}));
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha:v.alpha, beta:v.beta, gamma:v.gamma, absolute:false}));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', {}));
  }, 60); })"""
LAUNCH = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--force-color-profile=srgb']

def phone(b, sensors=True, **kw):
    ctx = b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={'latitude': LAT, 'longitude': LON, 'accuracy': 5}, permissions=['geolocation', 'camera'] + (SENSORS if sensors else []),
                        accept_downloads=True, service_workers='allow', **kw)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch(args=LAUNCH)
    ctx, pg = phone(b)
    pg.add_init_script(PERM_SPY)
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(800)
    pg.screenshot(path=OUT + '/01_allow.png')
    pg.click('#allow')
    check('motion permission asked inside the tap (before any await)', pg.evaluate('window.__perm') == [True], pg.evaluate('window.__perm'))
    pg.wait_for_timeout(300)
    check('permission granted by the browser', pg.evaluate('__field.C.perm') == 'granted', pg.evaluate('__field.C.perm'))
    pg.evaluate(ORI + '({alpha:270, beta:70, gamma:0})')       # rear camera looking EAST, 70° from straight down
    pg.fill('#pname', 'Loni East #1'); pg.fill('#pnotes', 'smoke test')
    pg.screenshot(path=OUT + '/02_session.png')
    pg.click('#start-btn'); pg.wait_for_timeout(2500)
    st = pg.evaluate("({name:__field.S.proj.name, lat:__field.S.fix&&__field.S.fix.lat, h:__field.C.heading, t:__field.C.tilt, src:__field.C.src, plat:__field.C.platform, vw:document.getElementById('video').videoWidth})")
    check('survey name made file-safe', st['name'] == 'Loni_East__1', st['name'])
    check('GPS fix', st['lat'] and abs(st['lat'] - LAT) < 1e-6, st['lat'])
    check('Android with requestPermission still reads absolute events', round(st['h']) == 90 and st['plat'] == 'android', st)
    check('tilt 70 from beta 70', st['t'] == 70, st['t'])
    check('SRC COMPASS', st['src'] == 'COMPASS', st['src'])
    check('camera stream live', st['vw'] > 0, st['vw'])
    pg.wait_for_timeout(400)
    check('HUD shows heading and source', 'HDG 90° E' in pg.inner_text('#h-hdg') and pg.inner_text('#h-src') == 'SRC COMPASS')
    exp_d = 1.5 * math.tan(math.radians(70))
    check('AIM tag = H·tan(tilt)', pg.inner_text('#aim-tag').startswith(f'AIM {exp_d:.1f} m'), pg.inner_text('#aim-tag'))
    check('tilt bar label FAR? no — 70° is inside 40–80°', pg.inner_text('#tilt-lbl') == '✓ AIM', pg.inner_text('#tilt-lbl'))
    pg.screenshot(path=OUT + '/03_camera.png')

    pg.click('.cbtn[data-cls=feature]'); pg.wait_for_timeout(1200)
    ctx.set_geolocation({'latitude': LAT + 0.000225, 'longitude': LON, 'accuracy': 5}); pg.wait_for_timeout(1500)
    pg.evaluate("window.__ori={alpha:135, beta:88, gamma:0}"); pg.wait_for_timeout(600)   # SW, near horizon
    pg.click('.cbtn[data-cls=ground]'); pg.wait_for_timeout(1200)
    pg.evaluate("window.__ori={alpha:0, beta:20, gamma:0}"); pg.wait_for_timeout(600)     # at your feet, facing north
    pg.click('.cbtn[data-cls=feature]'); pg.wait_for_timeout(1200)
    caps = pg.evaluate("__field.S.caps.slice().reverse().map(c=>({cls:c.cls,h:c.heading,t:c.tilt,aim:c.aim,fp:c.fp,ring:!!c.ring,src:c.headingSrc}))")
    check('3 captures in order', [c['cls'] for c in caps] == ['feature', 'ground', 'feature'], [c['cls'] for c in caps])
    check('capture 1: heading 90, aim east, footprint', caps[0]['h'] == 90 and caps[0]['aim'] and caps[0]['ring'])
    check('capture 2: heading 225 (SW), tilt 88 → no aim point, far edge clipped', caps[1]['h'] == 225 and caps[1]['aim'] is None and caps[1]['fp'] and caps[1]['fp']['farCapped'], caps[1])
    check('capture 3: tilt 20 heading 0', caps[2]['h'] == 0 and caps[2]['t'] == 20, caps[2])
    nph = pg.evaluate("Promise.all(__field.S.caps.map(c=>__field.store.getPhoto(c.id))).then(a=>a.filter(b=>b&&b.size>1000).length)")
    check('full-resolution photos in IndexedDB', nph == 3, nph)
    check('not the memory fallback', pg.evaluate('__field.store.mem') is False)

    # watchdog: stop the stream — the label must say so, the last heading is held, never invented
    pg.evaluate("window.__ori=null"); pg.wait_for_timeout(3300)
    s1 = pg.evaluate("[__field.C.src, __field.C.heading]")
    pg.wait_for_timeout(5500)
    s2 = pg.evaluate("[__field.C.src, __field.C.heading, __field.C.signal]")
    check('stream stops → STALE·HOLD within 3 s, heading held', s1[0] == 'STALE·HOLD' and round(s1[1]) == 0, s1)
    check('… → SIGNAL LOST by 8 s, still holding last heading', s2[0] == 'SIGNAL LOST' and s2[2] == 'LOST' and round(s2[1]) == 0, s2)
    pg.screenshot(path=OUT + '/04_camera_lost.png')
    pg.evaluate("window.__ori={alpha:270, beta:70, gamma:0}"); pg.wait_for_timeout(1500)
    check('stream back → COMPASS again', pg.evaluate('__field.C.src') == 'COMPASS')

    pg.click('.tab[data-tab=map]'); pg.wait_for_timeout(1500)
    lay = pg.evaluate("({cone:!!__field.S.layers.cone, live:!!__field.S.layers.live, aim:!!__field.S.layers.aim, fp:__field.S.layers.fp.getLayers().length})")
    check('map: live cone, live footprint, aim point, saved footprints', lay['cone'] and lay['live'] and lay['aim'] and lay['fp'] == 3, lay)
    pg.screenshot(path=OUT + '/05_map.png')
    pg.click('.tab[data-tab=data]'); pg.wait_for_timeout(700)
    check('data panel: drop-worst GPS note', 'worst dropped' in pg.inner_text('#kv'))
    pg.screenshot(path=OUT + '/06_data.png', full_page=True)

    # a note that a spreadsheet would execute
    pg.evaluate("__field.S.caps[0].note='=HYPERLINK(\"http://x\")'")
    with pg.expect_download() as d:
        pg.click('#b-zip')
    zpath = os.path.join(OUT, 'export.zip'); d.value.save_as(zpath)
    z = zipfile.ZipFile(zpath); names = z.namelist()
    pts = json.loads(z.read([n for n in names if n.endswith('_captures_points.geojson')][0]))
    fps = json.loads(z.read([n for n in names if n.endswith('_captures_footprints.geojson')][0]))
    csvt = z.read([n for n in names if n.endswith('_captures.csv')][0]).decode()
    pr = [f['properties'] for f in pts['features']]
    check('ZIP: 3 images named as in the records', len([n for n in names if n.startswith('images/') and n.endswith('.jpg')]) == 3 and all(('images/' + x['imgName']) in names for x in pr))
    check('ZIP: README', 'README.txt' in names)
    check('points: chronological, heading/tilt/aim fields', [x['heading_deg'] for x in pr] == [90, 225, 0] and pr[0]['aim_dist_m'] == round(exp_d, 2), [x['heading_deg'] for x in pr])
    check('points: fov_polygon member (CropView-compatible)', 'fov_polygon' in pts['features'][0])
    check('footprints: 3 polygons', len(fps['features']) == 3 and fps['features'][0]['geometry']['type'] == 'Polygon')
    check('CSV: header + 3 rows', len(csvt.strip().split('\n')) == 4)
    check('CSV: formula neutralised', "'=HYPERLINK" in csvt, [l for l in csvt.split('\n') if 'HYPERLINK' in l][:1])
    check('metadata: app + version', pts['metadata']['app'] == 'Field Camera' and pts['metadata']['version'] == '1.0.0')
    ok_run = subprocess.run([sys.executable, os.path.join(HERE, 'check_export_zip.py'), zpath], capture_output=True, text=True)
    check('check_export_zip.py passes the export', ok_run.returncode == 0, ok_run.stdout.strip().split('\n')[0])
    bad = os.path.join(OUT, 'bad.zip')                    # the old bugs: altitude as height, tilt default 45, raw formula
    with zipfile.ZipFile(bad, 'w') as bz:
        feats = [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [74.9, 18.2]},
                  'properties': {'id': f'X{i}', 'heading_deg': 0, 'heading_source': 'COMPASS', 'tilt_deg': 45, 'camera_height_m': 650}} for i in range(6)]
        bz.writestr('data/x_captures_points.geojson', json.dumps({'type': 'FeatureCollection', 'features': feats}))
        bz.writestr('data/x_captures.csv', 'id,note\nX0,=SUM(A1)\n')
    bad_run = subprocess.run([sys.executable, os.path.join(HERE, 'check_export_zip.py'), bad], capture_output=True, text=True)
    check('check_export_zip.py flags altitude-as-height, tilt default, raw formula', bad_run.returncode == 1 and 'GPS altitude' in bad_run.stdout and 'exactly 45' in bad_run.stdout and 'formula' in bad_run.stdout)

    # two-tap share: the first tap's activation expires while the ZIP builds
    pg.evaluate("""(() => { window.__shares = [];
      navigator.canShare = () => true;
      navigator.share = () => { const live = navigator.userActivation.isActive; window.__shares.push(live);
        return live && window.__shares.length > 1 ? Promise.resolve() : Promise.reject(Object.assign(new Error('Permission denied'), {name:'NotAllowedError'})); };
      document.getElementById('b-share').hidden = false; })()""")
    pg.evaluate("window.__slow = JSZip.prototype.generateAsync; JSZip.prototype.generateAsync = function(o){ return new Promise(r => setTimeout(() => r(window.__slow.call(this, o)), 5500)); }; 0")   # end with a value: returning a function hangs evaluate()
    pg.click('#b-share'); pg.wait_for_timeout(7000)
    lbl1 = pg.inner_text('#b-share')
    pg.click('#b-share'); pg.wait_for_timeout(500)
    check('share: 1st tap expires while building → button says Tap to share', lbl1 == 'Tap to share', lbl1)
    check('share: 2nd tap calls share() with live activation, then resets', pg.evaluate('window.__shares') == [False, True] and pg.inner_text('#b-share') == 'Share ZIP', pg.evaluate('window.__shares'))
    pg.evaluate("JSZip.prototype.generateAsync = window.__slow; 0")

    # reload → resume → everything still there
    pg.evaluate("clearInterval(window.__oriTimer)")
    pg.reload(); pg.wait_for_timeout(1000)
    pg.click('#allow'); pg.evaluate(ORI + '({alpha:270, beta:70, gamma:0})'); pg.wait_for_timeout(600)
    check('resume list shows the survey', pg.locator('.resume:has-text("Loni_East__1")').count() == 1)
    pg.screenshot(path=OUT + '/07_resume.png')
    pg.click('.resume:has-text("Loni_East__1")'); pg.wait_for_timeout(1500)
    after = pg.evaluate("({n:__field.S.caps.length, notes:__field.S.proj.notes})")
    nph = pg.evaluate("Promise.all(__field.S.caps.map(c=>__field.store.getPhoto(c.id))).then(a=>a.filter(b=>b&&b.size>1000).length)")
    check('resumed with 3 captures and photos', after['n'] == 3 and nph == 3 and after['notes'] == 'smoke test', after)
    controlled = pg.evaluate("!!(navigator.serviceWorker && navigator.serviceWorker.controller)")
    check('service worker controls the page', controlled)

    # offline: cut the network, reload, the app must still open with its libraries and font
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_timeout(1200)
    r = pg.evaluate("({title:document.title, leaflet:typeof L!=='undefined', jszip:typeof JSZip!=='undefined', core:typeof FieldSensors!=='undefined', font:document.fonts.check('16px \"Atkinson Hyperlegible\"')})")
    check('offline reload: app, Leaflet, JSZip, sensor core, font', r['leaflet'] and r['jszip'] and r['core'] and r['font'] and r['title'] == 'Field Camera', r)
    ctx.close()

    # sensors blocked: the browser says no, and the badge must say so instead of showing a heading
    ctx, pg = phone(b, sensors=False); pg.goto(BASE + '/index.html'); pg.wait_for_timeout(500)
    pg.click('#allow'); pg.wait_for_timeout(800)
    blk = pg.evaluate("[__field.C.perm, __field.C.src, __field.C.heading, document.getElementById('toast').textContent]")
    check('blocked sensors → SENSORS BLOCKED, no heading, a toast with the fix', blk[0] == 'denied' and blk[1] == 'SENSORS BLOCKED' and blk[2] is None and 'blocked' in blk[3].lower(), blk)
    ctx.close()

    # relative-only stream (no absolute events, no webkitCompassHeading): tilt yes, compass never
    ctx, pg = phone(b); pg.goto(BASE + '/index.html'); pg.wait_for_timeout(500)
    pg.click('#allow')
    pg.evaluate("setInterval(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:123,beta:45,gamma:0,absolute:false})),60)")
    pg.wait_for_timeout(800)
    rel = pg.evaluate("[__field.C.heading, __field.C.tilt, __field.C.src]")
    check('relative alpha never becomes a compass; tilt still read', rel[0] is None and rel[1] == 45 and rel[2] in ('SIGNAL LOST', 'NO SENSOR DATA'), rel)
    ctx.close()

    # iOS-shaped events: webkitCompassHeading on plain deviceorientation
    ctx, pg = phone(b); pg.goto(BASE + '/index.html'); pg.wait_for_timeout(500)
    pg.click('#allow')
    pg.evaluate("""setInterval(()=>{ const e=new Event('deviceorientation'); Object.assign(e,{alpha:10,beta:80,gamma:0,webkitCompassHeading:123,webkitCompassAccuracy:-1}); window.dispatchEvent(e); },60)""")
    pg.wait_for_timeout(800)
    ios = pg.evaluate("[__field.C.heading, __field.C.platform, __field.C.src]")
    check('iOS heading used as is, accuracy −1 flagged low-confidence', round(ios[0]) == 123 and ios[1] == 'ios' and ios[2] == 'COMPASS·LOW-CONF', ios)
    ctx.close()
    b.close()

srv.shutdown()
print('\npage errors:', errors or 'none')
print('screenshots:', OUT)
print(f'\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) and not errors else 1)
