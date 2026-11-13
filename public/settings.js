'use strict';
/* Einstellungen (Zahnrad oben links): Spaß-Modus, Hell/Dunkel und Fest-Overlays. Wird pro Gerät im Browser gespeichert. */
(function () {
  const T = window.C77Theme;
  if (!T) return;

  // mode: fall = fällt von oben, rise = steigt von unten auf
  const OVERLAYS = [
    { id: '', name: 'Standard', emoji: '🏠' },
    { id: 'weihnachten', name: 'Weihnachten', emoji: '🎄' },
    { id: 'silvester', name: 'Silvester', emoji: '🎆', fireworks: true }, // Feuerwerk (Canvas) + Glitzer
    { id: 'valentin', name: 'Valentinstag', emoji: '💘' },
    { id: 'karneval', name: 'Karneval', emoji: '🎭' },
    { id: 'ostern', name: 'Ostern', emoji: '🐣' },
    { id: 'oktoberfest', name: 'Oktoberfest', emoji: '🍺' },
    { id: 'halloween', name: 'Halloween', emoji: '🎃' },
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


  /* ---------- Fest-Effekte (Canvas): Schneefall, Herzen, Konfetti, Blütenblätter, Bierbläschen, Glut + Fledermäuse, Glitzer ---------- */
  const FXT = {
    weihnachten: { shape: 'soft', n: 1, s: [1.6, 10], v: [24, 94], burst: 'soft' },
    valentin: { shape: 'heart', cols: ['#ff4d79', '#ff8fab', '#ff2e63', '#ffc2d1', '#e11d48'], up: 1, n: 0.3, s: [7, 20], v: [30, 80], burst: 'heart' },
    karneval: { shape: 'conf', cols: ['#ff2bd6', '#ffd400', '#2dd4ff', '#7cff4a', '#ff7a1a', '#a855f7'], n: 0.8, s: [2.5, 6], v: [40, 110], burst: 'conf' },
    ostern: { shape: 'petal', cols: ['#ffc9e3', '#fff0a0', '#c6f0c0', '#cfe3ff', '#ffd0b0'], n: 0.5, s: [4, 9], v: [22, 60], burst: 'petal' },
    oktoberfest: { shape: 'bubble', cols: ['255,205,70', '255,230,140'], up: 1, n: 0.6, s: [2, 9], v: [30, 90], burst: 'bubble' },
    halloween: { shape: 'soft', rgb: '255,140,30', up: 1, n: 0.4, s: [2, 7], v: [14, 40], bats: 6, burst: 'soft' },
    silvester: { shape: 'glit', cols: ['#ffd700', '#fff3b0', '#e8e8ff', '#ffb300'], n: 0.45, s: [1.2, 3], v: [25, 70], burst: 'glit' },
  };
  // Boden: [Farbe, Höhe, Frequenz, Phase] – hinten nach vorne; l = Hell-Modus
  const GROUND = {
    weihnachten: { d: [['rgba(175,200,235,.30)', 46, 0.007, 1.3], ['rgba(225,238,255,.5)', 32, 0.011, 3], ['rgba(255,255,255,.92)', 20, 0.016, 0.4]],
      l: [['rgba(130,165,215,.35)', 46, 0.007, 1.3], ['rgba(150,185,230,.55)', 32, 0.011, 3], ['rgba(170,200,240,.85)', 20, 0.016, 0.4]], glint: 1 },
    ostern: { d: [['rgba(110,200,120,.35)', 46, 0.007, 0.7], ['rgba(80,180,95,.6)', 32, 0.011, 2], ['rgba(50,150,70,.95)', 20, 0.016, 5]] },
    oktoberfest: { d: [['rgba(255,214,102,.3)', 46, 0.007, 0.9], ['rgba(255,240,200,.6)', 32, 0.011, 2.5], ['rgba(255,253,245,.95)', 20, 0.016, 4]] },
  };
  const FX = (() => {
    let back = null, front = null, bctx = null, fctx = null, raf = 0, w = 0, h = 0, dpr = 1, last = 0, t = 0, id = '', cfg = null;
    let ps = [], puffs = [], bats = [], glints = [];
    const sprites = {};
    const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];
    const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
    function sprite(rgb) {
      if (sprites[rgb]) return sprites[rgb];
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},.6)`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return (sprites[rgb] = c);
    }
    function makeCanvas(cid) { const c = document.createElement('canvas'); c.id = cid; c.setAttribute('aria-hidden', 'true'); return c; }
    function mk(first) {
      const d = Math.pow(Math.random(), 1.6), up = cfg.up ? -1 : 1;
      return { x: rnd(0, w), y: first ? rnd(-20, h) : (up < 0 ? h + 20 : -20), d, front: d > 0.9,
        s: cfg.s[0] + (cfg.s[1] - cfg.s[0]) * d * d, vy: (cfg.v[0] + (cfg.v[1] - cfg.v[0]) * d) * up, a: 0.3 + d * 0.55,
        ph: rnd(0, 6.28), fr: rnd(0.6, 1.6), amp: rnd(5, 20), rot: rnd(0, 6.28), vr: rnd(-2.5, 2.5), col: cfg.cols ? pick(cfg.cols) : null };
    }
    function mkBat(first) { const dir = Math.random() < 0.5 ? 1 : -1; return { x: first ? rnd(0, w) : (dir > 0 ? -40 : w + 40), y: rnd(h * 0.08, h * 0.6), s: rnd(9, 18), vx: dir * rnd(50, 110), ph: rnd(0, 6), dir }; }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2); w = window.innerWidth; h = window.innerHeight;
      for (const [c, x] of [[back, bctx], [front, fctx]]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0); }
      const n = Math.round(Math.min(240, Math.max(70, (w * h) / 8500)) * cfg.n * (w < 600 ? 0.65 : 1));
      ps = Array.from({ length: n }, () => mk(true));
      bats = Array.from({ length: cfg.bats || 0 }, () => mkBat(true));
      glints = Array.from({ length: 26 }, () => ({ x: rnd(0, w), y: h - rnd(2, 26), p: rnd(0, 6.28) }));
    }
    function shape(g, k, s, col, ph) {
      if (k === 'heart') { g.fillStyle = col; g.beginPath(); g.moveTo(0, -s * 0.15); g.bezierCurveTo(0, -s * 0.5, -s * 0.55, -s * 0.5, -s * 0.55, -s * 0.1); g.bezierCurveTo(-s * 0.55, s * 0.25, 0, s * 0.4, 0, s * 0.6); g.bezierCurveTo(0, s * 0.4, s * 0.55, s * 0.25, s * 0.55, -s * 0.1); g.bezierCurveTo(s * 0.55, -s * 0.5, 0, -s * 0.5, 0, -s * 0.15); g.fill(); }
      else if (k === 'conf') { g.fillStyle = col; g.scale(1, Math.cos(t * 3 + ph)); g.fillRect(-s, -s * 0.5, s * 2, s); }
      else if (k === 'petal') { g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, 6.283); g.fill(); }
      else if (k === 'bubble') { g.strokeStyle = `rgba(${col},.85)`; g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, s, 0, 6.283); g.stroke(); g.fillStyle = `rgba(${col},.18)`; g.fill(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(-s * 0.35, -s * 0.35, Math.max(0.6, s * 0.22), 0, 6.283); g.fill(); }
      else if (k === 'glit') { g.globalAlpha *= 0.55 + 0.45 * Math.sin(t * 6 + ph); g.fillStyle = col; g.beginPath(); g.moveTo(0, -s * 1.6); g.lineTo(s * 0.35, -s * 0.35); g.lineTo(s * 1.6, 0); g.lineTo(s * 0.35, s * 0.35); g.lineTo(0, s * 1.6); g.lineTo(-s * 0.35, s * 0.35); g.lineTo(-s * 1.6, 0); g.lineTo(-s * 0.35, -s * 0.35); g.fill(); }
    }
    function draw(g, p, k, alpha) {
      g.save(); g.globalAlpha = alpha; g.translate(p.x, p.y);
      if (k === 'soft') { const sp = sprite(cfg.rgb || (isLight() ? '110,155,220' : '255,255,255')); g.drawImage(sp, -p.s, -p.s, p.s * 2, p.s * 2); }
      else { if (k === 'conf' || k === 'petal') g.rotate(p.rot); else if (k === 'heart') g.rotate(Math.sin(p.ph + t * p.fr) * 0.35); shape(g, k, p.s, p.col, p.ph); }
      g.restore();
    }
    function drawGround(light) {
      const G = GROUND[id]; if (!G) return;
      for (const [col, hh, f, ph] of (light && G.l) || G.d) {
        bctx.fillStyle = col; bctx.beginPath(); bctx.moveTo(0, h);
        for (let x = 0; x <= w + 20; x += 20) bctx.lineTo(x, h - hh * 0.5 - Math.sin(x * f + ph) * hh * 0.3 - Math.sin(x * f * 2.3 + ph * 2) * hh * 0.12);
        bctx.lineTo(w, h); bctx.closePath(); bctx.fill();
      }
      if (G.glint) for (const q of glints) { // glitzernde Schneekristalle
        bctx.globalAlpha = Math.max(0, Math.sin(t * 2.5 + q.p)) * 0.9; bctx.fillStyle = light ? '#7fa6e0' : '#fff';
        bctx.fillRect(q.x - 2, q.y, 5, 1); bctx.fillRect(q.x, q.y - 2, 1, 5);
      }
      bctx.globalAlpha = 1;
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
      bctx.clearRect(0, 0, w, h); fctx.clearRect(0, 0, w, h);
      drawGround(isLight());
      const wind = Math.sin(t * 0.13) * 18 + Math.sin(t * 0.41 + 1.3) * 9; // sanfte Windböen
      for (const p of ps) {
        p.x += (wind * (0.4 + p.d) + Math.sin(p.ph + t * p.fr) * p.amp) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.vy > 0 ? p.y > h + 20 : p.y < -20) { p.y = p.vy > 0 ? -20 : h + 20; p.x = rnd(0, w); }
        if (p.x > w + 24) p.x = -24; else if (p.x < -24) p.x = w + 24;
        draw(p.front ? fctx : bctx, p, cfg.shape, p.front ? p.a * 0.6 : p.a);
      }
      for (let i = 0; i < bats.length; i++) { // Fledermäuse fliegen quer durchs Bild
        const b = bats[i]; b.x += b.vx * dt; b.y += Math.sin(t * 2 + b.ph) * 30 * dt;
        if (b.x < -60 || b.x > w + 60) { bats[i] = mkBat(false); continue; }
        const f = Math.sin(t * 14 + b.ph) * 0.5 + 0.5, s = b.s;
        bctx.save(); bctx.translate(b.x, b.y); bctx.scale(b.dir, 1); bctx.fillStyle = 'rgba(18,10,28,.88)';
        for (const m of [1, -1]) { bctx.save(); bctx.scale(m, 1); bctx.beginPath(); bctx.moveTo(0, 0); bctx.quadraticCurveTo(-s * 0.7, -s * (0.9 * f + 0.1), -s * 1.4, s * 0.1); bctx.quadraticCurveTo(-s * 0.9, s * 0.05, -s * 0.7, s * 0.5); bctx.quadraticCurveTo(-s * 0.35, s * 0.15, 0, s * 0.35); bctx.fill(); bctx.restore(); }
        bctx.beginPath(); bctx.arc(0, s * 0.05, s * 0.22, 0, 6.283); bctx.fill(); bctx.restore();
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]; p.age += dt;
        if (p.age >= p.life) { puffs.splice(i, 1); continue; }
        p.vy += (cfg.up ? -120 : 300) * dt; p.vx *= 1 - 1.5 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        draw(fctx, p, cfg.burst, 1 - p.age / p.life);
      }
    }
    function burst(x, y) {
      for (let i = 0; i < 10; i++) puffs.push({ x: x + rnd(-6, 6), y, vx: rnd(-70, 70), vy: rnd(-130, -30), age: 0, life: rnd(0.5, 0.95),
        s: cfg.burst === 'soft' ? rnd(3, 7) : rnd(3, 8), ph: rnd(0, 6), fr: 1, rot: rnd(0, 6), vr: rnd(-6, 6), col: cfg.cols ? pick(cfg.cols) : null });
      if (puffs.length > 140) puffs.splice(0, puffs.length - 140);
    }
    function onClick(e) {
      const b = e.target && e.target.closest && e.target.closest('.btn,.chip,.item,.gear');
      if (!b || b.disabled) return;
      const r = b.getBoundingClientRect(); burst(r.left + r.width * rnd(0.2, 0.8), r.top);
    }
    function start(themeId) {
      if (back || reduced() || !FXT[themeId]) return;
      id = themeId; cfg = FXT[themeId]; puffs = []; last = 0;
      back = makeCanvas('fxBack'); front = makeCanvas('fxFront');
      document.body.prepend(back); document.body.append(front);
      bctx = back.getContext('2d'); fctx = front.getContext('2d');
      resize(); window.addEventListener('resize', resize); document.addEventListener('click', onClick, true);
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (!back) return;
      cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('click', onClick, true);
      back.remove(); front.remove(); back = front = bctx = fctx = null; ps = []; puffs = []; bats = [];
    }
    return { start, stop };
  })();

  /* ---------- Overlay-Partikel ---------- */
  function renderOverlay() {
    const layer = $('#overlayLayer');
    if (!layer) return;
    layer.textContent = '';
    FW.stop(); FX.stop();
    const o = OVERLAYS.find(x => x.id === T.getOverlay());
    if (!o || !o.id) return;
    if (o.fireworks) FW.start();
    FX.start(o.id);
    return;
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
