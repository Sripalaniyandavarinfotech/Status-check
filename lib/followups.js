// Follow-up reminders: "call back on Friday" on a customer or a TTD booking.
// They show on the Home page on their day, and stay there until done.
const { query } = require('./db');

const TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  SELECT f.id, to_char(f.due_on, 'YYYY-MM-DD') AS due_on, f.note, f.created_by, f.created_at,
    (f.due_on < ${TODAY}) AS overdue, (f.due_on = ${TODAY}) AS today,
    c.id AS customer_id, c.name AS customer_name, c.type, c.pan_agency, c.application_no, c.whatsapp AS customer_whatsapp,
    b.id AS ttd_id, b.kind AS ttd_kind, b.whatsapp AS ttd_whatsapp,
    (SELECT p.name FROM ttd_pilgrims p WHERE p.booking_id = b.id ORDER BY p.position LIMIT 1) AS ttd_name,
    n.id AS case_id, n.name AS case_name, n.new_name_en AS case_new_name, n.whatsapp AS case_whatsapp
  FROM followups f
  LEFT JOIN customers c ON c.id = f.customer_id
  LEFT JOIN ttd_bookings b ON b.id = f.ttd_id
  LEFT JOIN name_cases n ON n.id = f.case_id`;

const fromRow = r => ({
  id: String(r.id),
  dueOn: r.due_on,
  note: r.note || '',
  createdBy: r.created_by,
  overdue: r.overdue,
  today: r.today,
  ...(r.customer_id
    ? { kind: 'customer', targetId: r.customer_id, name: r.customer_name, type: r.type, agency: r.pan_agency, applicationNo: r.application_no, whatsapp: r.customer_whatsapp }
    : r.case_id
      ? { kind: 'case', targetId: r.case_id, name: `${r.case_name} → ${r.case_new_name}`, type: 'aadhaar-name', whatsapp: r.case_whatsapp }
      : { kind: 'ttd', targetId: r.ttd_id, name: r.ttd_name || 'TTD', type: r.ttd_kind, whatsapp: r.ttd_whatsapp }),
});

// Overdue and today's first, then the coming days.
async function list(owner) {
  const { rows } = await query(`${SELECT} WHERE f.owner = $1 AND f.done_at IS NULL ORDER BY f.due_on, f.id LIMIT 300`, [owner]);
  const items = rows.map(fromRow);
  return { due: items.filter(f => f.overdue || f.today), upcoming: items.filter(f => !f.overdue && !f.today) };
}

async function dueCount(owner) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM followups WHERE owner = $1 AND done_at IS NULL AND due_on <= ${TODAY}`, [owner]);
  return rows[0].n;
}

async function owns(owner, { customerId, ttdId, caseId }) {
  if (customerId) return (await query('SELECT 1 FROM customers WHERE id = $1 AND owner = $2', [String(customerId), owner])).rowCount > 0;
  if (ttdId) return (await query('SELECT 1 FROM ttd_bookings WHERE id = $1 AND owner = $2', [String(ttdId), owner])).rowCount > 0;
  if (caseId) return (await query('SELECT 1 FROM name_cases WHERE id = $1 AND owner = $2', [String(caseId), owner])).rowCount > 0;
  return false;
}

// One open reminder per customer or booking: a new one replaces the old.
async function set(owner, { customerId, ttdId, caseId, dueOn, note, by }) {
  const column = customerId ? 'customer_id' : caseId ? 'case_id' : 'ttd_id';
  const id = customerId || caseId || ttdId;
  await query(`UPDATE followups SET done_at = now() WHERE owner = $1 AND ${column} = $2 AND done_at IS NULL`, [owner, id]);
  const { rows } = await query(
    `INSERT INTO followups (owner, ${column}, due_on, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [owner, id, dueOn, note || null, by],
  );
  return one(owner, rows[0].id);
}

async function one(owner, id) {
  const { rows } = await query(`${SELECT} WHERE f.owner = $1 AND f.id = $2`, [owner, id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

async function done(owner, id) {
  const { rowCount } = await query('UPDATE followups SET done_at = now() WHERE owner = $1 AND id = $2 AND done_at IS NULL', [owner, id]);
  return rowCount > 0;
}

async function move(owner, id, dueOn) {
  const { rowCount } = await query('UPDATE followups SET due_on = $3 WHERE owner = $1 AND id = $2 AND done_at IS NULL', [owner, id, dueOn]);
  return rowCount ? one(owner, id) : null;
}

// Done in a month, for the monthly report.
async function doneIn(owner, ym) {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM followups WHERE owner = $1 AND done_at IS NOT NULL AND to_char(done_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $2",
    [owner, ym],
  );
  return rows[0].n;
}

// A real date, from today up to two years ahead.
function validDay(s) {
  if (!DATE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() >= today && d.getTime() <= today + 731 * 86400000;
}

// /api/followups/...
async function followupsApi(req, res, url, user, { send, readBody, httpError, activity }) {
  const [, , , id, action] = url.pathname.split('/');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const record = (what, detail) => activity.log({ actor: user, action: what, owner: user.id, detail });
  const label = f => `${f.name}${f.applicationNo ? ` (${f.applicationNo})` : ''}`;

  if (req.method === 'GET' && !id) return send(res, 200, await list(user.id));

  if (req.method === 'POST' && !id) {
    const source = body.customerId ? { customerId: body.customerId } : body.caseId ? { caseId: body.caseId } : { ttdId: body.ttdId || null };
    if (!await owns(user.id, source)) throw httpError(404, 'Customer not found');
    const dueOn = String(body.dueOn || '');
    if (!validDay(dueOn)) throw httpError(400, 'Choose a date from today onwards');
    const note = String(body.note || '').trim();
    if (note.length > 300) throw httpError(400, 'Keep the note under 300 characters');
    const f = await set(user.id, { ...source, dueOn, note, by: user.userId });
    await record('followup.add', `${label(f)}: ${dueOn}`);
    return send(res, 201, f);
  }

  if (!/^[0-9]{1,18}$/.test(id || '')) return send(res, 404, { error: 'Not found' });
  const f = await one(user.id, id);
  if (!f) return send(res, 404, { error: 'Reminder not found' });

  if (req.method === 'POST' && action === 'done') {
    await done(user.id, id);
    await record('followup.done', label(f));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && action === 'move') {
    const dueOn = String(body.dueOn || '');
    if (!validDay(dueOn)) throw httpError(400, 'Choose a date from today onwards');
    const moved = await move(user.id, id, dueOn);
    if (!moved) return send(res, 404, { error: 'Reminder not found' });
    await record('followup.move', `${label(f)}: ${dueOn}`);
    return send(res, 200, moved);
  }
  if (req.method === 'DELETE' && !action) {
    await done(user.id, id);
    await record('followup.remove', label(f));
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'Not allowed' });
}

module.exports = { followupsApi, list, dueCount, doneIn };
