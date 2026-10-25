# Open-source tools that go with this skill

Use these to check what the phone reports, and to do the heavy processing off the phone. All are open source.

| Tool | Use it for |
|---|---|
| **phyphox** (RWTH Aachen; Android, iOS) | Read raw accelerometer, gyroscope, magnetometer, pressure and sound with plots, to check what a phone's sensors really do before trusting the web API's numbers. Its remote-access mode shows the plots in a laptop browser. |
| **GnssLogger** (Google `gps-measurement-tools`) | Log raw GNSS measurements on Android, for checking a phone's GPS against a receiver or post-processing. |
| **RTKLIB** | Post-process logs from an RTK-capable receiver (or phone raw logs) to centimetre or decimetre positions; also streams NMEA. |
| **Open Camera** (Android) | Lock exposure and focus for canopy and cover photos when frames must be comparable. |
| **QGIS** | Open the CSV and GeoJSON exports: tracks, cover along a transect, noise along a walk. |
| **Leaflet** + **OpenStreetMap** | The map in the template (vendored by `vendor_libs.mjs`; no CDN at run time). |

Hardware note: any receiver that outputs NMEA (GGA, and GST for accuracy) over Bluetooth serial works with
the Web Serial path on Android Chrome 137+. Test with the "Paste NMEA" box first, using a log from the receiver.
