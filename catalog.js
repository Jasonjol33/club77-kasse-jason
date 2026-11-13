'use strict';
/*
 * Serverseitiger Produktkatalog = einzige vertrauenswürdige Preisquelle.
 * Die Produkte liegen in der Datenbank (Tabelle "products") und werden im Admin-Reiter „Produkte“ gepflegt.
 * Beim allerersten Start wird die Tabelle einmalig mit der Standardliste unten gefüllt.
 * Preise sind ganze Euro-Beträge. Bereits ausgestellte Rechnungen behalten ihren Preis (Name/Preis stehen in der Rechnung).
 */
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

module.exports = {
  init, reload, CATEGORIES, CATEGORY_ORDER,
  findProduct: name => byName.get(name),
  orderOf: name => (order.has(name) ? order.get(name) : 1e9),
  publicCatalog: () => CATEGORIES
    .map(c => ({ id: c.id, title: c.title, items: rows.filter(p => p.active && p.categoryId === c.id).map(p => ({ name: p.name, price: p.price })) }))
    .filter(c => c.items.length),
  adminList: () => ({ categories: CATEGORIES, products: rows }),
  get, nameTaken, create, update, remove,
};
