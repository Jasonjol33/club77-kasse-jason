'use strict';
/* Wird im <head> geladen, damit Hell/Dunkel und Fest-Overlay schon vor dem ersten Zeichnen gesetzt sind (kein Aufblitzen). */
(function () {
  const KEY = { theme: 'c77theme', overlay: 'c77overlay' };
  const THEME_COLOR = { dark: '#07050c', light: '#f6f2fb' };
  const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* Speicher nicht verfügbar */ } };
  const root = document.documentElement;

  function apply() {
    const theme = read(KEY.theme) === 'light' ? 'light' : 'dark';
    const overlay = read(KEY.overlay);
    root.setAttribute('data-theme', theme);
    if (overlay) root.setAttribute('data-overlay', overlay); else root.removeAttribute('data-overlay');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
  }
  window.C77Theme = {
    getTheme: () => (read(KEY.theme) === 'light' ? 'light' : 'dark'),
    getOverlay: () => read(KEY.overlay),
    setTheme(t) { write(KEY.theme, t === 'light' ? 'light' : 'dark'); apply(); },
    setOverlay(o) { write(KEY.overlay, o || ''); apply(); },
  };
  apply();
  // Das <meta> existiert beim ersten Aufruf evtl. noch nicht -> nach dem Laden erneut setzen
  document.addEventListener('DOMContentLoaded', apply);
})();
