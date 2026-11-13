'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_V1 = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO counters(name, value) VALUES ('invoice', 0), ('storno', 0);

/* Rechnungen UND Stornobuchungen (kind). Beträge in ganzen Euro. Stornos haben negative Beträge. */
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('invoice','storno')),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  cashier_name TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  business_day TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  ref_invoice_id INTEGER UNIQUE REFERENCES invoices(id),
  storno_reason TEXT,
  request_id TEXT,
  CHECK ((kind='invoice' AND ref_invoice_id IS NULL) OR (kind='storno' AND ref_invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX invoices_request ON invoices(cashier_id, request_id);
CREATE INDEX invoices_day ON invoices(business_day);
CREATE INDEX invoices_cashier_day ON invoices(cashier_id, business_day);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX items_invoice ON invoice_items(invoice_id);

CREATE TABLE discord_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (kind, invoice_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT
);

/* Unveränderbarkeit: Rechnungen, Positionen und Protokoll können weder geändert noch gelöscht werden. */
CREATE TRIGGER invoices_no_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT, 'Rechnungen sind unveränderbar'); END;
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'Rechnungen dürfen nicht gelöscht werden'); END;
CREATE TRIGGER items_no_update BEFORE UPDATE ON invoice_items BEGIN SELECT RAISE(ABORT, 'Rechnungspositionen sind unveränderbar'); END;
CREATE TRIGGER items_no_delete BEFORE DELETE ON invoice_items BEGIN SELECT RAISE(ABORT, 'Rechnungspositionen dürfen nicht gelöscht werden'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderbar'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'Protokoll darf nicht gelöscht werden'); END;
`;

const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN discord_id TEXT;
ALTER TABLE users ADD COLUMN discord_name TEXT;
CREATE UNIQUE INDEX users_discord ON users(discord_id) WHERE discord_id IS NOT NULL;
`;

const SCHEMA_V3 = `
ALTER TABLE users ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
`;

const SCHEMA_V4 = `
ALTER TABLE sessions ADD COLUMN via TEXT NOT NULL DEFAULT 'password';
`;

const SCHEMA_V5 = `
CREATE TABLE session_revocations (token_hash TEXT PRIMARY KEY, reason TEXT NOT NULL, at INTEGER NOT NULL);
`;

const SCHEMA_V6 = `
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'club77.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 6) throw new Error('Unbekannte Datenbankversion ' + version);
  const steps = [[0, SCHEMA_V1, 1], [1, SCHEMA_V2, 2], [2, SCHEMA_V3, 3], [3, SCHEMA_V4, 4], [4, SCHEMA_V5, 5], [5, SCHEMA_V6, 6]];
  for (const [from, sql, to] of steps) {
    if (version !== from) continue;
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(sql); db.exec('PRAGMA user_version=' + to); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    version = to;
  }
  return { db, file };
}

/** Führt fn in einer Transaktion aus (BEGIN IMMEDIATE => Schreibsperre, Rollback bei Fehler). */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}

module.exports = { openDatabase, transaction };