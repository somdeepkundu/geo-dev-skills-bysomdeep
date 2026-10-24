# Android app with Capacitor

Source: CropView v3 (`capacitor.config.json`, `package.json`, `native/cv-native.js`, `scripts/build-www.mjs`,
`android/`), prepared for the Play Store as an offline app. Files: `assets/capacitor/`.

## Shape

- **One `index.html`** serves GitHub Pages and the APK. No fork of the app code.
- `npm run build:www` builds `www/` from the web files; `npx cap sync android && npx cap open android` builds
  the APK in Android Studio. `www/`, `android/app/build/`, keystores (`*.jks`, `*.keystore`) and
  `android/app/release/` are git-ignored.
- `capacitor.config.json`:
  ```json
  { "appId": "in.ac.iitb.ctara.cropview", "appName": "CropView", "webDir": "www", "android": { "allowMixedContent": false } }
  ```
- Dependencies that shipped: `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (8.x),
  `@capacitor/filesystem`, `@capacitor/share`. Android SDK: `minSdkVersion 24`, `compileSdkVersion 36`,
  `targetSdkVersion 36`.

## Rules

- **Java 21.** Capacitor 8's generated `capacitor.build.gradle` sets `sourceCompatibility` /
  `targetCompatibility` to `JavaVersion.VERSION_21`; build with a JDK 21 (Android Studio's bundled JBR works).
- **The `appId` can never change** once the app is on the Play Store — it is the package name, and a new one is
  a new app with no updates, ratings or installs carried over. Pick a reverse-domain you control
  (CropView: `in.ac.iitb.ctara.cropview`) before the first upload. `appName` can change.
- Bump `versionCode` (integer) on every Play upload and keep `versionName` equal to the web version.
- Permissions in `AndroidManifest.xml`: `INTERNET`, `CAMERA`, `ACCESS_FINE_LOCATION`,
  `ACCESS_COARSE_LOCATION`; features `android.hardware.camera` (required), `android.hardware.location.gps`
  (required), `android.hardware.sensor.compass` (required="false", so phones without one can still install).
- **Bundle every library** in the APK (no CDN): the build either copies `vendor/` or rewrites CDN URLs to local
  copies, and fails loudly if an expected URL is missing (`build-www.mjs`).

## Downloads → Filesystem + Share

The Android WebView ignores `<a download>`: tapping Export does nothing. `native-bridge.js` (loaded only in the
native build) patches `HTMLAnchorElement.prototype.click`: a click on a `blob:` or `data:` link with a
`download` attribute is read as base64, written to `CACHE/exports/<name>` with `Filesystem.writeFile`, and
handed to `Share.share({files: [uri]})` — the Android share sheet (Drive, WhatsApp, Files, Gmail). It also
delays `URL.revokeObjectURL` by 60 s, because the web code revokes the URL right after `click()` and the
bridge reads it asynchronously. External `target="_blank"` links open in the phone browser.

The web code needs no change: it keeps calling `a.click()` on a blob link (`FieldStore.download`).

## Photos in the native app

CropView's web build kept full-resolution images only in memory, so `cv-native.js` also wrote each photo to
`DATA/captures/` with Filesystem and reloaded it on start. With the IndexedDB store from `field-store.js`
(FloodView) that second half is unnecessary — IndexedDB persists inside the WebView like in a browser.
