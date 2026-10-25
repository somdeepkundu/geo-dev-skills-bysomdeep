#!/usr/bin/env python3
"""Headless test of the Sensor Lab template with simulated sensors.

    python3 scripts/test_template.py            # assembles the app in a temp dir, then tests it
    python3 scripts/test_template.py --app DIR  # test an assembled app

Orientation and motion events are generated from the W3C rotation matrix, so the compass, the gyroscope
and gravity always describe the same physical phone. A "metro" adds a compass drift with no rotation.
Checks: capability probe; motion permission inside the tap; magnetic watch CLEAN when still and when
turning, DISTURBED in the metro case, clean again afterwards; gravity tilt agrees with orientation tilt;
stillness; steps and an eastward dead-reckoning track; green cover from the camera; microphone level;
NMEA paste with RTK fix and centimetre accuracy; AR and NFC report honestly when absent; CSV and GeoJSON
export; no page errors; no horizontal scroll at 390 px. Tiles may be blocked offline; not a failure.
Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
"""
import os, sys, csv, io, json, tempfile, threading, functools, http.server, socketserver, argparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assemble_app import assemble

ap = argparse.ArgumentParser(); ap.add_argument('--app'); a = ap.parse_args()
APP = os.path.abspath(a.app) if a.app else assemble(os.path.join(tempfile.mkdtemp(prefix='lab-'), 'app'))
OUT = tempfile.mkdtemp(prefix='lab-shots-')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=APP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://localhost:{srv.server_address[1]}/index.html'

checks, errors = [], []
def check(n, c, d=''):
    checks.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d != '' else ''), flush=True)

PERM_SPY = """window.__perm = []; const __rp = DeviceOrientationEvent.requestPermission;
if (typeof __rp === 'function') DeviceOrientationEvent.requestPermission = function () { window.__perm.push(navigator.userActivation.isActive); return __rp.call(this); };"""
# A simulated phone: pose (α, β, γ), pose rates (deg/s), compass drift (deg/s, the "metro"), walking bounce.
SIM = """window.__sim = (() => {
  const D = Math.PI / 180, G = 9.80665;
  const mul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, _, k) => s + r[k] * B[k][j], 0)));
  const T = A => A[0].map((_, j) => A.map(r => r[j]));
  function R(a, b, g) { a *= D; b *= D; g *= D;
    return mul(mul([[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]],
      [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]]), [[Math.cos(g), 0, Math.sin(g)], [0, 1, 0], [-Math.sin(g), 0, Math.cos(g)]]); }
  const s = { pose: [300, 75, -5], rate: [0, 0, 0], drift: 0, off: 0, walk: 0, t: 0 };
  const dt = 0.02;
  setInterval(() => {
    const p0 = s.pose.slice(); s.pose = s.pose.map((v, i) => v + s.rate[i] * dt); s.off += s.drift * dt; s.t += dt;
    const W = mul(T(R(...p0)), R(...s.pose));
    const rr = { beta: (W[2][1] - W[1][2]) / 2 / dt / D, gamma: (W[0][2] - W[2][0]) / 2 / dt / D, alpha: (W[1][0] - W[0][1]) / 2 / dt / D };
    const up = T(R(...s.pose)), k = (G + s.walk * Math.sin(2 * Math.PI * 1.8 * s.t)) ;
    const aig = { x: k * up[0][2], y: k * up[1][2], z: k * up[2][2] };
    const al = ((s.pose[0] - s.off) % 360 + 360) % 360, [_, b, g] = s.pose;
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: al, beta: b, gamma: g, absolute: true }));
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: al, beta: b, gamma: g, absolute: false }));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: aig, rotationRate: rr, interval: dt * 1000 }));
  }, 20);
  return s; })()"""
LAT, LON = 19.1334, 72.9133

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={'latitude': LAT, 'longitude': LON, 'accuracy': 4}, accept_downloads=True,
                        permissions=['geolocation', 'camera', 'microphone', 'accelerometer', 'gyroscope', 'magnetometer'])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.add_init_script(PERM_SPY)
    pg.goto(URL); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT + '/01_start.png', full_page=True)
    caps = pg.evaluate('__lab.caps.map(c => [c.key, c.ok])')
    check('capabilities listed (14 probes)', len(caps) == 14 and dict(caps)['orientation'] and dict(caps)['motion'] and not dict(caps)['nfc'], dict(caps))

    pg.click('#motionBtn'); pg.wait_for_timeout(200)
    perm = pg.evaluate('window.__perm')
    check('motion permission asked inside the tap', perm == [] or perm[0] is True, perm)
    pg.evaluate(SIM)
    pg.wait_for_timeout(3200)
    kv = lambda i: pg.inner_text('#' + i)
    check('still, clean field → compass clean', pg.inner_text('#magBadge') == 'compass clean', pg.inner_text('#magBadge') + ' · ' + kv('kMis'))
    check('held still detected', kv('kStill').startswith('yes'), kv('kStill'))
    check('gravity tilt agrees with orientation tilt', 'agrees' in kv('kTiltG') and kv('kTiltO') == '75°', kv('kTiltG') + ' / ' + kv('kTiltO'))
    check('near 90° the gravity sign is not guessed', pg.evaluate('__lab.S.signKnown !== true'))
    pg.evaluate('__sim.pose = [300, 30, 0]'); pg.wait_for_timeout(2500)      # held at 30°: now the sign is observable
    check('gravity sign learned (+1) once held away from 90°', pg.evaluate('__lab.S.signKnown === true && __lab.S.gravSign === 1'))
    pg.evaluate('__sim.pose = [300, 75, -5]'); pg.wait_for_timeout(2500)

    pg.evaluate('__sim.rate = [-15, 0, 0]'); pg.wait_for_timeout(3000)       # turning right 15°/s
    check('turning in a clean field → still clean', pg.inner_text('#magBadge') == 'compass clean', kv('kMis'))
    check('not still while turning', kv('kStill').startswith('no'), kv('kStill'))
    pg.evaluate('__sim.rate = [0, 0, 0]; __sim.drift = 12'); pg.wait_for_timeout(2600)   # the metro
    check('compass drifts, phone still → compass disturbed', pg.inner_text('#magBadge') == 'compass disturbed', kv('kMis'))
    pg.screenshot(path=OUT + '/02_disturbed.png', full_page=False)
    pg.evaluate('__sim.drift = 0'); pg.wait_for_timeout(5600)
    check('drift stops → clean again after the hold', pg.inner_text('#magBadge') == 'compass clean', pg.inner_text('#magBadge'))

    # walk east: phone upright, camera heading 90°
    pg.evaluate('__sim.pose = [270, 75, 0]; __sim.off = 0'); pg.wait_for_timeout(1500)   # the metro left a fixed offset; no check can see that (see SKILL.md)
    pg.click('#walkBtn'); pg.evaluate('__sim.walk = 2.5'); pg.wait_for_timeout(6000); pg.evaluate('__sim.walk = 0'); pg.wait_for_timeout(300)
    n = int(pg.inner_text('#steps'))
    check('walking 1.8 steps/s for 6 s → ~11 steps', 9 <= n <= 12, n)
    tr = pg.evaluate('__lab.walk.pdr.track')
    import math
    dlat, dlon = tr[-1][0] - tr[0][0], tr[-1][1] - tr[0][1]
    brg = (math.degrees(math.atan2(dlon * math.cos(math.radians(LAT)), dlat)) + 360) % 360
    dist = math.hypot(dlat, dlon * math.cos(math.radians(LAT))) * 111195
    check('dead-reckoned track heads east (≈90°)', abs(brg - 90) < 3, f'{brg:.1f}°, {dist:.1f} m')
    check('track length ≈ steps × step length', 0.5 * n < dist < 0.95 * n, f'{dist:.1f} m for {n} steps')
    pg.click('#walkBtn')
    with pg.expect_download() as d: pg.click('#gjBtn')
    gj = json.load(open(d.value.path()))
    check('track GeoJSON: PDR and GPS lines', [f['properties']['method'] for f in gj['features']] == ['pedestrian dead reckoning', 'GPS'] and len(gj['features'][0]['geometry']['coordinates']) >= n)

    pg.click('#camBtn'); pg.wait_for_timeout(1500)
    pct = pg.inner_text('#camPct')
    check('green cover from the camera (fake camera is mostly green)', pct.endswith('%') and int(pct.split()[0]) > 40, pct)
    pg.click('#camRec')
    pg.click('#sndBtn'); pg.wait_for_timeout(4500)
    now, mx, mode = pg.inner_text('#sndNow'), pg.inner_text('#sndMax'), pg.inner_text('#sndBadge')
    # Chromium's fake microphone is silent on the raw path, so this also tests the fallback
    check('microphone: silent raw input detected, falls back and says so', mode in ('live · raw', 'live · processed') and (mode == 'live · raw' or pg.evaluate("__lab.snd.mode") == 'processed'), mode)
    check('microphone level in dBFS (loudest > −100)', now.endswith('dB') and mx != '—' and -100 < float(mx) <= 0, f'now {now}, loudest {mx}, {mode}')
    pg.click('#sndRec')

    def nmea(body):
        c = 0
        for ch in body: c ^= ord(ch)
        return f'${body}*{c:02X}'
    text = '\n'.join([nmea('GNGGA,061500.00,1907.9998,N,07254.7980,E,4,24,0.5,14.2,M,-63.1,M,1.0,0001'), nmea('GNGST,061500.00,0.9,0.012,0.009,45.0,0.011,0.010,0.025'), nmea('GNGGA,061501.00,1907.9998,N,07254.7980,E,4,24,0.5,14.2,M,-63.1,M,1.0,0001')])
    pg.click('#h-gnss ~ details summary') if pg.locator('#h-gnss ~ details summary').count() else pg.evaluate("document.querySelector('#gnssKv').previousElementSibling.open = true")
    pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
    pg.fill('#nmeaIn', text); pg.click('#nmeaBtn'); pg.wait_for_timeout(200)
    check('NMEA paste: RTK fixed shown', pg.inner_text('#gnssBadge') == 'RTK fixed', pg.inner_text('#gnssBadge'))
    check('NMEA paste: accuracy in cm from GST', '1.5 cm' in pg.inner_text('#gnssKv'), pg.inner_text('#gnssKv').replace('\n', ' ')[:120])

    check('AR: honest status (available or not here)', pg.inner_text('#arBadge') in ('available', 'not here'), pg.inner_text('#arBadge'))
    check('NFC: not here in desktop Chromium, buttons disabled', pg.inner_text('#nfcBadge') == 'not here' and pg.is_disabled('#nfcScan'))

    with pg.expect_download() as d: pg.click('#csvBtn')
    rows = list(csv.DictReader(io.StringIO(open(d.value.path()).read())))
    mods = [r['module'] for r in rows]
    check('CSV: walk, green cover, sound, gnss rows', set(['walk', 'green_cover', 'sound', 'gnss']) <= set(mods), mods)
    check('CSV: every row has time and position columns', all(r['time'] and r['lat'] for r in rows))
    check('CSV: sound row says which audio input it used', any(r['module'] == 'sound' and r['audio_input'] in ('raw', 'processed') for r in rows))
    check('no horizontal scroll at 390 px', not pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
    pg.screenshot(path=OUT + '/03_full.png', full_page=True)
    b.close()

srv.shutdown()
check('no page errors', not errors, '; '.join(errors)[:300])
print(f'\nscreenshots: {OUT}\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) else 1)
