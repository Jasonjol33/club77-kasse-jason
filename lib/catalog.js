'use strict';
/*
 * Serverseitiger Produktkatalog = einzige vertrauenswürdige Preisquelle.
 * Übernommen 1:1 aus der ursprünglichen Club77.html (Namen, Preise, Kategorien, Reihenfolge).
 * Preise sind ganze Euro-Beträge (wie im Original).
 * Preisänderungen: hier ändern und neu deployen. Bereits ausgestellte Rechnungen behalten ihren Preis.
 */
const CATEGORIES = [
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

const BY_NAME = new Map();
const ORDER = new Map();
let idx = 0;
for (const cat of CATEGORIES) {
  for (const [name, price] of cat.items) {
    if (BY_NAME.has(name)) throw new Error('Doppelter Produktname im Katalog: ' + name);
    BY_NAME.set(name, { name, price, category: cat.title });
    ORDER.set(name, idx++);
  }
}
const CATEGORY_ORDER = CATEGORIES.map(c => c.title);

module.exports = {
  CATEGORIES,
  CATEGORY_ORDER,
  findProduct: name => BY_NAME.get(name),
  orderOf: name => (ORDER.has(name) ? ORDER.get(name) : 9999),
  publicCatalog: () => CATEGORIES.map(c => ({
    id: c.id, title: c.title, items: c.items.map(([name, price]) => ({ name, price })),
  })),
};
