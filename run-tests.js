'use strict';
/*
 * Integrationstests: startet den echten Server (eigener Prozess, temporäre Datenbank) und einen Mock-Discord-Server.
 * Aufruf: npm test
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; failures.push(name); console.log('  ✖', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50); } return false; }

/* ---------------- Mock Discord ---------------- */
function startMockDiscord() {
  const state = { received: [], failNext: 0, port: 0 };
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      if (state.failNext > 0) { state.failNext--; res.writeHead(500); return res.end('fail'); }
      try { state.received.push(JSON.parse(b)); } catch { /* ignore */ }
      res.writeHead(204); res.end();
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => { state.port = srv.address().port; state.close = () => srv.close(); resolve(state); }));
}

/* ---------------- Server-Prozess ---------------- */
function startServer(env) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const onData = d => { log += d; if (/läuft auf Port/.test(log)) resolve({ proc, port, base: `http://127.0.0.1:${port}`, getLog: () => log, stop: () => new Promise(r => { proc.once('exit', r); proc.kill('SIGTERM'); }) }); };
    proc.stdout.on('data', onData); proc.stderr.on('data', d => { log += d; });
    proc.on('exit', code => reject(new Error('Server beendet: ' + code + '\n' + log)));
    setTimeout(() => reject(new Error('Server-Start Timeout\n' + log)), 10000);
  });
}

/* ---------------- HTTP-Client mit Cookie ---------------- */
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body, opt = {}) {
    const headers = { 'X-Requested-With': 'club77', ...(opt.headers || {}) };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opt.noXrw) delete headers['X-Requested-With'];
    const res = await fetch(this.base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers, text };
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b, o) { return this.req('POST', u, b === undefined ? {} : b, o); }
  patch(u, b) { return this.req('PATCH', u, b); }
}
const rid = () => 'req-' + Math.random().toString(36).slice(2) + Date.now();

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'club77-test-'));
  const discord = await startMockDiscord();
  const baseEnv = {
    DATA_DIR: dataDir, ADMIN_USERNAME: 'chef', ADMIN_PASSWORD: 'Sup3rGeheimesPasswort!',
    DISCORD_WEBHOOK: `http://127.0.0.1:${discord.port}/api/webhooks/1/abc`, DISCORD_ALLOW_ANY_URL: '1', DISCORD_AUTO_CREATE: 'on',
    DISCORD_RETRY_BASE_MS: '100', OUTBOX_INTERVAL_MS: '300', MAX_STAFF_DISCOUNT: '60',
  };
  let srv = await startServer(baseEnv);
  console.log('Server gestartet auf', srv.base);

  /* ---------- 1. Nicht angemeldet ---------- */
  console.log('\n[1] Zugriff ohne Anmeldung');
  const anon = new Client(srv.base);
  for (const [m, u] of [['GET', '/api/products'], ['POST', '/api/invoices'], ['GET', '/api/invoices'], ['GET', '/api/stats'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users'], ['POST', '/api/discord/daily'], ['GET', '/api/admin/export.csv'], ['GET', '/api/invoices/1']]) {
    const r = await anon.req(m, u, m === 'GET' ? undefined : {});
    check(`${m} ${u} → 401`, r.status === 401, r.status);
  }
  const st0 = await anon.get('/api/status');
  check('Status ohne Login: kein Setup nötig, kein Benutzer', st0.data.setupNeeded === false && st0.data.user === null);

  /* ---------- 2. Admin ---------- */
  console.log('\n[2] Administrator');
  const admin = new Client(srv.base);
  let r = await admin.post('/api/login', { username: 'chef', password: 'falsch' });
  check('Falsches Passwort wird abgelehnt (401)', r.status === 401);
  r = await admin.post('/api/login', { username: 'chef', password: 'Sup3rGeheimesPasswort!' });
  check('Admin kann sich anmelden', r.status === 200 && r.data.user.role === 'admin', r.data);
  check('Session-Cookie ist HttpOnly + SameSite=Strict', /HttpOnly/i.test(r.headers.get('set-cookie')) && /SameSite=Strict/i.test(r.headers.get('set-cookie')));
  check('Antwort enthält keinen Passwort-Hash', !/scrypt|password_hash|"password"/i.test(JSON.stringify(r.data)));

  /* ---------- 3. Mitarbeiter anlegen ---------- */
  console.log('\n[3] Mitarbeiter anlegen / Erstanmeldung');
  const staff = {};
  for (const n of ['Mitarbeiter01', 'Mitarbeiter02', 'Mitarbeiter03']) {
    r = await admin.post('/api/admin/users', { username: n, password: `Start-${n}-Pw!` });
    check(`Admin erstellt ${n}`, r.status === 201 && r.data.user.role === 'cashier' && r.data.user.mustChangePassword === true, r.data);
    staff[n] = { id: r.data.user.id, client: new Client(srv.base), pw: `Neu-${n}-Passwort#1` };
  }
  r = await admin.post('/api/admin/users', { username: 'mitarbeiter01', password: 'IrgendwasLanges1' });
  check('Doppelter Benutzername (Groß/Klein egal) → 409', r.status === 409);
  r = await admin.post('/api/admin/users', { username: 'Neu Ling', password: 'IrgendwasLanges1' });
  check('Ungültiger Benutzername → 400', r.status === 400);
  r = await admin.post('/api/admin/users', { username: 'Kurzpw', password: 'kurz' });
  check('Zu kurzes Passwort → 400', r.status === 400);
  r = await admin.post('/api/admin/users', { username: 'AutoPw' });
  check('Ohne Passwort wird ein zufälliges generiert und einmalig zurückgegeben', r.status === 201 && typeof r.data.temporaryPassword === 'string' && r.data.temporaryPassword.length >= 12);
  const autoPwUser = r.data.user; const autoPw = r.data.temporaryPassword;

  for (const [n, s] of Object.entries(staff)) {
    r = await s.client.post('/api/login', { username: n, password: `Start-${n}-Pw!` });
    check(`${n} meldet sich mit Startpasswort an`, r.status === 200 && r.data.user.mustChangePassword === true);
    r = await s.client.get('/api/products');
    check(`${n}: vor Passwortwechsel gesperrt (403 PASSWORD_CHANGE_REQUIRED)`, r.status === 403 && r.data.code === 'PASSWORD_CHANGE_REQUIRED');
    r = await s.client.post('/api/me/password', { currentPassword: 'falsch', newPassword: s.pw });
    check(`${n}: Passwortwechsel mit falschem Altpasswort scheitert`, r.status === 403);
    r = await s.client.post('/api/me/password', { currentPassword: `Start-${n}-Pw!`, newPassword: s.pw });
    check(`${n}: Passwortwechsel klappt`, r.status === 200);
    r = await s.client.get('/api/products');
    check(`${n}: danach Zugriff auf Produkte`, r.status === 200 && r.data.categories.length === 5);
  }

  /* ---------- 4. Katalog 1:1 aus Original ---------- */
  console.log('\n[4] Produktkatalog entspricht der Original-Datei');
  const orig = fs.existsSync('/mnt/user-data/uploads/Club77.html') ? fs.readFileSync('/mnt/user-data/uploads/Club77.html', 'utf8') : null;
  if (orig) {
    const expected = {};
    for (const m of orig.matchAll(/<div class="card"><h3>([^<]+)<\/h3>\s*<div class="grid" id="[a-z]+">\s*([\s\S]*?)\s*<\/div><\/div>/g)) {
      expected[m[1].trim()] = m[2].trim().split(',').map(x => x.trim().split('|')).filter(x => x[0]).map(([n, p]) => [n, +p]);
    }
    const cats = (await staff.Mitarbeiter01.client.get('/api/products')).data.categories;
    const got = {}; for (const c of cats) got[c.title] = c.items.map(i => [i.name, i.price]);
    check('Kategorien identisch (Titel + Reihenfolge)', JSON.stringify(Object.keys(expected)) === JSON.stringify(Object.keys(got)), [Object.keys(expected), Object.keys(got)]);
    check('Alle Produkte + Preise identisch', JSON.stringify(expected) === JSON.stringify(got));
    check(`Anzahl Produkte: ${Object.values(expected).flat().length}`, Object.values(expected).flat().length === Object.values(got).flat().length);
  } else console.log('  (Original-HTML nicht gefunden – Vergleich übersprungen)');

  /* ---------- 5. Rechnungen erstellen ---------- */
  console.log('\n[5] Rechnungen');
  const c1 = staff.Mitarbeiter01.client, c2 = staff.Mitarbeiter02.client, c3 = staff.Mitarbeiter03.client;
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 2 }, { name: 'Wodka-E', quantity: 3 }] });
  check('M01: Rechnung erstellt (201)', r.status === 201, r.data);
  const inv1 = r.data.invoice;
  check('Summe serverseitig: 2×800 + 3×1600 = 6.400', inv1.total === 6400 && inv1.subtotal === 6400, inv1);
  check('Rechnung gehört M01 (Name + ID)', inv1.cashierName === 'Mitarbeiter01' && inv1.cashierId === staff.Mitarbeiter01.id);
  check('Rechnungsnummer-Format R-000001', inv1.number === 'R-000001', inv1.number);
  check('Positionen mit Einzelpreis gespeichert', inv1.items.length === 2 && inv1.items.every(i => i.unitPrice > 0 && i.category));

  // Manipulationsversuche: Preis/Kassierer/Summe vom Client werden ignoriert
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'VIP Lounge Groß', quantity: 1, unitPrice: 1, price: 1 }], total: 1, cashierId: staff.Mitarbeiter02.id, cashierName: 'Mitarbeiter02' });
  check('Manipulierter Preis/Kassierer wird ignoriert (1.000.000 €, M01)', r.status === 201 && r.data.invoice.total === 1000000 && r.data.invoice.cashierName === 'Mitarbeiter01', r.data);
  const vipInv = r.data.invoice;
  for (const [label, items] of [
    ['unbekanntes Produkt', [{ name: 'Gratis-Bier', quantity: 1 }]],
    ['Menge 0', [{ name: 'Cola', quantity: 0 }]],
    ['negative Menge', [{ name: 'Cola', quantity: -5 }]],
    ['Kommazahl als Menge', [{ name: 'Cola', quantity: 1.5 }]],
    ['Menge als Text', [{ name: 'Cola', quantity: '3' }]],
    ['Menge > 9999', [{ name: 'Cola', quantity: 10000 }]],
    ['leerer Warenkorb', []],
  ]) {
    r = await c1.post('/api/invoices', { requestId: rid(), items });
    check(`Ungültig abgelehnt: ${label} (400)`, r.status === 400, r.data);
  }
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }], discountPercent: 101 });
  check('Rabatt 101 % abgelehnt', r.status === 400);
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }], discountPercent: 12.5 });
  check('Rabatt 12,5 % (keine ganze Zahl) abgelehnt', r.status === 400);
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }], discountPercent: 61 });
  check('Mitarbeiter-Rabattlimit (MAX_STAFF_DISCOUNT=60) → 403', r.status === 403);
  r = await c1.post('/api/invoices', { items: [{ name: 'Cola', quantity: 1 }] });
  check('Fehlende requestId → 400', r.status === 400);

  r = await c2.post('/api/invoices', { requestId: rid(), items: [{ name: 'Tequila-Sunrise', quantity: 2 }, { name: 'Pommes', quantity: 1 }], discountPercent: 10, discountReason: 'Stammgast <b>x</b>' });
  check('M02: 10 % Rabatt: 3.700 − 370 = 3.330', r.status === 201 && r.data.invoice.subtotal === 3700 && r.data.invoice.discountAmount === 370 && r.data.invoice.total === 3330, r.data);
  check('Rabattgrund gespeichert', r.data.invoice.discountReason === 'Stammgast <b>x</b>');
  const inv2 = r.data.invoice;
  r = await c3.post('/api/invoices', { requestId: rid(), items: [{ name: 'Donut Box', quantity: 4 }, { name: 'Donut Box', quantity: 1 }, { name: 'Bier', quantity: 7 }] });
  check('M03: doppelte Positionen werden zusammengeführt (5×2.500 + 7×800 = 18.100)', r.status === 201 && r.data.invoice.total === 18100 && r.data.invoice.items.length === 2, r.data);
  const inv3 = r.data.invoice;
  check('Rundung wie im Original (33 % von 1.400 = 462)', (await c3.post('/api/invoices', { requestId: rid(), items: [{ name: 'Rum', quantity: 1 }], discountPercent: 33 })).data.invoice.discountAmount === 462);

  // Idempotenz
  const dupId = rid();
  const a = await c1.post('/api/invoices', { requestId: dupId, items: [{ name: 'Pommes', quantity: 1 }] });
  const b = await c1.post('/api/invoices', { requestId: dupId, items: [{ name: 'Pommes', quantity: 1 }] });
  check('Wiederholte Anfrage (gleiche requestId) erzeugt KEINE zweite Rechnung', a.data.invoice.id === b.data.invoice.id && b.data.duplicate === true && b.status === 200);

  /* ---------- 6. Trennung der Mitarbeiter ---------- */
  console.log('\n[6] Trennung der Mitarbeiter / Berechtigungen');
  r = await c1.get('/api/invoices?limit=200');
  check('M01 sieht nur eigene Rechnungen', r.data.invoices.length > 0 && r.data.invoices.every(i => i.cashierName === 'Mitarbeiter01'), r.data.invoices.map(i => i.cashierName));
  r = await c1.get(`/api/invoices?cashier=${staff.Mitarbeiter02.id}&limit=200`);
  check('?cashier= von M02 wird für M01 ignoriert', r.data.invoices.every(i => i.cashierName === 'Mitarbeiter01'));
  r = await c1.get('/api/invoices/' + inv2.id);
  check('M01 kann Rechnung von M02 NICHT abrufen (404)', r.status === 404);
  r = await c1.get('/api/invoices/' + inv1.id);
  check('M01 kann eigene Rechnung abrufen', r.status === 200 && r.data.invoice.number === inv1.number);
  check('Nicht-Admin bekommt keine Discord-Interna', r.data.invoice.discord === undefined);
  r = await c1.post(`/api/invoices/${inv2.id}/storno`, { reason: 'Betrugsversuch egal' });
  check('M01 kann nicht stornieren (403)', r.status === 403);
  r = await c1.get(`/api/stats?cashier=${staff.Mitarbeiter02.id}`);
  check('Statistik: ?cashier= wird ignoriert, nur eigene Werte', r.status === 200 && r.data.range.cashier === staff.Mitarbeiter01.id);
  check('Statistik M01 enthält keine Mitarbeiterliste', r.data.byCashier === undefined);
  for (const [m, u, body] of [
    ['GET', '/api/admin/users'], ['POST', '/api/admin/users', { username: 'Hacker', password: 'Hackerpasswort123', role: 'admin' }],
    ['PATCH', `/api/admin/users/${staff.Mitarbeiter02.id}`, { active: false }], ['POST', `/api/admin/users/${staff.Mitarbeiter02.id}/reset-password`, {}],
    ['GET', '/api/admin/audit'], ['GET', '/api/admin/export.csv'],
  ]) {
    r = await c1.req(m, u, m === 'GET' ? undefined : body);
    check(`Mitarbeiter: ${m} ${u.split('?')[0]} → 403`, r.status === 403, r.status);
  }
  r = await c1.patch(`/api/admin/users/${staff.Mitarbeiter01.id}`, { role: 'admin', active: true });
  check('Selbst-Beförderung zum Admin nicht möglich', r.status === 403);
  r = await c1.post('/api/discord/daily', { scope: 'all' });
  check('Gesamt-Tagesumsatz (scope=all) nur für Admin (403)', r.status === 403);
  r = await c1.get('/api/me');
  check('Rolle bleibt "cashier" (Server entscheidet)', r.data.user.role === 'cashier');

  /* ---------- 7. Admin sieht alles, Summen stimmen ---------- */
  console.log('\n[7] Admin-Auswertung');
  r = await admin.get('/api/invoices?limit=200');
  const all = r.data.invoices;
  check('Admin sieht Rechnungen aller Mitarbeiter', new Set(all.map(i => i.cashierName)).size === 3, all.map(i => i.cashierName));
  const sumAll = all.reduce((s, i) => s + i.total, 0);
  r = await admin.get('/api/stats');
  check('Gesamtumsatz = Summe der gespeicherten Rechnungen', r.data.summary.revenue === sumAll, [r.data.summary.revenue, sumAll]);
  check('Anzahl Rechnungen stimmt', r.data.summary.invoiceCount === all.length);
  const perUser = r.data.byCashier;
  let okPer = true;
  for (const u of perUser) { const mine = all.filter(i => i.cashierId === u.id); if (u.revenue !== mine.reduce((s, i) => s + i.total, 0) || u.invoiceCount !== mine.length) okPer = false; }
  check('Umsatz + Anzahl pro Mitarbeiter stimmen', okPer);
  check('Summe der Mitarbeiter = Gesamtumsatz', perUser.reduce((s, u) => s + u.revenue, 0) === r.data.summary.revenue);
  check('Tagesumsatz heute = Gesamt (alles heute erstellt)', r.data.todaySummary.revenue === sumAll);
  r = await admin.get(`/api/stats?cashier=${staff.Mitarbeiter03.id}`);
  check('Admin-Filter nach Mitarbeiter', r.data.summary.revenue === all.filter(i => i.cashierId === staff.Mitarbeiter03.id).reduce((s, i) => s + i.total, 0));
  r = await admin.get('/api/stats?from=2000-01-01&to=2000-12-31');
  check('Zeitraum ohne Daten → 0', r.data.summary.revenue === 0 && r.data.summary.invoiceCount === 0);
  r = await admin.get('/api/stats?from=today&to=today');
  check('Zeitraum "heute" = Gesamt', r.data.summary.revenue === sumAll);
  r = await admin.get('/api/stats?from=2026-13-45');
  check('Ungültiges Datum → 400', r.status === 400);
  r = await admin.get('/api/invoices?q=R-00000');
  check('Suche nach Rechnungsnummer', r.data.invoices.length > 0);
  r = await admin.get('/api/invoices?q=Mitarbeiter02');
  check('Admin-Suche nach Mitarbeitername', r.data.invoices.length === 1 && r.data.invoices[0].cashierName === 'Mitarbeiter02');
  r = await c2.get('/api/invoices?q=Tequila');
  check('Mitarbeiter-Suche nach Produkt (nur eigene)', r.data.invoices.length === 1 && r.data.invoices[0].cashierName === 'Mitarbeiter02');
  r = await c1.get('/api/invoices?q=Tequila');
  check('M01 findet Rechnungen von M02 per Suche nicht', r.data.invoices.length === 0);
  r = await c1.get('/api/invoices?q=' + encodeURIComponent("%' OR 1=1 --"));
  check('SQL-Sonderzeichen in Suche sind harmlos', r.status === 200 && r.data.invoices.length === 0);
  r = await admin.get('/api/invoices/' + inv2.id);
  check('Admin sieht Details fremder Rechnung', r.status === 200 && r.data.invoice.cashierName === 'Mitarbeiter02');
  r = await admin.get('/api/admin/export.csv');
  check('CSV-Export (Admin)', r.status === 200 && /^"Nummer";"Art"/.test(r.text) && r.text.includes('R-000001') && /text\/csv/.test(r.headers.get('content-type')));
  {
    const raw = Buffer.from(await (await fetch(srv.base + '/api/admin/export.csv', { headers: { Cookie: admin.cookie } })).arrayBuffer());
    check('CSV beginnt mit UTF-8-BOM (Excel-tauglich)', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);
  }

  /* ---------- 8. Stornierung ---------- */
  console.log('\n[8] Storno');
  r = await admin.post(`/api/invoices/${vipInv.id}/storno`, { reason: 'abc' });
  check('Storno ohne ausreichenden Grund → 400', r.status === 400);
  const before = (await admin.get('/api/stats')).data.summary;
  r = await admin.post(`/api/invoices/${vipInv.id}/storno`, { reason: 'Falsch eingegeben, Kunde hat nur Tisch gebucht' });
  check('Admin storniert mit Grund (201)', r.status === 201 && r.data.invoice.kind === 'storno' && r.data.invoice.total === -1000000, r.data);
  check('Storno-Nummer S-000001, Bezug + Grund gespeichert', r.data.invoice.number === 'S-000001' && r.data.invoice.refNumber === vipInv.number && r.data.invoice.stornoReason.includes('Falsch'));
  const stornoInv = r.data.invoice;
  r = await admin.post(`/api/invoices/${vipInv.id}/storno`, { reason: 'Noch einmal versucht' });
  check('Doppelte Stornierung → 409', r.status === 409);
  r = await admin.post(`/api/invoices/${stornoInv.id}/storno`, { reason: 'Storno stornieren geht nicht' });
  check('Storno eines Storno → 400', r.status === 400);
  const after = (await admin.get('/api/stats')).data;
  check('Umsatz sinkt um den Stornobetrag', after.summary.revenue === before.revenue - 1000000);
  check('Rechnungsanzahl unverändert, Storno separat gezählt', after.summary.invoiceCount === before.invoiceCount && after.summary.stornoCount === 1);
  r = await admin.get('/api/invoices/' + vipInv.id);
  check('Originalrechnung unverändert und als storniert markiert', r.data.invoice.total === 1000000 && r.data.invoice.stornoNumber === 'S-000001');
  r = await c1.get('/api/invoices/' + stornoInv.id);
  check('M01 sieht den Storno zu seiner Rechnung', r.status === 200 && r.data.invoice.kind === 'storno');
  r = await c2.get('/api/invoices/' + stornoInv.id);
  check('M02 sieht fremden Storno nicht (404)', r.status === 404);
  const m1stats = (await c1.get('/api/stats')).data.summary;
  const m1sum = (await c1.get('/api/invoices?limit=200')).data.invoices.reduce((s, i) => s + i.total, 0);
  check('Mitarbeiter-Umsatz berücksichtigt Storno und stimmt mit Rechnungsliste überein', m1stats.revenue === m1sum, [m1stats.revenue, m1sum]);

  /* ---------- 9. Unveränderbarkeit auf Datenbankebene ---------- */
  console.log('\n[9] Unveränderbarkeit (DB-Trigger)');
  {
    const dbx = new DatabaseSync(path.join(dataDir, 'club77.db'));
    dbx.exec('PRAGMA foreign_keys=ON');
    const t = (sql) => { try { dbx.exec(sql); return false; } catch (e) { return /unveränderbar|dürfen nicht|darf nicht/.test(e.message); } };
    check('UPDATE auf invoices blockiert', t(`UPDATE invoices SET total=1 WHERE id=1`));
    check('DELETE auf invoices blockiert', t(`DELETE FROM invoices WHERE id=1`));
    check('UPDATE auf invoice_items blockiert', t(`UPDATE invoice_items SET quantity=99 WHERE id=1`));
    check('DELETE auf invoice_items blockiert', t(`DELETE FROM invoice_items WHERE id=1`));
    check('UPDATE auf audit_log blockiert', t(`UPDATE audit_log SET action='x' WHERE id=1`));
    check('DELETE auf audit_log blockiert', t(`DELETE FROM audit_log WHERE id=1`));
    const pw = dbx.prepare('SELECT password_hash FROM users WHERE username=?').get('Mitarbeiter01').password_hash;
    check('Passwort nur als scrypt-Hash gespeichert (kein Klartext)', pw.startsWith('scrypt$') && !pw.includes('Mitarbeiter01') && !pw.includes('Passwort'));
    const sess = dbx.prepare('SELECT token_hash FROM sessions LIMIT 1').get().token_hash;
    check('Sitzungstoken nur als SHA-256-Hash gespeichert', /^[0-9a-f]{64}$/.test(sess) && !c1.cookie.includes(sess));
    dbx.close();
  }

  /* ---------- 10. Deaktivieren / Sitzung beenden ---------- */
  console.log('\n[9b] Produktverwaltung (nur Admin)');
  {
    const m1 = staff['Mitarbeiter01'];
    const cash = new Client(srv.base);
    let q = await cash.post('/api/login', { username: 'Mitarbeiter01', password: m1.pw });
    check('Mitarbeiter angemeldet (Testvorbereitung)', q.status === 200, q.data);
    for (const [m, u] of [['GET', '/api/admin/products'], ['POST', '/api/admin/products'], ['PATCH', '/api/admin/products/1'], ['DELETE', '/api/admin/products/1']]) {
      q = await cash.req(m, u, m === 'GET' || m === 'DELETE' ? undefined : {});
      check(`Mitarbeiter: ${m} ${u} → 403`, q.status === 403, q.status);
    }
    q = await admin.get('/api/admin/products');
    check('Admin sieht Produktliste + Kategorien', q.status === 200 && q.data.products.length >= 40 && q.data.categories.length === 5, q.status);
    const cola = q.data.products.find(p => p.name === 'Cola');
    q = await admin.post('/api/admin/products', { name: 'Mojito', price: 1500, categoryId: 'long' });
    check('Admin legt Produkt an (201)', q.status === 201 && q.data.product.name === 'Mojito' && q.data.product.price === 1500, q.data);
    const mojito = q.data.product;
    q = await admin.post('/api/admin/products', { name: 'mojito', price: 1, categoryId: 'long' });
    check('Doppelter Name (egal wie geschrieben) → 409', q.status === 409);
    q = await admin.post('/api/admin/products', { name: 'X', price: 1.5, categoryId: 'long' });
    check('Preis mit Komma/Dezimal → 400', q.status === 400);
    q = await admin.post('/api/admin/products', { name: 'X', price: -5, categoryId: 'long' });
    check('Negativer Preis → 400', q.status === 400);
    q = await admin.post('/api/admin/products', { name: 'X', price: 5, categoryId: 'gibtsnicht' });
    check('Unbekannte Kategorie → 400', q.status === 400);
    q = await cash.get('/api/products');
    check('Neues Produkt erscheint an der Kasse', q.data.categories.some(c => c.items.some(i => i.name === 'Mojito' && i.price === 1500)));
    q = await admin.patch('/api/admin/products/' + cola.id, { price: 900 });
    check('Preis ändern (200)', q.status === 200 && q.data.product.price === 900, q.data);
    let inv = await cash.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 2 }, { name: 'Mojito', quantity: 1 }], discountPercent: 0 });
    check('Rechnung nutzt die neuen Preise (2×900 + 1500 = 3300)', inv.status === 201 && inv.data.invoice.total === 3300, inv.data);
    q = await admin.patch('/api/admin/products/' + mojito.id, { active: false });
    check('Ausblenden (200)', q.status === 200 && q.data.product.active === false);
    inv = await cash.post('/api/invoices', { requestId: rid(), items: [{ name: 'Mojito', quantity: 1 }], discountPercent: 0 });
    check('Ausgeblendetes Produkt ist nicht mehr verkaufbar (400)', inv.status === 400, inv.status);
    q = await cash.get('/api/products');
    check('Ausgeblendetes Produkt nicht an der Kasse', !q.data.categories.some(c => c.items.some(i => i.name === 'Mojito')));
    q = await admin.req('DELETE', '/api/admin/products/' + mojito.id);
    check('Löschen (200)', q.status === 200);
    q = await admin.patch('/api/admin/products/' + cola.id, { price: 800 });
    check('Preis zurücksetzen', q.status === 200 && q.data.product.price === 800);
    q = await admin.get('/api/admin/audit?limit=50');
    check('Audit-Log enthält Produktänderungen', JSON.stringify(q.data).includes('product.update') && JSON.stringify(q.data).includes('product.create'));
  }

  console.log('\n[10] Konten deaktivieren, Abmelden');
  r = await c3.get('/api/products');
  check('M03 ist angemeldet', r.status === 200);
  r = await admin.patch(`/api/admin/users/${staff.Mitarbeiter03.id}`, { active: false });
  check('Admin deaktiviert M03', r.status === 200 && r.data.user.active === false);
  r = await c3.get('/api/products');
  check('Bestehende Sitzung von M03 sofort ungültig (401)', r.status === 401);
  const c3b = new Client(srv.base);
  r = await c3b.post('/api/login', { username: 'Mitarbeiter03', password: staff.Mitarbeiter03.pw });
  check('Deaktiviertes Konto kann sich nicht anmelden (401)', r.status === 401);
  r = await admin.patch(`/api/admin/users/${staff.Mitarbeiter03.id}`, { active: true });
  check('Admin aktiviert M03 wieder', r.status === 200 && r.data.user.active === true);
  r = await c3b.post('/api/login', { username: 'Mitarbeiter03', password: staff.Mitarbeiter03.pw });
  check('M03 kann sich wieder anmelden', r.status === 200);
  staff.Mitarbeiter03.client = c3b;
  r = await admin.patch(`/api/admin/users/${(await admin.get('/api/me')).data.user.id}`, { active: false });
  check('Admin kann sich nicht selbst deaktivieren', r.status === 400);
  r = await admin.post(`/api/admin/users/${autoPwUser.id}/reset-password`, {});
  check('Passwort-Reset liefert neues Einmalpasswort', r.status === 200 && r.data.temporaryPassword && r.data.temporaryPassword !== autoPw);
  const autoC = new Client(srv.base);
  r = await autoC.post('/api/login', { username: 'AutoPw', password: autoPw });
  check('Altes Passwort nach Reset ungültig', r.status === 401);

  const oldCookie = c2.cookie;
  r = await c2.post('/api/logout');
  check('Abmelden (200)', r.status === 200);
  const replay = new Client(srv.base); replay.cookie = oldCookie;
  r = await replay.get('/api/products');
  check('Altes Session-Cookie nach Abmeldung wertlos (401)', r.status === 401);
  r = await c2.post('/api/login', { username: 'Mitarbeiter02', password: staff.Mitarbeiter02.pw });
  check('M02 kann sich erneut anmelden', r.status === 200);

  /* ---------- 11. Sicherheit allgemein ---------- */
  console.log('\n[11] Sicherheit');
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }] }, { noXrw: true });
  check('Schreibender Aufruf ohne X-Requested-With → 403', r.status === 403);
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }] }, { headers: { Origin: 'https://evil.example' } });
  check('Fremde Origin → 403 (CSRF)', r.status === 403);
  const rawBad = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'club77', 'Content-Type': 'text/plain' }, body: '{}' });
  check('Falscher Content-Type → 415', rawBad.status === 415);
  const rawJson = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'club77', 'Content-Type': 'application/json' }, body: '{kaputt' });
  check('Kaputtes JSON → 400 (kein 500)', rawJson.status === 400);
  const big = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'club77', 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(100000) }) }).catch(() => ({ status: 413 }));
  check('Zu große Anfrage abgelehnt', big.status === 413 || big.status === 0);
  r = await anon.get('/api/gibtsnicht');
  check('Unbekannte API → 404 JSON', r.status === 404);
  const page = await fetch(srv.base + '/');
  const html = await page.text();
  const js = await (await fetch(srv.base + '/app.js')).text();
  check('Startseite wird ausgeliefert', page.status === 200 && html.includes('CLUB 77'));
  check('CSP + Security-Header gesetzt', /script-src 'self'/.test(page.headers.get('content-security-policy')) && page.headers.get('x-frame-options') === 'DENY');
  check('Kein Webhook / Secret in HTML oder JS', !/discord\.com\/api\/webhooks|webhooks\/\d|127\.0\.0\.1:\d+\/api\/webhooks|Sup3rGeheimes/.test(html + js));
  check('Kein inline-JavaScript (onclick=) im HTML', !/\sonclick=|<script>(?!<)/.test(html.replace(/<script src[^>]*><\/script>/, '')));
  for (const p of ['/server.js', '/../server.js', '/%2e%2e/server.js', '/lib/db.js', '/package.json', '/data/club77.db']) {
    const x = await fetch(srv.base + p);
    check(`Kein Zugriff auf ${p}`, x.status === 404 || x.status === 400, x.status);
  }
  // Login-Brute-Force-Schutz
  const bf = new Client(srv.base);
  let last;
  for (let i = 0; i < 6; i++) last = await bf.post('/api/login', { username: 'Mitarbeiter01', password: 'raten' + i });
  check('Nach 5 Fehlversuchen gesperrt (429 + Retry-After)', last.status === 429 && !!last.headers.get('retry-after'), last.status);
  r = await bf.post('/api/login', { username: 'Mitarbeiter01', password: staff.Mitarbeiter01.pw });
  check('Auch korrektes Passwort wird während der Sperre abgelehnt', r.status === 429);
  r = await admin.get('/api/admin/audit');
  check('Audit-Log enthält Login-Fehlversuche, Storno, Zugriffsverstöße', ['login.failed', 'invoice.storno', 'access.denied', 'user.create'].every(a => r.data.entries.some(e => e.action === a)));

  /* ---------- 12. Discord ---------- */
  console.log('\n[12] Discord (Mock-Webhook): Bons werden nur gesammelt, nur der Tagesumsatz wird gesendet');
  await sleep(1500);
  check('Bons wurden NICHT an Discord gesendet (nur gesammelt)', discord.received.length === 0, discord.received.length);
  check('Antwort beim Bon-Speichern enthält keine Discord-Zustellinfo', inv1.discord === undefined);
  {
    // Storno einer Rechnung MIT Rabatt: wird gespeichert, aber ebenfalls nicht an Discord gesendet
    const rr = await admin.post(`/api/invoices/${inv2.id}/storno`, { reason: 'Rabatt-Storno Test' });
    check('Storno mit Rabatt erstellt', rr.status === 201 && rr.data.invoice.total === -3330);
    await sleep(800);
    check('Storno wird nicht an Discord gesendet', discord.received.length === 0, discord.received.length);
  }
  // Discord-Ausfall darf das Speichern nie beeinflussen
  discord.failNext = 5;
  r = await c1.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }] });
  check('Rechnung wird gespeichert (201)', r.status === 201);
  const failedInv = r.data.invoice;
  check('Rechnung ist abrufbar', (await c1.get('/api/invoices/' + failedInv.id)).status === 200);
  r = await admin.get('/api/invoices/' + failedInv.id);
  check('Admin sieht keinen Discord-Versandstatus mehr', r.status === 200 && r.data.invoice.discord === undefined);
  discord.failNext = 0;
  await sleep(500);
  check('Immer noch keine Discord-Meldung für Bons', discord.received.length === 0);

  // Tagesumsatz – die einzige Meldung, die nach Discord geht (nur auf Knopfdruck)
  const n0 = discord.received.length;
  r = await c1.post('/api/discord/daily', { scope: 'own' });
  check('Tagesumsatz (eigener) an Discord (200)', r.status === 200);
  await waitFor(() => discord.received.length > n0);
  check('Genau eine Meldung (der Tagesumsatz)', discord.received.length === 1, discord.received.length);
  check('allowed_mentions verhindert @-Pings', discord.received.every(p => p.allowed_mentions && Array.isArray(p.allowed_mentions.parse) && p.allowed_mentions.parse.length === 0));
  const daily = discord.received[discord.received.length - 1].embeds[0];
  check('Tagesumsatz-Embed: Titel, Kassierer, Kategorien (stornierte VIP-Buchung ist herausgerechnet)', daily.title.includes('Tagesumsatz') && daily.description.includes('Mitarbeiter01') && daily.fields.some(f => f.name.startsWith('🥤 Alkoholfrei')) && daily.fields.some(f => f.name.startsWith('🍹 Longdrinks')) && !daily.fields.some(f => f.name.startsWith('💎 VIP')), daily);
  const m1now = (await c1.get('/api/stats')).data.summary.revenue;
  check('Tagesumsatz-Gesamt in Discord = Serverstatistik', daily.fields.some(f => f.name === '✅ Gesamt' && f.value.includes(m1now.toLocaleString('de-DE'))), [m1now, daily.fields]);
  r = await c1.post('/api/discord/daily', { scope: 'own' });
  check('Doppelklick-Schutz beim Tagesumsatz (429)', r.status === 429);
  r = await admin.post('/api/discord/daily', { scope: 'all' });
  check('Admin: Gesamt-Tagesumsatz an Discord', r.status === 200);
  await sleep(200);
  const allEmbed = discord.received[discord.received.length - 1].embeds[0];
  check('Gesamt-Embed enthält Aufschlüsselung pro Mitarbeiter', allEmbed.fields.some(f => f.name.includes('Pro Mitarbeiter') && f.value.includes('Mitarbeiter02')));

  /* ---------- 13. Neustart / Persistenz ---------- */
  console.log('\n[13] Neustart');
  const listBefore = (await admin.get('/api/invoices?limit=200')).data;
  const statsBefore = (await admin.get('/api/stats')).data.summary;
  const adminCookie = admin.cookie;
  await srv.stop();
  srv = await startServer(baseEnv);
  const admin2 = new Client(srv.base); admin2.cookie = adminCookie;
  r = await admin2.get('/api/invoices?limit=200');
  check('Rechnungen nach Neustart vollständig vorhanden', r.data.total === listBefore.total && JSON.stringify(r.data.invoices.map(i => [i.number, i.total, i.cashierName])) === JSON.stringify(listBefore.invoices.map(i => [i.number, i.total, i.cashierName])));
  check('Umsatz nach Neustart identisch', (await admin2.get('/api/stats')).data.summary.revenue === statsBefore.revenue);
  check('Sitzung bleibt über Neustart/Seitenaktualisierung erhalten', (await admin2.get('/api/me')).status === 200);
  r = await admin2.get('/api/admin/users');
  check('Mitarbeiterkonten nach Neustart vorhanden (≥ 5 Konten)', r.data.users.length >= 5);
  const fresh = new Client(srv.base);
  r = await fresh.post('/api/login', { username: 'mitarbeiter02', password: staff.Mitarbeiter02.pw });
  check('Mitarbeiter kann sich nach Neustart anmelden (Benutzername ohne Groß/Klein)', r.status === 200);
  r = await fresh.post('/api/invoices', { requestId: rid(), items: [{ name: 'Pommes', quantity: 1 }] });
  check('Nummernkreis läuft nach Neustart lückenlos weiter', r.status === 201 && /^R-0000(0[89]|1\d)$/.test(r.data.invoice.number), r.data.invoice && r.data.invoice.number);
  check('Admin-Passwort aus ENV wurde beim Neustart nicht erneut angelegt', (await admin2.get('/api/admin/users')).data.users.filter(u => u.role === 'admin').length === 1);
  await srv.stop();

  /* ---------- 14. Ersteinrichtung ohne ADMIN_PASSWORD ---------- */
  console.log('\n[14] Ersteinrichtung (Setup-Code)');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'club77-setup-'));
  const s2 = await startServer({ DATA_DIR: dir2, ADMIN_PASSWORD: '', ADMIN_USERNAME: '', DISCORD_WEBHOOK: '' });
  const m = s2.getLog().match(/SETUP-CODE: (\S+)/);
  check('Setup-Code wird nur ins Server-Log geschrieben', !!m);
  const sc = new Client(s2.base);
  check('Status meldet setupNeeded', (await sc.get('/api/status')).data.setupNeeded === true);
  r = await sc.post('/api/login', { username: 'admin', password: 'irgendwas' });
  check('Ohne Admin kein Login möglich', r.status === 401);
  r = await sc.post('/api/setup-admin', { setupCode: 'falsch', username: 'boss', password: 'EinLangesPasswort1' });
  check('Falscher Setup-Code → 403', r.status === 403);
  r = await sc.post('/api/setup-admin', { setupCode: m[1], username: 'boss', password: 'kurz' });
  check('Schwaches Passwort → 400', r.status === 400);
  r = await sc.post('/api/setup-admin', { setupCode: m[1], username: 'boss', password: 'EinLangesPasswort1' });
  check('Richtiger Code legt Administrator an (201)', r.status === 201);
  r = await sc.post('/api/setup-admin', { setupCode: m[1], username: 'boss2', password: 'EinLangesPasswort1' });
  check('Setup ist danach gesperrt (409)', r.status === 409);
  r = await sc.post('/api/login', { username: 'boss', password: 'EinLangesPasswort1' });
  check('Neuer Administrator kann sich anmelden', r.status === 200 && r.data.user.role === 'admin');
  r = await sc.post('/api/discord/daily', { scope: 'own' });
  check('Ohne Webhook: Discord-Funktion meldet sauber 503', r.status === 503);
  r = await sc.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 1 }] });
  check('Rechnungen funktionieren auch ohne Discord', r.status === 201);
  await s2.stop();


  /* ---------- 15. Anmeldung / Autorisierung mit Discord (OAuth + Rollen) ---------- */
  console.log('\n[15] Autorisierung durch Discord (Server-Mitgliedschaft + Rolle, Konto entsteht automatisch)');
  {
    const noGuild = new Set();
    const rolesOf = new Map(); // Discord-ID -> Rollen (Standard: Mitarbeiter-Rolle 555)
    const nickOf = new Map();
    const oa = http.createServer((req, res) => {
      let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
        const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        const bearer = (req.headers.authorization || '').replace('Bearer tok-', '');
        if (req.url === '/api/oauth2/token') {
          const f = new URLSearchParams(b);
          const okBasic = req.headers.authorization === 'Basic ' + Buffer.from('cid:csecret').toString('base64');
          if (!okBasic || f.get('grant_type') !== 'authorization_code' || !f.get('code_verifier') || !/^code-\d+$/.test(f.get('code') || '')) { res.writeHead(400); return res.end('{}'); }
          return json({ access_token: 'tok-' + f.get('code').slice(5) });
        }
        if (req.url === '/api/users/@me') return json({ id: bearer, username: 'user' + bearer.slice(-4), global_name: 'Disc ' + bearer.slice(-4) });
        if (req.url === '/api/users/@me/guilds/999/member') {
          if (noGuild.has(bearer)) { res.writeHead(404); return res.end('{}'); }
          return json({ roles: rolesOf.has(bearer) ? rolesOf.get(bearer) : ['555'], nick: nickOf.get(bearer) || null });
        }
        res.writeHead(404); res.end();
      });
    });
    await new Promise(r => oa.listen(0, '127.0.0.1', r));
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'club77-oauth-'));
    const oauthEnv = { DATA_DIR: dir3, ADMIN_USERNAME: 'chef', ADMIN_PASSWORD: 'Sup3rGeheimesPasswort!', DISCORD_WEBHOOK: '',
      PUBLIC_URL: 'https://kasse.example', DISCORD_AUTO_CREATE: 'on', DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'csecret', DISCORD_GUILD_ID: '999',
      DISCORD_STAFF_ROLE_ID: '555', DISCORD_ADMIN_ROLE_ID: '666', DISCORD_OAUTH_BASE: `http://127.0.0.1:${oa.address().port}` };
    const s3 = await startServer(oauthEnv);
    const raw = async (url, cookie) => { const x = await fetch(s3.base + url, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} }); return { status: x.status, location: x.headers.get('location') || '', cookies: x.headers.getSetCookie() }; };
    const startLogin = async () => { const x = await raw('/api/auth/discord/start'); const state = new URL(x.location).searchParams.get('state'); return { x, state, cookie: x.cookies[0].split(';')[0] }; };
    const loginAs = async id => { const t = await startLogin(); const x = await raw(`/api/auth/discord/callback?code=code-${id}&state=${t.state}`, t.cookie); const sess = x.cookies.find(c => c.startsWith('c77_session=')); return { x, sess, client: (() => { const c = new Client(s3.base); if (sess) c.cookie = sess.split(';')[0]; return c; })() }; };
    const A = new Client(s3.base);
    await A.post('/api/login', { username: 'chef', password: 'Sup3rGeheimesPasswort!' });
    const userCount = async () => (await A.get('/api/admin/users?archived=1')).data.users.length;
    check('Status meldet discordLogin = true', (await A.get('/api/status')).data.discordLogin === true);
    const st = await startLogin();
    const loc = new URL(st.x.location);
    check('Start leitet zu Discord weiter (PKCE S256, state, Redirect-URI, Scope identify + guilds.members.read)', st.x.status === 302 && loc.pathname === '/oauth2/authorize' && loc.searchParams.get('code_challenge_method') === 'S256' && loc.searchParams.get('redirect_uri') === 'https://kasse.example/api/auth/discord/callback' && loc.searchParams.get('scope') === 'identify guilds.members.read' && loc.searchParams.get('client_id') === 'cid' && st.state.length >= 20);
    check('State-Cookie: HttpOnly + SameSite=Lax', /HttpOnly/i.test(st.x.cookies[0]) && /SameSite=Lax/i.test(st.x.cookies[0]));

    // Ohne Mitarbeiter-Rolle: kein Zugang, kein Konto
    rolesOf.set('11111111111111111', []);
    const n0u = await userCount();
    let l = await loginAs('11111111111111111');
    check('Mitglied OHNE Mitarbeiter-Rolle → ?discord=role, keine Sitzung', l.x.location === '/?discord=role' && !l.sess);
    check('…und es wird kein Konto angelegt', (await userCount()) === n0u);

    // Mit Rolle: Konto entsteht automatisch, KEINE Discord-ID vom Admin nötig
    const DID = '22222222222222222';
    nickOf.set(DID, 'Anna K');
    l = await loginAs(DID);
    check('Mit Mitarbeiter-Rolle: Weiterleitung "/" + Session-Cookie (HttpOnly, Strict)', l.x.status === 302 && l.x.location === '/' && l.sess && /HttpOnly/i.test(l.sess) && /SameSite=Strict/i.test(l.sess), l.x);
    const E = l.client;
    let r = await E.get('/api/me');
    check('Konto wurde automatisch angelegt (Name aus Discord-Nickname, Rolle cashier)', r.status === 200 && r.data.user.username === 'AnnaK' && r.data.user.role === 'cashier' && r.data.user.discordLinked === true, r.data);
    check('Kein Passwortwechsel nötig, Kasse sofort nutzbar', r.data.user.mustChangePassword === false && (await E.get('/api/products')).status === 200);
    check('Discord-Login verschafft keine Admin-Rechte (403)', (await E.get('/api/admin/users')).status === 403);
    r = await E.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 2 }] });
    check('Automatisch angelegter Mitarbeiter kann Bons erstellen', r.status === 201 && r.data.invoice.cashierName === 'AnnaK');
    r = await new Client(s3.base).post('/api/login', { username: 'AnnaK', password: 'irgendwas-12345' });
    check('Passwort-Anmeldung für das Discord-Konto nicht möglich (zufälliges Passwort)', r.status === 401);
    const nAfter = await userCount();
    l = await loginAs(DID);
    check('Zweiter Login: gleiches Konto, kein Duplikat', l.sess && (await userCount()) === nAfter && (await l.client.get('/api/me')).data.user.username === 'AnnaK');

    // Gleicher Anzeigename → eindeutiger Benutzername
    nickOf.set('33333333333333333', 'Anna K');
    l = await loginAs('33333333333333333');
    check('Gleicher Anzeigename → Benutzername wird eindeutig (AnnaK2)', (await l.client.get('/api/me')).data.user.username === 'AnnaK2');
    nickOf.set('55555555555555555', '🔥🔥');
    l = await loginAs('55555555555555555');
    check('Name ohne gültige Zeichen → Ersatzname "Mitarbeiter"', (await l.client.get('/api/me')).data.user.username === 'Mitarbeiter');

    // Admin-Rolle auf Discord => Administrator; Entzug => zurückgestuft (solange ein anderer Admin existiert)
    const AD = '44444444444444444';
    rolesOf.set(AD, ['666']);
    l = await loginAs(AD);
    r = await l.client.get('/api/me');
    check('Discord-Admin-Rolle → Administrator', r.data.user.role === 'admin' && (await l.client.get('/api/admin/users')).status === 200);
    rolesOf.set(AD, ['555']);
    l = await loginAs(AD);
    check('Admin-Rolle auf Discord entzogen → beim nächsten Login Mitarbeiter', (await l.client.get('/api/me')).data.user.role === 'cashier' && (await l.client.get('/api/admin/users')).status === 403);
    rolesOf.set(AD, []);
    l = await loginAs(AD);
    check('Alle Rollen entzogen → Login verweigert (?discord=role)', l.x.location === '/?discord=role' && !l.sess);

    // Missbrauchsversuche
    const ok1 = await startLogin();
    let x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=${ok1.state}`, ok1.cookie);
    check('Erster Callback ok', x.location === '/');
    x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=${ok1.state}`, ok1.cookie);
    check('Wiederverwendeter State/Code wird abgelehnt', x.location === '/?discord=state');
    const ok2 = await startLogin();
    x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=${ok2.state}`);
    check('Ohne State-Cookie abgelehnt (Login-CSRF-Schutz)', x.location === '/?discord=state' && !x.cookies.some(c => c.startsWith('c77_session=')));
    const ok3 = await startLogin(), other = await startLogin();
    x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=${ok3.state}`, other.cookie);
    check('State-Cookie passt nicht zum State → abgelehnt', x.location === '/?discord=state');
    x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=erfunden`, ok3.cookie);
    check('Erfundener State → abgelehnt', x.location === '/?discord=state');
    const ok4 = await startLogin();
    x = await raw(`/api/auth/discord/callback?error=access_denied&state=${ok4.state}`, ok4.cookie);
    check('Abbruch bei Discord → ?discord=cancel', x.location === '/?discord=cancel');
    const ok5 = await startLogin();
    x = await raw(`/api/auth/discord/callback?code=falsch&state=${ok5.state}`, ok5.cookie);
    check('Ungültiger Code (Discord lehnt ab) → ?discord=error', x.location === '/?discord=error');

    // Server-Mitgliedschaft + Deaktivierung
    noGuild.add('66666666666666666');
    const nG = await userCount();
    l = await loginAs('66666666666666666');
    check('Kein Mitglied des Discord-Servers → ?discord=guild, kein Konto', l.x.location === '/?discord=guild' && !l.sess && (await userCount()) === nG);
    const uid = (await A.get('/api/admin/users')).data.users.find(u => u.username === 'AnnaK').id;
    check('Admin-Liste zeigt Discord-Name, aber keine Discord-ID', (await A.get('/api/admin/users')).data.users.every(u => u.discordId === undefined));
    await A.patch(`/api/admin/users/${uid}`, { active: false });
    check('Deaktivierung beendet die Discord-Sitzung', (await E.get('/api/me')).status === 401);
    l = await loginAs(DID);
    check('Deaktiviertes Konto kann sich trotz Discord-Rolle nicht anmelden', l.x.location === '/?discord=denied' && !l.sess);
    await A.patch(`/api/admin/users/${uid}`, { active: true });
    check('Nach Aktivierung wieder möglich', (await loginAs(DID)).sess);

    // Eine Discord-ID von Hand eintragen gibt es nicht mehr
    r = await A.post(`/api/admin/users/${uid}/discord`, { discordId: '12345678901234567' });
    check('Route "Discord-ID setzen" existiert nicht mehr (404)', r.status === 404);

    // Bestehendes Passwort-Konto per Discord verknüpfen
    r = await A.post('/api/admin/users', { username: 'Mitarbeiter02', password: 'StartPasswort-456' });
    const linkReq = async c => { const x = await fetch(s3.base + '/api/me/discord/link', { method: 'POST', headers: { 'X-Requested-With': 'club77', 'Content-Type': 'application/json', Cookie: c.cookie }, body: '{}' }); let data = {}; try { data = await x.json(); } catch { /* */ } return { status: x.status, data, headers: x.headers }; };
    const M2 = new Client(s3.base);
    await M2.post('/api/login', { username: 'Mitarbeiter02', password: 'StartPasswort-456' });
    r = await linkReq(M2);
    check('Verknüpfen ohne abgeschlossenen Passwortwechsel gesperrt (403)', r.status === 403);
    await M2.post('/api/me/password', { currentPassword: 'StartPasswort-456', newPassword: 'Eigenes-Passwort-789' });
    r = await linkReq(M2);
    check('Verknüpfen: liefert Discord-URL + State-Cookie', r.status === 200 && r.data.url.includes('/oauth2/authorize') && /c77_oauth=/.test(r.headers.get('set-cookie')));
    const ls = new URL(r.data.url).searchParams.get('state'), lc = r.headers.get('set-cookie').split(';')[0];
    x = await raw(`/api/auth/discord/callback?code=code-${DID}&state=${ls}`, lc);
    check('Verknüpfen mit bereits vergebenem Discord-Konto → ?discord=taken', x.location === '/?discord=taken');
    rolesOf.set('77777777777777777', []);
    r = await linkReq(M2);
    const lsr = new URL(r.data.url).searchParams.get('state'), lcr = r.headers.get('set-cookie').split(';')[0];
    x = await raw(`/api/auth/discord/callback?code=code-77777777777777777&state=${lsr}`, lcr);
    check('Verknüpfen ohne Mitarbeiter-Rolle → ?discord=role', x.location === '/?discord=role');
    r = await linkReq(M2);
    const ls2 = new URL(r.data.url).searchParams.get('state'), lc2 = r.headers.get('set-cookie').split(';')[0];
    x = await raw(`/api/auth/discord/callback?code=code-88888888888888888&state=${ls2}`, lc2);
    check('Verknüpfen klappt → ?discord=linked', x.location === '/?discord=linked');
    r = await M2.get('/api/me');
    check('Konto zeigt Verknüpfung', r.data.user.discordLinked === true && /^Disc /.test(r.data.user.discordName));
    l = await loginAs('88888888888888888');
    check('Discord-Login landet im verknüpften Konto (kein neues Konto)', (await l.client.get('/api/me')).data.user.username === 'Mitarbeiter02');
    r = await M2.post('/api/me/discord/unlink');
    check('Verknüpfung lösen', r.status === 200 && (await M2.get('/api/me')).data.user.discordLinked === false);
    const noAuth = await linkReq(new Client(s3.base));
    check('Verknüpfen ohne Anmeldung → 401', noAuth.status === 401);
    {
      const en = (await A.get('/api/admin/audit?limit=500')).data.entries;
      check('Audit enthält Discord-Ereignisse', ['discord.link', 'discord.account_created', 'discord.login_no_role', 'discord.role_sync'].every(a => en.some(e => e.action === a)));
    }
    await s3.stop(); oa.close(); fs.rmSync(dir3, { recursive: true, force: true });

    const s4 = await startServer({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'club77-off-')), ADMIN_PASSWORD: 'Sup3rGeheimesPasswort!', ADMIN_USERNAME: 'chef', DISCORD_WEBHOOK: '' });
    const off = await fetch(s4.base + '/api/auth/discord/start', { redirect: 'manual' });
    const offStatus = (await (await fetch(s4.base + '/api/status')).json()).discordLogin;
    check('Ohne Konfiguration meldet /api/status discordLogin = false', offStatus === false);
    await s4.stop();
    check('Ohne Konfiguration: Discord-Login aus (→ ?discord=off)', off.status === 302 && off.headers.get('location') === '/?discord=off');
    // Ohne Mitarbeiter-Rolle in der Konfiguration bleibt der Login AUS (sonst könnte jedes Servermitglied die Kasse benutzen)
    const s5b = await startServer({ ...oauthEnv, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'club77-norole-')), DISCORD_STAFF_ROLE_ID: '' });
    check('Ohne DISCORD_STAFF_ROLE_ID ist der Discord-Login deaktiviert', (await (await fetch(s5b.base + '/api/status')).json()).discordLogin === false);
    await s5b.stop();
  }

  /* ---------- 16. Konten löschen ---------- */
  console.log('\n[16] Konten löschen (komplett)');
  {
    const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'club77-del-'));
    const s5 = await startServer({ DATA_DIR: dir5, ADMIN_USERNAME: 'chef', ADMIN_PASSWORD: 'Sup3rGeheimesPasswort!', DISCORD_WEBHOOK: '' });
    const A = new Client(s5.base); await A.post('/api/login', { username: 'chef', password: 'Sup3rGeheimesPasswort!' });
    const mk = async n => (await A.post('/api/admin/users', { username: n, password: 'Start-Passwort-' + n })).data.user;
    const leer = await mk('Leer01'), aktiv = await mk('Aktiv01'), aktiv2 = await mk('Aktiv02');
    const B = new Client(s5.base); await B.post('/api/login', { username: 'Aktiv01', password: 'Start-Passwort-Aktiv01' });
    await B.post('/api/me/password', { currentPassword: 'Start-Passwort-Aktiv01', newPassword: 'Neues-Passwort-Aktiv01' });
    const bi = await B.post('/api/invoices', { requestId: rid(), items: [{ name: 'Cola', quantity: 3 }] });
    const aid = (await A.get('/api/admin/users')).data.users.find(u => u.username === 'chef').id;
    let r = await B.req('DELETE', `/api/admin/users/${leer.id}`);
    check('Mitarbeiter darf nicht löschen (403)', r.status === 403);
    r = await new Client(s5.base).req('DELETE', `/api/admin/users/${leer.id}`);
    check('Ohne Anmeldung nicht löschbar (401)', r.status === 401);
    r = await A.req('DELETE', `/api/admin/users/${aid}`);
    check('Admin kann sich nicht selbst löschen (400)', r.status === 400);
    r = await A.req('DELETE', `/api/admin/users/${leer.id}`);
    check('Konto ohne Rechnungen wird wirklich gelöscht', r.status === 200 && r.data.result === 'deleted');
    check('…und steht nicht mehr in der Liste', !(await A.get('/api/admin/users?archived=1')).data.users.some(u => u.username === 'Leer01'));
    r = await new Client(s5.base).post('/api/login', { username: 'Leer01', password: 'Start-Passwort-Leer01' });
    check('Gelöschtes Konto kann sich nicht anmelden', r.status === 401);
    check('Benutzername ist danach wieder frei', (await A.post('/api/admin/users', { username: 'Leer01', password: 'AnderesPasswort-123' })).status === 201);
    r = await A.req('DELETE', `/api/admin/users/${aktiv.id}`);
    check('Konto MIT Rechnungen wird ebenfalls komplett gelöscht', r.status === 200 && r.data.result === 'deleted');
    check('Gelöscht: nicht mehr in der Benutzerliste', !(await A.get('/api/admin/users')).data.users.some(u => u.username === 'Aktiv01'));
    check('Gelöscht: auch nicht in der Liste mit ?archived=1 (kein Archiv mehr)', !(await A.get('/api/admin/users?archived=1')).data.users.some(u => u.username === 'Aktiv01'));
    check('Sitzung des gelöschten Kontos sofort beendet', (await B.get('/api/me')).status === 401);
    r = await new Client(s5.base).post('/api/login', { username: 'Aktiv01', password: 'Neues-Passwort-Aktiv01' });
    check('Gelöschtes Konto kann sich nicht anmelden', r.status === 401);
    r = await A.get('/api/invoices/' + bi.data.invoice.id);
    check('Rechnung bleibt erhalten, Name steht weiterhin darin', r.status === 200 && r.data.invoice.cashierName === 'Aktiv01');
    r = await A.get('/api/stats');
    check('Umsatz des gelöschten Kassierers bleibt in der Auswertung (als "gelöscht")', r.data.summary.revenue === 2400 && r.data.byCashier.some(c => c.username === 'Aktiv01' && c.revenue === 2400 && c.archived));
    check('Gelöschter Kassierer ohne Umsatz im Zeitraum wird nicht gezeigt', !(await A.get('/api/stats?from=2000-01-01&to=2000-01-02')).data.byCashier.some(c => c.username === 'Aktiv01'));
    check('Rechnungsfilter kennt gelöschten Kassierer (?former=1)', (await A.get('/api/admin/users?former=1')).data.users.some(u => u.username === 'Aktiv01' && u.archived));
    r = await A.get('/api/invoices?cashier=' + aktiv.id);
    check('Rechnungen des gelöschten Kassierers weiter filterbar', r.status === 200 && JSON.stringify(r.data).includes(bi.data.invoice.number));
    r = await A.post('/api/admin/users', { username: 'aktiv01', password: 'AnderesPasswort-123' });
    check('Benutzername ist nach dem Löschen wieder frei (neues, getrenntes Konto)', r.status === 201);
    r = await A.get('/api/stats');
    check('Neues gleichnamiges Konto erbt keinen Umsatz des alten', r.data.byCashier.filter(c => c.username.toLowerCase() === 'aktiv01').length === 2 && r.data.byCashier.find(c => c.username.toLowerCase() === 'aktiv01' && !c.archived).revenue === 0);
    check('Audit enthält zweimal user.delete', (await A.get('/api/admin/audit?limit=200')).data.entries.filter(e => e.action === 'user.delete').length === 2);
    // letzter Admin
    const adm2 = await A.post('/api/admin/users', { username: 'Chef2', password: 'Zweiter-Admin-123', role: 'admin' });
    const C = new Client(s5.base); await C.post('/api/login', { username: 'Chef2', password: 'Zweiter-Admin-123' });
    await C.post('/api/me/password', { currentPassword: 'Zweiter-Admin-123', newPassword: 'Zweiter-Admin-456!' });
    r = await C.req('DELETE', `/api/admin/users/${aid}`);
    check('Ein Admin darf einen anderen Admin löschen, solange ein aktiver Admin bleibt', r.status === 200);
    r = await C.req('DELETE', `/api/admin/users/${adm2.data.user.id}`);
    check('Letzter Admin kann nicht gelöscht werden (400)', r.status === 400);
    await s5.stop(); fs.rmSync(dir5, { recursive: true, force: true });
  }

  discord.close();
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
  console.log(`\n==== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ====`);
  if (failed) { console.log('Fehlgeschlagen:\n - ' + failures.join('\n - ')); process.exit(1); }
}

main().catch(e => { console.error('Testlauf abgebrochen:', e); process.exit(2); });
