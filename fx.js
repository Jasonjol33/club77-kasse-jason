'use strict';
/*
 * CLUB 77 – Event-Overlays (Laser, Nebel, Champagner, Konfetti, Schnee, Feuerwerk)
 * Reine Darstellung: Canvas über der Kasse, klick-durchlässig, pausiert im Hintergrund-Tab.
 * Die Auswahl wird pro Gerät gespeichert (localStorage).
 */
(() => {
  const cv = document.getElementById('fxCanvas');
  if (!cv) return;
  const cx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = 'club77-event';
  const LEVELS = [
    { id: 'low', name: 'Dezent', v: 0.55 },
    { id: 'mid', name: 'Normal', v: 1 },
    { id: 'high', name: 'Stark', v: 1.5 },
  ];
  const EVENTS = [
    { id: 'off', icon: '⛔', name: 'Kein Event', desc: 'Normale Kasse' },
    { id: 'laser', icon: '⚡', name: 'Laser-Show', desc: 'Strahlen im Takt' },
    { id: 'nebel', icon: '🌫️', name: 'Club-Nebel', desc: 'Nebel mit Scheinwerfern' },
    { id: 'champagner', icon: '🥂', name: 'Champagner', desc: 'Aufsteigende Perlen' },
    { id: 'konfetti', icon: '🎊', name: 'Konfetti', desc: 'Party-Regen' },
    { id: 'schnee', icon: '❄️', name: 'Winternacht', desc: 'Schneefall, Glühwein-Abend' },
    { id: 'feuerwerk', icon: '🎆', name: 'Feuerwerk', desc: 'Silvester-Show' },
  ];

  let W = 0, H = 0, raf = 0, last = 0, t = 0;
  let mode = 'off', lvl = 1, lvlId = 'mid';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => { resize(); if (M[mode] && M[mode].init) M[mode].init(); });

  /* ---------- Konfetti-Ebene (läuft in jedem Modus, auch für den Fun-Knopf) ---------- */
  const COLS = ['#ff2bd6', '#8b5cf6', '#22d3ee', '#fde047', '#ffffff', '#fb7185', '#34d399'];
  let conf = [];
  function confetti(x, y, vx, vy, g, drag) {
    conf.push({ x, y, vx, vy, g, drag, w: rnd(6, 11), h: rnd(10, 18), rot: rnd(0, 6.28), vr: rnd(-6, 6), fl: rnd(0, 6.28), vf: rnd(4, 11), c: pick(COLS), ph: rnd(0, 6.28) });
  }
  function burst() {
    if (reduce.matches) return;
    for (const side of [0, 1]) {
      const x = side ? W + 5 : -5, dir = side ? -1 : 1;
      for (let i = 0; i < 70; i++) {
        const a = -rnd(0.45, 1.25), s = rnd(600, 1100);
        confetti(x, H + 5, dir * Math.cos(a) * s * 0.8, Math.sin(a) * s, 320, 2.1);
      }
    }
    start();
  }
  function drawConf(dt) {
    cx.globalCompositeOperation = 'source-over';
    for (const p of conf) {
      p.vy += p.g * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += (p.vx + Math.sin(t * 1.8 + p.ph) * 22) * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt; p.fl += p.vf * dt;
      const f = Math.cos(p.fl);
      cx.save();
      cx.translate(p.x, p.y); cx.rotate(p.rot); cx.scale(1, f);
      cx.globalAlpha = (0.7 + 0.3 * Math.abs(f)) * Math.min(1, lvl + 0.3);
      cx.fillStyle = p.c;
      cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
    }
    cx.globalAlpha = 1;
    conf = conf.filter(p => p.y < H + 30 && p.x > -60 && p.x < W + 60);
  }

  /* ---------- Modi ---------- */
  const clear = () => { cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, W, H); };
  const M = {};

  // Laser: je 5 Strahlen aus 3 Projektoren, Glow + heller Kern, Puls im 128-BPM-Takt
  M.laser = {
    init() { this.em = [{ x: W * 0.1, c: '255,43,214', ph: 0 }, { x: W * 0.9, c: '34,211,238', ph: 2.1 }, { x: W * 0.5, c: '167,139,250', ph: 4.2 }]; },
    frame() {
      clear();
      cx.globalCompositeOperation = 'lighter';
      cx.lineCap = 'round';
      const beat = 0.7 + 0.3 * Math.sin(t * Math.PI * 2 * (128 / 60));
      const len = Math.hypot(W, H) * 1.3;
      for (const e of this.em) {
        const glow = cx.createRadialGradient(e.x, 0, 0, e.x, 0, 120);
        glow.addColorStop(0, `rgba(${e.c},${0.35 * lvl * beat})`); glow.addColorStop(1, `rgba(${e.c},0)`);
        cx.fillStyle = glow; cx.fillRect(e.x - 120, 0, 240, 120);
        for (let i = 0; i < 5; i++) {
          const a = Math.PI / 2 + Math.sin(t * 0.7 + e.ph + i * 0.4) * 0.85 + (i - 2) * 0.17;
          const x2 = e.x + Math.cos(a) * len, y2 = Math.sin(a) * len;
          for (const [w, al] of [[16, 0.05], [5, 0.13], [1.6, 0.8]]) {
            const g = cx.createLinearGradient(e.x, 0, x2, y2);
            g.addColorStop(0, `rgba(${e.c},${Math.min(1, al * lvl * beat)})`);
            g.addColorStop(0.7, `rgba(${e.c},${Math.min(1, al * lvl * beat * 0.45)})`);
            g.addColorStop(1, `rgba(${e.c},0)`);
            cx.strokeStyle = g; cx.lineWidth = w;
            cx.beginPath(); cx.moveTo(e.x, 0); cx.lineTo(x2, y2); cx.stroke();
          }
        }
      }
    },
  };

  // Nebel: driftende, farbig angeleuchtete Schwaden + zwei schwenkende Scheinwerferkegel
  M.nebel = {
    init() { this.b = Array.from({ length: 9 }, () => ({ x: rnd(0, W), y: rnd(H * 0.2, H), r: rnd(220, 420), vx: rnd(-14, 14), vy: rnd(-6, 6), ph: rnd(0, 6.28) })); },
    frame(dt) {
      clear();
      const hue = (t * 14) % 360;
      cx.globalCompositeOperation = 'lighter';
      for (const o of this.b) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x < -o.r) o.x = W + o.r; if (o.x > W + o.r) o.x = -o.r;
        if (o.y < H * 0.1) o.vy = Math.abs(o.vy); if (o.y > H) o.vy = -Math.abs(o.vy);
        const al = (0.07 + 0.03 * Math.sin(t * 0.5 + o.ph)) * lvl;
        const g = cx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, `hsla(${(hue + o.ph * 20) % 360},90%,60%,${al})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
        cx.fillStyle = g; cx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
      }
      for (const [x0, ph, col] of [[W * 0.25, 0, '255,43,214'], [W * 0.75, 3, '34,211,238']]) {
        const a = Math.PI / 2 + Math.sin(t * 0.45 + ph) * 0.5, wdt = 0.13, len = H * 1.3;
        const g = cx.createLinearGradient(x0, 0, x0 + Math.cos(a) * len, Math.sin(a) * len);
        g.addColorStop(0, `rgba(${col},${0.26 * lvl})`); g.addColorStop(1, `rgba(${col},0)`);
        cx.fillStyle = g; cx.beginPath(); cx.moveTo(x0, -10);
        cx.lineTo(x0 + Math.cos(a - wdt) * len, Math.sin(a - wdt) * len);
        cx.lineTo(x0 + Math.cos(a + wdt) * len, Math.sin(a + wdt) * len);
        cx.closePath(); cx.fill();
      }
    },
  };

  // Champagner: Perlen mit Glanzpunkt, leichtes Schwanken, goldene Glitzer
  M.champagner = {
    init() { this.p = []; for (let i = 0; i < 60 * lvl; i++) this.spawn(rnd(0, H)); this.s = []; },
    spawn(y) { this.p.push({ x: rnd(0, W), y: y ?? H + 10, r: rnd(1.5, 6.5), ph: rnd(0, 6.28), a: rnd(4, 14) }); },
    frame(dt) {
      clear();
      if (Math.random() < dt * 34 * lvl) this.spawn();
      if (Math.random() < dt * 5 * lvl) this.s.push({ x: rnd(0, W), y: rnd(0, H), life: 0, max: rnd(0.6, 1.3), r: rnd(6, 14) });
      for (const b of this.p) {
        b.y -= (28 + b.r * 13) * dt;
        const x = b.x + Math.sin(t * 2 + b.ph) * b.a;
        cx.fillStyle = 'rgba(255,230,170,0.07)'; cx.beginPath(); cx.arc(x, b.y, b.r, 0, 6.283); cx.fill();
        cx.strokeStyle = 'rgba(255,238,190,0.4)'; cx.lineWidth = 1; cx.stroke();
        cx.fillStyle = 'rgba(255,255,255,0.85)'; cx.beginPath(); cx.arc(x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.6, b.r * 0.26), 0, 6.283); cx.fill();
      }
      this.p = this.p.filter(b => b.y > -12);
      cx.globalCompositeOperation = 'lighter';
      for (const s of this.s) {
        s.life += dt; const k = Math.sin(Math.PI * Math.min(1, s.life / s.max)) * lvl;
        cx.strokeStyle = `rgba(255,220,130,${0.9 * Math.min(1, k)})`; cx.lineWidth = 1.2;
        cx.beginPath(); cx.moveTo(s.x - s.r, s.y); cx.lineTo(s.x + s.r, s.y); cx.moveTo(s.x, s.y - s.r); cx.lineTo(s.x, s.y + s.r); cx.stroke();
      }
      this.s = this.s.filter(s => s.life < s.max);
      cx.globalCompositeOperation = 'source-over';
    },
  };

  // Konfetti: fortlaufender, leichter Regen (die Ebene selbst zeichnet die Teilchen)
  M.konfetti = {
    init() {},
    frame(dt) {
      clear();
      if (Math.random() < dt * 22 * lvl) confetti(rnd(0, W), -20, rnd(-20, 20), rnd(10, 60), 150, 1.8);
    },
  };

  // Schnee: drei Tiefenebenen, ferne Flocken klein/scharf, nahe groß und unscharf
  let flakeSprite;
  function sprite() {
    if (flakeSprite) return flakeSprite;
    flakeSprite = document.createElement('canvas'); flakeSprite.width = flakeSprite.height = 64;
    const c = flakeSprite.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return flakeSprite;
  }
  M.schnee = {
    init() { this.f = Array.from({ length: Math.round(150 * lvl) }, () => this.make(rnd(0, H))); },
    make(y) { const l = pick([0, 0, 0, 1, 1, 2]); return { x: rnd(0, W), y: y ?? -10, l, r: [2.2, 4, 9][l], vy: [28, 55, 110][l] * rnd(0.8, 1.2), ph: rnd(0, 6.28), al: [0.75, 0.6, 0.28][l] }; },
    frame(dt) {
      clear();
      const s = sprite(), wind = Math.sin(t * 0.25) * 22;
      for (const f of this.f) {
        f.y += f.vy * dt; f.x += (Math.sin(t * 0.9 + f.ph) * 18 + wind) * (f.l + 1) * 0.5 * dt;
        if (f.y > H + 12) { f.y = -12; f.x = rnd(0, W); }
        if (f.x < -12) f.x = W + 12; if (f.x > W + 12) f.x = -12;
        cx.globalAlpha = f.al * Math.min(1, lvl + 0.2);
        cx.drawImage(s, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      }
      cx.globalAlpha = 1;
    },
  };

  // Feuerwerk: Raketen mit Funkenschweif, Explosion mit Schwerkraft, Nachleuchten durch Ausblenden
  M.feuerwerk = {
    init() {
      this.r = []; this.p = []; this.fl = []; this.next = 0.3;
      // eigene Ebene für die Nachleuchtspuren, damit Konfetti nicht verschmiert
      this.o = document.createElement('canvas'); this.o.width = cv.width; this.o.height = cv.height;
      this.c = this.o.getContext('2d'); this.c.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      clear();
    },
    frame(dt) {
      const c = this.c;
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      this.next -= dt;
      if (this.next <= 0) { this.next = rnd(0.6, 1.6) / lvl; this.r.push({ x: rnd(W * 0.12, W * 0.88), y: H + 8, vy: -Math.sqrt(2 * 260 * H * rnd(0.45, 0.8)), vx: rnd(-30, 30), hue: rnd(0, 360) }); }
      for (const r of this.r) {
        r.vy += 260 * dt; r.x += r.vx * dt; r.y += r.vy * dt;
        c.fillStyle = 'rgba(255,230,180,0.9)'; c.fillRect(r.x - 1, r.y - 1, 2.4, 2.4);
        if (Math.random() < 0.7) this.p.push({ x: r.x, y: r.y, vx: rnd(-15, 15), vy: rnd(10, 40), life: 0, max: rnd(0.3, 0.6), hue: 40, spark: true });
        if (r.vy > -30) {
          r.dead = true;
          const n = Math.round(80 * Math.min(1.3, lvl + 0.2)), two = Math.random() < 0.4;
          for (let i = 0; i < n; i++) {
            const a = rnd(0, 6.283), sp = rnd(60, 270);
            this.p.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(1.1, 2), hue: two && i % 2 ? (r.hue + 150) % 360 : r.hue });
          }
          this.fl.push({ x: r.x, y: r.y, life: 0 });
        }
      }
      this.r = this.r.filter(r => !r.dead);
      for (const p of this.p) {
        p.life += dt;
        if (!p.spark) { p.vy += 130 * dt; const k = Math.max(0, 1 - 1.5 * dt); p.vx *= k; p.vy *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        const a = Math.max(0, 1 - p.life / p.max);
        c.fillStyle = `hsla(${p.hue},100%,${p.spark ? 75 : 62}%,${a})`;
        c.beginPath(); c.arc(p.x, p.y, p.spark ? 1 : 1.7 * (0.5 + a), 0, 6.283); c.fill();
      }
      this.p = this.p.filter(p => p.life < p.max);
      for (const f of this.fl) {
        f.life += dt; const a = Math.max(0, 0.35 - f.life) * lvl;
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, 260);
        g.addColorStop(0, `rgba(255,240,220,${a})`); g.addColorStop(1, 'rgba(255,240,220,0)');
        c.fillStyle = g; c.fillRect(f.x - 260, f.y - 260, 520, 520);
      }
      this.fl = this.fl.filter(f => f.life < 0.35);
      clear(); cx.drawImage(this.o, 0, 0, W, H);
    },
  };

  /* ---------- Schleife ---------- */
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; t += dt;
    const m = M[mode];
    if (m) m.frame(dt); else clear();
    drawConf(dt);
    if (!m && !conf.length) stop();
  }
  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; clear(); }

  /* ---------- API ---------- */
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ id: mode, lvl: lvlId })); } catch { /* Speicher nicht verfügbar */ } }
  function apply() {
    if (reduce.matches) { mode = 'off'; conf = []; stop(); return; }
    const m = M[mode];
    if (!m) { mode = 'off'; if (!conf.length) stop(); return; }
    lvl = (LEVELS.find(l => l.id === lvlId) || LEVELS[1]).v;
    clear(); if (m.init) m.init(); start();
  }
  function setEvent(id) { mode = EVENTS.some(e => e.id === id) ? id : 'off'; if (mode === 'off') { conf = []; stop(); } else apply(); save(); }
  function setLevel(id) { lvlId = LEVELS.some(l => l.id === id) ? id : 'mid'; lvl = LEVELS.find(l => l.id === lvlId).v; if (mode !== 'off') apply(); save(); }

  resize();
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); if (s.lvl) lvlId = s.lvl; if (s.id) mode = s.id; } catch { /* ignorieren */ }
  if (!M[mode]) mode = 'off';
  lvl = (LEVELS.find(l => l.id === lvlId) || LEVELS[1]).v;
  if (mode !== 'off') apply();

  window.CLUB77_FX = {
    EVENTS, LEVELS, burst,
    get reduced() { return reduce.matches; },
    get: () => ({ id: mode, lvl: lvlId }),
    setEvent, setLevel,
  };
})();
