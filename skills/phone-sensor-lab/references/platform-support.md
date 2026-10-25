# Platform support (checked October 2026)

Probe at run time with `SensorLab.capabilities()`; this table is for planning. "Flag" means the API exists in
Chromium only after the user enables it in `chrome://flags`, so an ordinary user will not have it.

| Need | API | Android Chrome | iOS Safari | Notes |
|---|---|---|---|---|
| Compass, tilt | `deviceorientation(absolute)` | yes | yes (`webkitCompassHeading`) | Rules in phone-field-sensors |
| Accelerometer, gyroscope | `devicemotion` (`accelerationIncludingGravity`, `rotationRate`) | yes | yes, after `requestPermission` | Basis of compass trust, stillness, steps |
| Motion sensor classes | `Accelerometer`, `Gyroscope`, `GravitySensor`, `AbsoluteOrientationSensor` | yes | no | Not needed here; `devicemotion` is everywhere |
| Magnetic field (µT) | `Magnetometer` | flag `#enable-generic-sensor-extra-classes` | no | Hence the gyroscope check (rule 5) |
| Ambient light (lux) | `AmbientLightSensor` | flag (same) | no | Use camera-frame shares instead |
| Camera, microphone | `getUserMedia` | yes | yes | Turn off voice processing for levels |
| External GNSS (serial) | Web Serial | Chrome 137+, Bluetooth RFCOMM only (no USB serial) | no | Desktop Chrome: USB serial |
| Bluetooth sensors | Web Bluetooth | yes | no | Standard GATT services decode the same everywhere |
| AR camera height | WebXR `immersive-ar` + `hit-test` | ARCore phones (hit test since Chrome 81) | no | Untested in this skill |
| NFC tags | Web NFC (`NDEFReader`) | yes | no | Untested in this skill |
| Vibration | `navigator.vibrate` | yes | no | A nudge only; never the only signal |
| Barometer | none | no web API | no | Use a Bluetooth sensor, or a native (Capacitor) plugin |

Also: Web Serial over Bluetooth on Android does not support the `connected` property or connect/disconnect
events yet, and is not available in WebView (so not inside a Capacitor app).

## Sources

- Chrome developers, *Sensors for the web* (Generic Sensor API; Magnetometer and AmbientLightSensor behind
  `#enable-generic-sensor-extra-classes`): https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor
- *Magnetometer API in Android Chrome Browser* (flag "Generic Sensor Extra Classes" still required, 2023):
  https://newscrewdriver.com/2023/03/28/magnetometer-api-in-android-chrome-browser
- blink-dev, *Intent to Ship: Web serial over Bluetooth on Android* (Chrome 137; RFCOMM; no WebView; connected
  events deferred): https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE/m/XbuAYkRxEQAJ
- web.dev, *Positioning virtual objects in real-world views* (WebXR hit test, Chrome 81; `local` + `hit-test`,
  `requestHitTestSource({space: viewer})`): https://web.dev/articles/ar-hit-test
- Chrome developers, *Interact with NFC devices on Chrome for Android*: https://developer.chrome.com/docs/capabilities/nfc
