// Fees and payments: each shop's price list, the fee on a customer or TTD booking,
// payments in cash or UPI, the day's collection and who still owes money.
// Every query is limited to the signed-in shop's own records.
const { query } = require('./db');

const KEYS = ['certificate', 'smartcard', 'voter', 'aadhaar', 'aadhaar-name', 'pan', 'ttd:sed300', 'ttd:angapradakshinam', 'ttd:edip', 'ttd:senior'];
const MAX = 100000;
const DAY = col => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
const TODAY = `to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;

// A TTD booking's name: its first pilgrim, and how many more.
const TTD_NAME = `(SELECT p.name || CASE WHEN count(*) OVER () > 1 THEN ' +' || (count(*) OVER () - 1) ELSE '' END
  FROM ttd_pilgrims p WHERE p.booking_id = b.id ORDER BY p.position LIMIT 1)`;

const rupees = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX ? n : null;
};

async function prices(owner) {
  const { rows } = await query('SELECT key, amount FROM prices WHERE owner = $1', [owner]);
  return Object.fromEntries(rows.map(r => [r.key, r.amount]));
}

// A blank price removes it.
async function savePrices(owner, list) {
  for (const key of KEYS) {
    if (!(key in list)) continue;
    const v = list[key];
    if (v === null || v === '') await query('DELETE FROM prices WHERE owner = $1 AND key = $2', [owner, key]);
    else {
      const amount = rupees(v);
      if (amount === null) throw Object.assign(new Error('Enter prices in whole rupees, up to ₹1,00,000'), { status: 400 });
      await query('INSERT INTO prices (owner, key, amount) VALUES ($1, $2, $3) ON CONFLICT (owner, key) DO UPDATE SET amount = $3', [owner, key, amount]);
    }
  }
  return prices(owner);
}

// The customer or booking a request is about, if it belongs to this shop.
async function target(owner, { customerId, ttdId, caseId }) {
  if (customerId) {
    const { rows } = await query('SELECT id, name, type, application_no, fee FROM customers WHERE id = $1 AND owner = $2', [String(customerId), owner]);
    return rows[0] && { column: 'customer_id', table: 'customers', id: rows[0].id, fee: rows[0].fee, label: `${rows[0].name} (${rows[0].application_no})` };
  }
  if (ttdId) {
    const { rows } = await query(`SELECT b.id, b.fee, b.kind, ${TTD_NAME} AS name FROM ttd_bookings b WHERE b.id = $1 AND b.owner = $2`, [String(ttdId), owner]);
    return rows[0] && { column: 'ttd_id', table: 'ttd_bookings', id: rows[0].id, fee: rows[0].fee, label: `TTD: ${rows[0].name || rows[0].kind}` };
  }
  if (caseId) {
    const { rows } = await query('SELECT id, name, new_name_en, fee FROM name_cases WHERE id = $1 AND owner = $2', [String(caseId), owner]);
    return rows[0] && { column: 'case_id', table: 'name_cases', id: rows[0].id, fee: rows[0].fee, label: `Aadhaar name: ${rows[0].name} → ${rows[0].new_name_en}` };
  }
  return null;
}

async function state(t) {
  const { rows } = await query(
    `SELECT id, amount, mode, taken_by AS by, paid_at AS at FROM payments WHERE ${t.column} = $1 ORDER BY id`,
    [t.id],
  );
  const row = (await query(`SELECT fee, payment FROM ${t.table} WHERE id = $1`, [t.id])).rows[0] || {};
  const fee = row.fee ?? null;
  const paid = rows.reduce((n, p) => n + p.amount, 0);
  return { payment: row.payment || null, fee, paid, due: fee === null ? 0 : Math.max(0, fee - paid), payments: rows };
}

// Paid or not paid: what the shop marks. null clears it.
async function setPayment(t, payment) {
  await query(`UPDATE ${t.table} SET payment = $2, payment_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id = $1`, [t.id, payment]);
  return state(t);
}

async function setFee(t, fee) {
  await query(`UPDATE ${t.table} SET fee = $2 WHERE id = $1`, [t.id, fee]);
  return state(t);
}

async function addPayment(owner, t, { amount, mode, operatorId, by }) {
  await query(
    `INSERT INTO payments (owner, ${t.column}, label, amount, mode, operator_id, taken_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [owner, t.id, t.label, amount, mode, operatorId || null, by],
  );
  // Paying the whole fee marks it paid.
  const s = await state(t);
  if (s.fee > 0 && !s.due && s.payment !== 'paid') return setPayment(t, 'paid');
  return s;
}

async function removePayment(owner, id) {
  const { rows } = await query('DELETE FROM payments WHERE id = $1 AND owner = $2 RETURNING customer_id, ttd_id, case_id, label, amount', [id, owner]);
  return rows[0] || null;
}

// Today: how many were marked paid, any amounts taken, and how many have not paid.
async function today(owner) {
  const { rows: [r] } = await query(
    `SELECT COALESCE(sum(amount) FILTER (WHERE mode = 'cash'), 0)::int AS cash,
       COALESCE(sum(amount) FILTER (WHERE mode = 'upi'), 0)::int AS upi, count(*)::int AS count
     FROM payments WHERE owner = $1 AND ${DAY('paid_at')} = ${TODAY}`,
    [owner],
  );
  const { rows: [p] } = await query(
    `SELECT (SELECT count(*) FROM customers WHERE owner = $1 AND payment = 'paid' AND ${DAY('payment_at')} = ${TODAY})
       + (SELECT count(*) FROM ttd_bookings WHERE owner = $1 AND payment = 'paid' AND ${DAY('payment_at')} = ${TODAY})
       + (SELECT count(*) FROM name_cases WHERE owner = $1 AND payment = 'paid' AND ${DAY('payment_at')} = ${TODAY}) AS paid_today`,
    [owner],
  );
  const owed = await dues(owner);
  return {
    ...r, total: r.cash + r.upi, paidToday: Number(p.paid_today),
    unpaid: owed.length, outstanding: owed.reduce((n, d) => n + d.due, 0),
  };
}

// Customers and bookings marked not paid, oldest first. Amounts only where entered.
async function dues(owner) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'customer' AS kind, c.id, c.name, c.type, c.pan_agency AS agency, c.application_no, c.whatsapp, c.fee, c.created_at,
         COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.customer_id = c.id), 0)::int AS paid
       FROM customers c WHERE c.owner = $1 AND c.payment = 'unpaid'
       UNION ALL
       SELECT 'ttd', b.id, ${TTD_NAME}, b.kind, NULL, NULL, b.whatsapp, b.fee, b.created_at,
         COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.ttd_id = b.id), 0)::int
       FROM ttd_bookings b WHERE b.owner = $1 AND b.payment = 'unpaid'
       UNION ALL
       SELECT 'case', n.id, n.name, 'aadhaar-name', NULL, NULL, n.whatsapp, n.fee, n.created_at,
         COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.case_id = n.id), 0)::int
       FROM name_cases n WHERE n.owner = $1 AND n.payment = 'unpaid'
     ) x ORDER BY x.created_at, x.id`,
    [owner],
  );
  return rows.map(r => ({
    kind: r.kind, id: r.id, name: r.name || '', type: r.type, agency: r.agency, applicationNo: r.application_no,
    whatsapp: r.whatsapp, fee: r.fee, paid: r.paid, due: r.fee == null ? 0 : Math.max(0, r.fee - r.paid), createdAt: r.created_at,
  }));
}

// Money for one month (YYYY-MM): by mode and by operator.
async function month(owner, ym) {
  const { rows: [r] } = await query(
    `SELECT COALESCE(sum(amount) FILTER (WHERE mode = 'cash'), 0)::int AS cash,
       COALESCE(sum(amount) FILTER (WHERE mode = 'upi'), 0)::int AS upi, count(*)::int AS count
     FROM payments WHERE owner = $1 AND to_char(paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $2`,
    [owner, ym],
  );
  const { rows: ops } = await query(
    `SELECT o.name, COALESCE(sum(p.amount), 0)::int AS collected FROM payments p LEFT JOIN operators o ON o.id = p.operator_id
     WHERE p.owner = $1 AND to_char(p.paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $2 GROUP BY o.name`,
    [owner, ym],
  );
  return { ...r, total: r.cash + r.upi, operators: ops };
}

// /api/money/...
async function moneyApi(req, res, url, user, { send, readBody, httpError, activity, operators }) {
  const [, , , section, id] = url.pathname.split('/');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const record = (action, detail) => activity.log({ actor: user, action, owner: user.id, detail });
  const find = async source => {
    const t = await target(user.id, source);
    if (!t) throw httpError(404, 'Customer not found');
    return t;
  };

  if (section === 'prices' && req.method === 'GET') return send(res, 200, await prices(user.id));
  if (section === 'prices' && req.method === 'POST') {
    const saved = await savePrices(user.id, body.prices && typeof body.prices === 'object' ? body.prices : {});
    await record('money.prices', null);
    return send(res, 200, saved);
  }
  if (section === 'today' && req.method === 'GET') return send(res, 200, await today(user.id));
  if (section === 'dues' && req.method === 'GET') return send(res, 200, await dues(user.id));
  if (section === 'state' && req.method === 'GET') {
    return send(res, 200, await state(await find({ customerId: url.searchParams.get('customerId'), ttdId: url.searchParams.get('ttdId'), caseId: url.searchParams.get('caseId') })));
  }

  if (section === 'status' && req.method === 'POST') {
    const t = await find(body);
    const payment = ['paid', 'unpaid'].includes(body.payment) ? body.payment : body.payment === null ? null : undefined;
    if (payment === undefined) throw httpError(400, 'Choose Paid or Not paid');
    const result = await setPayment(t, payment);
    await record(payment === 'paid' ? 'money.marked-paid' : payment === 'unpaid' ? 'money.marked-unpaid' : 'money.cleared', t.label);
    return send(res, 200, result);
  }

  if (section === 'fee' && req.method === 'POST') {
    const t = await find(body);
    const fee = body.fee === null || body.fee === '' ? null : rupees(body.fee);
    if (fee === null && body.fee !== null && body.fee !== '') throw httpError(400, 'Enter the fee in whole rupees');
    const result = await setFee(t, fee);
    await record('money.fee', `${t.label}: ${fee === null ? '-' : `₹${fee}`}`);
    return send(res, 200, result);
  }

  if (section === 'payments' && req.method === 'POST' && !id) {
    const t = await find(body);
    const amount = rupees(body.amount);
    if (!amount) throw httpError(400, 'Enter the amount paid in whole rupees');
    const mode = body.mode === 'upi' ? 'upi' : body.mode === 'cash' ? 'cash' : null;
    if (!mode) throw httpError(400, 'Choose Cash or UPI');
    const operatorId = body.operatorId ? String(body.operatorId) : null;
    if (operatorId && (!/^[0-9]{1,18}$/.test(operatorId) || !await operators.owned(operatorId, user.id))) throw httpError(400, 'Choose an operator from your list');
    const result = await addPayment(user.id, t, { amount, mode, operatorId, by: user.userId });
    await record('money.paid', `${t.label}: ₹${amount} ${mode === 'upi' ? 'UPI' : 'cash'}`);
    return send(res, 201, result);
  }

  if (section === 'payments' && req.method === 'DELETE' && /^[0-9]{1,18}$/.test(id || '')) {
    const gone = await removePayment(user.id, id);
    if (!gone) throw httpError(404, 'Payment not found');
    await record('money.unpaid', `${gone.label}: ₹${gone.amount}`);
    const t = gone.customer_id || gone.ttd_id || gone.case_id ? await target(user.id, { customerId: gone.customer_id, ttdId: gone.ttd_id, caseId: gone.case_id }) : null;
    return send(res, 200, t ? await state(t) : { ok: true });
  }

  return send(res, 405, { error: 'Not allowed' });
}

module.exports = { moneyApi, prices, today, dues, month, target, addPayment, setPayment, KEYS, rupees };
