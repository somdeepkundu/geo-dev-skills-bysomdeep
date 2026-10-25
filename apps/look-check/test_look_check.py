#!/usr/bin/env python3
"""Headless test of Look Check with synthetic sensors (method from phone-field-sensors/scripts/test_template.py).

    python3 apps/look-check/test_look_check.py

Serves the repository root, because the app loads sensor-core.js and field-store.js from the skill folder.
Checks: permission asked inside the tap; heading and tilt from a known pose; a map tap sets the target and the
true bearing; recorded error is 0 when aimed at the target and +10 when turned 10° right; the gimbal-lock twin
poses read the same; tilt checks; CSV export; the log survives a reload; iOS-shaped events; no invented heading
when sensors send nothing; no horizontal scroll at phone width. Map tiles may be blocked offline; that is not a failure.
Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
"""
import os, sys, csv, io, math, tempfile, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = tempfile.mkdtemp(prefix='look-shots-')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://localhost:{srv.server_address[1]}/apps/look-check/index.html'

LAT, LON = 19.1334, 72.9133            # IIT Bombay campus
EAST_200M = (LAT, LON + 200 / (111195 * math.cos(math.radians(LAT))))
checks, errors = [], []
def check(name, cond, detail=''):
    checks.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''), flush=True)

PERM_SPY = """
window.__perm = [];
const __rp = DeviceOrientationEvent.requestPermission;
if (typeof __rp === 'function') DeviceOrientationEvent.requestPermission = function () { window.__perm.push(navigator.userActivation.isActive); return __rp.call(this); };
"""
ORI = """(o => { window.__ori = o; clearInterval(window.__oriTimer);
  window.__oriTimer = setInterval(() => { const v = window.__ori; if (!v) return;
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {alpha:v.alpha, beta:v.beta, gamma:v.gamma, absolute:true}));
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha:v.alpha, beta:v.beta, gamma:v.gamma, absolute:false}));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', {}));
  }, 60); })"""
SENSORS = ['accelerometer', 'gyroscope', 'magnetometer']
LAUNCH = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

def phone(b, sensors=True):
    ctx = b.new_context(viewport={'width': 390, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={'latitude': LAT, 'longitude': LON, 'accuracy': 4},
                        permissions=['geolocation', 'camera'] + (SENSORS if sensors else []), accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script(PERM_SPY)
    return ctx, pg

def settle(pg, ms=1300): pg.wait_for_timeout(ms)   # > 1 s, so the recording window holds only the new pose
txt = lambda pg, sel: pg.inner_text(sel).strip()

with sync_playwright() as p:
    b = p.chromium.launch(args=LAUNCH)
    ctx, pg = phone(b)
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '/01_start.png', full_page=True)
    pg.click('#startBtn'); pg.wait_for_timeout(300)
    perm = pg.evaluate('window.__perm')
    check('motion permission asked inside the tap', perm == [] or perm[0] is True, perm)

    # Known pose: α 270, β 70, γ 0 → camera heading 90° (east), tilt 70°
    pg.evaluate(ORI + '({alpha:270, beta:70, gamma:0})'); settle(pg)
    check('heading 090° from α270 β70 γ0', txt(pg, '#hdg') == '090°', txt(pg, '#hdg'))
    check('tilt 70° from β70 γ0', txt(pg, '#tilt') == '70°', txt(pg, '#tilt'))
    check('signal badge says COMPASS', txt(pg, '#src') == 'COMPASS', txt(pg, '#src'))
    check('platform detected from the events (android)', 'android' in txt(pg, '#plat'), txt(pg, '#plat'))
    check('GPS fix shown', '±' in txt(pg, '#gps'), txt(pg, '#gps'))

    # Tap the map 200 m east of us to set the target, the way a person would
    pg.locator('#map').scroll_into_view_if_needed()
    pg.evaluate(f'__look.S.map.setView([{LAT}, {LON}], 16, {{animate: false}})'); pg.wait_for_timeout(400)   # 200 m ≈ 90 px: inside the map
    pt = pg.evaluate(f"(() => {{ const m = __look.S.map, q = m.latLngToContainerPoint([{EAST_200M[0]}, {EAST_200M[1]}]), r = m.getContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }})()")
    pg.mouse.click(pt[0], pt[1]); pg.wait_for_timeout(400)
    tgt = pg.evaluate('__look.S.target')
    check('map tap sets the target', tgt is not None and abs(tgt['lat'] - EAST_200M[0]) < 2e-5 and abs(tgt['lon'] - EAST_200M[1]) < 2e-5, tgt)
    check('true bearing ≈ 90°', txt(pg, '#tBrg') in ('90°', '89°', '91°'), txt(pg, '#tBrg'))
    check('distance ≈ 200 m', txt(pg, '#tDist') in ('199 m', '200 m', '201 m'), txt(pg, '#tDist'))
    check('error shown as 0°', txt(pg, '#tErr') in ('0°', '+0°', '-0°'), txt(pg, '#tErr'))
    check('Record enabled with target and heading', pg.is_enabled('#recBtn'))
    pg.click('#recBtn'); pg.wait_for_timeout(200)
    r0 = pg.evaluate('__look.S.log[0]')
    check('recorded aim error ≈ 0°', r0['kind'] == 'aim' and abs(r0['error_deg']) < 0.6, round(r0['error_deg'], 2))
    check('recording averaged several samples with no wobble', r0['samples'] >= 5 and r0['heading_spread_deg'] < 0.01, (r0['samples'], r0['heading_spread_deg']))
    check('GPS bearing uncertainty recorded (atan(acc/dist))', 0.5 < r0['target_bearing_unc_deg'] < 2, round(r0['target_bearing_unc_deg'], 2))

    # Turn 10° clockwise: α 260 → heading 100 → error +10, "right of true"
    pg.evaluate(ORI + '({alpha:260, beta:70, gamma:0})'); settle(pg)
    check('turned 10° right: error +10°', txt(pg, '#tErr') == '+10°', txt(pg, '#tErr'))
    check('says compass reads right of true', 'right' in txt(pg, '#tSide'), txt(pg, '#tSide'))
    pg.click('#recBtn'); pg.wait_for_timeout(200)
    check('recorded +10°', abs(pg.evaluate('__look.S.log[0].error_deg') - 10) < 0.6, round(pg.evaluate('__look.S.log[0].error_deg'), 2))

    # Gimbal-lock twins: the same physical pose must read the same (rule 1)
    pg.evaluate(ORI + '({alpha:40, beta:88, gamma:10})'); settle(pg, 700); h1 = txt(pg, '#hdg')
    pg.evaluate(ORI + '({alpha:220, beta:92, gamma:-170})'); settle(pg, 700); h2 = txt(pg, '#hdg')
    check('gimbal-lock twin poses read the same heading', h1 == h2 == '310°', (h1, h2))

    # Tilt checks: flat on a table (rear camera straight down) and upright
    pg.evaluate(ORI + '({alpha:0, beta:0, gamma:0})'); settle(pg)
    pg.click('#flatBtn'); pg.wait_for_timeout(200)
    t0 = pg.evaluate('__look.S.log[0]')
    check('flat check: tilt 0°', t0['kind'] == 'tilt' and abs(t0['tilt_error_deg']) < 0.6, round(t0['tilt_deg'], 2))
    pg.evaluate(ORI + '({alpha:0, beta:90, gamma:0})'); settle(pg)
    pg.click('#upBtn'); pg.wait_for_timeout(200)
    t90 = pg.evaluate('__look.S.log[0]')
    check('upright check: tilt 90°', abs(t90['tilt_error_deg']) < 0.6, round(t90['tilt_deg'], 2))
    pg.evaluate(ORI + '({alpha:0, beta:0, gamma:60})'); settle(pg, 600)
    check('landscape tilt uses γ too (β0 γ60 → 60°)', txt(pg, '#tilt') == '60°', txt(pg, '#tilt'))

    summary = txt(pg, '#summary')
    check('summary counts aims and tilt checks', '2 aims' in summary and '2 tilt checks' in summary, summary)

    pg.evaluate("document.querySelector('details').open = true"); pg.wait_for_timeout(300)
    raw = txt(pg, '#raw')
    check('raw panel shows α β γ and event rates', 'absolute α β γ' in raw and 'events per second' in raw)
    pg.screenshot(path=OUT + '/02_running.png', full_page=True)

    with pg.expect_download() as d:
        pg.click('#csvBtn')
    rows = list(csv.reader(io.StringIO(open(d.value.path()).read())))
    check('CSV: header + 4 rows, oldest first', len(rows) == 5 and rows[0][0] == 'time' and rows[1][1] == 'aim', (len(rows), rows[1][1] if len(rows) > 1 else None))
    hdr = rows[0]
    check('CSV: error and uncertainty columns', 'error_deg' in hdr and 'target_bearing_unc_deg' in hdr and 'heading_spread_deg' in hdr)
    check('CSV: first aim error ≈ 0', abs(float(rows[1][hdr.index('error_deg')])) < 0.6)

    pg.reload(); pg.wait_for_timeout(600)
    check('log survives a reload', '2 aims' in txt(pg, '#summary'), txt(pg, '#summary'))
    overflow = pg.evaluate('document.documentElement.scrollWidth > innerWidth')
    check('no horizontal scroll at 390 px', not overflow)
    ctx.close()

    # iOS-shaped events: webkitCompassHeading on plain deviceorientation
    ctx, pg = phone(b)
    pg.goto(URL); pg.click('#startBtn')
    pg.evaluate("""setInterval(()=>{ const e=new Event('deviceorientation'); Object.assign(e,{alpha:10,beta:80,gamma:0,webkitCompassHeading:123,webkitCompassAccuracy:8}); window.dispatchEvent(e); },60)""")
    settle(pg, 900)
    check('iOS: uses webkitCompassHeading as is', txt(pg, '#hdg') == '123°', txt(pg, '#hdg'))
    check('iOS: platform ios', 'ios' in txt(pg, '#plat'), txt(pg, '#plat'))
    ctx.close()

    # No sensor data at all: heading must stay "—", never 0 / north (rule 2)
    ctx, pg = phone(b, sensors=False)
    pg.goto(URL); pg.click('#startBtn'); pg.wait_for_timeout(6500)
    check('no data: heading stays —', txt(pg, '#hdg') == '—', txt(pg, '#hdg'))
    check('no data: badge says why', txt(pg, '#src') in ('NO SENSOR DATA', 'SENSORS BLOCKED'), txt(pg, '#src'))
    pg.screenshot(path=OUT + '/03_nodata.png', full_page=True)
    ctx.close()
    b.close()

srv.shutdown()
check('no page errors', not errors, '; '.join(errors)[:300])
print(f'\nscreenshots: {OUT}\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) else 1)
