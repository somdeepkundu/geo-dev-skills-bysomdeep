#!/usr/bin/env python3
"""Rasterise an app's icons/icon.svg into icons/icon-192.png and icons/icon-512.png
(the two PNG sizes Chrome needs before it offers "Install app"). Uses headless Chromium
through Playwright, so no image library is needed.

    python3 make_icons.py <app-dir>

Draw the SVG full-bleed (background colour edge to edge, artwork inside the central
80 %), and the same PNG works as a maskable icon too.
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

app = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
svg = (app / 'icons' / 'icon.svg').read_text()
with sync_playwright() as p:
    b = p.chromium.launch()
    for size in (192, 512):
        pg = b.new_page(viewport={'width': size, 'height': size})
        pg.set_content(f'<html><body style="margin:0;background:transparent">'
                       f'<div style="width:{size}px;height:{size}px">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</div></body></html>')
        pg.screenshot(path=str(app / 'icons' / f'icon-{size}.png'), omit_background=True)
        pg.close()
    b.close()
print('wrote icons/icon-192.png and icons/icon-512.png in', app)
