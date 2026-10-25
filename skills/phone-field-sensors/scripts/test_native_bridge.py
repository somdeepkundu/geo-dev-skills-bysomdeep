#!/usr/bin/env python3
"""Headless check of assets/capacitor/native-bridge.js with a mocked Capacitor.

    python3 scripts/test_native_bridge.py

1. In a plain browser the bridge must do nothing: <a download> still downloads.
2. With window.Capacitor.isNativePlatform() === true, a blob download must be written with
   Filesystem.writeFile(path 'exports/<name>', base64 data, directory 'CACHE') and handed to Share.share.
"""
import os, sys, base64, threading, functools, http.server, socketserver, tempfile, shutil
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
root = tempfile.mkdtemp(prefix='nb-')
shutil.copy(os.path.join(HERE, '..', 'assets', 'capacitor', 'native-bridge.js'), root)
shutil.copy(os.path.join(HERE, '..', 'assets', 'template', 'field-store.js'), root)
MOCK = """window.__calls = []; window.Capacitor = { isNativePlatform: () => true, Plugins: {
  Filesystem: { writeFile: async o => { window.__calls.push(['write', o.path, o.directory, o.data]); return { uri: 'file:///cache/' + o.path }; } },
  Share: { share: async o => { window.__calls.push(['share', o.files]); } } } };"""
for name, native in (('web.html', False), ('native.html', True)):
    open(os.path.join(root, name), 'w').write('<!doctype html><title>t</title><body>' +
        (f'<script>{MOCK}</script>' if native else '') +
        '<script src="field-store.js"></script><script src="native-bridge.js"></script></body>')

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{srv.server_address[1]}'
checks = []
def check(n, c, d=''): checks.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d != '' else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(accept_downloads=True); pg.goto(B + '/web.html')
    with pg.expect_download() as d:
        pg.evaluate("FieldStore.download('a,b\\n1,2', 'plain.csv', 'text/csv')")
    check('web: bridge inactive, normal download', d.value.suggested_filename == 'plain.csv')
    pg = b.new_page(); pg.goto(B + '/native.html')
    pg.evaluate("FieldStore.download('a,b\\n1,2', 'My Survey:1.csv', 'text/csv')"); pg.wait_for_timeout(600)
    calls = pg.evaluate('window.__calls')
    w = next((c for c in calls if c[0] == 'write'), None); s = next((c for c in calls if c[0] == 'share'), None)
    check('native: written to CACHE/exports with a safe name', w and w[1] == 'exports/My Survey_1.csv' and w[2] == 'CACHE', w and w[:3])
    check('native: content intact (base64)', w and base64.b64decode(w[3]).decode() == 'a,b\n1,2')
    check('native: handed to the share sheet', s and s[1] == ['file:///cache/exports/My Survey_1.csv'], s)
    b.close()
srv.shutdown()
print(f'\n{sum(checks)}/{len(checks)} checks passed'); sys.exit(0 if all(checks) else 1)
