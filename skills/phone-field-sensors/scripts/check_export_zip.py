#!/usr/bin/env python3
"""Sanity-check a field-capture export ZIP (this template, FloodView or CropView v3.x).

    python3 check_export_zip.py survey.zip [more.zip ...]

Flags the mistakes that have actually happened in the field data:
  • camera_height_m that looks like GPS altitude (CropView v3.0 footprints were ~430× too big)
  • heading outside 0–360, or a heading recorded while the source said the signal was lost
  • tilt that is exactly 45 on most rows (the old `beta || 45` default leaking through)
  • footprint polygons that are not closed, or far bigger than the camera geometry allows
  • photos listed in the records but missing from images/
  • CSV cells that a spreadsheet would run as a formula
Prints a short report per ZIP; exits 1 if any ZIP has an error (warnings don't fail).
"""
import sys, json, zipfile, csv, io, math

def check(path):
    errs, warns = [], []
    z = zipfile.ZipFile(path); names = set(z.namelist())
    pts_name = next((n for n in names if n.endswith('_captures_points.geojson')), None)
    if not pts_name:
        return [f'no *_captures_points.geojson'], warns, 0
    gj = json.loads(z.read(pts_name))
    feats = gj.get('features', [])
    tilts = []
    for f in feats:
        p = f.get('properties', {}); pid = p.get('id', '?')
        h = p.get('heading_deg', p.get('azimuth_deg'))
        src = str(p.get('heading_source') or '')
        if h is not None and not (0 <= float(h) < 360.5):
            errs.append(f'{pid}: heading {h} outside 0–360')
        if h is not None and src in ('SIGNAL LOST', 'NO SENSOR DATA', 'SENSORS BLOCKED'):
            warns.append(f'{pid}: heading {h} saved while source was {src} — treat the direction as unknown')
        t = p.get('tilt_deg_from_nadir', p.get('tilt_deg'))
        if t is not None:
            tilts.append(t)
            if not (0 <= float(t) <= 180): errs.append(f'{pid}: tilt {t} outside 0–180')
        H = p.get('camera_height_m')
        if H is None:
            warns.append(f'{pid}: no camera_height_m (pre-v3.1 export? footprint built from GPS altitude is not trustworthy)')
        elif float(H) > 60:
            errs.append(f'{pid}: camera_height_m {H} — looks like GPS altitude, not height above ground')
        fw = p.get('footprint_width_m')
        if fw and H and t is not None and float(t) < 85:
            # the widest a 65°–90° hfov footprint can be at the 85° cap
            limit = 2 * math.hypot(float(H), float(H) * math.tan(math.radians(85))) * math.tan(math.radians(45))
            if float(fw) > limit * 1.05: errs.append(f'{pid}: footprint width {fw:.1f} m impossible for camera height {H} m')
        img = p.get('imgName')
        if img and ('images/' + img) not in names and not any(n.endswith('/' + img) for n in names):
            warns.append(f'{pid}: photo {img} not in the ZIP')
        poly = f.get('fov_polygon')
        if poly:
            ring = poly['coordinates'][0]
            if ring[0] != ring[-1]: errs.append(f'{pid}: footprint ring not closed')
    if len(tilts) >= 5 and sum(1 for t in tilts if t == 45) / len(tilts) > 0.6:
        errs.append(f'{sum(1 for t in tilts if t == 45)}/{len(tilts)} tilts are exactly 45° — a default is leaking in, the tilt sensor was not read')
    for n in names:
        if n.endswith('.csv'):
            for row in csv.reader(io.StringIO(z.read(n).decode('utf-8', 'replace'))):
                for cell in row:
                    if cell[:1] in ('=', '+', '@') or (cell[:1] == '-' and not cell[1:2].isdigit() and cell != '-'):
                        errs.append(f'{n}: unguarded formula-like cell {cell[:30]!r}')
    return errs, warns, len(feats)

bad = False
for path in sys.argv[1:]:
    errs, warns, n = check(path)
    print(f'{path}: {n} records, {len(errs)} errors, {len(warns)} warnings')
    for e in errs: print('  ERROR ', e)
    for w in warns[:20]: print('  warn  ', w)
    if len(warns) > 20: print(f'  … {len(warns) - 20} more warnings')
    bad |= bool(errs)
if len(sys.argv) < 2: print(__doc__); sys.exit(2)
sys.exit(1 if bad else 0)
