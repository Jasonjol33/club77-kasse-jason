'use strict';
/* Einstellungen (Zahnrad oben links): Spaß-Modus, Hell/Dunkel und Fest-Overlays. Wird pro Gerät im Browser gespeichert. */
(function () {
  const T = window.C77Theme;
  if (!T) return;

  // mode: fall = fällt von oben, rise = steigt von unten auf
  const OVERLAYS = [
    { id: '', name: 'Standard', emoji: '🏠' },
    { id: 'weihnachten', name: 'Weihnachten', emoji: '🎄', mode: 'fall', items: ['❄️', '❄️', '⛄', '🎄', '⭐'] },
    { id: 'silvester', name: 'Silvester', emoji: '🎆', fireworks: true }, // echtes Feuerwerk (Canvas), keine Emojis
    { id: 'valentin', name: 'Valentinstag', emoji: '💘', mode: 'rise', items: ['💘', '💖', '💕', '❤️'] },
    { id: 'karneval', name: 'Karneval', emoji: '🎭', mode: 'fall', items: ['🎭', '🎈', '🎊', '🥳'] },
    { id: 'ostern', name: 'Ostern', emoji: '🐣', mode: 'fall', items: ['🐣', '🥚', '🐰', '🌷'] },
    { id: 'oktoberfest', name: 'Oktoberfest', emoji: '🍺', mode: 'rise', items: ['🍺', '🥨', '🍻'] },
    { id: 'halloween', name: 'Halloween', emoji: '🎃', mode: 'fall', items: ['🎃', '🦇', '👻', '🕷️'] },
  ];

  const $ = s => document.querySelector(s);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }


  /* ---------- Feuerwerk (Silvester): Raketen steigen auf, explodieren, Funken glühen aus ---------- */
  const FW = (() => {
    let canvas = null, ctx = null, raf = 0, w = 0, h = 0, dpr = 1, rockets = [], sparks = [], flashes = [], nextLaunch = 0, last = 0;
    const GRAVITY = 110, FRICTION = 1.5, MAX_SPARKS = 700;
    const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const rnd = (a, b) => a + Math.random() * (b - a);

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function launch() {
      const small = w < 600;
      const side = Math.random() < 0.65 && w > 700; // am PC meist links/rechts neben dem Inhalt
      const x = side ? (Math.random() < 0.5 ? rnd(w * 0.05, w * 0.28) : rnd(w * 0.72, w * 0.95)) : rnd(w * 0.1, w * 0.9);
      rockets.push({ x, y: h + 8, ty: rnd(h * 0.12, h * 0.5), speed: rnd(h * 0.55, h * 0.85), sway: rnd(-18, 18), hue: rnd(0, 360), trail: [] });
      if (small && rockets.length > 3) rockets.shift();
    }
    function explode(x, y, hue) {
      const scale = Math.max(0.55, Math.min(1.3, h / 800));
      const type = ['peony', 'ring', 'willow', 'double'][Math.floor(Math.random() * 4)];
      const n = Math.round((type === 'ring' ? 70 : 95) * (w < 600 ? 0.7 : 1));
      const hue2 = (hue + rnd(60, 180)) % 360;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.04, 0.04);
        let speed = (type === 'ring' ? 260 : rnd(70, 340)) * scale, life = rnd(1.1, 2.0), hh = hue, g = 1;
        if (type === 'willow') { speed *= 0.7; life = rnd(1.8, 2.8); hh = 42; g = 1.8; }       // goldener Weidenregen
        if (type === 'double' && i % 2) { speed *= 0.55; hh = hue2; }
        sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0, life, hue: hh + rnd(-8, 8), size: rnd(1.6, 3.2) * Math.min(1.2, scale + 0.2), g });
      }
      flashes.push({ x, y, age: 0, hue });
      if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'; // dunkel: leuchtend, hell: kräftige Farben
      const L = dark ? 64 : 46;

      nextLaunch -= dt;
      if (nextLaunch <= 0) { launch(); nextLaunch = rnd(0.5, 1.5); }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y -= r.speed * dt; r.x += r.sway * dt;
        r.trail.push([r.x, r.y]); if (r.trail.length > 12) r.trail.shift();
        for (let k = 1; k < r.trail.length; k++) {
          ctx.strokeStyle = `hsla(40,100%,${dark ? 78 : 50}%,${(k / r.trail.length) * 0.8})`;
          ctx.lineWidth = 1 + (k / r.trail.length) * 1.5;
          ctx.beginPath(); ctx.moveTo(r.trail[k - 1][0], r.trail[k - 1][1]); ctx.lineTo(r.trail[k][0], r.trail[k][1]); ctx.stroke();
        }
        if (r.y <= r.ty) { explode(r.x, r.y, r.hue); rockets.splice(i, 1); }
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.age += dt;
        if (f.age > 0.25) { flashes.splice(i, 1); continue; }
        const a = 1 - f.age / 0.25, rad = 30 + f.age * 260;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
        g.addColorStop(0, `hsla(${f.hue},100%,${dark ? 85 : 55}%,${0.5 * a})`);
        g.addColorStop(1, `hsla(${f.hue},100%,60%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
      }

      ctx.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.age += dt;
        if (p.age >= p.life) { sparks.splice(i, 1); continue; }
        const damp = Math.exp(-FRICTION * dt);
        p.vx *= damp; p.vy = p.vy * damp + GRAVITY * p.g * dt;
        const px = p.x, py = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const t = p.age / p.life, alpha = Math.pow(1 - t, 1.4) * (Math.random() > 0.93 ? 0.5 : 1); // leichtes Funkeln
        ctx.strokeStyle = `hsla(${p.hue},100%,${L + (1 - t) * 18}%,${alpha})`;
        ctx.lineWidth = p.size * (1 - t * 0.5);
        ctx.beginPath(); ctx.moveTo(px - p.vx * 0.04, py - p.vy * 0.04); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    function start() {
      if (canvas || reduced()) return;
      canvas = document.createElement('canvas');
      canvas.id = 'fireworks'; canvas.setAttribute('aria-hidden', 'true');
      document.body.prepend(canvas);
      ctx = canvas.getContext('2d');
      resize(); window.addEventListener('resize', resize);
      rockets = []; sparks = []; flashes = []; last = 0; nextLaunch = 0.2;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (!canvas) return;
      cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
      canvas.remove(); canvas = null; ctx = null; rockets = []; sparks = []; flashes = [];
    }
    return { start, stop };
  })();

  /* ---------- Overlay-Partikel ---------- */
  function renderOverlay() {
    const layer = $('#overlayLayer');
    if (!layer) return;
    layer.textContent = '';
    FW.stop();
    const o = OVERLAYS.find(x => x.id === T.getOverlay());
    if (o && o.fireworks) { FW.start(); return; }
    if (!o || !o.items) return;
    const count = window.innerWidth < 600 ? 14 : 24;
    for (let i = 0; i < count; i++) {
      const p = el('span', 'ovp' + (o.mode === 'rise' ? ' rise' : ''), o.items[i % o.items.length]);
      p.setAttribute('aria-hidden', 'true');
      p.style.left = (Math.random() * 96).toFixed(1) + 'vw';
      p.style.fontSize = (16 + Math.random() * 20).toFixed(0) + 'px';
      p.style.animationDuration = (9 + Math.random() * 10).toFixed(1) + 's';
      p.style.animationDelay = (-Math.random() * 18).toFixed(1) + 's'; // negativ = sofort mitten in der Animation
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
      layer.append(p);
    }
  }

  /* ---------- Dialog ---------- */
  function markPressed(group, value) {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false');
  }

  function build() {
    const dlg = $('#settingsDlg');
    const themeBox = $('#setTheme'), ovBox = $('#setOverlay');
    for (const [v, label] of [['dark', '🌙 Dunkel'], ['light', '☀️ Hell']]) {
      const b = el('button', 'btn off sm opt', label);
      b.type = 'button'; b.dataset.value = v;
      b.addEventListener('click', () => { T.setTheme(v); markPressed(themeBox, v); });
      themeBox.append(b);
    }
    for (const o of OVERLAYS) {
      const b = el('button', 'btn off sm opt', o.emoji + ' ' + o.name);
      b.type = 'button'; b.dataset.value = o.id;
      b.addEventListener('click', () => { T.setOverlay(o.id); markPressed(ovBox, o.id); renderOverlay(); });
      ovBox.append(b);
    }
    markPressed(themeBox, T.getTheme());
    markPressed(ovBox, T.getOverlay());
    $('#gearBtn').addEventListener('click', () => { if (!dlg.open) dlg.showModal(); });
    $('#setClose').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { // Klick neben das Fenster schließt
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    renderOverlay();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
