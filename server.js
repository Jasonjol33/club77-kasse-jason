'use strict';
/*
 * CLUB 77 Kassensystem – Server
 * Reines Node.js (>= 22.13), keine externen Abhängigkeiten. Datenbank: SQLite (node:sqlite) auf persistentem Volume.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ---- Produktkatalog (eingebettet, in der Datenbank gespeichert; Pflege im Admin-Reiter „Produkte“) ---- */
const catalog = (() => {
const SEED = [
  { id: 'soft', title: '🥤 Alkoholfrei', items: [
    ['Cola', 800], ['Sprunk', 800], ['Ice Tea', 800], ['Energy', 800], ['Bubbletea', 1000],
  ]},
  { id: 'shots', title: '🥃 Schnaps', items: [
    ['Bier', 800], ['Tequila', 1400], ['Whisky', 1400], ['Rum', 1400],
    ['Heidelbeer-Likör', 1400], ['Pfirsich-Likör', 1400],
  ]},
  { id: 'long', title: '🍹 Longdrinks', items: [
    ['Bloody Mary', 1600], ['Sex On The Beach', 1600], ['Swimmingpool', 1600], ['Black Mamba', 1600],
    ['Whisky-Cola', 1600], ['Wodka-E', 1600], ['Wodka-O', 1600], ['Wodka-Frucht', 1600],
    ['Fruit Kiss', 1600], ['Mai-Tai', 1600], ['Tequila-Sunrise', 1600],
    ['Seventy Seven', 7000], ['VIP Champagner', 12000],
  ]},
  { id: 'food', title: '🍕 Essen', items: [
    ['Pommes', 500], ['Mozzarella Sticks', 700], ['Chicken Nugget Box', 700], ['Baklava', 700],
    ['Pfirsich-Tiramisu', 700], ['Donuts', 1100], ['Donut Box', 2500], ['Bruschetta', 700],
  ]},
  { id: 'vip', title: '💎 VIP', items: [
    ['VIP Tisch', 25000], ['VIP Lounge ohne Verpflegung', 500000],
    ['VIP Lounge Klein', 660000], ['Nachbestellen Klein', 160000],
    ['VIP Lounge Mittel', 800000], ['Nachbestellen Mittel', 300000],
    ['VIP Lounge Groß', 1000000], ['Nachbestellen Groß', 500000],
  ]},
];

const CATEGORIES = SEED.map(c => ({ id: c.id, title: c.title }));
const CATEGORY_ORDER = CATEGORIES.map(c => c.title); // feste Reihenfolge (Referenz bleibt gleich)
const TITLE_BY_ID = new Map(CATEGORIES.map(c => [c.id, c.title]));

let db = null;
let rows = [];            // alle Produkte (auch ausgeblendete), in Anzeigereihenfolge
let byName = new Map();   // nur aktive Produkte (nur die dürfen verkauft werden)
let order = new Map();

function reload() {
  const all = db.prepare('SELECT * FROM products').all();
  const catIdx = id => { const i = CATEGORIES.findIndex(c => c.id === id); return i < 0 ? 999 : i; };
  all.sort((a, b) => catIdx(a.category_id) - catIdx(b.category_id) || a.sort - b.sort || a.id - b.id);
  rows = all.map(r => ({ id: r.id, name: r.name, price: r.price, categoryId: r.category_id, category: TITLE_BY_ID.get(r.category_id) || r.category_id, active: !!r.active }));
  byName = new Map(); order = new Map();
  rows.forEach((p, i) => { order.set(p.name, i); if (p.active) byName.set(p.name, p); });
}

function init(database) {
  db = database;
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_lower TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL, price INTEGER NOT NULL CHECK (price >= 0), sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const seeded = db.prepare(`SELECT 1 FROM counters WHERE name='catalog_seeded'`).get();
  if (!seeded) {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const ins = db.prepare('INSERT INTO products(name,name_lower,category_id,price,sort,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)');
      for (const cat of SEED) cat.items.forEach(([name, price], i) => ins.run(name, name.toLowerCase(), cat.id, price, i, now, now));
      db.prepare(`INSERT INTO counters(name,value) VALUES ('catalog_seeded',1)`).run();
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }
  reload();
}

const nameTaken = (name, exceptId) => {
  const r = db.prepare('SELECT id FROM products WHERE name_lower=?').get(String(name).toLowerCase());
  return !!r && r.id !== exceptId;
};
const get = id => rows.find(p => p.id === id) || null;

function create({ name, price, categoryId }) {
  const now = new Date().toISOString();
  const max = db.prepare('SELECT COALESCE(MAX(sort),-1) m FROM products WHERE category_id=?').get(categoryId).m;
  const res = db.prepare('INSERT INTO products(name,name_lower,category_id,price,sort,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(name, name.toLowerCase(), categoryId, price, max + 1, now, now);
  reload();
  return get(Number(res.lastInsertRowid));
}
function update(id, { name, price, categoryId, active }) {
  const cur = get(id);
  const n = name ?? cur.name, p = price ?? cur.price, c = categoryId ?? cur.categoryId, a = active ?? cur.active;
  let sortSql = '';
  const args = [n, n.toLowerCase(), c, p, a ? 1 : 0, new Date().toISOString()];
  if (c !== cur.categoryId) { // Kategorie gewechselt: ans Ende der neuen Kategorie
    const max = db.prepare('SELECT COALESCE(MAX(sort),-1) m FROM products WHERE category_id=?').get(c).m;
    sortSql = ', sort=?'; args.push(max + 1);
  }
  args.push(id);
  db.prepare(`UPDATE products SET name=?, name_lower=?, category_id=?, price=?, active=?, updated_at=?${sortSql} WHERE id=?`).run(...args);
  reload();
  return get(id);
}
function remove(id) { db.prepare('DELETE FROM products WHERE id=?').run(id); reload(); }

return {
  init, reload, CATEGORIES, CATEGORY_ORDER,
  findProduct: name => byName.get(name),
  orderOf: name => (order.has(name) ? order.get(name) : 1e9),
  publicCatalog: () => CATEGORIES
    .map(c => ({ id: c.id, title: c.title, items: rows.filter(p => p.active && p.categoryId === c.id).map(p => ({ name: p.name, price: p.price })) }))
    .filter(c => c.items.length),
  adminList: () => ({ categories: CATEGORIES, products: rows }),
  get, nameTaken, create, update, remove,
};
})();

const { openDatabase, transaction } = require('./lib/db');
const auth = require('./lib/auth');
const { createDiscord } = require('./lib/discord');

/* ------------------------------------------------------------------ Konfiguration */
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROD = process.env.NODE_ENV === 'production';
const TZ = process.env.CLUB_TIMEZONE || 'Europe/Berlin';
// Geschäftstag: Ein "Tag" beginnt um diese Uhrzeit (Standard 06:00), damit Umsätze nach Mitternacht noch zum Abend davor zählen.
const DAY_START_HOUR = Math.min(12, Math.max(0, parseInt(process.env.DAY_START_HOUR ?? '6', 10) || 0));
// Höchster Rabatt, den normale Mitarbeiter vergeben dürfen (Original: unbegrenzt bis 100 %).
const MAX_STAFF_DISCOUNT = Math.min(100, Math.max(0, parseInt(process.env.MAX_STAFF_DISCOUNT ?? '100', 10)));
const SESSION_IDLE_MS = 12 * 3600 * 1000;
const SESSION_ABSOLUTE_MS = 48 * 3600 * 1000;
const MAX_ITEM_QTY = 9999;
const MAX_LINES = 100;
const MAX_SUBTOTAL = 5_000_000_000;

// Anmeldung/Autorisierung über Discord (OAuth2). Aktiv nur, wenn PUBLIC_URL + Client-ID + Client-Secret +
// Server-ID + Mitarbeiter-Rolle gesetzt sind. Wer auf dem Discord-Server die Mitarbeiter-Rolle hat, darf sich anmelden;
// das Konto wird beim ersten Login automatisch angelegt. Eine Discord-ID muss nirgends mehr eingetragen werden.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const DC_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const DC_CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
const DC_GUILD_ID = (process.env.DISCORD_GUILD_ID || '').trim();       // Discord-Server der Crew
const DC_STAFF_ROLE = (process.env.DISCORD_STAFF_ROLE_ID || '').trim(); // Rolle = Kassierer-Zugang
const DC_ADMIN_ROLE = (process.env.DISCORD_ADMIN_ROLE_ID || '').trim(); // optional: Rolle = Administrator
const DC_BASE = (process.env.DISCORD_OAUTH_BASE || 'https://discord.com').replace(/\/+$/, '');
const isSnowflake = v => /^\d{1,25}$/.test(v);
// Bot-Token (nur Server!): prüft laufend, ob angemeldete Personen noch Mitglied + in der Rolle sind.
const DC_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || '').trim();
const RECHECK_MS = Math.max(1, Number(process.env.DISCORD_RECHECK_SECONDS) || 60) * 1000;
const DISCORD_LOGIN = !!(PUBLIC_URL && DC_CLIENT_ID && DC_CLIENT_SECRET && isSnowflake(DC_GUILD_ID) && isSnowflake(DC_STAFF_ROLE) && (!DC_ADMIN_ROLE || isSnowflake(DC_ADMIN_ROLE)));
const BOT_ENABLED = DISCORD_LOGIN && !!DC_BOT_TOKEN;
// DISCORD_ONLY=on: Anmeldung nur über Discord (Passwort nur noch als Notzugang für Administratoren, abschaltbar mit ADMIN_PASSWORD_LOGIN=off)
const DISCORD_ONLY = DISCORD_LOGIN && (process.env.DISCORD_ONLY || 'off').toLowerCase() === 'on';
const ADMIN_PW_LOGIN = (process.env.ADMIN_PASSWORD_LOGIN || 'on').toLowerCase() !== 'off';
if ((process.env.DISCORD_ONLY || '').toLowerCase() === 'on' && !DISCORD_LOGIN) console.error('[setup] DISCORD_ONLY=on wird ignoriert: Discord-Login ist nicht vollständig eingerichtet (sonst wäre niemand mehr anmeldbar).');
const DC_REDIRECT = PUBLIC_URL + '/api/auth/discord/callback';
// Discord-Konten werden NICHT mehr automatisch angelegt: Erst Passwort-Login (Konto vom Admin), danach Discord verknüpfen.
// Nur mit DISCORD_AUTO_CREATE=on wird wieder beim ersten Discord-Login automatisch ein Konto angelegt.
const DC_AUTO_CREATE = (process.env.DISCORD_AUTO_CREATE || 'off').toLowerCase() === 'on';

const { db, file: DB_FILE } = openDatabase(DATA_DIR);
catalog.init(db);
const discord = createDiscord({
  webhookUrl: process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1471193631640522885/x8cvKZPSimLSVazphvXl7qcPZlSrkuqe7WR2F_oif-fSnapiITUhuS-k6WvutBy4jY4E',
  timeZone: TZ,
  allowAnyUrl: process.env.DISCORD_ALLOW_ANY_URL === '1',
});
/* ------------------------------------------------------------------ Hilfsfunktionen */
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (msg, code) => new HttpError(400, msg, code);

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function businessDay(date = new Date()) {
  return dayFormatter.format(new Date(date.getTime() - DAY_START_HOUR * 3600 * 1000));
}
function validDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
/** "today" => aktueller Geschäftstag; sonst YYYY-MM-DD; leer => null */
function parseDay(v, name) {
  if (v === undefined || v === null || v === '') return null;
  if (v === 'today') return businessDay();
  if (!validDay(v)) throw bad(`Ungültiges Datum (${name}).`);
  return v;
}
function parseId(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw bad('Ungültige ID.');
  return n;
}
const clientIp = req => String(req.headers['fly-client-ip'] || req.socket.remoteAddress || 'unbekannt');
const nowIso = () => new Date().toISOString();

function cleanText(v, max) {
  // Steuerzeichen entfernen, Whitespace normalisieren
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function audit(user, action, detail, ip) {
  db.prepare('INSERT INTO audit_log(at,user_id,username,action,detail,ip) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), user ? user.id : null, user ? user.username : null, action, detail || null, ip || null);
}

/* ------------------------------------------------------------------ HTTP-Basics */
function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://i.postimg.cc data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.toLowerCase().startsWith('application/json')) return reject(new HttpError(415, 'Content-Type muss application/json sein.'));
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'Anfrage zu groß.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return reject(bad('Ungültige Daten.'));
        resolve(v);
      } catch { reject(bad('Ungültiges JSON.')); }
    });
    req.on('error', reject);
  });
}
function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
const COOKIE = 'c77_session';
const cookieAttrs = '; HttpOnly; SameSite=Strict; Path=/' + (PROD ? '; Secure' : '');
const sessionCookie = token => `${COOKIE}=${token}${cookieAttrs}; Max-Age=${SESSION_ABSOLUTE_MS / 1000}`;
const clearCookie = () => `${COOKIE}=${cookieAttrs}; Max-Age=0`;

/* ------------------------------------------------------------------ Sessions & Login-Schutz */
function createSession(userId, via = 'password') {
  const token = auth.newToken();
  const t = Date.now();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,last_seen_at,expires_at,via) VALUES (?,?,?,?,?,?)')
    .run(auth.sha256(token), userId, t, t, t + SESSION_IDLE_MS, via);
  return token;
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.sha256(token));
}
/** Merkt sich, WARUM eine Sitzung beendet wurde, damit die Person beim nächsten Aufruf eine verständliche Meldung sieht. */
function revokeSessions(userId, reason, { onlyVia, exceptHash } = {}) {
  let sql = 'SELECT token_hash FROM sessions WHERE user_id=?'; const args = [userId];
  if (onlyVia) { sql += ' AND via=?'; args.push(onlyVia); }
  if (exceptHash) { sql += ' AND token_hash<>?'; args.push(exceptHash); }
  for (const r of db.prepare(sql).all(...args)) {
    if (reason) db.prepare('INSERT OR REPLACE INTO session_revocations(token_hash,reason,at) VALUES (?,?,?)').run(r.token_hash, reason, Date.now());
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(r.token_hash);
  }
}
function destroyUserSessions(userId, exceptHash, reason) { revokeSessions(userId, reason, { exceptHash }); }
function revokedReason(req) {
  const token = getCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const r = db.prepare('SELECT reason FROM session_revocations WHERE token_hash=?').get(auth.sha256(token));
  return r ? r.reason : null;
}
setInterval(() => { db.prepare('DELETE FROM session_revocations WHERE at<?').run(Date.now() - 2 * 24 * 3600 * 1000); }, 60 * 60 * 1000).unref();
/**
 * Senden an Discord nur mit gültiger Discord-Rolle. Wird bei JEDEM Sendevorgang geprüft (live beim Bot), nicht nur beim Login.
 * - Bot aktiv: Discord wird jetzt gefragt (Mitglied + Mitarbeiter-/Admin-Rolle). Nicht erreichbar => nicht senden (sicherer Standard).
 * - Nur OAuth (ohne Bot): Es zählt die beim Discord-Login geprüfte Rolle (Sitzung muss über Discord entstanden sein).
 * - Discord-Login nicht eingerichtet: keine Rollen vorhanden, also keine Einschränkung.
 */
async function assertMayPostToDiscord(user) {
  if (!DISCORD_LOGIN) return;
  const noRole = 'Zum Senden an Discord brauchst du die Mitarbeiter-Rolle auf dem Discord-Server.';
  if (!user.discordId) throw new HttpError(403, 'Zum Senden an Discord muss dein Konto mit Discord verknüpft sein (Anmeldung über „Mit Discord anmelden“).', 'DISCORD_ROLE_REQUIRED');
  if (!BOT_ENABLED) {
    if (user.via !== 'discord') throw new HttpError(403, 'Zum Senden an Discord musst du dich über Discord angemeldet haben.', 'DISCORD_ROLE_REQUIRED');
    return;
  }
  let st;
  try { st = await botMemberStatus(user.discordId); }
  catch { throw new HttpError(503, 'Die Rollenprüfung bei Discord ist gerade nicht möglich. Bitte gleich erneut versuchen.', 'DISCORD_CHECK_FAILED'); }
  if (!st.isStaff) {
    audit(user, 'discord.send_denied', st.member ? 'Rolle fehlt' : 'nicht auf dem Server');
    throw new HttpError(403, noRole, 'DISCORD_ROLE_REQUIRED');
  }
}

/** Liefert den angemeldeten, aktiven Benutzer – oder null. Wird bei JEDEM geschützten Aufruf geprüft. */
function authenticate(req) {
  const token = getCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const hash = auth.sha256(token);
  const row = db.prepare(
    `SELECT s.created_at sc, s.last_seen_at ls, s.expires_at ex, s.via via, u.*
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hash);
  const t = Date.now();
  if (!row) return null;
  if (row.ex < t || row.sc + SESSION_ABSOLUTE_MS < t || !row.active) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
    return null;
  }
  if (t - row.ls > 5 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?').run(t, t + SESSION_IDLE_MS, hash);
  }
  return {
    id: row.id, username: row.username, role: row.role, active: !!row.active,
    mustChangePassword: !!row.must_change_password, tokenHash: hash,
    discordLinked: !!row.discord_id, discordName: row.discord_name || null, discordId: row.discord_id || null, via: row.via,
  };
}

const failures = new Map(); // key -> { count, until, first }
const WINDOW_MS = 15 * 60 * 1000, LOCK_MS = 10 * 60 * 1000;
function lockedFor(key) {
  const f = failures.get(key);
  if (!f) return 0;
  if (f.until && f.until > Date.now()) return f.until - Date.now();
  if (Date.now() - f.first > WINDOW_MS) failures.delete(key);
  return 0;
}
function registerFailure(key, limit) {
  const t = Date.now();
  let f = failures.get(key);
  if (!f || t - f.first > WINDOW_MS) f = { count: 0, first: t, until: 0 };
  f.count++;
  if (f.count >= limit) { f.until = t + LOCK_MS; f.count = 0; f.first = t; }
  failures.set(key, f);
}
setInterval(() => { for (const [k, f] of failures) if (Date.now() - f.first > WINDOW_MS && !(f.until > Date.now())) failures.delete(k); }, 5 * 60 * 1000).unref();
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()); }, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ Benutzer */
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const userDTO = u => ({
  id: u.id, username: u.username, role: u.role, active: !!u.active,
  mustChangePassword: !!u.must_change_password, createdAt: u.created_at, lastLoginAt: u.last_login_at || null,
  discordLinked: !!u.discord_id, discordName: u.discord_name || null,
  archived: !!u.archived,
});
const publicUser = u => ({
  id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword,
  discordLinked: !!(u.discordLinked ?? u.discord_id), discordName: u.discordName ?? u.discord_name ?? null,
});
const config = () => ({
  timezone: TZ, dayStartHour: DAY_START_HOUR, maxStaffDiscount: MAX_STAFF_DISCOUNT, discord: discord.enabled, today: businessDay(),
});
const adminCount = () => db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin'`).get().c;

async function createUser({ username, password, role, createdBy, mustChange }) {
  const hash = await auth.hashPassword(password);
  const res = db.prepare(
    `INSERT INTO users(username,username_lower,role,active,password_hash,must_change_password,created_at,created_by)
     VALUES (?,?,?,1,?,?,?,?)`).run(username, username.toLowerCase(), role, hash, mustChange ? 1 : 0, nowIso(), createdBy || null);
  return db.prepare('SELECT * FROM users WHERE id=?').get(res.lastInsertRowid);
}

/* Ersteinrichtung: ADMIN_PASSWORD-Secret ODER einmaliger Setup-Code im Log (kein offenes "Wer zuerst kommt"-Setup). */
let setupCode = '';
async function ensureAdmin() {
  if (adminCount() > 0) return;
  const username = cleanText(process.env.ADMIN_USERNAME || 'admin', 32);
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const problem = auth.checkPasswordPolicy(password, username);
    if (!USERNAME_RE.test(username) || problem) {
      console.error(`[setup] ADMIN_USERNAME/ADMIN_PASSWORD ungültig (${problem || 'Benutzername'}) – wechsle zur Setup-Seite.`);
    } else {
      const u = await createUser({ username, password, role: 'admin', mustChange: false });
      audit(u, 'setup.admin_from_env', 'Administrator aus Umgebungsvariablen angelegt');
      console.log(`[setup] Administrator "${username}" wurde angelegt.`);
      return;
    }
  }
  setupCode = process.env.SETUP_CODE || crypto.randomBytes(9).toString('base64url');
  console.log('==============================================================');
  console.log('[setup] Es existiert noch kein Administrator.');
  console.log(`[setup] SETUP-CODE: ${setupCode}`);
  console.log('[setup] Öffne die Webseite und lege den Administrator mit diesem Code an.');
  console.log('==============================================================');
}

/* ------------------------------------------------------------------ Rechnungen */
const INVOICE_SELECT = `
  SELECT i.*,
    (SELECT o.number FROM invoices o WHERE o.id=i.ref_invoice_id) AS ref_number,
    (SELECT s.number FROM invoices s WHERE s.ref_invoice_id=i.id) AS storno_number,
    (SELECT s.id FROM invoices s WHERE s.ref_invoice_id=i.id) AS storno_id,
    (SELECT COALESCE(SUM(ABS(x.quantity)),0) FROM invoice_items x WHERE x.invoice_id=i.id) AS item_count
  FROM invoices i`;

function invoiceDTO(r, items) {
  const dto = {
    id: r.id, number: r.number, kind: r.kind, createdAt: r.created_at, businessDay: r.business_day,
    cashierId: r.cashier_id, cashierName: r.cashier_name, createdByName: r.created_by_name,
    subtotal: r.subtotal, discountPercent: r.discount_percent, discountAmount: r.discount_amount,
    discountReason: r.discount_reason, total: r.total, itemCount: r.item_count,
    refInvoiceId: r.ref_invoice_id, refNumber: r.ref_number || null, stornoReason: r.storno_reason || null,
    stornoId: r.storno_id || null, stornoNumber: r.storno_number || null,
  };
  if (items) dto.items = items.map(x => ({ productName: x.product_name, category: x.category, unitPrice: x.unit_price, quantity: x.quantity, lineTotal: x.line_total }));
  return dto;
}
function loadInvoice(id) {
  const r = db.prepare(`${INVOICE_SELECT} WHERE i.id=?`).get(id);
  if (!r) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(id);
  return invoiceDTO(r, items);
}
const pad = n => String(n).padStart(6, '0');
function nextNumber(kind) {
  const name = kind === 'storno' ? 'storno' : 'invoice';
  db.prepare('UPDATE counters SET value=value+1 WHERE name=?').run(name);
  const v = db.prepare('SELECT value FROM counters WHERE name=?').get(name).value;
  return (kind === 'storno' ? 'S-' : 'R-') + pad(v);
}

/** Validiert Warenkorb + Rabatt GEGEN den Serverkatalog. Der Client liefert nur Produktname + Menge. */
function priceCart(body, user) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw bad('Warenkorb ist leer.');
  if (body.items.length > MAX_LINES) throw bad('Zu viele Positionen.');
  const merged = new Map();
  for (const it of body.items) {
    if (!it || typeof it !== 'object') throw bad('Ungültige Position.');
    const product = catalog.findProduct(it.name);
    if (!product) throw bad('Unbekanntes Produkt.');
    const qty = it.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) throw bad(`Ungültige Menge bei "${product.name}" (1–${MAX_ITEM_QTY}).`);
    const sum = (merged.get(product.name) || 0) + qty;
    if (sum > MAX_ITEM_QTY) throw bad(`Zu große Menge bei "${product.name}".`);
    merged.set(product.name, sum);
  }
  const lines = [...merged.entries()]
    .map(([name, quantity]) => { const p = catalog.findProduct(name); return { name, category: p.category, unitPrice: p.price, quantity, lineTotal: p.price * quantity }; })
    .sort((a, b) => catalog.orderOf(a.name) - catalog.orderOf(b.name));
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (subtotal > MAX_SUBTOTAL) throw bad('Betrag zu hoch.');

  let pct = body.discountPercent ?? 0;
  if (typeof pct === 'string' && /^\d{1,3}$/.test(pct)) pct = Number(pct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw bad('Rabatt muss eine ganze Zahl von 0 bis 100 sein.');
  if (user.role !== 'admin' && pct > MAX_STAFF_DISCOUNT) throw new HttpError(403, `Du darfst höchstens ${MAX_STAFF_DISCOUNT} % Rabatt geben.`);
  const discountAmount = Math.round(subtotal * pct / 100); // gleiche Rundung wie im Original
  const reason = pct > 0 ? cleanText(body.discountReason, 120) : '';
  return { lines, subtotal, pct, discountAmount, reason, total: subtotal - discountAmount };
}

function createInvoice(user, body) {
  const requestId = body.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw bad('Ungültige Anfrage-ID.');
  const priced = priceCart(body, user);

  const result = transaction(db, () => {
    // Idempotenz: wiederholte Anfrage (z. B. Netzwerkfehler) liefert die bereits gespeicherte Rechnung zurück.
    const existing = db.prepare('SELECT id FROM invoices WHERE cashier_id=? AND request_id=?').get(user.id, requestId);
    if (existing) return { id: existing.id, duplicate: true };
    const created = nowIso();
    const number = nextNumber('invoice');
    const res = db.prepare(
      `INSERT INTO invoices(number,kind,cashier_id,cashier_name,created_by,created_by_name,created_at,business_day,
         subtotal,discount_percent,discount_amount,discount_reason,total,request_id)
       VALUES (?,'invoice',?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, user.id, user.username, user.id, user.username, created, businessDay(new Date(created)),
        priced.subtotal, priced.pct, priced.discountAmount, priced.reason, priced.total, requestId);
    const id = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO invoice_items(invoice_id,product_name,category,unit_price,quantity,line_total) VALUES (?,?,?,?,?,?)');
    for (const l of priced.lines) ins.run(id, l.name, l.category, l.unitPrice, l.quantity, l.lineTotal);
    return { id, duplicate: false };
  });
  if (!result.duplicate) audit(user, 'invoice.create', loadInvoice(result.id).number);
  return result;
}

function createStorno(admin, invoiceId, reasonRaw) {
  const reason = cleanText(reasonRaw, 300);
  if (reason.length < 5) throw bad('Bitte einen Storno-Grund angeben (mindestens 5 Zeichen).');
  // Der ursprüngliche Kassierer kann inzwischen gelöscht sein (seine Rechnungen bleiben bestehen). Dann würde der Fremdschlüssel
  // invoices.cashier_id -> users.id die Stornobuchung ablehnen. Wie in purgeUser: außerhalb der Transaktion kurz abschalten (synchron, kein Wettlauf).
  db.exec('PRAGMA foreign_keys=OFF');
  let result;
  try { result = transaction(db, () => {
    const orig = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
    if (!orig) throw new HttpError(404, 'Rechnung nicht gefunden.');
    if (orig.kind !== 'invoice') throw bad('Eine Stornobuchung kann nicht erneut storniert werden.');
    if (db.prepare('SELECT 1 FROM invoices WHERE ref_invoice_id=?').get(orig.id)) throw new HttpError(409, 'Diese Rechnung wurde bereits storniert.');
    const created = nowIso();
    const number = nextNumber('storno');
    const res = db.prepare(
      `INSERT INTO invoices(number,kind,cashier_id,cashier_name,created_by,created_by_name,created_at,business_day,
         subtotal,discount_percent,discount_amount,discount_reason,total,ref_invoice_id,storno_reason)
       VALUES (?,'storno',?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, orig.cashier_id, orig.cashier_name, admin.id, admin.username, created, businessDay(new Date(created)),
        -orig.subtotal, orig.discount_percent, -orig.discount_amount, orig.discount_reason, -orig.total, orig.id, reason);
    const id = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO invoice_items(invoice_id,product_name,category,unit_price,quantity,line_total) VALUES (?,?,?,?,?,?)');
    for (const x of db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(orig.id)) {
      ins.run(id, x.product_name, x.category, x.unit_price, -x.quantity, -x.line_total);
    }
    return id;
  }); } finally { db.exec('PRAGMA foreign_keys=ON'); }
  const inv = loadInvoice(result);
  audit(admin, 'invoice.storno', `${inv.number} zu ${inv.refNumber}: ${reason}`);
  return inv;
}

/* ------------------------------------------------------------------ Auswertungen (immer aus gespeicherten Rechnungen) */
/** Konto komplett entfernen (inkl. Discord-Verknüpfung und Sitzungen). Rechnungen bleiben unverändert (Name steht als Text darin). */
function purgeUser(id) {
  // PRAGMA foreign_keys wirkt nicht innerhalb einer Transaktion => davor/danach umschalten (Server arbeitet synchron, kein Wettlauf)
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
    });
  } finally { db.exec('PRAGMA foreign_keys=ON'); }
}

function filterSql({ from, to, cashier }, { liveOnly = false } = {}) {
  const w = [], a = [];
  // Summen: Rechnungen gelöschter Konten zählen nicht mit (die Rechnungen selbst bleiben in Liste/Export erhalten)
  if (liveOnly) w.push('EXISTS (SELECT 1 FROM users u WHERE u.id=i.cashier_id)');
  if (from) { w.push('i.business_day>=?'); a.push(from); }
  if (to) { w.push('i.business_day<=?'); a.push(to); }
  if (cashier) { w.push('i.cashier_id=?'); a.push(cashier); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', args: a };
}
function computeStats(f, withCashiers) {
  const { where, args } = filterSql(f, { liveOnly: true });
  const summary = db.prepare(
    `SELECT COALESCE(SUM(i.total),0) revenue, COALESCE(SUM(i.subtotal),0) gross, COALESCE(SUM(i.discount_amount),0) discounts,
            COALESCE(SUM(i.kind='invoice'),0) invoiceCount, COALESCE(SUM(i.kind='storno'),0) stornoCount
       FROM invoices i ${where}`).get(...args);
  const products = db.prepare(
    `SELECT it.category category, it.product_name name, SUM(it.quantity) qty, SUM(it.line_total) total
       FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id ${where}
      GROUP BY it.category, it.product_name HAVING SUM(it.quantity)<>0`).all(...args)
    .map(p => ({ category: p.category, name: p.name, qty: p.qty, total: p.total }))
    .sort((a, b) => catalog.orderOf(a.name) - catalog.orderOf(b.name));
  const out = { summary: { ...summary }, products };
  if (withCashiers) {
    const rows = new Map(db.prepare(
      `SELECT i.cashier_id id, SUM(i.total) revenue, SUM(i.discount_amount) discounts,
              SUM(i.kind='invoice') invoiceCount, SUM(i.kind='storno') stornoCount
         FROM invoices i ${where} GROUP BY i.cashier_id`).all(...args).map(r => [r.id, r]));
    const mk = (u, r) => ({ id: u.id, username: u.username, role: u.role, active: !!u.active, archived: !!u.archived, revenue: r.revenue || 0, discounts: r.discounts || 0, invoiceCount: r.invoiceCount || 0, stornoCount: r.stornoCount || 0 });
    const live = db.prepare('SELECT id, username, role, active, archived FROM users WHERE archived=0 ORDER BY username_lower').all();
    // Gelöschte Konten tauchen hier nicht mehr auf und zählen auch in keiner Summe mit (siehe filterSql)
    out.byCashier = live.map(u => mk(u, rows.get(u.id) || {}));
  }
  return out;
}

/* ------------------------------------------------------------------ Routen */
const routes = [];
const route = (method, pattern, opts, handler) => routes.push({ method, pattern, opts, handler });

// ---- öffentlich
route('GET', /^\/healthz$/, { public: true }, ctx => { db.prepare('SELECT 1').get(); return ctx.json(200, { ok: true }); });

route('GET', /^\/api\/status$/, { public: true }, ctx => {
  const user = authenticate(ctx.req);
  ctx.json(200, { setupNeeded: adminCount() === 0, discordLogin: DISCORD_LOGIN, discordOnly: DISCORD_ONLY, passwordLogin: !DISCORD_ONLY || ADMIN_PW_LOGIN, user: user ? publicUser(user) : null, config: user ? config() : undefined });
});

route('POST', /^\/api\/setup-admin$/, { public: true }, async ctx => {
  if (adminCount() > 0) throw new HttpError(409, 'Der Administrator ist bereits eingerichtet.');
  const key = 'setup:' + ctx.ip;
  const wait = lockedFor(key);
  if (wait) throw new HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.');
  const body = await ctx.body();
  const given = Buffer.from(String(body.setupCode || '')), want = Buffer.from(setupCode);
  if (!setupCode || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    registerFailure(key, 5);
    throw new HttpError(403, 'Setup-Code falsch. Den Code findest du im Server-Log (fly logs).');
  }
  const username = String(body.username || '').trim();
  if (!USERNAME_RE.test(username)) throw bad('Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, . _ -).');
  const problem = auth.checkPasswordPolicy(body.password, username);
  if (problem) throw bad(problem);
  const u = await createUser({ username, password: body.password, role: 'admin', mustChange: false });
  audit(u, 'setup.admin', 'Administrator über Setup-Seite angelegt', ctx.ip);
  setupCode = '';
  ctx.json(201, { ok: true });
});

route('POST', /^\/api\/login$/, { public: true }, async ctx => {
  const body = await ctx.body();
  const username = String(body.username || '').trim().slice(0, 64);
  const password = typeof body.password === 'string' ? body.password.slice(0, 256) : '';
  const kIp = 'ip:' + ctx.ip, kUser = `u:${ctx.ip}:${username.toLowerCase()}`;
  const wait = Math.max(lockedFor(kIp), lockedFor(kUser));
  if (wait) {
    throw Object.assign(new HttpError(429, 'Zu viele fehlgeschlagene Anmeldungen. Bitte in einigen Minuten erneut versuchen.'), { retryAfter: Math.ceil(wait / 1000) });
  }
  const row = username ? db.prepare('SELECT * FROM users WHERE username_lower=?').get(username.toLowerCase()) : null;
  const ok = row ? await auth.verifyPassword(password, row.password_hash) : await auth.fakeVerify(password);
  if (!ok || !row.active) {
    registerFailure(kIp, 25); registerFailure(kUser, 5);
    audit(null, 'login.failed', `Benutzer: ${cleanText(username, 40)}${row && !row.active && ok ? ' (deaktiviert)' : ''}`, ctx.ip);
    // Gleiche Meldung für falsches Passwort, unbekannten und gesperrten Benutzer
    throw new HttpError(401, 'Benutzername oder Passwort falsch, oder das Konto ist gesperrt.');
  }
  failures.delete(kUser);
  // Erste Anmeldung (und solange Discord noch nicht verknüpft ist) geht mit Passwort.
  // Sobald Discord verknüpft ist, ist nur noch die Discord-Anmeldung erlaubt (Admins ggf. als Notzugang).
  if (DISCORD_ONLY && row.discord_id && !(row.role === 'admin' && ADMIN_PW_LOGIN)) {
    audit(row, 'login.blocked_discord_only', null, ctx.ip);
    throw new HttpError(403, 'Dein Konto ist mit Discord verknüpft. Bitte „Mit Discord anmelden“ verwenden.', 'DISCORD_ONLY');
  }
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(), row.id);
  const token = createSession(row.id);
  audit(row, 'login.ok', null, ctx.ip);
  ctx.json(200, { user: publicUser({ ...row, mustChangePassword: row.must_change_password }), config: config() }, { 'Set-Cookie': sessionCookie(token) });
});

route('POST', /^\/api\/logout$/, { public: true }, ctx => {
  const token = getCookie(ctx.req, COOKIE);
  const user = authenticate(ctx.req);
  destroySession(token);
  if (user) audit(user, 'logout', null, ctx.ip);
  ctx.json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
});

// ---- angemeldet
/* ------------------------------------------------------------------ Anmeldung mit Discord (OAuth2 + PKCE) */
const oauthStates = new Map(); // state -> { mode, userId, verifier, exp }
setInterval(() => { for (const [k, v] of oauthStates) if (v.exp < Date.now()) oauthStates.delete(k); }, 60 * 1000).unref();
const OAUTH_COOKIE = 'c77_oauth';
// Lax (nicht Strict): Der Rücksprung von discord.com ist eine seitenübergreifende Navigation.
const oauthCookie = (value, maxAge) => `${OAUTH_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/discord; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;
function redirect(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers);
  res.end();
}
function startOAuth(mode, userId) {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  oauthStates.set(state, { mode, userId: userId || null, verifier, exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: DC_CLIENT_ID, response_type: 'code', redirect_uri: DC_REDIRECT,
    scope: 'identify guilds.members.read', state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  return { url: `${DC_BASE}/oauth2/authorize?${params}`, cookie: oauthCookie(state, 600) };
}
async function discordJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!res.ok) throw new Error('Discord HTTP ' + res.status);
  return res.json();
}
async function fetchDiscordProfile(code, verifier) {
  const token = await discordJson(`${DC_BASE}/api/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${DC_CLIENT_ID}:${DC_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: DC_REDIRECT, code_verifier: verifier }),
  });
  const auth_ = { Authorization: 'Bearer ' + token.access_token };
  const me = await discordJson(`${DC_BASE}/api/users/@me`, { headers: auth_ });
  if (!/^\d{5,25}$/.test(String(me.id))) throw new Error('Ungültige Discord-ID');
  // Autorisierung durch Discord: Mitgliedschaft und Rollen auf dem Crew-Server (braucht nur den Token der Person, keinen Bot).
  let member;
  try { member = await discordJson(`${DC_BASE}/api/users/@me/guilds/${DC_GUILD_ID}/member`, { headers: auth_ }); }
  catch (e) { if (/HTTP (403|404)/.test(e.message)) { const err = new Error('Kein Mitglied des Discord-Servers'); err.code = 'guild'; throw err; } throw e; }
  const roles = Array.isArray(member && member.roles) ? member.roles.map(String) : [];
  const isAdmin = !!DC_ADMIN_ROLE && roles.includes(DC_ADMIN_ROLE);
  const isStaff = isAdmin || roles.includes(DC_STAFF_ROLE);
  const nick = member && (member.nick || (member.user && member.user.global_name));
  return { id: String(me.id), name: cleanText(nick || me.global_name || me.username || 'Discord-Nutzer', 40), isStaff, isAdmin };
}
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Aus dem Discord-Namen einen freien, gültigen Benutzernamen machen (Buchstaben/Ziffern/._-, 3–32 Zeichen). */
function freeUsername(name) {
  let base = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 26);
  if (base.length < 3) base = 'Mitarbeiter';
  let cand = base, n = 1;
  while (db.prepare('SELECT 1 FROM users WHERE username_lower=?').get(cand.toLowerCase())) cand = base + (++n);
  return cand;
}
/** Neues Konto für eine Person mit Discord-Mitarbeiterrolle. Passwort = zufällig & unbekannt (Anmeldung nur per Discord). */
async function provisionFromDiscord(profile) {
  const hash = await auth.hashPassword(crypto.randomBytes(24).toString('base64url'));
  return transaction(db, () => {
    const again = db.prepare('SELECT * FROM users WHERE discord_id=?').get(profile.id);
    if (again) return again;
    const username = freeUsername(profile.name);
    const res = db.prepare(
      `INSERT INTO users(username,username_lower,role,active,password_hash,must_change_password,created_at,created_by,discord_id,discord_name)
       VALUES (?,?,?,1,?,0,?,NULL,?,?)`)
      .run(username, username.toLowerCase(), profile.isAdmin ? 'admin' : 'cashier', hash, nowIso(), profile.id, profile.name);
    return db.prepare('SELECT * FROM users WHERE id=?').get(res.lastInsertRowid);
  });
}

route('GET', /^\/api\/auth\/discord\/start$/, { public: true }, ctx => {
  if (!DISCORD_LOGIN) return redirect(ctx.res, '/?discord=off');
  const { url, cookie } = startOAuth('login', null);
  redirect(ctx.res, url, [cookie]);
});

route('GET', /^\/api\/auth\/discord\/callback$/, { public: true }, async ctx => {
  const q = ctx.url.searchParams;
  const clear = oauthCookie('', 0);
  const fail = code => redirect(ctx.res, '/?discord=' + code, [clear]);
  if (!DISCORD_LOGIN) return fail('off');
  const state = q.get('state') || '';
  const st = oauthStates.get(state);
  oauthStates.delete(state); // Einmalnutzung
  if (!st || st.exp < Date.now() || !safeEqual(getCookie(ctx.req, OAUTH_COOKIE), state)) return fail('state');
  const code = q.get('code');
  if (q.get('error') || !code || code.length > 200) return fail('cancel');
  let profile;
  try { profile = await fetchDiscordProfile(code, st.verifier); }
  catch (e) { if (e.code !== 'guild') console.error('[discord-login]', e.message); return fail(e.code === 'guild' ? 'guild' : 'error'); }

  if (!profile.isStaff) {
    audit(null, 'discord.login_no_role', `${profile.name} (${profile.id})`, ctx.ip);
    return fail('role');
  }

  if (st.mode === 'link') {
    const me = st.userId && db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(st.userId);
    if (!me) return fail('state');
    if (!me.last_login_at || me.must_change_password) return fail('early');
    if (db.prepare('SELECT 1 FROM users WHERE discord_id=? AND id<>?').get(profile.id, me.id)) return fail('taken');
    db.prepare('UPDATE users SET discord_id=?, discord_name=? WHERE id=?').run(profile.id, profile.name, me.id);
    audit(me, 'discord.link', `${profile.name} (${profile.id})`, ctx.ip);
    return fail('linked');
  }

  let u = db.prepare('SELECT * FROM users WHERE discord_id=?').get(profile.id);
  if (!u) {
    if (!DC_AUTO_CREATE) {
      audit(null, 'discord.login_unlinked', `${profile.name} (${profile.id})`, ctx.ip);
      return fail('unlinked');
    }
    // Nur mit DISCORD_AUTO_CREATE=on: Rolle vorhanden => Konto wird automatisch angelegt.
    u = await provisionFromDiscord(profile);
    audit(u, 'discord.account_created', `${profile.name} (${profile.id}) als ${u.role}`, ctx.ip);
  }
  if (!u.active) { audit(u, 'discord.login_denied', 'Konto deaktiviert', ctx.ip); return fail('denied'); }

  // Rolle folgt Discord (nur wenn eine Admin-Rolle konfiguriert ist; der letzte aktive Admin wird nie herabgestuft).
  if (DC_ADMIN_ROLE && u.username_lower !== PROTECTED_USER) {
    const want = profile.isAdmin ? 'admin' : 'cashier';
    if (u.role !== want) {
      const otherAdmins = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id<>?`).get(u.id).c;
      if (want === 'admin' || otherAdmins > 0) {
        db.prepare('UPDATE users SET role=? WHERE id=?').run(want, u.id);
        audit(u, 'discord.role_sync', `${u.role} -> ${want}`, ctx.ip);
        u = { ...u, role: want };
      }
    }
  }
  if (u.must_change_password) {
    // Ein vom Admin vergebenes Start-/Reset-Passwort wird unbrauchbar gemacht; der Mitarbeiter nutzt Discord.
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?')
      .run(await auth.hashPassword(crypto.randomBytes(24).toString('base64url')), u.id);
  }
  db.prepare('UPDATE users SET last_login_at=?, discord_name=? WHERE id=?').run(nowIso(), profile.name, u.id);
  const token = createSession(u.id, 'discord');
  audit(u, 'login.ok', 'über Discord', ctx.ip);
  redirect(ctx.res, '/', [sessionCookie(token), clear]);
});

route('POST', /^\/api\/me\/discord\/link$/, {}, ctx => {
  if (!DISCORD_LOGIN) throw new HttpError(503, 'Discord-Anmeldung ist auf dem Server nicht eingerichtet.');
  // „Komplett eingeloggt“: mindestens eine Anmeldung und das Start-Passwort ist bereits geändert.
  const me = db.prepare('SELECT last_login_at, must_change_password FROM users WHERE id=?').get(ctx.user.id);
  if (!me || !me.last_login_at || me.must_change_password) throw new HttpError(403, 'Discord kann erst nach der ersten vollständigen Anmeldung mit Passwort verknüpft werden.', 'LINK_NOT_ALLOWED_YET');
  const { url, cookie } = startOAuth('link', ctx.user.id);
  ctx.json(200, { url }, { 'Set-Cookie': cookie });
});

route('POST', /^\/api\/me\/discord\/unlink$/, {}, ctx => {
  db.prepare('UPDATE users SET discord_id=NULL, discord_name=NULL WHERE id=?').run(ctx.user.id);
  audit(ctx.user, 'discord.unlink', null, ctx.ip);
  ctx.json(200, { ok: true });
});

// ---- angemeldet
route('GET', /^\/api\/me$/, { allowPwChange: true }, ctx => ctx.json(200, { user: publicUser(ctx.user), config: config() }));

route('POST', /^\/api\/me\/password$/, { allowPwChange: true }, async ctx => {
  const body = await ctx.body();
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
  if (!(await auth.verifyPassword(String(body.currentPassword || ''), row.password_hash))) throw new HttpError(403, 'Das aktuelle Passwort ist falsch.');
  const problem = auth.checkPasswordPolicy(body.newPassword, row.username);
  if (problem) throw bad(problem);
  if (body.newPassword === body.currentPassword) throw bad('Das neue Passwort muss sich vom alten unterscheiden.');
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(await auth.hashPassword(body.newPassword), row.id);
  destroyUserSessions(row.id, ctx.user.tokenHash); // alle anderen Sitzungen beenden
  audit(ctx.user, 'password.change', null, ctx.ip);
  ctx.json(200, { ok: true });
});

route('GET', /^\/api\/products$/, {}, ctx => ctx.json(200, { categories: catalog.publicCatalog() }));

route('POST', /^\/api\/invoices$/, {}, async ctx => {
  const body = await ctx.body();
  const r = createInvoice(ctx.user, body);
  const invoice = loadInvoice(r.id);
  ctx.json(r.duplicate ? 200 : 201, { invoice, duplicate: r.duplicate });
});

route('GET', /^\/api\/invoices$/, {}, ctx => {
  const q = ctx.url.searchParams;
  const isAdmin = ctx.user.role === 'admin';
  const filter = { from: parseDay(q.get('from'), 'von'), to: parseDay(q.get('to'), 'bis'), cashier: null };
  if (filter.from && filter.to && filter.from > filter.to) throw bad('"Von" liegt nach "Bis".');
  filter.cashier = isAdmin ? (q.get('cashier') ? parseId(q.get('cashier')) : null) : ctx.user.id; // Mitarbeiter: IMMER nur eigene
  const { where, args } = filterSql(filter);
  const w = where ? [where.slice(6)] : [], a = [...args];
  const kind = q.get('kind');
  if (kind === 'invoice' || kind === 'storno') { w.push('i.kind=?'); a.push(kind); }
  const search = cleanText(q.get('q'), 60);
  if (search) {
    const like = '%' + search.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const parts = [`i.number LIKE ? ESCAPE '\\'`, `EXISTS (SELECT 1 FROM invoice_items x WHERE x.invoice_id=i.id AND x.product_name LIKE ? ESCAPE '\\')`];
    a.push(like, like);
    if (isAdmin) { parts.push(`i.cashier_name LIKE ? ESCAPE '\\'`); a.push(like); }
    w.push('(' + parts.join(' OR ') + ')');
  }
  const whereSql = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
  const total = db.prepare(`SELECT COUNT(*) c FROM invoices i ${whereSql}`).get(...a).c;
  const rows = db.prepare(`${INVOICE_SELECT} ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...a, limit, offset);
  ctx.json(200, { invoices: rows.map(r => invoiceDTO(r)), total, limit, offset });
});

route('GET', /^\/api\/invoices\/(\d+)$/, {}, ctx => {
  const inv = loadInvoice(parseId(ctx.params[0]));
  // Fremde Rechnungen: 404 statt 403 -> Existenz wird nicht preisgegeben
  if (!inv || (ctx.user.role !== 'admin' && inv.cashierId !== ctx.user.id)) throw new HttpError(404, 'Rechnung nicht gefunden.');
  ctx.json(200, { invoice: inv });
});

route('POST', /^\/api\/invoices\/(\d+)\/storno$/, { admin: true }, async ctx => {
  const body = await ctx.body();
  const inv = createStorno(ctx.user, parseId(ctx.params[0]), body.reason);
  ctx.json(201, { invoice: inv });
});

route('GET', /^\/api\/stats$/, {}, ctx => {
  const q = ctx.url.searchParams;
  const isAdmin = ctx.user.role === 'admin';
  const f = { from: parseDay(q.get('from'), 'von'), to: parseDay(q.get('to'), 'bis'), cashier: isAdmin ? (q.get('cashier') ? parseId(q.get('cashier')) : null) : ctx.user.id };
  if (f.from && f.to && f.from > f.to) throw bad('"Von" liegt nach "Bis".');
  const stats = computeStats(f, isAdmin && !f.cashier);
  const today = businessDay();
  const todayStats = computeStats({ from: today, to: today, cashier: f.cashier }, false);
  ctx.json(200, { today, range: { from: f.from, to: f.to, cashier: f.cashier }, ...stats, todaySummary: todayStats.summary });
});

route('POST', /^\/api\/discord\/daily$/, {}, async ctx => {
  if (!discord.enabled) throw new HttpError(503, 'Discord ist auf dem Server nicht eingerichtet (DISCORD_WEBHOOK fehlt).');
  const body = await ctx.body();
  const all = body.scope === 'all';
  await assertMayPostToDiscord(ctx.user);
  if (all && ctx.user.role !== 'admin') throw new HttpError(403, 'Nur Administratoren dürfen den Gesamtumsatz senden.');
  const cooldownKey = `daily:${ctx.user.id}:${all}`;
  if (lockedFor(cooldownKey)) throw new HttpError(429, 'Bitte einen Moment warten, bevor der Tagesumsatz erneut gesendet wird.');
  const day = body.day ? parseDay(body.day, 'Tag') : businessDay();
  const filter = { from: day, to: day, cashier: all ? null : ctx.user.id };
  const stats = computeStats(filter, all);
  if (!stats.products.length && stats.summary.invoiceCount === 0) throw bad('Noch kein Umsatz vorhanden!');
  const payload = discord.buildDailyPayload({
    day, who: all ? 'Gesamt (alle Mitarbeiter)' : `Kassierer: ${ctx.user.username}`,
    summary: stats.summary, products: stats.products, byCashier: all ? stats.byCashier.filter(c => c.invoiceCount > 0 || c.stornoCount > 0) : null,
  });
  const res = await discord.post(payload);
  if (!res.ok) throw new HttpError(502, `Senden an Discord fehlgeschlagen (${res.error}).`);
  failures.set(cooldownKey, { count: 0, first: Date.now(), until: Date.now() + 10000 });
  audit(ctx.user, 'discord.daily', `${all ? 'alle' : 'eigene'} ${day}`, ctx.ip);
  ctx.json(200, { ok: true });
});

// ---- Administration
route('GET', /^\/api\/admin\/users$/, { admin: true }, ctx => {
  const rows = db.prepare('SELECT * FROM users WHERE archived=0 ORDER BY username_lower').all();
  const users = rows.map(userDTO);
  ctx.json(200, { users });
});

route('POST', /^\/api\/admin\/users$/, { admin: true }, async ctx => {
  const body = await ctx.body();
  const username = String(body.username || '').trim();
  if (!USERNAME_RE.test(username)) throw bad('Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, . _ -).');
  const role = body.role === 'admin' ? 'admin' : 'cashier';
  let password = body.password, generated = false;
  if (password === undefined || password === null || password === '') { password = auth.generatePassword(); generated = true; }
  const problem = auth.checkPasswordPolicy(password, username);
  if (problem) throw bad(problem);
  if (db.prepare('SELECT 1 FROM users WHERE username_lower=?').get(username.toLowerCase())) throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben.');
  const u = await createUser({ username, password, role, createdBy: ctx.user.id, mustChange: true });
  audit(ctx.user, 'user.create', `${u.username} (${u.role})`, ctx.ip);
  ctx.json(201, { user: userDTO(u), temporaryPassword: generated ? password : undefined });
});

const PROTECTED_USER = 'admin'; // Die Rolle dieses Kontos ist fest (Administrator) und nicht änderbar
route('PATCH', /^\/api\/admin\/users\/(\d+)$/, { admin: true }, async ctx => {
  const body = await ctx.body();
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(parseId(ctx.params[0]));
  if (!target) throw new HttpError(404, 'Mitarbeiter nicht gefunden.');
  if (body.active === undefined && body.role === undefined) throw bad('Feld "active" (true/false) oder "role" fehlt.');

  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'cashier') throw bad('Ungültige Rolle.');
    if (target.username_lower === PROTECTED_USER) throw new HttpError(403, `Die Rolle des Kontos „${target.username}“ kann nicht geändert werden.`);
    if (body.role !== target.role) {
      if (target.role === 'admin' && target.active &&
          db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id<>?`).get(target.id).c === 0) {
        throw bad('Der letzte aktive Administrator kann nicht herabgestuft werden.');
      }
      db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, target.id);
      audit(ctx.user, 'user.role', `${target.username}: ${target.role} -> ${body.role}`, ctx.ip);
    }
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw bad('Feld "active" muss true/false sein.');
    if (target.id === ctx.user.id && !body.active) throw bad('Du kannst dein eigenes Konto nicht deaktivieren.');
    db.prepare('UPDATE users SET active=?, archived=CASE WHEN ?=1 THEN 0 ELSE archived END WHERE id=?').run(body.active ? 1 : 0, body.active ? 1 : 0, target.id);
    if (!body.active) destroyUserSessions(target.id, undefined, 'Dein Konto wurde deaktiviert. Du wurdest abgemeldet.');
    audit(ctx.user, body.active ? 'user.activate' : 'user.deactivate', target.username, ctx.ip);
  }
  ctx.json(200, { user: userDTO(db.prepare('SELECT * FROM users WHERE id=?').get(target.id)) });
});

/* Konto löschen: verschwindet komplett (Konto, Sitzungen, Discord-Verknüpfung) und taucht in keiner Mitarbeiter-/Kassierer-Liste mehr auf.
   Bereits erstellte Rechnungen sind unveränderbar und bleiben mit dem Namen als Text bestehen (Umsatz/Buchhaltung). */
route('DELETE', /^\/api\/admin\/users\/(\d+)$/, { admin: true }, ctx => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(parseId(ctx.params[0]));
  if (!target) throw new HttpError(404, 'Mitarbeiter nicht gefunden.');
  if (target.id === ctx.user.id) throw bad('Du kannst dein eigenes Konto nicht löschen.');
  if (target.role === 'admin' && target.active &&
      db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id<>?`).get(target.id).c === 0) {
    throw bad('Das letzte aktive Administrator-Konto kann nicht gelöscht werden.');
  }
  purgeUser(target.id);
  audit(ctx.user, 'user.delete', target.username, ctx.ip);
  ctx.json(200, { result: 'deleted' });
});

route('POST', /^\/api\/admin\/users\/(\d+)\/reset-password$/, { admin: true }, async ctx => {
  const body = await ctx.body();
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(parseId(ctx.params[0]));
  if (!target) throw new HttpError(404, 'Mitarbeiter nicht gefunden.');
  let password = body.password, generated = false;
  if (password === undefined || password === null || password === '') { password = auth.generatePassword(); generated = true; }
  const problem = auth.checkPasswordPolicy(password, target.username);
  if (problem) throw bad(problem);
  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(await auth.hashPassword(password), target.id);
  destroyUserSessions(target.id);
  audit(ctx.user, 'user.reset_password', target.username, ctx.ip);
  ctx.json(200, { temporaryPassword: generated ? password : undefined });
});

/* ---- Produktverwaltung (nur Administratoren). Preise = ganze Euro; Rechnungen behalten ihren damaligen Preis. */
const MAX_PRODUCT_PRICE = 100_000_000;
function parseProductFields(body, { partial }) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = cleanText(body.name, 60);
    if (name.length < 1) throw bad('Bitte einen Produktnamen eingeben (max. 60 Zeichen).');
    out.name = name;
  }
  if (!partial || body.price !== undefined) {
    let pr = body.price;
    if (typeof pr === 'string' && /^\d{1,9}$/.test(pr.trim())) pr = Number(pr.trim());
    if (!Number.isInteger(pr) || pr < 0 || pr > MAX_PRODUCT_PRICE) throw bad('Der Preis muss eine ganze Zahl in Euro sein (0 bis 100.000.000).');
    out.price = pr;
  }
  if (!partial || body.categoryId !== undefined) {
    if (!catalog.CATEGORIES.some(c => c.id === body.categoryId)) throw bad('Bitte eine gültige Kategorie wählen.');
    out.categoryId = body.categoryId;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw bad('Feld "active" muss true/false sein.');
    out.active = body.active;
  }
  return out;
}

route('GET', /^\/api\/admin\/products$/, { admin: true }, ctx => ctx.json(200, catalog.adminList()));

route('POST', /^\/api\/admin\/products$/, { admin: true }, async ctx => {
  const f = parseProductFields(await ctx.body(), { partial: false });
  if (catalog.nameTaken(f.name)) throw new HttpError(409, 'Ein Produkt mit diesem Namen gibt es schon.');
  const p = catalog.create(f);
  audit(ctx.user, 'product.create', `${p.name} (${p.category}) ${p.price} €`, ctx.ip);
  ctx.json(201, { product: p });
});

route('PATCH', /^\/api\/admin\/products\/(\d+)$/, { admin: true }, async ctx => {
  const id = parseId(ctx.params[0]);
  const cur = catalog.get(id);
  if (!cur) throw new HttpError(404, 'Produkt nicht gefunden.');
  const f = parseProductFields(await ctx.body(), { partial: true });
  if (!Object.keys(f).length) throw bad('Nichts zu ändern.');
  if (f.name !== undefined && catalog.nameTaken(f.name, id)) throw new HttpError(409, 'Ein Produkt mit diesem Namen gibt es schon.');
  const p = catalog.update(id, f);
  const changes = [];
  if (p.price !== cur.price) changes.push(`Preis ${cur.price} € → ${p.price} €`);
  if (p.name !== cur.name) changes.push(`Name „${cur.name}“ → „${p.name}“`);
  if (p.categoryId !== cur.categoryId) changes.push(`Kategorie ${cur.category} → ${p.category}`);
  if (p.active !== cur.active) changes.push(p.active ? 'eingeblendet' : 'ausgeblendet');
  audit(ctx.user, 'product.update', `${cur.name}: ${changes.join(', ') || 'keine Änderung'}`, ctx.ip);
  ctx.json(200, { product: p });
});

route('DELETE', /^\/api\/admin\/products\/(\d+)$/, { admin: true }, ctx => {
  const id = parseId(ctx.params[0]);
  const cur = catalog.get(id);
  if (!cur) throw new HttpError(404, 'Produkt nicht gefunden.');
  catalog.remove(id);
  audit(ctx.user, 'product.delete', `${cur.name} (${cur.price} €)`, ctx.ip);
  ctx.json(200, { result: 'deleted' });
});

route('GET', /^\/api\/admin\/audit$/, { admin: true }, ctx => {
  const limit = Math.min(500, Math.max(1, parseInt(ctx.url.searchParams.get('limit') || '100', 10) || 100));
  ctx.json(200, { entries: db.prepare('SELECT id, at, username, action, detail, ip FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map(r => ({ ...r })) });
});

route('GET', /^\/api\/admin\/export\.csv$/, { admin: true }, ctx => {
  const q = ctx.url.searchParams;
  const f = { from: parseDay(q.get('from'), 'von'), to: parseDay(q.get('to'), 'bis'), cashier: q.get('cashier') ? parseId(q.get('cashier')) : null };
  const { where, args } = filterSql(f);
  const rows = db.prepare(`${INVOICE_SELECT} ${where} ORDER BY i.id`).all(...args);
  const itemsStmt = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id');
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV-Injection verhindern
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['Nummer', 'Art', 'Datum', 'Uhrzeit', 'Geschäftstag', 'Kassierer', 'Positionen', 'Zwischensumme', 'Rabatt %', 'Rabatt', 'Rabattgrund', 'Gesamt', 'Bezug', 'Storno-Grund', 'Storniert von'];
  const lines = [head.map(cell).join(';')];
  const dFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, dateStyle: 'short' });
  const tFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, timeStyle: 'medium' });
  for (const r of rows) {
    const d = new Date(r.created_at);
    const items = itemsStmt.all(r.id).map(x => `${x.quantity}x ${x.product_name}`).join(', ');
    lines.push([r.number, r.kind === 'storno' ? 'Storno' : 'Rechnung', dFmt.format(d), tFmt.format(d), r.business_day, r.cashier_name, items,
      r.subtotal, r.discount_percent, r.discount_amount, r.discount_reason, r.total, r.ref_number || '', r.storno_reason || '', r.kind === 'storno' ? r.created_by_name : ''].map(cell).join(';'));
  }
  audit(ctx.user, 'export.csv', `${rows.length} Zeilen`, ctx.ip);
  res_csv(ctx.res, '\ufeff' + lines.join('\r\n') + '\r\n');
});
function res_csv(res, text) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="club77-rechnungen.csv"', 'Cache-Control': 'no-store' });
  res.end(text);
}

/* ------------------------------------------------------------------ Dispatcher */
async function handleApi(req, res, url) {
  const method = req.method;
  const ip = clientIp(req);
  // CSRF-Schutz (zusätzlich zu SameSite=Strict): Origin muss passen, Custom-Header Pflicht bei schreibenden Aufrufen
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* ignore */ }
      if (!ok) throw new HttpError(403, 'Anfrage von fremder Herkunft abgelehnt.');
    }
    if (req.headers['x-requested-with'] !== 'club77') throw new HttpError(403, 'Ungültige Anfrage.');
  }
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    let user = null;
    if (!r.opts.public) {
      user = authenticate(req);
      if (!user) {
        const why = revokedReason(req);
        throw new HttpError(401, why || 'Bitte anmelden.', why ? 'SESSION_REVOKED' : 'UNAUTHENTICATED');
      }
      if (user.mustChangePassword && !r.opts.allowPwChange) throw new HttpError(403, 'Bitte zuerst das Passwort ändern.', 'PASSWORD_CHANGE_REQUIRED');
      if (r.opts.admin && user.role !== 'admin') {
        audit(user, 'access.denied', `${method} ${url.pathname}`, ip);
        throw new HttpError(403, 'Nur Administratoren dürfen diese Aktion ausführen.', 'FORBIDDEN');
      }
    }
    let bodyCache;
    const ctx = {
      req, res, url, ip, user, params: m.slice(1),
      body: () => (bodyCache ??= readJson(req)),
      json: (status, data, headers) => sendJson(res, status, data, headers),
    };
    return r.handler(ctx);
  }
  throw new HttpError(404, 'Nicht gefunden.');
}

/* ------------------------------------------------------------------ Statische Dateien (Whitelist aus /public) */
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const staticFiles = new Map();
for (const f of fs.readdirSync(PUBLIC_DIR)) {
  const full = path.join(PUBLIC_DIR, f);
  if (fs.statSync(full).isFile() && MIME[path.extname(f)]) staticFiles.set('/' + f, { data: fs.readFileSync(full), type: MIME[path.extname(f)] });
}
function serveStatic(req, res, url) {
  const key = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = staticFiles.get(key);
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : f.data);
}

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  const finish = err => {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) {
      const headers = err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {};
      return sendJson(res, err.status, { error: err.message, code: err.code }, headers);
    }
    console.error('[error]', err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
    sendJson(res, 500, { error: 'Interner Serverfehler.' });
  };
  if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) {
    Promise.resolve().then(() => handleApi(req, res, url)).catch(finish);
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
  } else {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end();
  }
});
server.requestTimeout = 30000;

/* ------------------------------------------------------------------ Backups (SQLite VACUUM INTO, auf dem Volume) */
function backupDb() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter(f => /^club77-.*\.db$/.test(f)).sort();
  if (files.length) {
    const last = fs.statSync(path.join(dir, files[files.length - 1])).mtimeMs;
    if (Date.now() - last < 20 * 3600 * 1000) return null;
  }
  const target = path.join(dir, `club77-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  fs.chmodSync(target, 0o600);
  for (const old of fs.readdirSync(dir).filter(f => /^club77-.*\.db$/.test(f)).sort().slice(0, -14)) fs.unlinkSync(path.join(dir, old));
  console.log('[backup] erstellt:', path.basename(target));
  return target;
}

/* ------------------------------------------------------------------ Start */
/* ------------------------------------------------------------------ Bot: laufende Discord-Autorisierung */
// Der Bot-Token wird NUR hier auf dem Server benutzt (REST-Abfrage der Mitglieder-Rollen). Es läuft kein Bot-Prozess,
// der Bot muss nur auf dem Server sein. Verliert jemand Mitgliedschaft oder Mitarbeiter-Rolle, werden seine Sitzungen beendet.
async function botGet(pathname) {
  const res = await fetch(`${DC_BASE}/api/${pathname}`, {
    headers: { Authorization: 'Bot ' + DC_BOT_TOKEN }, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (res.status === 404) return null; // Mitglied existiert nicht (mehr)
  if (!res.ok) throw new Error('Discord HTTP ' + res.status);
  return res.json();
}
async function botMemberStatus(discordId) {
  const member = await botGet(`guilds/${DC_GUILD_ID}/members/${discordId}`);
  if (!member) return { member: false, isStaff: false, isAdmin: false };
  const roles = Array.isArray(member.roles) ? member.roles.map(String) : [];
  const isAdmin = !!DC_ADMIN_ROLE && roles.includes(DC_ADMIN_ROLE);
  return { member: true, isAdmin, isStaff: isAdmin || roles.includes(DC_STAFF_ROLE) };
}

let rechecking = false, lastBotError = '';
async function recheckDiscordAccess() {
  if (!BOT_ENABLED || rechecking) return;
  rechecking = true;
  try {
    // 1) Im Nur-Discord-Modus: Passwort-Sitzungen von normalen Mitarbeitern (z. B. aus der Zeit davor) beenden
    if (DISCORD_ONLY) {
      const stale = db.prepare(`SELECT DISTINCT s.user_id id, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.via='password'`).all()
        .filter(u => !(u.role === 'admin' && ADMIN_PW_LOGIN));
      for (const u of stale) {
        revokeSessions(u.id, 'Die Anmeldung ist jetzt nur noch über Discord möglich. Bitte melde dich mit „Mit Discord anmelden“ an.', { onlyVia: 'password' });
        audit(null, 'discord.session_ended', `${u.username}: Passwort-Sitzung im Nur-Discord-Modus`);
      }
    }
    // 2) Discord-Sitzungen: Mitgliedschaft + Rolle erneut bei Discord prüfen
    const users = db.prepare(
      `SELECT DISTINCT u.* FROM users u JOIN sessions s ON s.user_id=u.id
        WHERE u.active=1 AND u.discord_id IS NOT NULL AND s.via='discord' AND s.expires_at>?`).all(Date.now());
    for (const u of users) {
      let st;
      try { st = await botMemberStatus(u.discord_id); lastBotError = ''; }
      catch (e) {
        // Discord/Bot nicht erreichbar: letzten Stand beibehalten (die Kasse darf im Club nicht ausfallen)
        if (e.message !== lastBotError) console.error('[bot] Prüfung nicht möglich:', e.message);
        lastBotError = e.message;
        continue;
      }
      if (!st.isStaff) {
        revokeSessions(u.id, st.member
          ? 'Dir fehlt die nötige Rolle auf dem Discord-Server. Du wurdest abgemeldet. Bitte wende dich an die Leitung.'
          : 'Du bist nicht mehr auf dem Discord-Server. Du wurdest abgemeldet. Bitte wende dich an die Leitung.');
        audit(u, 'discord.revoked', st.member ? 'Mitarbeiter-Rolle entfernt' : 'nicht mehr auf dem Discord-Server');
        console.log(`[bot] Zugriff entzogen: ${u.username}`);
        continue;
      }
      if (DC_ADMIN_ROLE) { // Rolle folgt Discord; der letzte aktive Admin wird nie herabgestuft
        const want = st.isAdmin ? 'admin' : 'cashier';
        if (u.role !== want) {
          const others = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id<>?`).get(u.id).c;
          if (want === 'admin' || others > 0) {
            db.prepare('UPDATE users SET role=? WHERE id=?').run(want, u.id);
            audit(u, 'discord.role_sync', `${u.role} -> ${want} (Bot-Prüfung)`);
          }
        }
      }
    }
  } catch (e) { console.error('[bot] Fehler:', e.message); }
  finally { rechecking = false; }
}

async function main() {
  for (const u of db.prepare('SELECT id, username FROM users WHERE archived=1').all()) { purgeUser(u.id); audit(null, 'user.delete', u.username + ' (früher archiviert)'); }
  await ensureAdmin();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CLUB 77 Kassensystem läuft auf Port ${PORT} | DB: ${DB_FILE} | Discord-Tagesumsatz: ${discord.enabled ? 'aktiv' : 'aus'} | Discord-Login: ${DISCORD_LOGIN ? 'aktiv' : 'aus'} | Bot-Prüfung: ${BOT_ENABLED ? 'alle ' + RECHECK_MS / 1000 + ' s' : 'aus'} | Nur-Discord: ${DISCORD_ONLY ? 'an' : 'aus'} | Geschäftstag ab ${DAY_START_HOUR}:00 (${TZ})`);
  });
  if (BOT_ENABLED) {
    botGet(`guilds/${DC_GUILD_ID}`).then(g => console.log(g ? `[bot] Verbindung OK – Discord-Server "${cleanText(g.name, 40)}"` : '[bot] Der Bot ist nicht auf dem Discord-Server (Server-ID prüfen / Bot einladen).'))
      .catch(e => console.error('[bot] Verbindung fehlgeschlagen:', e.message, '(Bot-Token prüfen)'));
    setTimeout(recheckDiscordAccess, 3000).unref();
    setInterval(recheckDiscordAccess, RECHECK_MS).unref();
  }
  setTimeout(() => { try { backupDb(); } catch (e) { console.error('[backup] Fehler:', e.message); } }, 60 * 1000).unref();
  setInterval(() => { try { backupDb(); } catch (e) { console.error('[backup] Fehler:', e.message); } }, 6 * 3600 * 1000).unref();
}
function shutdown() {
  console.log('Fahre herunter …');
  server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
main().catch(e => { console.error(e); process.exit(1); });
