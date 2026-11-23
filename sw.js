// SPDX-License-Identifier: AGPL-3.0-or-later
/* Offline support: keeps the app's own files in a cache so the workbench opens without a connection. It never contacts any
 * other site. VERSION must equal package.json's version (a test checks it); a new release gets a new cache and drops the old one. */
'use strict';
const VERSION = '1.3.1';
const CACHE = 'kspcn-' + VERSION;
const FILES = [
  './', 'index.html', 'css/app.css', 'icon.svg', 'manifest.webmanifest',
  'js/data.js', 'js/orbits.js', 'js/core.js', 'js/world.js', 'js/trajectory.js', 'js/sim.js', 'js/network.js', 'js/planner.js',
  'js/reentry.js', 'js/transfer.js', 'js/parsers.js', 'js/share.js', 'js/career-data.js', 'js/craft.js', 'js/career.js', 'js/terrain-data.js', 'js/landing.js', 'js/mission.js', 'js/app.js', 'js/ui-scenario.js', 'js/ui-tracker.js',
  'js/ui-planner.js', 'js/ui-network.js', 'js/ui-reentry.js', 'js/ui-transfer.js', 'js/ui-career.js', 'js/ui-missions.js', 'js/ui-landing.js', 'js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kspcn-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache first for the app's own files; anything else (or a miss) goes to the network untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
