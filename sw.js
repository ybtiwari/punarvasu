// Punarvasu Clinic Portal — minimal service worker.
//
// This file exists only to satisfy the browser's PWA "installability" checks
// (Chrome/Android requires a registered service worker with a fetch handler
// before it will show the automatic "Add to Home Screen" prompt).
//
// It deliberately does NOT cache any patient data, messages, or
// prescriptions — every request is passed straight through to the network.
// This keeps the portal always showing live Firebase data and avoids any
// risk of one patient's cached data appearing on another device.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass-through: always hit the network, never serve from cache.
  event.respondWith(fetch(event.request));
});
