#!/usr/bin/env python3
"""Headless end-to-end test of the Event Timeline template (assets/template).

    python3 scripts/test_template.py            # copies the template to a temp dir, vendors Leaflet, runs
    python3 scripts/test_template.py --app DIR  # test an app you already built from the template

What it checks: the page loads with no CSP or script errors; the demo time (?demo=) puts every item in
the right state (done / live / soon / later) in the list, on the map and in the legend; the playhead
follows now and switches to PREVIEW on a keyboard move, and Now returns to follow; hostile text in
events.json is shown as text, not HTML; a malformed row is dropped; no horizontal scroll at phone width.
Map tiles may fail in a sandbox with no internet; tile errors are not counted as failures.
Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
"""
import os, sys, json, shutil, subprocess, tempfile, threading, functools, http.server, socketserver, argparse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.abspath(os.path.join(HERE, '..'))
ap = argparse.ArgumentParser(); ap.add_argument('--app'); args = ap.parse_args()

if args.app:
    root = os.path.abspath(args.app)
else:
    root = tempfile.mkdtemp(prefix='tl-')
    shutil.copytree(os.path.join(SKILL, 'assets', 'template'), root, dirs_exist_ok=True)
    subprocess.run(['node', os.path.join(HERE, 'vendor_libs.mjs'), root, '--no-jszip'], check=True, stdout=subprocess.DEVNULL)

# Hostile + malformed data in a copy, so the escaping and validation checks run on every test.
TEST = os.path.join(tempfile.mkdtemp(prefix='tl-data-'), 'site')
shutil.copytree(root, TEST, dirs_exist_ok=True)
data = json.load(open(os.path.join(TEST, 'data', 'events.json')))
n_good = len(data['items'])
data['items'].append({'id': 'evil', 'title': '<img src=x onerror="window.__pwned=1">Evil', 'place': [18.94, 72.83], 'start': '12:00', 'end': '12:30', 'kind': 'x'})
data['items'].append({'id': 'bad', 'title': 'Bad coords', 'place': [999, 72.8], 'start': '12:00', 'end': '12:30', 'kind': 'x'})
json.dump(data, open(os.path.join(TEST, 'data', 'events.json'), 'w'))
expected_items = n_good + 1   # the evil item is shown as text; the bad coordinates are dropped

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=TEST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{srv.server_address[1]}'

checks = []
def check(name, cond, detail=''):
    checks.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''))

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('requestfailed', lambda r: None)   # tiles are blocked in some sandboxes; not a failure
    pg.goto(B + '/index.html?demo=2026-10-25T15:10')
    pg.wait_for_selector('#items li', timeout=15000)
    pg.wait_for_timeout(400)

    check('demo banner shown', pg.is_visible('#demoBanner'), pg.inner_text('#demoBanner')[:60])
    check('playhead shows demo time 3:10 pm', '3:10' in pg.inner_text('#phTime'), pg.inner_text('#phTime'))
    check('mode is following now', 'Following now' in pg.inner_text('#phMode'))

    states = pg.evaluate("[...document.querySelectorAll('#items li')].map(li => li.dataset.state)")
    check('list: all items rendered, bad row dropped, evil item shown as text',
          len(states) == expected_items, f'{len(states)} rows, expected {expected_items}')
    check('list states at 15:10: four done, one live, one later',
          sorted(states[:n_good]) == sorted(['done', 'done', 'done', 'done', 'live', 'later']), states[:n_good])
    check('evil title rendered as text, no <img> injected', pg.evaluate("document.querySelectorAll('#items img').length") == 0
          and pg.evaluate("window.__pwned") is None)
    check('evil title text shown literally', any('<img' in t for t in pg.evaluate("[...document.querySelectorAll('#items .title')].map(e => e.textContent)")))
    pins = pg.evaluate("window.__pinStates || null")
    legend = pg.inner_text('#legend')
    check('legend counts the states', 'Live' in legend and 'Done' in legend, legend.replace('\n', ' ')[:80])
    check('timeline bars carry the same state as the list',
          pg.evaluate("[...document.querySelectorAll('.bar')].filter(b => b.classList.contains('live')).length") == 1)

    # keyboard: move the playhead back, which switches to PREVIEW
    pg.focus('#track'); pg.keyboard.press('ArrowLeft')
    pg.wait_for_timeout(200)
    check('arrow key switches to PREVIEW', 'Previewing' in pg.inner_text('#phMode'), pg.inner_text('#phMode'))
    check('Now button enabled in preview', pg.is_enabled('#nowBtn'))
    pg.click('#nowBtn'); pg.wait_for_timeout(200)
    check('Now returns to following', 'Following now' in pg.inner_text('#phMode') and pg.is_disabled('#nowBtn'))

    # click on a list item jumps the playhead to its start
    pg.click('#items li:nth-child(1)'); pg.wait_for_timeout(200)
    check('list click previews the item start', 'Previewing' in pg.inner_text('#phMode'))
    check('aria value text is set on the slider', bool(pg.get_attribute('#track', 'aria-valuetext')))

    overflow = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check('no horizontal scroll at 390 px', not overflow)
    check('no script or CSP errors', not errors, '; '.join(errors)[:300])
    b.close()

srv.shutdown()
print(f'\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) else 1)
