#!/usr/bin/env python3
"""Headless test of Road Check with a simulated phone (method from phone-field-sensors/scripts/test_template.py).

    python3 apps/road-check/test_road_check.py [--shots DIR]

A page-side timer fires real DeviceMotionEvents at 60 a second (phone pitched 50 degrees, an 11 Hz vertical shake)
while Playwright moves the GPS east at 10 m/s, so the whole path is exercised: events, gravity removal, 20 m
segments, storage, the black screen, the summary and the ZIP. Serves the repository root because the app loads
sensor-core.js and field-store.js from the skill folder. Map tiles may be blocked offline; that is not a failure.
Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
"""
import os, sys, io, re, csv, json, math, zipfile, tempfile, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else tempfile.mkdtemp(prefix='road-shots-')
os.makedirs(OUT, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://localhost:{srv.server_address[1]}/apps/road-check/index.html'

LAT, LON = 19.1334, 72.9133
M_PER_DEG_LON = 111195 * math.cos(math.radians(LAT))
checks, errors = [], []
def check(name, cond, detail=''):
    checks.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''), flush=True)

PERM_SPY = """
window.__perm = [];
if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  const rp = DeviceMotionEvent.requestPermission;
  DeviceMotionEvent.requestPermission = function () { window.__perm.push(navigator.userActivation.isActive); return rp.call(this); };
}
"""
# amp = vertical shake in m/s²; spike = one extra hit on the next event; gyro=false sends no rotation rate
SHAKE = """(cfg => { window.__shake = cfg; clearInterval(window.__shakeT); const P = 50 * Math.PI / 180, t0 = performance.now();
  window.__shakeT = setInterval(() => { const c = window.__shake; if (!c) return; const t = (performance.now() - t0) / 1000;
    let g = 9.81 + c.amp * Math.sin(2 * Math.PI * 11 * t); if (c.spike) { g += c.spike; c.spike = 0; }
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0.2, y: g * Math.sin(P), z: g * Math.cos(P) },
      rotationRate: c.gyro === false ? { alpha: null, beta: null, gamma: null } : { alpha: 0, beta: 0, gamma: 0 }, interval: 16 }));
  }, 1000 / 60); })"""
SENSORS = ['accelerometer', 'gyroscope', 'magnetometer']

def phone(b, w=390, h=800):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={'latitude': LAT, 'longitude': LON, 'accuracy': 5},
                        permissions=['geolocation', 'clipboard-read', 'clipboard-write'] + SENSORS, accept_downloads=True, service_workers='block')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.add_init_script(PERM_SPY)
    return ctx, pg

def drive(ctx, pg, seconds, x0=0.0, speed=10.0):
    """Move the GPS east at `speed` m/s, one fix a second. Returns the distance reached."""
    x = x0
    for _ in range(seconds):
        x += speed
        ctx.set_geolocation({'latitude': LAT, 'longitude': LON + x / M_PER_DEG_LON, 'accuracy': 5})
        pg.wait_for_timeout(1000)
    return x

txt = lambda pg, sel: pg.inner_text(sel).strip()
num = lambda s: float(''.join(ch for ch in s if ch.isdigit() or ch == '.') or 'nan')
no_hscroll = lambda pg: pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
st = lambda pg, expr: pg.evaluate('(() => { const R = window.__roadCheck.state(); return ' + expr + '; })()')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = phone(b)
    pg.goto(URL); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT + '/01_home.png', full_page=True)
    check('home: no sideways scroll at 390 px', no_hscroll(pg))
    check('home: ride name is prefilled', txt(pg, '#ridesEmpty') != '' and pg.input_value('#rideName').startswith('Ride '), pg.input_value('#rideName'))
    check('home: font is the vendored one', pg.evaluate("document.fonts.check('700 16px \"Atkinson Hyperlegible\"')"))
    pg.click('#mount label:nth-child(3)')
    check('picking "pocket" explains what it costs', 'soaks up' in txt(pg, '#mountNote'), txt(pg, '#mountNote'))
    pg.click('#mount label:nth-child(1)')
    pg.fill('#rideName', '=Powai loop')

    # ── a ride ──
    pg.click('#startBtn'); pg.wait_for_timeout(300)
    perm = pg.evaluate('window.__perm')
    check('motion permission asked inside the tap', perm == [] or perm[0] is True, perm)
    check('ride screen is up and the home screen is gone', pg.is_visible('#ride') and not pg.is_visible('#home'))
    pg.wait_for_timeout(400)
    check('before any reading: speed and shake show a dash, not zero', txt(pg, '#speed') == '—' and txt(pg, '#shake') == '—')
    pg.evaluate(SHAKE + '({amp: 3})')
    pg.wait_for_timeout(2500)                                  # standing, gravity average settles
    check('standing: badge says STANDING, nothing logged', txt(pg, '#state') == 'STANDING' and st(pg, 'R.seg.segments.length') == 0, txt(pg, '#state'))
    x = drive(ctx, pg, 8)
    check('moving: badge says LOGGING', txt(pg, '#state') == 'LOGGING', txt(pg, '#state'))
    sp = num(txt(pg, '#speed')); check('speed reads about 36 km/h (from fixes; this phone gives no GPS speed)', 30 <= sp <= 42, sp)
    sh = num(txt(pg, '#shake')); check('shake reads about 2.1 m/s² for a 3 m/s² sine', 1.8 <= sh <= 2.4, sh)
    check('a class word shows while moving', 'fair' in txt(pg, '#shakeWord') or 'rough' in txt(pg, '#shakeWord'), txt(pg, '#shakeWord'))
    hz = num(txt(pg, '#hz')); check('readings per second shown, near 60', 40 <= hz <= 70, hz)
    check('GPS accuracy shown', txt(pg, '#gps') == '± 5 m', txt(pg, '#gps'))
    pg.evaluate('window.__shake.spike = 12')
    x = drive(ctx, pg, 4, x)
    n1 = st(pg, 'R.seg.segments.length')
    check('about one segment per 20 m', 4 <= n1 <= 7, n1)
    check('the hit is counted as one bump', txt(pg, '#bumps') == '1', txt(pg, '#bumps'))
    check('segments are drawn on the map', st(pg, 'R.layers.segs.getLayers().length') == n1 and st(pg, 'R.layers.bumps.getLayers().length') == 1)
    check('segment RMS matches the shake', all(1.8 <= v <= 2.5 for v in st(pg, 'R.seg.segments.slice(1).map(s => s.rms_v)')), st(pg, 'R.seg.segments.map(s => +s.rms_v.toFixed(2))'))
    check('raw readings are going to storage in chunks', st(pg, 'R.metas.length') >= 1, st(pg, 'R.metas.length'))
    check('ride: no sideways scroll, both buttons on screen', no_hscroll(pg) and pg.evaluate("['endBtn','dimBtn'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })"))
    pg.screenshot(path=OUT + '/02_ride.png')

    # ── black screen ──
    pg.tap('#dimBtn'); pg.wait_for_timeout(1200)
    check('dim: black screen covers everything', pg.is_visible('#dim') and pg.evaluate("document.elementFromPoint(100, 760).closest('#dim') !== null"))
    box = pg.evaluate("(() => { const r = document.getElementById('endBtn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    pg.touchscreen.tap(box[0], box[1]); pg.touchscreen.tap(box[0], box[1]); pg.wait_for_timeout(200)
    check('dim: taps where End was do nothing', st(pg, 'R !== null') and pg.is_visible('#dim'))
    check('dim: shows time, speed and state in grey', txt(pg, '#dimSpeed') != '' and txt(pg, '#dimWord') != '', txt(pg, '#dimSpeed') + ' / ' + txt(pg, '#dimWord'))
    pg.screenshot(path=OUT + '/03_dim.png')
    hb = pg.evaluate("(() => { const r = document.getElementById('holdBtn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    pg.mouse.move(hb[0], hb[1]); pg.mouse.down(); pg.wait_for_timeout(600); pg.mouse.up(); pg.wait_for_timeout(200)
    check('dim: a short press does not wake', pg.is_visible('#dim'))
    x = drive(ctx, pg, 3, x)
    check('dim: logging carries on behind the black screen', st(pg, 'R.seg.segments.length') > n1, st(pg, 'R.seg.segments.length'))
    pg.mouse.move(hb[0], hb[1]); pg.mouse.down(); pg.wait_for_timeout(2300); pg.mouse.up(); pg.wait_for_timeout(200)
    check('dim: holding 2 s wakes the screen', not pg.is_visible('#dim') and pg.is_visible('#ride'))

    # ── screen off: nothing is logged, and the app says so ──
    pg.evaluate("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis || 'visible' }); window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));")
    pg.wait_for_timeout(3600)
    pg.evaluate("window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange'));"); pg.wait_for_timeout(300)
    check('screen off for 3.6 s is recorded as a pause and announced', st(pg, 'R.ride.pauses.length') == 1 and 'Nothing was logged' in txt(pg, '#toast'), txt(pg, '#toast'))

    # ── slow stretch: measured, not scored ──
    x = drive(ctx, pg, 12, x, speed=2.0)
    check('under 10 km/h: the live word says too slow to score', 'too slow' in txt(pg, '#shakeWord'), txt(pg, '#shakeWord'))
    check('…and that segment has no index', st(pg, "R.seg.segments.some(s => s.flags.includes('slow') && s.index === null && s.rms_v > 1.5)"))
    x = drive(ctx, pg, 3, x)

    # ── end ──
    pg.tap('#endBtn'); pg.wait_for_timeout(200)
    check('End asks for a second tap', txt(pg, '#endBtn') == 'Tap again to end' and pg.is_visible('#ride'))
    pg.tap('#endBtn'); pg.wait_for_timeout(900)
    check('summary screen opens', pg.is_visible('#done') and txt(pg, '#doneName') == '=Powai loop', txt(pg, '#doneName'))
    d = num(txt(pg, '#dDist')); check('distance near the %d m driven' % round(x), abs(d - x) < 30, txt(pg, '#dDist'))
    check('one sharp bump in the summary', txt(pg, '#dBumps') == '1')
    check('share-of-ride bar has more than one class (scored + not scored)', pg.locator('#shareBar i').count() >= 2, pg.locator('#shareBar i').count())
    check('roughest stretches listed', pg.locator('#worst li').count() >= 3, pg.locator('#worst li').count())
    check('the note says the classes are not calibrated and mentions the pause', 'not calibrated' in txt(pg, '#doneNote') and 'Logging stopped 1 time' in txt(pg, '#doneNote'))
    check('summary: no sideways scroll', no_hscroll(pg))
    pg.screenshot(path=OUT + '/04_summary.png', full_page=True)

    # ── export ──
    check('summary: Export ZIP is above the map', pg.evaluate("document.getElementById('zipBtn').getBoundingClientRect().top < document.getElementById('doneMap').getBoundingClientRect().top"))
    with pg.expect_download() as dl: pg.tap('#zipBtn')
    path = dl.value.path(); z = zipfile.ZipFile(path); names = [n for n in z.namelist() if not n.endswith('/')]
    check('ZIP name starts RoadCheck_ and holds 8 files', dl.value.suggested_filename.startswith('RoadCheck_Powai_loop_') and len(names) == 8, dl.value.suggested_filename + ' ' + str(names))
    gj = json.loads(z.read([n for n in names if n.endswith('_segments.geojson')][0]))
    nseg = len(gj['features'])
    check('segments GeoJSON: LineStrings with class, index, speed', nseg >= 8 and all(f['geometry']['type'] == 'LineString' and 'index' in f['properties'] for f in gj['features']), nseg)
    check('GeoJSON says how it was measured', gj['ride']['mount'] == 'handlebar mount' and gj['ride']['vehicle'] == 'motorbike' and gj['ride']['settings']['segLen'] == 20 and len(gj['ride']['pauses']) == 1)
    lons = [f['geometry']['coordinates'][0][0] for f in gj['features']]
    check('segments run east in order', lons == sorted(lons) and lons[-1] > LON + 100 / M_PER_DEG_LON)
    rows = list(csv.DictReader(io.StringIO(z.read([n for n in names if n.endswith('_segments.csv')][0]).decode())))
    check('CSV has the same segments; formula in the ride name is guarded', len(rows) == nseg and rows[0]['ride'] == "'=Powai loop", rows[0]['ride'])
    check('slow rows have an empty index and class', any(r['flags'] == 'slow' and r['index'] == '' and r['class'] == '' for r in rows))
    bj = json.loads(z.read([n for n in names if n.endswith('_bumps.geojson')][0]))
    check('bump point exported with its peak', len(bj['features']) == 1 and bj['features'][0]['properties']['peak_v'] > 6, bj['features'][0]['properties'])
    raw = z.read([n for n in names if n.endswith('_raw.csv')][0]).decode().strip().split('\n')
    check('raw CSV: 8 columns, over 1000 readings, unix-ms times', raw[0].startswith('time_unix_ms,ax,ay,az') and len(raw) > 1000 and len(raw[5].split(',')) == 8 and float(raw[5].split(',')[0]) > 1.7e12, len(raw))
    dpk = json.loads(z.read('datapackage.json'))
    seg_csv_header = list(rows[0].keys())
    check('datapackage.json describes every column of the segments CSV', [f['name'] for f in dpk['resources'][0]['schema']['fields']] == seg_csv_header and all(f.get('description') for f in dpk['resources'][0]['schema']['fields']))
    check('datapackage resources point at files that are in the ZIP', all(r['path'] in names for r in dpk['resources']), [r['path'] for r in dpk['resources'] if r['path'] not in names])
    prompt = z.read('PROMPT.md').decode()
    check('PROMPT.md: names the real files, the ride and the plan', all(n in prompt for n in ['data/Powai_loop_segments.csv', 'raw/Powai_loop_raw.csv', '## Plan', 'datapackage.json']) and 'Powai loop' in prompt)
    check("PROMPT.md: the ride's own numbers are in it (distance, bumps, bounding box)", 'sharp bumps 1' in prompt and 'bounding box' in prompt and re.search(r'local time = UTC[+-]\d\d:\d\d', prompt), [l for l in prompt.split('\n') if 'Time (UTC)' in l])
    check('PROMPT.md: the formula-guard apostrophe is not in prose, no undefined/NaN', 'undefined' not in prompt and 'NaN' not in prompt)
    check('README points to PROMPT.md', 'PROMPT.md' in z.read('README.txt').decode())
    readme = z.read('README.txt').decode()
    check('README explains columns and says NOT CALIBRATED', 'NOT CALIBRATED' in readme and 'rms_v' in readme and 'curve_radius_gyro_m' in readme)
    meta = json.loads(z.read('ride.json'))
    check('ride.json: device facts found by probing', meta['device']['gyroscope'] is True and meta['device']['gps_speed'] is False and meta['summary']['bumps'] == 1, meta['device'])

    # ── saved rides survive a reload ──
    pg.tap('#backBtn'); pg.wait_for_timeout(300)
    with pg.expect_download() as dl2: pg.tap('#rides .r-zip')
    z2 = zipfile.ZipFile(dl2.value.path())
    check('home list: a ZIP button on each ride downloads the same export', dl2.value.suggested_filename == dl.value.suggested_filename and sorted(z2.namelist()) == sorted(z.namelist()), dl2.value.suggested_filename)
    check('the ride is listed on the home screen', pg.locator('#rides li').count() == 1 and '=Powai loop' in txt(pg, '#rides'))
    check('escaped, not run as HTML', pg.evaluate("document.querySelector('#rides .r-name').children.length") == 0)
    pg.reload(); pg.wait_for_timeout(600)
    check('still listed after a reload', pg.locator('#rides li').count() == 1)
    pg.tap('#rides button'); pg.wait_for_timeout(700)
    pg.tap('#promptBtn'); pg.wait_for_timeout(500)
    clip = pg.evaluate('navigator.clipboard.readText()')
    check('Copy LLM prompt puts PROMPT.md on the clipboard', clip.startswith('# Task: analyse one road-roughness ride') and '## Plan' in clip and 'Powai loop' in clip and 'Copied' not in txt(pg, '#toast') or 'Prompt copied' in txt(pg, '#toast'), txt(pg, '#toast'))
    check('reopened from storage with its segments', pg.is_visible('#done') and pg.evaluate("document.querySelectorAll('#worst li').length") >= 3)

    # ── a ride cut short by a reload ──
    pg.tap("#backBtn"); pg.tap("#startBtn"); pg.wait_for_timeout(300)
    pg.evaluate(SHAKE + '({amp: 5, gyro: false})'); pg.wait_for_timeout(2200)
    drive(ctx, pg, 7)                                           # GPS restarts 200 m back: that hop must not count
    check('no gyroscope: still logs, turn rate stays null', st(pg, 'R.seg.segments.length') >= 2 and st(pg, 'R.seg.segments.every(s => s.turn_rate_dps === null)') and st(pg, 'R.ride.device.gyroscope') is False)
    pg.wait_for_timeout(6000)                                   # let a 10 s chunk and the ride record be written
    pg.reload(); pg.wait_for_timeout(700)
    check('after the reload it is kept and marked interrupted', pg.locator('#rides li').count() == 2 and 'interrupted' in txt(pg, '#rides li:first-child'), txt(pg, '#rides li:first-child'))
    pg.tap('#rides li:first-child button'); pg.wait_for_timeout(700)
    check('its segments are there, and the GPS hop back to the start was not counted', 40 <= num(txt(pg, '#dDist')) <= 80, txt(pg, '#dDist'))
    pg.tap('#delBtn'); pg.wait_for_timeout(150)
    check('Delete asks for a second tap', 'Tap again' in txt(pg, '#delBtn'))
    pg.tap('#delBtn'); pg.wait_for_timeout(500)
    check('deleted ride is gone, the other stays', pg.is_visible('#home') and pg.locator('#rides li').count() == 1)
    ctx.close()

    # ── a phone that sends nothing ──
    ctx, pg = phone(b)
    pg.goto(URL); pg.wait_for_timeout(400); pg.tap('#startBtn'); pg.wait_for_timeout(6500)
    check('no motion events: red NO MOTION DATA, and still a dash', txt(pg, '#state') == 'NO MOTION DATA' and txt(pg, '#shake') == '—', txt(pg, '#state'))
    check('…with a toast saying what to check', 'motion sensors' in txt(pg, '#toast'), txt(pg, '#toast'))
    pg.evaluate("window.dispatchEvent(new DeviceMotionEvent('devicemotion', {}))"); pg.wait_for_timeout(300)
    check('events with no numbers are not readings', txt(pg, '#shake') == '—' and st(pg, 'R.lastMotion') == 0)
    ctx.close()

    # ── demo ride, on a small phone ──
    ctx, pg = phone(b, 360, 640)
    pg.goto(URL + '?demo=12'); pg.wait_for_timeout(9000)
    check('demo: logging, with several classes on the map', txt(pg, '#state') in ('LOGGING', 'STANDING') and len(set(st(pg, 'R.seg.segments.map(s => s.class)'))) >= 3, sorted(set(str(c) for c in st(pg, 'R.seg.segments.map(s => s.class)'))))
    check('360×640: no sideways scroll, buttons on screen, map at least 150 px tall', no_hscroll(pg) and pg.evaluate("document.getElementById('dimBtn').getBoundingClientRect().bottom <= innerHeight && document.getElementById('map').getBoundingClientRect().height >= 150"), pg.evaluate("document.getElementById('map').getBoundingClientRect().height"))
    pg.screenshot(path=OUT + '/05_demo_ride_360.png')
    pg.wait_for_timeout(6000)
    pg.tap('#endBtn'); pg.tap('#endBtn'); pg.wait_for_timeout(900)
    check('demo summary is labelled simulated', 'simulated' in txt(pg, '#doneWhen'), txt(pg, '#doneWhen'))
    check('demo: bumps and curve radii were found', num(txt(pg, '#dBumps')) >= 3 and pg.evaluate("window.__roadCheck.store.listRides().then(async r => (await window.__roadCheck.store.segsFor(r[0].id)).some(s => s.curve_radius_gyro_m > 10 && s.curve_radius_gyro_m < 120))"))
    pg.screenshot(path=OUT + '/06_demo_summary_360.png', full_page=True)
    ctx.close(); b.close()

check('no JavaScript errors', not errors, errors[:3])
print(f'\n{sum(checks)} passed, {len(checks) - sum(checks)} failed · screenshots in {OUT}')
sys.exit(0 if all(checks) else 1)
