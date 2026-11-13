'use strict';
/* Service Worker + „App installieren“-Button (Kasse als Web-App auf Handy/PC installierbar) */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* Installation optional */ }); });
  }
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone()) return; // läuft schon als installierte App

  let deferred = null;
  const buttons = [];
  const ua = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function hideAll() { for (const b of buttons) b.hidden = true; }

  async function onClick() {
    if (deferred) {
      const ev = deferred; deferred = null;
      try { ev.prompt(); await ev.userChoice; } catch { /* egal */ }
      return;
    }
    if (isIos) {
      alert('So installierst du die Kasse als App:\n\n1. Tippe unten in Safari auf „Teilen“ (Quadrat mit Pfeil).\n2. Wähle „Zum Home-Bildschirm“.\n3. Tippe auf „Hinzufügen“.');
    } else {
      alert('So installierst du die Kasse als App:\n\nÖffne das Browser-Menü (⋮ oder ⋯) und wähle „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.\n\nTipp: Am Handy am besten in Chrome (Android) oder Safari (iPhone) öffnen.');
    }
  }

  function makeButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn off sm';
    b.textContent = '📲 App installieren';
    b.addEventListener('click', onClick);
    buttons.push(b);
    return b;
  }

  function mount() {
    // Im Kopfbereich (neben „Abmelden“)
    const logout = document.getElementById('logoutBtn');
    if (logout && logout.parentNode) logout.parentNode.insertBefore(makeButton(), logout);
    // Auf der Anmeldeseite
    const login = document.getElementById('loginView');
    if (login) { const b = makeButton(); b.style.marginTop = '14px'; b.style.width = '100%'; login.append(b); }
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', hideAll);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
