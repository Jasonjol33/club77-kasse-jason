'use strict';
// Minimaler Service Worker: macht die Kasse als App installierbar.
// Die API wird NIE zwischengespeichert (Rechnungen/Umsätze müssen immer live vom Server kommen).
const CACHE = 'club77-shell-v4';
const SHELL = ['/', '/app.js', '/settings.js', '/theme-init.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return; // direkt ans Netz
  // Oberfläche: erst Netz (immer aktuell nach einem Deploy), bei Funkloch die zuletzt gespeicherte Version
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
