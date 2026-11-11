// TTD (Tirumala) bookings: a group of pilgrims, prepared before the quota opens, so
// staff can copy every detail into the TTD site one click at a time. The CRM never
// fills in or submits the TTD site itself.
const { query, transaction } = require('./db');

// How many pilgrims each kind takes, whether it needs a date, and any age rule.
const KINDS = {
  sed300: { label: '₹300 Special Entry Darshan', min: 1, max: 6, dated: true },
  angapradakshinam: { label: 'Angapradakshinam', min: 1, max: 2, dated: true },
  edip: { label: 'E-DIP', min: 1, max: 2, dated: false },
  senior: { label: 'Senior citizen', min: 1, max: 2, dated: true, oldest: 75 },
};
const GENDERS = ['Male', 'Female', 'Other'];
const ID_TYPES = ['Aadhaar'];
const STATUSES = ['ready', 'booked', 'failed'];
const LIST_MAX = 300;

const iso = d => (d ? d.toISOString() : null);

// Dates as text straight from the database, so the time zone can't move them a day.
const COLUMNS = `b.id, b.kind, b.date_mode, to_char(b.date_from, 'YYYY-MM-DD') AS date_from, to_char(b.date_to, 'YYYY-MM-DD') AS date_to,
  b.email, b.city, b.state, b.country, b.pincode, b.whatsapp, b.operator_id, b.notes, b.status, b.ref_no, b.booked_at,
  (b.ticket IS NOT NULL) AS has_ticket, b.ticket_name, b.sent_at, b.created_at,
  (SELECT o.name FROM operators o WHERE o.id = b.operator_id) AS operator_name`;

const fromRow = (r, pilgrims = []) => ({
  id: r.id,
  kind: r.kind,
  dateMode: r.date_mode,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  email: r.email,
  city: r.city,
  state: r.state,
  country: r.country,
  pincode: r.pincode,
  whatsapp: r.whatsapp,
  operatorId: r.operator_id ? String(r.operator_id) : '',
  operatorName: r.operator_name,
  notes: r.notes || '',
  status: r.status,
  refNo: r.ref_no || '',
  bookedAt: iso(r.booked_at),
  hasTicket: r.has_ticket,
  ticketName: r.ticket_name,
  sentAt: iso(r.sent_at),
  createdAt: iso(r.created_at),
  pilgrims,
});

// Pilgrims without the sealed Aadhaar, which only booking mode opens.
const pilgrimFromRow = r => ({ id: r.id, name: r.name, age: r.age, gender: r.gender, idType: r.id_type, aadhaarLast4: r.aadhaar_last4 });

async function pilgrimsOf(ids, withSealed = false) {
  if (!ids.length) return {};
  const { rows } = await query('SELECT * FROM ttd_pilgrims WHERE booking_id = ANY($1) ORDER BY booking_id, position', [ids]);
  const out = {};
  for (const r of rows) (out[r.booking_id] ||= []).push(withSealed ? { ...pilgrimFromRow(r), sealed: r.aadhaar_sealed } : pilgrimFromRow(r));
  return out;
}

const like = q => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

// One shop's bookings with a filter, plus the counts for its tabs.
async function list(owner, { status, kind, q }) {
  const params = [owner];
  const where = ['b.owner = $1'];
  if (STATUSES.includes(status)) { params.push(status); where.push(`b.status = $${params.length}`); }
  if (KINDS[kind]) { params.push(kind); where.push(`b.kind = $${params.length}`); }
  if (q) {
    params.push(like(q));
    const n = params.length;
    where.push(`(b.whatsapp ILIKE $${n} OR b.ref_no ILIKE $${n} OR b.email ILIKE $${n} OR EXISTS (SELECT 1 FROM ttd_pilgrims p WHERE p.booking_id = b.id AND p.name ILIKE $${n}))`);
  }
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM ttd_bookings b WHERE ${where.join(' AND ')}
     ORDER BY CASE b.status WHEN 'ready' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, b.date_from NULLS LAST, b.created_at DESC
     LIMIT ${LIST_MAX}`,
    params,
  );
  const people = await pilgrimsOf(rows.map(r => r.id));
  const { rows: [counts] } = await query(
    `SELECT count(*)::int AS "all", count(*) FILTER (WHERE status = 'ready')::int AS ready,
       count(*) FILTER (WHERE status = 'booked')::int AS booked, count(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM ttd_bookings WHERE owner = $1`,
    [owner],
  );
  return { items: rows.map(r => fromRow(r, people[r.id] || [])), counts };
}

async function get(id, owner, withSealed = false) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM ttd_bookings b WHERE b.id = $1 AND b.owner = $2`, [id, owner]);
  if (!rows[0]) return null;
  return fromRow(rows[0], (await pilgrimsOf([id], withSealed))[id] || []);
}

// Saves a whole booking and its pilgrims at once. `pilgrims` items carry `sealed` and
// `last4` already worked out, or `keep: true` to leave a saved Aadhaar as it is.
async function save(owner, b, pilgrims) {
  return transaction(async db => {
    const values = [b.id, owner, b.kind, b.dateMode, b.dateFrom, b.dateTo, b.email, b.city, b.state, b.country, b.pincode, b.whatsapp, b.operatorId || null, b.notes || null];
    if (b.isNew) {
      await db.query(
        `INSERT INTO ttd_bookings (id, owner, kind, date_mode, date_from, date_to, email, city, state, country, pincode, whatsapp, operator_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        values,
      );
    } else {
      const { rowCount } = await db.query(
        `UPDATE ttd_bookings SET kind = $3, date_mode = $4, date_from = $5, date_to = $6, email = $7, city = $8, state = $9, country = $10,
           pincode = $11, whatsapp = $12, operator_id = $13, notes = $14, updated_at = now()
         WHERE id = $1 AND owner = $2`,
        values,
      );
      if (!rowCount) return false;
    }
    const keepIds = pilgrims.filter(p => !p.isNew).map(p => p.id);
    await db.query('DELETE FROM ttd_pilgrims WHERE booking_id = $1 AND NOT (id = ANY($2))', [b.id, keepIds]);
    for (const [i, p] of pilgrims.entries()) {
      if (p.isNew) {
        await db.query(
          `INSERT INTO ttd_pilgrims (id, booking_id, position, name, age, gender, id_type, aadhaar_last4, aadhaar_sealed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [p.id, b.id, i, p.name, p.age, p.gender, p.idType, p.last4, p.sealed],
        );
      } else {
        await db.query(
          `UPDATE ttd_pilgrims SET position = $3, name = $4, age = $5, gender = $6, id_type = $7,
             aadhaar_last4 = CASE WHEN $10 THEN aadhaar_last4 ELSE $8 END, aadhaar_sealed = CASE WHEN $10 THEN aadhaar_sealed ELSE $9 END
           WHERE id = $1 AND booking_id = $2`,
          [p.id, b.id, i, p.name, p.age, p.gender, p.idType, p.last4 || null, p.sealed || null, !!p.keep],
        );
      }
    }
    return true;
  });
}

// Booked (with the TTD reference number), failed, or back to ready to try again.
async function setStatus(id, owner, status, refNo) {
  const { rowCount } = await query(
    `UPDATE ttd_bookings SET status = $3, ref_no = CASE WHEN $3 = 'booked' THEN $4 ELSE ref_no END,
       booked_at = CASE WHEN $3 = 'booked' THEN COALESCE(booked_at, now()) WHEN $3 = 'ready' THEN NULL ELSE booked_at END, updated_at = now()
     WHERE id = $1 AND owner = $2`,
    [id, owner, status, refNo || null],
  );
  return rowCount > 0;
}

async function saveTicket(id, owner, data, name) {
  const { rowCount } = await query('UPDATE ttd_bookings SET ticket = $3, ticket_name = $4, updated_at = now() WHERE id = $1 AND owner = $2', [id, owner, data, name]);
  return rowCount > 0;
}

async function ticket(id, owner) {
  const { rows } = await query('SELECT ticket, ticket_name FROM ttd_bookings WHERE id = $1 AND owner = $2 AND ticket IS NOT NULL', [id, owner]);
  return rows[0] || null;
}

async function markSent(id, owner) {
  const { rowCount } = await query('UPDATE ttd_bookings SET sent_at = now() WHERE id = $1 AND owner = $2', [id, owner]);
  return rowCount > 0;
}

async function remove(id, owner) {
  const { rowCount } = await query('DELETE FROM ttd_bookings WHERE id = $1 AND owner = $2', [id, owner]);
  return rowCount > 0;
}

// Ready bookings for booking mode, with the sealed Aadhaar numbers for the server to open.
async function readyWithSealed(owner, ids) {
  const params = [owner];
  let pick = '';
  if (ids?.length) { params.push(ids); pick = 'AND b.id = ANY($2)'; }
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM ttd_bookings b WHERE b.owner = $1 AND b.status = 'ready' ${pick}
     ORDER BY b.date_from NULLS LAST, b.created_at LIMIT 100`,
    params,
  );
  const people = await pilgrimsOf(rows.map(r => r.id), true);
  return rows.map(r => fromRow(r, people[r.id] || []));
}

// Customers to fill a pilgrim from: name, phone and the last 4 of a saved Aadhaar.
async function customerSearch(owner, q) {
  const { rows } = await query(
    `SELECT id, name, whatsapp, aadhaar_last4, (aadhaar_sealed IS NOT NULL) AS has_aadhaar FROM customers
     WHERE owner = $1 AND (name ILIKE $2 OR whatsapp ILIKE $2) ORDER BY created_at DESC LIMIT 8`,
    [owner, like(q)],
  );
  return rows.map(r => ({ id: r.id, name: r.name, whatsapp: r.whatsapp, aadhaarLast4: r.aadhaar_last4, hasAadhaar: r.has_aadhaar }));
}

async function customerSealed(owner, customerId) {
  const { rows } = await query('SELECT aadhaar_sealed FROM customers WHERE id = $1 AND owner = $2', [customerId, owner]);
  return rows[0]?.aadhaar_sealed || null;
}

// For the dashboard: how many are waiting to book, and booked this month.
async function summary(owner) {
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE status = 'ready')::int AS ready, count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'booked' AND to_char(booked_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))::int AS "bookedThisMonth"
     FROM ttd_bookings WHERE owner = $1`,
    [owner],
  );
  return r;
}

module.exports = { KINDS, GENDERS, ID_TYPES, STATUSES, list, get, save, setStatus, saveTicket, ticket, markSent, remove, readyWithSealed, customerSearch, customerSealed, summary };
