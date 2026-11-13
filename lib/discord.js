'use strict';
/*
 * Discord-Anbindung (nur serverseitig; Webhook-URL kommt ausschließlich aus der Umgebungsvariable DISCORD_WEBHOOK).
 *
 * Nach Discord geht NUR der Tagesumsatz – und nur, wenn ein Mitarbeiter/Admin ihn per Knopfdruck sendet.
 * Bons und Stornos werden ausschließlich im Kassensystem gespeichert (gesammelt) und nie automatisch gesendet.
 */
const { CATEGORY_ORDER } = require('./catalog');

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const PINK = 0xff2bd6;

function createDiscord({ webhookUrl, timeZone, allowAnyUrl = false, logger = console }) {
  let url = (webhookUrl || '').trim();
  if (url && !allowAnyUrl && !WEBHOOK_RE.test(url)) {
    logger.error('[discord] DISCORD_WEBHOOK hat kein gültiges Format – Discord ist deaktiviert.');
    url = '';
  }
  const enabled = !!url;
  const eur = n => Number(n).toLocaleString('de-DE') + ' €';
  const dayDE = d => d.split('-').reverse().join('.');

  async function post(payload) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (res.ok) return { ok: true };
      let retryAfterMs = 0;
      if (res.status === 429) {
        try { retryAfterMs = Math.ceil(((await res.json()).retry_after || 1) * 1000); } catch { retryAfterMs = 2000; }
      }
      return { ok: false, status: res.status, retryAfterMs, error: 'HTTP ' + res.status };
    } catch (e) {
      return { ok: false, error: e && e.name === 'TimeoutError' ? 'Timeout' : 'Netzwerkfehler' };
    }
  }

  /* ---------- Embed ---------- */
  /** Tagesumsatz – gleiche Struktur wie im Original (Umsatz / Rabatte / Gesamt + Felder je Kategorie). */
  function buildDailyPayload({ day, who, summary, products, byCashier }) {
    const artikel = products.reduce((s, p) => s + p.qty, 0);
    const fields = [{ name: '💰 Umsatz', value: eur(summary.gross), inline: true }];
    if (summary.discounts > 0) fields.push({ name: '🎁 Rabatte', value: '−' + eur(summary.discounts), inline: true });
    fields.push({ name: '✅ Gesamt', value: `**${eur(summary.revenue)}**`, inline: true });

    const groups = new Map();
    for (const p of products) {
      if (!groups.has(p.category)) groups.set(p.category, { sum: 0, rows: [] });
      const g = groups.get(p.category);
      g.sum += p.total;
      g.rows.push({ s: p.total, txt: `\`${p.qty.toLocaleString('de-DE')}×\` ${p.name} — **${eur(p.total)}**` });
    }
    const order = [...CATEGORY_ORDER, ...[...groups.keys()].filter(k => !CATEGORY_ORDER.includes(k))];
    const addChunked = (title, sum, rows) => {
      let chunk = '', part = 0;
      const push = () => {
        fields.push({ name: part === 0 ? (sum === null ? title : `${title} • ${eur(sum)}`) : `${title} (Fortsetzung)`, value: chunk, inline: false });
        part++; chunk = '';
      };
      for (const r of rows) { if ((chunk + '\n' + r).length > 1000) push(); chunk += (chunk ? '\n' : '') + r; }
      if (chunk) push();
    };
    for (const cat of order) {
      const g = groups.get(cat);
      if (!g) continue;
      g.rows.sort((a, b) => b.s - a.s);
      addChunked(cat, g.sum, g.rows.map(r => r.txt));
    }
    if (byCashier && byCashier.length) {
      addChunked('👥 Pro Mitarbeiter', null,
        byCashier.map(c => `${c.username} — ${c.invoiceCount} Bons — **${eur(c.revenue)}**`));
    }
    return {
      embeds: [{
        title: '📈 CLUB 77 • Tagesumsatz',
        description: `📅 **${dayDE(day)}**\n👤 **${who}**\n📦 **Artikel verkauft:** ${artikel.toLocaleString('de-DE')}`,
        color: PINK, fields: fields.slice(0, 25), footer: { text: 'Club 77 Kassensystem' }, timestamp: new Date().toISOString(),
      }],
    };
  }

  return { enabled, post, buildDailyPayload };
}

module.exports = { createDiscord };
