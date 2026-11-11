// /api/ttd: TTD bookings. Only the signed-in shop's own bookings, ever.
const ttd = require('./ttd');
const aadhaar = require('./aadhaar');

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const TICKET_MAX = 3 * 1024 * 1024;

// Reads a PDF sent as the raw request body.
function readPdf(req, httpError) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    let tooBig = false;
    req.on('data', d => {
      if (tooBig) return;
      size += d.length;
      if (size > TICKET_MAX) { tooBig = true; reject(httpError(413, 'The ticket PDF must be smaller than 3 MB')); return; }
      parts.push(d);
    });
    req.on('end', () => { if (!tooBig) resolve(Buffer.concat(parts)); });
    req.on('error', reject);
  });
}

// Checks a booking from the form and returns the cleaned values, or throws a message
// the person can act on. Every rule TTD has is checked here, so a saved booking is ready.
function clean(body, { normalizeWhatsapp, httpError }) {
  const bad = message => { throw httpError(400, message); };
  const kind = ttd.KINDS[body.kind] ? body.kind : bad('Choose the booking type');
  const rule = ttd.KINDS[kind];
  const text = (v, max) => String(v ?? '').trim().slice(0, max);

  let dateMode = null; let dateFrom = null; let dateTo = null;
  if (rule.dated) {
    dateMode = ['fixed', 'range', 'any'].includes(body.dateMode) ? body.dateMode : bad('Choose which date the pilgrims want');
    if (dateMode === 'fixed') {
      dateFrom = isDay(body.dateFrom) ? body.dateFrom : bad('Choose the date');
      dateTo = dateFrom;
    }
    if (dateMode === 'range') {
      dateFrom = isDay(body.dateFrom) ? body.dateFrom : bad('Choose the first date of the range');
      dateTo = isDay(body.dateTo) ? body.dateTo : bad('Choose the last date of the range');
      if (dateTo < dateFrom) bad('The last date must be on or after the first date');
    }
  }

  const email = text(body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Enter a valid email address');
  const city = text(body.city, 60) || bad('Enter the city');
  const state = text(body.state, 60) || bad('Enter the state');
  const country = text(body.country, 60) || bad('Enter the country');
  const pincode = text(body.pincode, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) bad('Enter a valid 6-digit pincode');
  const whatsapp = normalizeWhatsapp(body.whatsapp) || bad("Enter the customer's 10-digit WhatsApp number");

  const list = Array.isArray(body.pilgrims) ? body.pilgrims : [];
  if (list.length < rule.min || list.length > rule.max) {
    bad(rule.max === 1 ? 'This booking takes 1 pilgrim' : `This booking takes ${rule.min} to ${rule.max} pilgrims`);
  }
  const pilgrims = list.map((p, i) => {
    const n = i + 1;
    const name = text(p.name, 60) || bad(`Enter pilgrim ${n}'s name`);
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) bad(`Enter pilgrim ${n}'s age`);
    const gender = ttd.GENDERS.includes(p.gender) ? p.gender : bad(`Choose pilgrim ${n}'s gender`);
    const idType = ttd.ID_TYPES.includes(p.idType) ? p.idType : 'Aadhaar';
    const number = String(p.aadhaar || '').replace(/[\s-]/g, '');
    if (number && !aadhaar.isValid(number)) bad(`Pilgrim ${n}'s Aadhaar number is not valid`);
    return { id: typeof p.id === 'string' && /^[a-z0-9]{6,30}$/.test(p.id) ? p.id : null, name, age, gender, idType, number, fromCustomer: typeof p.fromCustomer === 'string' ? p.fromCustomer : null };
  });
  if (rule.oldest && !pilgrims.some(p => p.age >= rule.oldest)) bad(`At least one pilgrim must be ${rule.oldest} or older`);

  const operatorId = String(body.operatorId || '');
  const notes = text(body.notes, 500);
  return { kind, dateMode, dateFrom, dateTo, email, city, state, country, pincode, whatsapp, operatorId, notes, pilgrims };
}

module.exports = async function ttdApi(req, res, url, user, h) {
  const { send, readBody, httpError, normalizeWhatsapp, activity, users, operators } = h;
  const [, , , id, action] = url.pathname.split('/'); // /api/ttd/<id>/<action>
  const record = (act, detail) => activity.log({ actor: user, action: act, owner: user.id, detail });
  const label = b => `${b.pilgrims[0]?.name || ''}${b.pilgrims.length > 1 ? ` +${b.pilgrims.length - 1}` : ''}, ${ttd.KINDS[b.kind]?.label || b.kind}`;

  if (req.method === 'GET' && !id) {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    return send(res, 200, await ttd.list(user.id, { status: url.searchParams.get('status'), kind: url.searchParams.get('kind'), q }));
  }

  if (req.method === 'GET' && id === 'customers') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
    return send(res, 200, q.length < 2 ? [] : await ttd.customerSearch(user.id, q));
  }

  // Booking mode: the ready bookings with their full Aadhaar numbers, opened here once,
  // so copying during the rush doesn't wait on the network. Logged and limited.
  if (req.method === 'POST' && id === 'sheet') {
    const key = `ttd-sheet|${user.id}`;
    if (users.limited(key, 40)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes and try again.' });
    users.countTry(key, 10 * 60 * 1000);
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string').slice(0, 100) : null;
    const bookings = await ttd.readyWithSealed(user.id, ids);
    let opened = 0;
    for (const b of bookings) {
      for (const p of b.pilgrims) {
        if (p.sealed) {
          try { p.aadhaar = aadhaar.open(p.sealed, p.id); opened += 1; } catch { p.aadhaar = null; p.aadhaarError = true; }
        }
        delete p.sealed;
      }
    }
    if (opened) await record('ttd.sheet', `${opened} Aadhaar numbers for ${bookings.length} TTD bookings`);
    return send(res, 200, bookings);
  }

  // Adding a booking, or saving changes to one.
  if (req.method === 'POST' && (!id || action === 'edit')) {
    const body = await readBody(req);
    const b = clean(body, { normalizeWhatsapp, httpError });
    if (b.operatorId && (!/^[0-9]{1,18}$/.test(b.operatorId) || !await operators.owned(b.operatorId, user.id))) throw httpError(400, 'Choose an operator from your list');
    const existing = id ? await ttd.get(id, user.id) : null;
    if (id && !existing) return send(res, 404, { error: 'Booking not found' });
    if (b.pilgrims.some(p => p.number || p.fromCustomer) && !aadhaar.ready()) throw httpError(503, 'Aadhaar numbers cannot be saved until AADHAAR_KEY is set');

    const known = new Set((existing?.pilgrims || []).map(p => p.id));
    const pilgrims = [];
    for (const p of b.pilgrims) {
      const isNew = !p.id || !known.has(p.id);
      const pid = isNew ? newId() : p.id;
      let number = p.number;
      // Copied from a saved customer: opened and sealed again for this pilgrim.
      if (!number && p.fromCustomer) {
        const sealed = await ttd.customerSealed(user.id, p.fromCustomer);
        if (sealed) {
          try { number = aadhaar.open(sealed, p.fromCustomer); } catch { throw httpError(500, "That customer's Aadhaar number cannot be read. Check AADHAAR_KEY."); }
        }
      }
      if (isNew && !number) throw httpError(400, `Enter pilgrim ${pilgrims.length + 1}'s Aadhaar number`);
      const keep = !isNew && !number;
      pilgrims.push({ ...p, id: pid, isNew, keep, last4: number ? number.slice(-4) : null, sealed: number ? aadhaar.seal(number, pid) : null });
    }
    const bookingId = id || newId();
    const ok = await ttd.save(user.id, { ...b, id: bookingId, isNew: !id }, pilgrims);
    if (!ok) return send(res, 404, { error: 'Booking not found' });
    const saved = await ttd.get(bookingId, user.id);
    await record(id ? 'ttd.edit' : 'ttd.add', label(saved));
    return send(res, id ? 200 : 201, saved);
  }

  const booking = id ? await ttd.get(id, user.id) : null;
  if (!booking) return send(res, 404, { error: 'Booking not found' });

  if (req.method === 'POST' && action === 'status') {
    const body = await readBody(req);
    const status = ttd.STATUSES.includes(body.status) ? body.status : null;
    if (!status) return send(res, 400, { error: 'Choose booked, failed or ready' });
    const refNo = String(body.refNo || '').trim().slice(0, 40);
    await ttd.setStatus(id, user.id, status, refNo);
    await record(`ttd.${status}`, `${label(booking)}${refNo ? `: ${refNo}` : ''}`);
    return send(res, 200, await ttd.get(id, user.id));
  }

  if (req.method === 'POST' && action === 'ticket') {
    if (!/pdf/i.test(req.headers['content-type'] || '')) return send(res, 400, { error: 'Choose a PDF file' });
    const data = await readPdf(req, httpError);
    if (data.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'That file is not a PDF' });
    const name = String(url.searchParams.get('name') || 'ticket.pdf').replace(/[^\w .()-]/g, '').slice(0, 80) || 'ticket.pdf';
    await ttd.saveTicket(id, user.id, data, name);
    await record('ttd.ticket', label(booking));
    return send(res, 200, await ttd.get(id, user.id));
  }

  if (req.method === 'GET' && action === 'ticket') {
    const t = await ttd.ticket(id, user.id);
    if (!t) return send(res, 404, { error: 'No ticket is saved for this booking' });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${t.ticket_name || 'ticket.pdf'}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.end(t.ticket);
  }

  if (req.method === 'POST' && action === 'sent') {
    await ttd.markSent(id, user.id);
    await record('ttd.sent', label(booking));
    return send(res, 200, await ttd.get(id, user.id));
  }

  if (req.method === 'POST' && action === 'delete') {
    await ttd.remove(id, user.id);
    await record('ttd.delete', label(booking));
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Not allowed' });
};
