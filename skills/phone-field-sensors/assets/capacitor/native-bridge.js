/* native-bridge.js — Android (Capacitor) only; does nothing in a normal browser.
 *
 * From CropView v3 (somdeepkundu/cropview-v3, native/cv-native.js), which ships on Android:
 * the Android WebView ignores <a download>, so every download the web app triggers
 * (photo, ZIP, GeoJSON, CSV) is written to the app's cache with @capacitor/filesystem
 * and handed to the Android share sheet with @capacitor/share (Drive, WhatsApp, Files, Gmail…).
 * The web code keeps calling a.click() on a blob: link and needs no change.
 *
 * Load it last, only in the native build (build-www.mjs injects it before </body>).
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License
 */
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const { Filesystem, Share } = Cap.Plugins;

  const blobToB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

  // The web code revokes the object URL right after click(); keep it alive long enough to read it.
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = u => setTimeout(() => revoke(u), 60000);

  async function saveAndShare(href, name) {
    try {
      const b64 = href.startsWith('data:') ? href.split(',')[1] : await blobToB64(await (await fetch(href)).blob());
      const safe = name.replace(/[\\/:*?"<>|]/g, '_');
      const { uri } = await Filesystem.writeFile({ path: 'exports/' + safe, data: b64, directory: 'CACHE', recursive: true });
      await Share.share({ title: safe, files: [uri], dialogTitle: 'Save / send ' + safe });
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) {
        console.error(e);
        if (typeof window.toast === 'function') window.toast('Export failed: ' + (e.message || e), 'err');
      }
    }
  }

  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^(blob|data):/.test(this.href)) {
      saveAndShare(this.href, this.getAttribute('download') || 'export');
      return;
    }
    return nativeClick.call(this);
  };

  // External links open in the phone's browser instead of replacing the app.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[target="_blank"][href^="http"]');
    if (a) { e.preventDefault(); window.location.href = a.href; }
  }, true);
})();
