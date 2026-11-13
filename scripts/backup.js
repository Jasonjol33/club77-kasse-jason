'use strict';
/* Erstellt sofort eine konsistente Sicherung der Datenbank:  node scripts/backup.js [Zielpfad.db] */
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('../lib/db');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = openDatabase(dataDir);
const dir = path.join(dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = process.argv[2] || path.join(dir, `club77-manuell-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
db.prepare('VACUUM INTO ?').run(target);
fs.chmodSync(target, 0o600);
console.log('Sicherung erstellt:', target);
db.close();
