// SPDX-License-Identifier: AGPL-3.0-or-later
// Entry point: every UI module has registered its tab by now.
window.KSPApp.start();

// Offline use: register the service worker on a real web address (not file://, and not on a local dev server where cached files would hide edits).
(function () {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !local) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
  }
})();
