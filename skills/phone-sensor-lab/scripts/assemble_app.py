#!/usr/bin/env python3
"""Assemble a Sensor Lab app from this skill and phone-field-sensors.

    python3 scripts/assemble_app.py my-lab

Copies assets/template, adds sensor-core.js and field-store.js from the sibling phone-field-sensors skill
(not duplicated here, so the two skills cannot drift apart), and vendors Leaflet with its vendor script.
Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
"""
import os, sys, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
PHONE = os.path.join(os.path.dirname(SKILL), 'phone-field-sensors')

def assemble(dest):
    if not os.path.isdir(PHONE):
        sys.exit('phone-field-sensors not found next to this skill: ' + PHONE)
    shutil.copytree(os.path.join(SKILL, 'assets', 'template'), dest, dirs_exist_ok=True)
    for f in ('sensor-core.js', 'field-store.js'):
        shutil.copy(os.path.join(PHONE, 'assets', 'template', f), dest)
    subprocess.run(['node', os.path.join(PHONE, 'scripts', 'vendor_libs.mjs'), dest, '--no-jszip'], check=True, stdout=subprocess.DEVNULL)
    return dest

if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    print('assembled', assemble(os.path.abspath(sys.argv[1])))
