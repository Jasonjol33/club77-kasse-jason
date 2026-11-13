'use strict';
/*
 * Legt einen Administrator an oder setzt dessen Passwort zurück (z. B. bei Passwortverlust).
 * Aufruf (auf Fly.io):  fly ssh console -C "sh -c 'ADMIN_PASSWORD=... node scripts/create-admin.js admin'" -a <app>
 * Das Passwort wird NICHT als Argument übergeben (sonst landet es in der Shell-Historie), sondern per Umgebungsvariable.
 */
const path = require('node:path');
const { openDatabase } = require('../lib/db');
const auth = require('../lib/auth');

(async () => {
  const username = (process.argv[2] || '').trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username) || !password) {
    console.error('Aufruf: ADMIN_PASSWORD="…" node scripts/create-admin.js <benutzername>');
    process.exit(1);
  }
  const problem = auth.checkPasswordPolicy(password, username);
  if (problem) { console.error(problem); process.exit(1); }
  const { db } = openDatabase(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const hash = await auth.hashPassword(password);
  const existing = db.prepare('SELECT * FROM users WHERE username_lower=?').get(username.toLowerCase());
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE users SET password_hash=?, role='admin', active=1, must_change_password=0 WHERE id=?`).run(hash, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);
    db.prepare('INSERT INTO audit_log(at,username,action,detail) VALUES (?,?,?,?)').run(now, username, 'cli.admin_reset', 'per scripts/create-admin.js');
    console.log(`Konto "${existing.username}" ist jetzt aktiver Administrator mit neuem Passwort.`);
  } else {
    db.prepare(`INSERT INTO users(username,username_lower,role,active,password_hash,must_change_password,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(username, username.toLowerCase(), 'admin', 1, hash, 0, now);
    db.prepare('INSERT INTO audit_log(at,username,action,detail) VALUES (?,?,?,?)').run(now, username, 'cli.admin_create', 'per scripts/create-admin.js');
    console.log(`Administrator "${username}" wurde angelegt.`);
  }
  db.close();
})();
