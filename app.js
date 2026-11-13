'use strict';
/*
 * CLUB 77 Kassensystem – Frontend
 * Wichtig: Preise, Summen, Rechte und Umsätze werden IMMER vom Server berechnet und geprüft.
 * Alles, was hier angezeigt wird, ist nur Darstellung. Es werden keine Geheimnisse im Browser gespeichert.
 * Alle Texte aus Serverdaten werden per textContent eingefügt (kein innerHTML -> kein XSS).
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === false || v == null) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  const fmt = n => Number(n).toLocaleString('de-DE');
  const eur = n => fmt(n) + ' €';
  const state = {
    user: null, config: null, categories: null, products: new Map(),
    cart: new Map(), step: 1, requestId: null, busy: false, pwForced: false,
    inv: { offset: 0, total: 0, cashier: '', loadSeq: 0 },
    adminLoaded: false, discordLogin: false,
  };

  const tz = () => (state.config && state.config.timezone) || 'Europe/Berlin';
  const fmtDT = iso => new Date(iso).toLocaleString('de-DE', { timeZone: tz(), dateStyle: 'short', timeStyle: 'medium' });
  const fmtDay = d => (d ? d.split('-').reverse().join('.') : '');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

  /* ============================================================ API */
  class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }

  async function api(path, opt = {}) {
    const init = { method: opt.method || 'GET', headers: { 'X-Requested-With': 'club77' }, credentials: 'same-origin' };
    if (opt.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opt.body); }
    let res;
    try { res = await fetch(path, init); } catch { throw new ApiError('Keine Verbindung zum Server. Bitte erneut versuchen.', 0); }
    let data = null;
    try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
    if (!res.ok) {
      if (res.status === 401 && state.user && data && data.code === 'UNAUTHENTICATED') sessionLost();
      if (data && data.code === 'PASSWORD_CHANGE_REQUIRED') { state.pwForced = true; showOnly('pwView'); }
      throw new ApiError((data && data.error) || `Fehler ${res.status}`, res.status, data);
    }
    return data;
  }

  /* ============================================================ Ansichten */
  const VIEWS = ['loginView', 'setupView', 'pwView', 'appView'];
  function showOnly(id) {
    for (const v of VIEWS) $('#' + v).hidden = v !== id;
    if (id === 'pwView') {
      $('#pwLogout').textContent = state.pwForced ? 'Abmelden' : 'Abbrechen';
      $('#pwMsg').textContent = '';
      $('#pwOld').focus();
    }
  }

  function sessionLost() {
    resetClientState();
    showOnly('loginView');
    setMsg('#loginMsg', 'Deine Sitzung ist abgelaufen. Bitte neu anmelden.', true);
  }
  function resetClientState() {
    state.user = null; state.cart.clear(); state.adminLoaded = false; state.categories = null;
    closeDialog();
    for (const id of ['loginPass', 'pwOld', 'pwNew', 'pwNew2', 'setupPass', 'setupPass2']) $('#' + id).value = '';
    $('#secretBox').hidden = true;
  }
  function setMsg(sel, text, isErr = true) {
    const el = $(sel);
    el.textContent = text || '';
    el.className = 'msg ' + (text ? (isErr ? 'err' : 'ok') : '');
  }

  /* ============================================================ Dialog */
  const dlg = $('#dlg');
  function openDialog(...nodes) {
    dlg.textContent = '';
    dlg.append(...nodes);
    if (!dlg.open) dlg.showModal();
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

  /* ============================================================ Start / Anmeldung */
  const DISCORD_MSGS = {
    role: 'Dir fehlt die Mitarbeiter-Rolle auf dem Discord-Server. Bitte wende dich an die Leitung.',
    denied: 'Dein Konto ist deaktiviert.',
    guild: 'Du bist kein Mitglied des Discord-Servers.',
    cancel: 'Discord-Anmeldung abgebrochen.',
    state: 'Die Discord-Anmeldung ist abgelaufen oder ungültig. Bitte erneut versuchen.',
    error: 'Discord-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
    off: 'Die Discord-Anmeldung ist nicht eingerichtet.',
    taken: 'Dieses Discord-Konto ist bereits mit einem anderen Mitarbeiterkonto verknüpft.',
    linked: 'Discord wurde verknüpft ✔ Ab jetzt meldest du dich nur noch über Discord an.',
    unlinked: 'Dieses Discord-Konto ist noch mit keinem Konto verknüpft. Melde dich zuerst mit Benutzername und Passwort an und verknüpfe Discord danach über „💬 Discord verknüpfen“.',
    early: 'Discord kann erst nach der ersten vollständigen Anmeldung mit Passwort (inkl. Passwortwechsel) verknüpft werden.',
  };
  function discordResult() {
    const code = new URLSearchParams(location.search).get('discord');
    if (!code) return null;
    history.replaceState(null, '', location.pathname);
    return { code, text: DISCORD_MSGS[code] || DISCORD_MSGS.error };
  }

  async function boot() {
    const dres = discordResult();
    try {
      const st = await api('/api/status');
      state.discordLogin = !!st.discordLogin;
      $('#discordLoginWrap').hidden = !state.discordLogin;
      if (st.setupNeeded) return showOnly('setupView');
      if (st.user) { state.config = st.config; await enterApp(st.user); if (dres) alert(dres.text); return; }
      showOnly('loginView');
      if (dres) setMsg('#loginMsg', dres.text, dres.code === 'linked' ? false : true);
    } catch (e) {
      showOnly('loginView');
      setMsg('#loginMsg', e.message);
    }
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true; setMsg('#loginMsg', '');
    try {
      const r = await api('/api/login', { method: 'POST', body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value } });
      $('#loginPass').value = '';
      state.config = r.config;
      await enterApp(r.user);
    } catch (err) { setMsg('#loginMsg', err.message); }
    finally { btn.disabled = false; }
  });

  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#setupPass').value !== $('#setupPass2').value) return setMsg('#setupMsg', 'Die Passwörter stimmen nicht überein.');
    try {
      await api('/api/setup-admin', { method: 'POST', body: { setupCode: $('#setupCode').value.trim(), username: $('#setupUser').value.trim(), password: $('#setupPass').value } });
      $('#loginUser').value = $('#setupUser').value.trim();
      $('#setupPass').value = ''; $('#setupPass2').value = ''; $('#setupCode').value = '';
      showOnly('loginView');
      setMsg('#loginMsg', 'Administrator angelegt. Bitte jetzt anmelden.', false);
    } catch (err) { setMsg('#setupMsg', err.message); }
  });

  async function logout() {
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* egal */ }
    resetClientState();
    state.pwForced = false;
    showOnly('loginView');
    setMsg('#loginMsg', '');
  }
  $('#logoutBtn').addEventListener('click', logout);

  function updateDiscordBtn() {
    const b = $('#discordBtn');
    b.hidden = !(state.discordLogin || (state.user && state.user.discordLinked));
    if (state.user) b.textContent = state.user.discordLinked ? '💬 Discord trennen' : '💬 Discord verknüpfen';
  }
  $('#discordBtn').addEventListener('click', async () => {
    try {
      if (state.user.discordLinked) {
        if (!confirm('Verknüpfung mit Discord ' + (state.user.discordName ? '(' + state.user.discordName + ') ' : '') + 'wirklich entfernen?')) return;
        await api('/api/me/discord/unlink', { method: 'POST', body: {} });
        state.user.discordLinked = false; state.user.discordName = null; updateDiscordBtn();
      } else {
        const r = await api('/api/me/discord/link', { method: 'POST', body: {} });
        location.href = r.url;
      }
    } catch (e) { alert(e.message); }
  });

  $('#changePwBtn').addEventListener('click', () => { state.pwForced = false; showOnly('pwView'); });
  $('#pwLogout').addEventListener('click', () => { if (state.pwForced) logout(); else showOnly('appView'); });
  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#pwNew').value !== $('#pwNew2').value) return setMsg('#pwMsg', 'Die neuen Passwörter stimmen nicht überein.');
    try {
      await api('/api/me/password', { method: 'POST', body: { currentPassword: $('#pwOld').value, newPassword: $('#pwNew').value } });
      for (const id of ['pwOld', 'pwNew', 'pwNew2']) $('#' + id).value = '';
      const me = await api('/api/me');
      state.config = me.config; state.pwForced = false;
      await enterApp(me.user);
      alert('Passwort wurde geändert ✔');
    } catch (err) { setMsg('#pwMsg', err.message); }
  });

  async function enterApp(user) {
    state.user = user;
    if (user.mustChangePassword) { state.pwForced = true; return showOnly('pwView'); }
    state.pwForced = false;
    const admin = user.role === 'admin';
    $('#whoName').textContent = user.username;
    const badge = $('#whoRole');
    badge.textContent = admin ? 'Administrator' : 'Mitarbeiter';
    badge.className = 'badge' + (admin ? ' admin' : '');
    $('#cashierName').textContent = user.username;
    updateDiscordBtn();
    $('#tabAdmin').hidden = !admin;
    $('#tabProducts').hidden = !admin;
    $('#tabInvoices').textContent = admin ? '📄 Alle Rechnungen' : '📄 Meine Rechnungen';
    $('#invTitle').textContent = admin ? '📄 Alle Rechnungen' : '📄 Meine Rechnungen';
    $('#fCashierWrap').hidden = !admin;
    $('#rabatt').max = admin ? 100 : state.config.maxStaffDiscount;
    $('#sendDaily').textContent = '📈 Tagesumsatz an Discord senden';
    showOnly('appView');
    try {
      if (!state.categories) {
        const p = await api('/api/products');
        state.categories = p.categories;
        buildProducts(p.categories);
      }
    } catch (e) { alert('Produkte konnten nicht geladen werden: ' + e.message); }
    resetCart();
    switchTab('kasse');
  }

  /* ============================================================ Tabs */
  function switchTab(name) {
    $$('#tabs .chip').forEach(c => c.classList.toggle('on', c.dataset.tab === name));
    $('#kasseView').hidden = name !== 'kasse';
    $('#invoicesView').hidden = name !== 'invoices';
    $('#adminView').hidden = name !== 'admin' || state.user.role !== 'admin';
    $('#productsView').hidden = name !== 'products' || state.user.role !== 'admin';
    if (name === 'kasse') { refreshProducts(); loadDaily(); }
    if (name === 'products' && state.user.role === 'admin') loadProductsAdmin();
    if (name === 'invoices') openInvoicesTab();
    if (name === 'admin' && state.user.role === 'admin') loadAdmin();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) switchTab(b.dataset.tab); });

  /* ============================================================ KASSE (Produkte, Menge, Rabatt) */
  function buildProducts(categories) {
    const root = $('#products');
    root.textContent = '';
    state.products.clear();
    for (const cat of categories) {
      const grid = h('div', { class: 'grid' });
      for (const p of cat.items) {
        const count = h('span', { class: 'count' }, '0×');
        const minus = h('button', { class: 'minus', type: 'button', 'aria-label': p.name + ' entfernen' }, '−');
        const small = h('small', null, fmt(p.price) + ' €');
        const div = h('div', { class: 'item', tabindex: '0', role: 'button', 'aria-label': p.name + ', ' + fmt(p.price) + ' Euro' }, p.name, small, count, minus);
        state.products.set(p.name, { price: p.price, div, count });
        div.addEventListener('click', () => addQty(p.name, state.step));
        div.addEventListener('contextmenu', e => { e.preventDefault(); addQty(p.name, -state.step); });
        div.addEventListener('keydown', e => {
          if (e.target !== div) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addQty(p.name, state.step); }
          if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); addQty(p.name, -state.step); }
        });
        minus.addEventListener('click', e => { e.stopPropagation(); addQty(p.name, -state.step); });
        grid.append(div);
      }
      root.append(h('div', { class: 'card' }, h('h3', null, cat.title), grid));
    }
  }

  function addQty(name, delta) {
    const q = Math.max(0, Math.min(9999, (state.cart.get(name) || 0) + delta));
    if (q === 0) state.cart.delete(name); else state.cart.set(name, q);
    update();
  }

  /* Schrittweite pro Klick */
  $$('.step-buttons .btn').forEach(b => b.addEventListener('click', () => {
    state.step = Number(b.dataset.step);
    $$('.step-buttons .btn').forEach(x => { x.classList.toggle('on', x === b); x.classList.toggle('off', x !== b); });
  }));

  function getRabatt() {
    let v = Math.round(parseFloat($('#rabatt').value));
    const max = state.user && state.user.role === 'admin' ? 100 : (state.config ? state.config.maxStaffDiscount : 100);
    if (isNaN(v) || v < 0) v = 0;
    return Math.min(v, max);
  }
  function setRabatt(v) { $('#rabatt').value = v; update(); }
  $('#rabatt').addEventListener('input', update);
  $('#rabatt').addEventListener('change', () => { $('#rabatt').value = getRabatt(); update(); });
  $$('.chip[data-v]').forEach(c => c.addEventListener('click', () => setRabatt(Number(c.dataset.v))));

  function update() {
    let t = 0;
    for (const [name, p] of state.products) {
      const q = state.cart.get(name) || 0;
      p.count.textContent = q + '×';
      p.div.classList.toggle('has', q > 0);
      t += q * p.price;
    }
    const r = getRabatt();
    const d = Math.round(t * r / 100); // Anzeige – maßgeblich ist die Server-Berechnung
    const sumEl = $('#sum');
    sumEl.textContent = 'Gesamt: ' + fmt(t - d) + ' €';
    if (d > 0) sumEl.append(h('small', null, '(−' + fmt(d) + ' € Rabatt)'));
    $$('.chip[data-v]').forEach(c => c.classList.toggle('on', Number(c.dataset.v) === r));
    state.requestId = uuid(); // geänderter Warenkorb = neue Anfrage-ID
  }

  function resetCart() {
    state.cart.clear();
    $('#rabatt').value = 0;
    $('#rabattReason').value = '';
    update();
  }

  /* Bon abschließen -> Server speichert Rechnung (Preise/Rabatt werden dort neu berechnet) */
  $('#sendBon').addEventListener('click', async () => {
    if (state.busy) return;
    if (state.cart.size === 0) { alert('Warenkorb leer!'); return; }
    if (!confirm('Bon abschließen und zum Tagesumsatz hinzufügen?')) return;
    state.busy = true;
    const btn = $('#sendBon'); btn.disabled = true;
    try {
      const r = await api('/api/invoices', {
        method: 'POST',
        body: {
          requestId: state.requestId,
          items: [...state.cart.entries()].map(([name, quantity]) => ({ name, quantity })),
          discountPercent: getRabatt(),
          discountReason: $('#rabattReason').value,
        },
      });
      resetCart();
      showInvoice(r.invoice, { receipt: true });
      loadDaily();
    } catch (e) {
      alert('Bon konnte NICHT gespeichert werden: ' + e.message + '\nDer Warenkorb bleibt erhalten – bitte erneut versuchen.');
    } finally { state.busy = false; btn.disabled = false; }
  });

  /* Tagesumsatz (Box wie im Original) – berechnet aus den gespeicherten Rechnungen des angemeldeten Mitarbeiters */
  async function loadDaily() {
    const box = $('#dailyBox');
    try {
      const s = await api('/api/stats?from=today&to=today&cashier=' + state.user.id);
      $('#dailyDay').textContent = '(Geschäftstag ' + fmtDay(s.today) + ')';
      box.textContent = '';
      for (const p of s.products) box.append(h('div', null, `• ${fmt(p.qty)}× ${p.name} = ${fmt(p.total)} €`));
      if (s.summary.discounts > 0) box.append(h('div', { style: 'color:var(--pink)' }, `• 🎁 Rabatte = −${fmt(s.summary.discounts)} €`));
      box.append(h('div', { style: 'margin-top:10px;font-weight:800;color:var(--pink)' }, 'Gesamt: ' + fmt(s.summary.revenue) + ' €'));
    } catch (e) { box.textContent = 'Konnte nicht geladen werden: ' + e.message; }
  }
  $('#refreshDaily').addEventListener('click', loadDaily);

  $('#sendDaily').addEventListener('click', async () => {
    if (!confirm('Tagesumsatz wirklich senden?')) return;
    try { await api('/api/discord/daily', { method: 'POST', body: { scope: 'own' } }); alert('Tagesumsatz an Discord gesendet ✔'); }
    catch (e) { alert('Senden fehlgeschlagen: ' + e.message); }
  });

  /* ============================================================ Rechnungsdetail / Bon */
  function showInvoice(inv, opt = {}) {
    const isStorno = inv.kind === 'storno';
    const admin = state.user.role === 'admin';
    const nodes = [];
    nodes.push(h('h3', null, (opt.receipt ? '🧾 BON ' : isStorno ? '↩️ Storno ' : '🧾 Rechnung ') + inv.number));
    const kv = h('div', { class: 'kv' },
      h('div', null, 'Datum: ', h('b', null, fmtDT(inv.createdAt))),
      h('div', null, 'Kassierer: ', h('b', null, inv.cashierName)),
    );
    if (isStorno) {
      kv.append(h('div', null, 'Storno zu: ', h('b', null, inv.refNumber)));
      kv.append(h('div', null, 'Storniert von: ', h('b', null, inv.createdByName)));
      kv.append(h('div', null, 'Grund: ', h('b', null, inv.stornoReason)));
    }
    if (inv.stornoNumber) kv.append(h('div', { style: 'color:var(--red)' }, '⚠️ Storniert durch ', h('b', null, inv.stornoNumber)));
    nodes.push(kv);

    const tb = h('tbody');
    for (const it of inv.items) {
      tb.append(h('tr', { class: isStorno ? 'storno' : '' },
        h('td', null, fmt(it.quantity) + '×'), h('td', null, it.productName),
        h('td', { class: 'num' }, eur(it.unitPrice)), h('td', { class: 'num' }, eur(it.lineTotal))));
    }
    nodes.push(h('div', { class: 'tablewrap', style: 'margin-top:12px' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Menge'), h('th', null, 'Produkt'), h('th', { class: 'num' }, 'Einzelpreis'), h('th', { class: 'num' }, 'Summe'))), tb)));

    if (inv.discountAmount !== 0) {
      nodes.push(h('div', { class: 'kv', style: 'margin-top:10px' },
        h('div', null, 'Zwischensumme: ', h('b', null, eur(inv.subtotal))),
        h('div', null, `Rabatt (${inv.discountPercent}%): `, h('b', null, (inv.discountAmount > 0 ? '−' : '+') + eur(Math.abs(inv.discountAmount)))),
        inv.discountReason ? h('div', null, 'Rabattgrund: ', h('b', null, inv.discountReason)) : null));
    }
    nodes.push(h('div', { class: 'totalrow' }, 'Gesamt: ' + eur(inv.total)));

    if (opt.receipt) {
      nodes.push(h('p', { class: 'hint' }, '✔ Bon wurde gespeichert und zum Tagesumsatz gezählt.'));
    }

    // Storno nur für Administratoren (Server prüft zusätzlich)
    if (admin && !isStorno && !inv.stornoNumber && !opt.receipt) {
      const ta = h('textarea', { maxlength: '300', placeholder: 'Storno-Grund (Pflicht, mind. 5 Zeichen)', 'aria-label': 'Storno-Grund' });
      const msg = h('div', { class: 'msg err', role: 'alert' });
      const go = h('button', { class: 'btn danger sm', type: 'button' }, '↩️ Stornobuchung erstellen');
      go.addEventListener('click', async () => {
        if (ta.value.trim().length < 5) { msg.textContent = 'Bitte einen Grund angeben (mind. 5 Zeichen).'; return; }
        if (!confirm(`Rechnung ${inv.number} wirklich stornieren? Die Originalrechnung bleibt unverändert erhalten, es wird eine Stornobuchung erstellt.`)) return;
        go.disabled = true;
        try {
          const r = await api(`/api/invoices/${inv.id}/storno`, { method: 'POST', body: { reason: ta.value } });
          showInvoice(r.invoice);
          refreshAfterChange();
        } catch (e) { msg.textContent = e.message; go.disabled = false; }
      });
      nodes.push(h('div', { class: 'stornobox' }, h('b', null, 'Stornieren'), ta, msg, go));
    }
    nodes.push(h('div', { class: 'dlgfoot' },
      h('button', { class: 'btn sm', type: 'button', onclick: closeDialog }, 'Schließen')));
    openDialog(...nodes);
  }

  function refreshAfterChange() {
    if (!$('#invoicesView').hidden) loadInvoices(true);
    if (!$('#adminView').hidden) loadAdminStats();
    if (!$('#kasseView').hidden) loadDaily();
  }

  /* ============================================================ Rechnungen (Mitarbeiter: nur eigene / Admin: alle) */
  const today = () => (state.config && state.config.today) || '';
  let searchTimer;

  async function refreshConfig() {
    try { state.config = (await api('/api/me')).config; } catch { /* ignorieren */ }
  }

  async function openInvoicesTab() {
    await refreshConfig(); // aktueller Geschäftstag
    // Standard: heutiger Geschäftstag
    if (!$('#fFrom').value && !$('#fTo').value && !state.inv.touched) { $('#fFrom').value = today(); $('#fTo').value = today(); }
    if (state.user.role === 'admin') fillCashierSelect().then(() => loadInvoices(true));
    else loadInvoices(true);
  }

  async function fillCashierSelect() {
    const sel = $('#fCashier');
    try {
      const r = await api('/api/admin/users?former=1');
      const keep = state.inv.cashier;
      sel.textContent = '';
      sel.append(h('option', { value: '' }, 'Alle Mitarbeiter'));
      for (const u of r.users) sel.append(h('option', { value: String(u.id) }, u.username + (u.archived ? ' (gelöscht)' : u.active ? '' : ' (deaktiviert)')));
      sel.value = keep || '';
    } catch { /* Admin-Daten nicht ladbar – Filter bleibt leer */ }
  }

  function invQuery() {
    const p = new URLSearchParams();
    if ($('#fFrom').value) p.set('from', $('#fFrom').value);
    if ($('#fTo').value) p.set('to', $('#fTo').value);
    if (state.user.role === 'admin' && $('#fCashier').value) p.set('cashier', $('#fCashier').value);
    if ($('#fQ').value.trim()) p.set('q', $('#fQ').value.trim());
    return p;
  }

  async function loadInvoices(reset) {
    const seq = ++state.inv.loadSeq;
    if (reset) { state.inv.offset = 0; $('#invBody').textContent = ''; }
    const p = invQuery();
    p.set('limit', '50'); p.set('offset', String(state.inv.offset));
    const sp = invQuery();
    try {
      const [list, st] = await Promise.all([
        api('/api/invoices?' + p), reset ? api('/api/stats?' + sp) : Promise.resolve(null),
      ]);
      if (seq !== state.inv.loadSeq) return; // veraltete Antwort verwerfen
      const body = $('#invBody');
      for (const r of list.invoices) {
        const storno = r.kind === 'storno';
        const status = storno ? h('span', { class: 'badge bad' }, 'Storno zu ' + r.refNumber)
          : r.stornoNumber ? h('span', { class: 'badge bad' }, 'Storniert (' + r.stornoNumber + ')')
          : h('span', { class: 'badge good' }, 'OK');
        const tr = h('tr', { class: 'click' + (storno ? ' storno' : ''), tabindex: '0' },
          h('td', null, r.number), h('td', null, fmtDT(r.createdAt)), h('td', null, r.cashierName),
          h('td', { class: 'num' }, fmt(r.itemCount)), h('td', { class: 'num' }, eur(r.total)), h('td', null, status));
        const open = async () => {
          try { showInvoice((await api('/api/invoices/' + r.id)).invoice); } catch (e) { alert(e.message); }
        };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
        body.append(tr);
      }
      state.inv.offset += list.invoices.length;
      state.inv.total = list.total;
      if (!list.total) body.append(h('tr', null, h('td', { colspan: '6', class: 'empty' }, 'Keine Rechnungen gefunden.')));
      $('#invCount').textContent = list.total ? `${state.inv.offset} von ${list.total} angezeigt` : '';
      $('#invMore').hidden = state.inv.offset >= list.total;
      if (st) renderInvStats(st);
    } catch (e) {
      if (seq === state.inv.loadSeq) { $('#invCount').textContent = e.message; }
    }
  }

  function renderInvStats(st) {
    const admin = state.user.role === 'admin';
    const box = $('#invStats');
    box.textContent = '';
    const card = (label, value) => box.append(h('div', { class: 'stat' }, h('span', null, label), h('b', null, value)));
    card(admin ? 'Umsatz heute (Auswahl)' : 'Mein Tagesumsatz (heute)', eur(st.todaySummary.revenue));
    card('Umsatz im gewählten Zeitraum', eur(st.summary.revenue));
    card('Rechnungen im Zeitraum', fmt(st.summary.invoiceCount));
    if (st.summary.stornoCount) card('Stornobuchungen', fmt(st.summary.stornoCount));
    if (st.summary.discounts) card('Rabatte', '−' + eur(st.summary.discounts));
  }

  for (const id of ['fFrom', 'fTo', 'fCashier']) {
    $('#' + id).addEventListener('change', () => { state.inv.touched = true; state.inv.cashier = $('#fCashier').value; loadInvoices(true); });
  }
  $('#fQ').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadInvoices(true), 300); });
  $('#fToday').addEventListener('click', () => { state.inv.touched = true; $('#fFrom').value = today(); $('#fTo').value = today(); loadInvoices(true); });
  $('#fAll').addEventListener('click', () => { state.inv.touched = true; $('#fFrom').value = ''; $('#fTo').value = ''; loadInvoices(true); });
  $('#invMore').addEventListener('click', () => loadInvoices(false));

  /* ============================================================ ADMIN */
  async function loadAdmin() { await refreshConfig(); loadAdminStats(); loadUsers(); }

  function aQuery() {
    const p = new URLSearchParams();
    if ($('#aFrom').value) p.set('from', $('#aFrom').value);
    if ($('#aTo').value) p.set('to', $('#aTo').value);
    return p;
  }

  async function loadAdminStats() {
    try {
      const st = await api('/api/stats?' + aQuery());
      const box = $('#aStats'); box.textContent = '';
      const card = (l, v) => box.append(h('div', { class: 'stat' }, h('span', null, l), h('b', null, v)));
      card('Gesamtumsatz (Zeitraum)', eur(st.summary.revenue));
      card('Anzahl Rechnungen', fmt(st.summary.invoiceCount));
      card('Stornobuchungen', fmt(st.summary.stornoCount));
      card('Rabatte gesamt', '−' + eur(st.summary.discounts));
      card('Umsatz heute', eur(st.todaySummary.revenue));
      const body = $('#aBody'); body.textContent = '';
      for (const c of st.byCashier) {
        body.append(h('tr', null,
          h('td', null, c.username), h('td', null, h('span', { class: 'badge ' + (c.active ? 'good' : 'bad') }, c.archived ? 'gelöscht' : c.active ? 'aktiv' : 'deaktiviert')),
          h('td', { class: 'num' }, fmt(c.invoiceCount)), h('td', { class: 'num' }, fmt(c.stornoCount)),
          h('td', { class: 'num' }, c.discounts ? '−' + eur(c.discounts) : '–'), h('td', { class: 'num' }, eur(c.revenue)),
          h('td', null, h('button', { class: 'btn off sm', type: 'button', onclick: () => showCashierInvoices(c.id) }, 'Rechnungen'))));
      }
      body.append(h('tr', { class: 'sum' }, h('td', null, 'Gesamtsumme aller Mitarbeiter'), h('td'),
        h('td', { class: 'num' }, fmt(st.summary.invoiceCount)), h('td', { class: 'num' }, fmt(st.summary.stornoCount)),
        h('td', { class: 'num' }, st.summary.discounts ? '−' + eur(st.summary.discounts) : '–'), h('td', { class: 'num' }, eur(st.summary.revenue)), h('td')));
    } catch (e) { $('#aStats').textContent = e.message; }
  }

  function showCashierInvoices(id) {
    state.inv.touched = true; state.inv.cashier = String(id);
    $('#fFrom').value = $('#aFrom').value; $('#fTo').value = $('#aTo').value; $('#fQ').value = '';
    switchTab('invoices');
  }

  $('#aFrom').addEventListener('change', loadAdminStats);
  $('#aTo').addEventListener('change', loadAdminStats);
  $('#aToday').addEventListener('click', () => { $('#aFrom').value = today(); $('#aTo').value = today(); $('#aAll').classList.remove('on'); $('#aToday').classList.add('on'); loadAdminStats(); });
  $('#aAll').addEventListener('click', () => { $('#aFrom').value = ''; $('#aTo').value = ''; $('#aToday').classList.remove('on'); $('#aAll').classList.add('on'); loadAdminStats(); });
  $('#aCsv').addEventListener('click', () => {
    const a = h('a', { href: '/api/admin/export.csv?' + aQuery(), download: 'club77-rechnungen.csv' });
    document.body.append(a); a.click(); a.remove();
  });
  $('#aDiscord').addEventListener('click', async () => {
    if (!confirm('Gesamt-Tagesumsatz (alle Mitarbeiter, heute) wirklich an Discord senden?')) return;
    try { await api('/api/discord/daily', { method: 'POST', body: { scope: 'all' } }); alert('Gesamt-Tagesumsatz an Discord gesendet ✔'); }
    catch (e) { alert('Senden fehlgeschlagen: ' + e.message); }
  });

  function showSecret(title, username, password) {
    const box = $('#secretBox');
    box.textContent = '';
    box.append(h('div', null, title), h('div', null, 'Benutzername: ', h('code', null, username)), h('div', null, 'Passwort: ', h('code', null, password)),
      h('div', { class: 'hint' }, 'Wird nur jetzt einmal angezeigt. Der Mitarbeiter muss es bei der ersten Anmeldung ändern.'));
    box.hidden = false;
  }

  function roleCell(u, self) {
    if (u.username.toLowerCase() === 'admin') {
      return h('span', { class: 'badge admin', title: 'Die Rolle dieses Kontos kann nicht geändert werden' }, 'Administrator 🔒');
    }
    const sel = h('select', { class: 'input', 'aria-label': 'Rolle von ' + u.username, style: 'min-width:150px' },
      h('option', { value: 'cashier' }, 'Mitarbeiter'), h('option', { value: 'admin' }, 'Administrator'));
    sel.value = u.role;
    sel.addEventListener('change', async () => {
      const want = sel.value, label = want === 'admin' ? 'Administrator' : 'Mitarbeiter';
      if (!confirm(`Rolle von ${u.username} auf „${label}“ ändern?`)) { sel.value = u.role; return; }
      try {
        await api('/api/admin/users/' + u.id, { method: 'PATCH', body: { role: want } });
        if (self) return location.reload(); // eigene Rolle geändert: Oberfläche neu aufbauen
        loadUsers(); loadAdminStats();
      }
      catch (e) { alert(e.message); sel.value = u.role; }
    });
    return sel;
  }

  async function loadUsers() {
    const body = $('#uBody');
    try {
      const r = await api('/api/admin/users');
      body.textContent = '';
      for (const u of r.users) {
        const self = u.id === state.user.id;
        const actions = h('td', null);
        if (!self) {
          actions.append(
            h('button', { class: 'btn off sm', type: 'button', onclick: () => toggleUser(u) }, u.active ? 'Deaktivieren' : 'Aktivieren'),
            h('button', { class: 'btn off sm', type: 'button', onclick: () => resetPw(u) }, 'Passwort zurücksetzen'),
            h('button', { class: 'btn danger sm', type: 'button', onclick: () => deleteUser(u) }, '🗑️ Löschen'));
        }
        actions.append(
          h('button', { class: 'btn off sm', type: 'button', onclick: () => showCashierInvoices(u.id) }, 'Rechnungen'));
        body.append(h('tr', null,
          h('td', null, u.username + (self ? ' (du)' : '')),
          h('td', null, roleCell(u, self)),
          h('td', null, h('span', { class: 'badge ' + (u.active ? 'good' : 'bad') }, u.active ? 'aktiv' : 'deaktiviert'), u.mustChangePassword ? h('span', { class: 'badge' }, 'Passwortwechsel offen') : null),
          h('td', null, u.discordLinked ? h('span', { class: 'badge good' }, '💬 ' + (u.discordName || 'verknüpft')) : '–'),
          h('td', null, u.lastLoginAt ? fmtDT(u.lastLoginAt) : 'noch nie'), actions));
      }
    } catch (e) { body.textContent = e.message; }
  }

  async function deleteUser(u) {
    if (!confirm(`${u.username} komplett löschen?\n\nDas Konto verschwindet vollständig und kann sich nicht mehr anmelden. Schon erstellte Rechnungen und Umsätze bleiben aus Buchhaltungsgründen unverändert erhalten (nur der Name steht noch darin).`)) return;
    try {
      const r = await api('/api/admin/users/' + u.id, { method: 'DELETE' });
      alert(`${u.username} wurde gelöscht.`);
      loadUsers(); loadAdminStats();
    } catch (e) { alert(e.message); }
  }

  async function toggleUser(u) {
    if (!confirm(`${u.username} wirklich ${u.active ? 'deaktivieren (wird sofort abgemeldet)' : 'aktivieren'}?`)) return;
    try { await api('/api/admin/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); loadUsers(); loadAdminStats(); }
    catch (e) { alert(e.message); }
  }
  async function resetPw(u) {
    if (!confirm(`Passwort von ${u.username} zurücksetzen? Alle Sitzungen des Mitarbeiters werden beendet.`)) return;
    try {
      const r = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
      showSecret('🔑 Neues Passwort', u.username, r.temporaryPassword);
      loadUsers();
    } catch (e) { alert(e.message); }
  }

  $('#nuCreate').addEventListener('click', async () => {
    const username = $('#nuName').value.trim();
    const password = $('#nuPass').value;
    setMsg('#nuMsg', '');
    try {
      const r = await api('/api/admin/users', { method: 'POST', body: { username, password: password || undefined, role: $('#nuRole').value } });
      $('#nuName').value = ''; $('#nuPass').value = '';
      if (r.temporaryPassword) showSecret('✅ Konto erstellt', r.user.username, r.temporaryPassword);
      else { $('#secretBox').hidden = true; setMsg('#nuMsg', `Konto "${r.user.username}" erstellt. Beim ersten Login muss ein neues Passwort gesetzt werden.`, false); }
      loadUsers(); loadAdminStats();
    } catch (e) { setMsg('#nuMsg', e.message); }
  });

  $('#auditBox').addEventListener('toggle', async () => {
    if (!$('#auditBox').open) return;
    const body = $('#auditBody');
    try {
      const r = await api('/api/admin/audit?limit=100');
      body.textContent = '';
      for (const a of r.entries) body.append(h('tr', null, h('td', null, fmtDT(a.at)), h('td', null, a.username || '–'), h('td', null, a.action), h('td', null, a.detail || '')));
    } catch (e) { body.textContent = e.message; }
  });

  /* ============================================================ Produkte (Kasse aktualisieren + Admin-Verwaltung) */
  async function refreshProducts() {
    try {
      const p = await api('/api/products');
      if (state.categories && JSON.stringify(p.categories) === JSON.stringify(state.categories)) return;
      state.categories = p.categories;
      buildProducts(p.categories);
      for (const name of [...state.cart.keys()]) if (!state.products.has(name)) state.cart.delete(name); // entfernte Produkte aus dem Warenkorb
      update();
    } catch { /* Kasse bleibt mit alter Liste nutzbar */ }
  }

  let prodData = null;
  async function loadProductsAdmin() {
    const body = $('#pBody');
    try {
      prodData = await api('/api/admin/products');
      const sel = $('#npCat'), keep = sel.value;
      sel.textContent = '';
      for (const c of prodData.categories) sel.append(h('option', { value: c.id }, c.title));
      if (keep) sel.value = keep;
      body.textContent = '';
      for (const p of prodData.products) body.append(productRow(p));
    } catch (e) { body.textContent = e.message; }
  }

  function productRow(p) {
    const price = h('input', { class: 'input', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: String(p.price), style: 'width:130px', 'aria-label': 'Preis ' + p.name });
    const cat = h('select', { class: 'input', 'aria-label': 'Kategorie ' + p.name });
    for (const c of prodData.categories) cat.append(h('option', { value: c.id }, c.title));
    cat.value = p.categoryId;
    const name = h('input', { class: 'input', value: p.name, maxlength: '60', 'aria-label': 'Name' });
    const save = async () => {
      const body = {};
      const nm = name.value.trim();
      if (nm !== p.name) body.name = nm;
      if (price.value.trim() !== String(p.price)) body.price = price.value.trim();
      if (cat.value !== p.categoryId) body.categoryId = cat.value;
      if (!Object.keys(body).length) return alert('Keine Änderung.');
      if (body.price !== undefined && !confirm(`Preis von „${p.name}“ von ${fmt(p.price)} € auf ${fmt(Number(body.price))} € ändern?`)) return;
      try { await api('/api/admin/products/' + p.id, { method: 'PATCH', body }); await loadProductsAdmin(); }
      catch (e) { alert(e.message); }
    };
    const toggle = async () => {
      try { await api('/api/admin/products/' + p.id, { method: 'PATCH', body: { active: !p.active } }); await loadProductsAdmin(); }
      catch (e) { alert(e.message); }
    };
    const del = async () => {
      if (!confirm(`„${p.name}“ endgültig löschen?\n\nSchon erstellte Rechnungen bleiben unverändert. Zum nur Verstecken lieber „Ausblenden“ nutzen.`)) return;
      try { await api('/api/admin/products/' + p.id, { method: 'DELETE' }); await loadProductsAdmin(); }
      catch (e) { alert(e.message); }
    };
    price.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    return h('tr', null,
      h('td', null, name), h('td', null, cat), h('td', null, price),
      h('td', null, h('span', { class: 'badge ' + (p.active ? 'good' : 'bad') }, p.active ? 'sichtbar' : 'ausgeblendet')),
      h('td', null,
        h('button', { class: 'btn sm', type: 'button', onclick: save }, '💾 Speichern'),
        h('button', { class: 'btn off sm', type: 'button', onclick: toggle }, p.active ? 'Ausblenden' : 'Einblenden'),
        h('button', { class: 'btn danger sm', type: 'button', onclick: del }, '🗑️')));
  }

  $('#npAdd').addEventListener('click', async () => {
    setMsg('#npMsg', '');
    try {
      const r = await api('/api/admin/products', { method: 'POST', body: { name: $('#npName').value.trim(), price: $('#npPrice').value.trim(), categoryId: $('#npCat').value } });
      $('#npName').value = ''; $('#npPrice').value = '';
      setMsg('#npMsg', `„${r.product.name}“ wurde hinzugefügt.`, false);
      await loadProductsAdmin();
    } catch (e) { setMsg('#npMsg', e.message); }
  });

  boot();
})();
