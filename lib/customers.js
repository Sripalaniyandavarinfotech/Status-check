// Customers and their WhatsApp history in the database.
const { query, transaction } = require('./db');

const HISTORY = 20; // send records kept for each customer
const PAGE = 25; // customers shown on one page

// The same four groups the website shows.
const STAGE = `CASE
  WHEN c.last_checked IS NULL THEN 'none'
  WHEN NOT COALESCE(c.found, false) OR c.status ~* 'reject|cancel' THEN 'bad'
  WHEN c.status ~* 'approved|accepted|e-?roll updated|issued|complet|sign|print|deliver' THEN 'ok'
  ELSE 'progress' END`;

// Final results. Stages like "pending for signature" are not final, so they are left out.
const FINISHED = 'approved|accepted|issued|deliver|complet|reject|cancel';

const VIEW = {
  waiting: 'c.notify_due',
  progress: `${STAGE} = 'progress'`,
  approved: `${STAGE} = 'ok'`,
  rejected: `${STAGE} = 'bad'`,
  new: `${STAGE} = 'none'`,
};

const like = q => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const MATCH = n => `(c.name ILIKE $${n} OR c.application_no ILIKE $${n} OR c.whatsapp ILIKE $${n})`;

const SELECT = `
  SELECT c.*, (SELECT o.name FROM operators o WHERE o.id = c.operator_id) AS operator_name,
    (SELECT count(*)::int FROM customers x WHERE x.owner = c.owner AND x.whatsapp = c.whatsapp) AS same_phone, COALESCE((
    SELECT json_agg(jsonb_strip_nulls(jsonb_build_object(
      'at', n.sent_at, 'status', n.status, 'mode', n.mode, 'ok', n.ok,
      'messageId', n.message_id, 'error', n.error, 'text', n.body
    )) ORDER BY n.id DESC)
    FROM notifications n WHERE n.customer_id = c.id
  ), '[]') AS notifications, COALESCE((
    SELECT json_agg(jsonb_build_object('id', n.id, 'author', n.author, 'body', n.body, 'at', n.created_at) ORDER BY n.id DESC)
    FROM customer_notes n WHERE n.customer_id = c.id
  ), '[]') AS notes, COALESCE((
    SELECT json_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'mode', p.mode, 'by', p.taken_by, 'at', p.paid_at) ORDER BY p.id)
    FROM payments p WHERE p.customer_id = c.id
  ), '[]') AS payments, (
    SELECT jsonb_build_object('id', f.id, 'dueOn', to_char(f.due_on, 'YYYY-MM-DD'), 'note', f.note)
    FROM followups f WHERE f.customer_id = c.id AND f.done_at IS NULL ORDER BY f.due_on, f.id LIMIT 1
  ) AS follow_up, (SELECT nc.new_name_en FROM name_cases nc WHERE nc.id = c.case_id) AS case_name
  FROM customers c`;

const iso = d => (d ? d.toISOString() : null);

const fromRow = r => ({
  id: r.id,
  owner: r.owner,
  type: r.type,
  name: r.name,
  applicationNo: r.application_no,
  whatsapp: r.whatsapp,
  aadhaarLast4: r.aadhaar_last4,
  hasAadhaar: !!r.aadhaar_sealed,
  informed: r.informed,
  panKind: r.pan_kind,
  panAgency: r.pan_agency,
  birthDate: r.birth_date,
  appliedOn: r.applied_on,
  operatorId: r.operator_id,
  operatorName: r.operator_name,
  samePhone: r.same_phone,
  service: r.service,
  status: r.status,
  previousStatus: r.previous_status,
  remarks: r.remarks,
  found: r.found,
  notifyDue: r.notify_due,
  lastChecked: iso(r.last_checked),
  statusChangedAt: iso(r.status_changed_at),
  createdAt: iso(r.created_at),
  notifications: r.notifications,
  notes: r.notes,
  payment: r.payment || null,
  fee: r.fee ?? null,
  payments: r.payments || [],
  paid: (r.payments || []).reduce((n, p) => n + p.amount, 0),
  followUp: r.follow_up || null,
  renewal: r.renewal || null,
  caseId: r.case_id || null,
  caseRole: r.case_role || null,
  caseName: r.case_name || null,
});

// One page of a service box, with its filter and search applied.
async function page(owner, { type, view, q, kind, agency, page: wanted }) {
  const params = [owner, type];
  const where = ['c.owner = $1', 'c.type = $2'];
  // Informed customers move out of the status lists, into their own list.
  if (view === 'informed') where.push('c.informed');
  else if (VIEW[view]) where.push(VIEW[view], 'NOT c.informed');
  if (q) {
    params.push(like(q));
    where.push(MATCH(params.length));
  }
  if (kind) {
    params.push(kind);
    where.push(`c.pan_kind = $${params.length}`);
  }
  if (agency) {
    params.push(agency);
    where.push(`c.pan_agency = $${params.length}`);
  }
  const clause = where.join(' AND ');
  const total = (await query(`SELECT count(*)::int n FROM customers c WHERE ${clause}`, params)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const at = Math.min(Math.max(1, Number(wanted) || 1), pages);
  const { rows } = await query(`${SELECT} WHERE ${clause} ORDER BY c.created_at DESC, c.id LIMIT ${PAGE} OFFSET ${(at - 1) * PAGE}`, params);
  return { items: rows.map(fromRow), page: at, pages, total };
}

// The counts around the list, without loading the customers themselves.
async function summary(owner, type, q, kind, agency) {
  const search = q ? like(q) : null;
  const boxes = (await query(
    `SELECT c.type, count(*)::int AS total, count(*) FILTER (WHERE c.notify_due)::int AS due,
       count(*) FILTER (WHERE ${VIEW.progress})::int AS progress,
       count(*) FILTER (WHERE $2::text IS NULL OR ${MATCH(2)})::int AS matches
     FROM customers c WHERE c.owner = $1 GROUP BY c.type`,
    [owner, search],
  )).rows;
  const { rows: [views] } = await query(
    `SELECT count(*)::int AS "all", count(*) FILTER (WHERE c.notify_due AND NOT c.informed)::int AS waiting,
       count(*) FILTER (WHERE ${VIEW.progress} AND NOT c.informed)::int AS progress, count(*) FILTER (WHERE ${VIEW.approved} AND NOT c.informed)::int AS approved,
       count(*) FILTER (WHERE ${VIEW.rejected} AND NOT c.informed)::int AS rejected, count(*) FILTER (WHERE ${VIEW.new} AND NOT c.informed)::int AS new,
       count(*) FILTER (WHERE c.informed)::int AS informed
     FROM customers c WHERE c.owner = $1 AND c.type = $2 AND ($3::text IS NULL OR c.pan_kind = $3) AND ($4::text IS NULL OR c.pan_agency = $4)`,
    [owner, type, kind || null, agency || null],
  );
  const { rows: [kinds] } = await query(
    `SELECT count(*)::int AS "all", count(*) FILTER (WHERE c.pan_kind = 'New')::int AS "New", count(*) FILTER (WHERE c.pan_kind = 'Correction')::int AS "Correction"
     FROM customers c WHERE c.owner = $1 AND c.type = $2 AND ($3::text IS NULL OR c.pan_agency = $3)`,
    [owner, type, agency || null],
  );
  // PAN counts for each agency, for the side bar.
  const agencies = Object.fromEntries((await query(
    `SELECT c.pan_agency AS agency, count(*)::int AS total, count(*) FILTER (WHERE c.notify_due)::int AS due,
       count(*) FILTER (WHERE ${VIEW.progress})::int AS progress,
       count(*) FILTER (WHERE $2::text IS NULL OR ${MATCH(2)})::int AS matches
     FROM customers c WHERE c.owner = $1 AND c.type = 'pan' GROUP BY c.pan_agency`,
    [owner, search],
  )).rows.map(r => [r.agency, r]));
  const { rows: [all] } = await query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.notify_due)::int AS due, count(*) FILTER (WHERE ${VIEW.progress})::int AS progress
     FROM customers c WHERE c.owner = $1`,
    [owner],
  );
  const waiting = (await query(
    `SELECT c.id, c.name, c.type, c.pan_agency AS "panAgency", c.status, c.found, c.service, c.remarks, c.whatsapp, c.application_no AS "applicationNo", c.last_checked AS "lastChecked"
     FROM customers c WHERE c.owner = $1 AND c.notify_due ORDER BY c.created_at DESC LIMIT 200`,
    [owner],
  )).rows;
  return { boxes, views, kinds, agencies, ...all, waiting };
}

// Every application of this user's under one WhatsApp number, in all services.
async function byPhone(owner, whatsapp) {
  const { rows } = await query(`${SELECT} WHERE c.owner = $1 AND c.whatsapp = $2 ORDER BY c.created_at DESC`, [owner, whatsapp]);
  return rows.map(fromRow);
}

// Everything in one service box, for Download CSV.
async function exportBox(owner, type) {
  const { rows } = await query(`${SELECT} WHERE c.owner = $1 AND c.type = $2 ORDER BY c.created_at DESC`, [owner, type]);
  return rows.map(fromRow);
}

// Returns nothing unless the customer belongs to this owner.
async function ownedBy(id, owner) {
  const { rows } = await query(`${SELECT} WHERE c.id = $1 AND c.owner = $2`, [id, owner]);
  return rows[0] ? fromRow(rows[0]) : null;
}

async function find(id) {
  const { rows } = await query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

// Another of this user's customers with this number, in any service.
async function sameNumber(owner, applicationNo, exceptId) {
  const { rows } = await query(
    'SELECT name, type FROM customers WHERE owner = $1 AND application_no = $2 AND id IS DISTINCT FROM $3 LIMIT 1',
    [owner, applicationNo, exceptId || null],
  );
  return rows[0] || null;
}

// Null when this user already saved this number for this service.
async function add(c) {
  const { rows } = await query(
    `INSERT INTO customers (id, owner, type, name, application_no, whatsapp, aadhaar_last4, aadhaar_sealed, operator_id, pan_kind, birth_date, applied_on, pan_agency, fee, payment, payment_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $15::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (owner, type, application_no) DO NOTHING
     RETURNING *, '[]'::json AS notifications, '[]'::json AS notes`,
    [c.id, c.owner, c.type, c.name, c.applicationNo, c.whatsapp, c.aadhaarLast4 || null, c.aadhaarSealed || null, c.operatorId || null, c.panKind || null, c.birthDate || null, c.appliedOn || null, c.panAgency || null, c.fee ?? null, c.payment || null],
  );
  return rows[0] ? find(rows[0].id) : null;
}

// Null when another customer of this user already has that number. A new number
// is a different application, so its old status is cleared.
// A blank Aadhaar number keeps the saved one.
async function edit(c, { name, applicationNo, whatsapp, aadhaarLast4, aadhaarSealed, operatorId, panKind, birthDate, appliedOn }) {
  const changed = applicationNo !== c.applicationNo;
  try {
    await query(
      `UPDATE customers SET name = $2, application_no = $3, whatsapp = $4, aadhaar_last4 = COALESCE($5, aadhaar_last4), aadhaar_sealed = COALESCE($6, aadhaar_sealed), operator_id = $7, pan_kind = $8, birth_date = $9, applied_on = $10 ${changed
        ? ', status = NULL, previous_status = NULL, found = NULL, service = NULL, remarks = NULL, notify_due = false, last_checked = NULL, status_changed_at = NULL, informed = false'
        : ''} WHERE id = $1`,
      [c.id, name, applicationNo, whatsapp, aadhaarLast4 || null, aadhaarSealed || null, operatorId || null, panKind || null, birthDate || null, appliedOn || null],
    );
  } catch (e) {
    if (e.code === '23505') return null;
    throw e;
  }
  return find(c.id);
}

const sealedAadhaar = async id => (await query('SELECT aadhaar_sealed FROM customers WHERE id = $1', [id])).rows[0]?.aadhaar_sealed || null;

async function removeAadhaar(id) {
  await query('UPDATE customers SET aadhaar_last4 = NULL, aadhaar_sealed = NULL WHERE id = $1', [id]);
  return find(id);
}

async function addNote(id, author, body) {
  await query('INSERT INTO customer_notes (customer_id, author, body) VALUES ($1, $2, $3)', [id, author, body]);
  return find(id);
}

async function removeNote(id, noteId) {
  await query('DELETE FROM customer_notes WHERE id = $1 AND customer_id = $2', [noteId, id]);
  return find(id);
}

async function remove(id, owner) {
  const { rowCount } = await query('DELETE FROM customers WHERE id = $1 AND owner = $2', [id, owner]);
  return rowCount > 0;
}

// False when the customer was deleted while this was running.
async function saveStatus(c) {
  const { rowCount } = await query(
    `UPDATE customers SET status = $2, previous_status = $3, found = $4, service = $5, remarks = $6,
       notify_due = $7, last_checked = $8, status_changed_at = $9, informed = $10
     WHERE id = $1`,
    [c.id, c.status, c.previousStatus, c.found, c.service, c.remarks, !!c.notifyDue, c.lastChecked, c.statusChangedAt, !!c.informed],
  );
  return rowCount > 0;
}

async function addNotification(id, n, notifyDue) {
  await query(
    `INSERT INTO notifications (customer_id, sent_at, status, mode, ok, message_id, error, body)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8 WHERE EXISTS (SELECT 1 FROM customers WHERE id = $1)`,
    [id, n.at, n.status, n.mode, n.ok, n.messageId, n.error, n.text],
  );
  await query(
    `DELETE FROM notifications WHERE customer_id = $1 AND id NOT IN (
       SELECT id FROM notifications WHERE customer_id = $1 ORDER BY id DESC LIMIT ${HISTORY})`,
    [id],
  );
  await query('UPDATE customers SET notify_due = $2 WHERE id = $1', [id, !!notifyDue]);
}

// Takes back a message the user opened in WhatsApp but didn't send.
async function undoChat(id, notifyDue) {
  await query(
    `DELETE FROM notifications WHERE id = (
       SELECT id FROM notifications WHERE customer_id = $1 AND mode = 'chat' ORDER BY id DESC LIMIT 1)`,
    [id],
  );
  await query('UPDATE customers SET notify_due = $2 WHERE id = $1', [id, !!notifyDue]);
  return find(id);
}

const waitingIds = async (owner, type) => (await query('SELECT id FROM customers WHERE owner = $1 AND notify_due AND ($2::text IS NULL OR type = $2) ORDER BY created_at DESC', [owner, type || null])).rows.map(r => r.id);

// Applications to check automatically. Suspended users are left out here.
async function dueForChecks(types, onlyOwner) {
  const { rows } = await query(
    `SELECT c.id, c.owner FROM customers c JOIN users u ON u.id = c.owner
     WHERE u.status = 'active' AND c.type = ANY($1) AND ($2::text IS NULL OR c.owner = $2)
       AND NOT (COALESCE(c.found, false) AND c.status ~* '${FINISHED}')
     ORDER BY c.created_at`,
    [types, onlyOwner || null],
  );
  return rows;
}

// ---- Results of automatic checks ----
const lastRun = async owner => (await query('SELECT run FROM check_runs WHERE owner = $1', [owner])).rows[0]?.run || null;

const saveRun = (owner, run) => query(
  'INSERT INTO check_runs (owner, run) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET run = EXCLUDED.run',
  [owner, JSON.stringify(run)],
);

// True the first time a time slot is claimed, so each slot runs once.
async function claimSlot(slot) {
  const { rowCount } = await query(
    `INSERT INTO app_state (key, value) VALUES ('last_slot', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE app_state.value <> EXCLUDED.value`,
    [slot],
  );
  return rowCount > 0;
}

// Removes all of one user's customers, with their notes and WhatsApp history.
// All of it goes, or none. The activity log stays as the record that it happened.
async function resetOwner(owner) {
  return transaction(async db => {
    const { rowCount } = await db.query('DELETE FROM customers WHERE owner = $1', [owner]);
    await db.query('DELETE FROM ttd_bookings WHERE owner = $1', [owner]);
    await db.query('DELETE FROM payments WHERE owner = $1', [owner]);
    await db.query('DELETE FROM name_cases WHERE owner = $1', [owner]);
    await db.query('DELETE FROM monthly_sent WHERE owner = $1', [owner]);
    await db.query('DELETE FROM check_runs WHERE owner = $1', [owner]);
    return rowCount;
  });
}

// ---- Reports ----
const MONTH = col => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`;

// The last 6 months, for one user or (with no owner) everyone. Counts only.
async function months(owner) {
  const { rows } = await query(
    `WITH m AS (
       SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - (n || ' month')::interval, 'YYYY-MM') AS month
       FROM generate_series(0, 5) n)
     SELECT m.month,
       (SELECT count(*)::int FROM customers c WHERE ($1::text IS NULL OR c.owner = $1) AND ${MONTH('c.created_at')} = m.month) AS added,
       (SELECT count(*)::int FROM customers c WHERE ($1::text IS NULL OR c.owner = $1) AND ${VIEW.approved} AND ${MONTH('COALESCE(c.status_changed_at, c.last_checked)')} = m.month) AS approved,
       (SELECT count(*)::int FROM customers c WHERE ($1::text IS NULL OR c.owner = $1) AND ${VIEW.rejected} AND ${MONTH('COALESCE(c.status_changed_at, c.last_checked)')} = m.month) AS rejected,
       (SELECT count(*)::int FROM notifications n JOIN customers c ON c.id = n.customer_id
         WHERE ($1::text IS NULL OR c.owner = $1) AND n.ok AND n.mode IN ('live', 'chat') AND ${MONTH('n.sent_at')} = m.month) AS sent
     FROM m ORDER BY m.month DESC`,
    [owner || null],
  );
  return rows;
}

async function report(owner) {
  const { rows: services } = await query(
    `SELECT c.type, count(*)::int AS total, count(*) FILTER (WHERE ${VIEW.approved})::int AS approved,
       count(*) FILTER (WHERE ${VIEW.rejected})::int AS rejected, count(*) FILTER (WHERE ${VIEW.progress})::int AS progress,
       count(*) FILTER (WHERE ${VIEW.new})::int AS new
     FROM customers c WHERE c.owner = $1 GROUP BY c.type`,
    [owner],
  );
  const { rows: [whatsapp] } = await query(
    `SELECT count(*) FILTER (WHERE n.ok AND n.mode IN ('live', 'chat'))::int AS sent,
       count(*) FILTER (WHERE n.ok AND n.mode IN ('live', 'chat') AND ${MONTH('n.sent_at')} = ${MONTH('now()')})::int AS "thisMonth",
       count(*) FILTER (WHERE NOT n.ok)::int AS failed
     FROM notifications n JOIN customers c ON c.id = n.customer_id WHERE c.owner = $1`,
    [owner],
  );
  return { services, months: await months(owner), whatsapp };
}

// One row for each operator, and one for customers with no operator.
async function operatorReport(owner) {
  const { rows } = await query(
    `WITH who AS (SELECT id, name FROM operators WHERE owner = $1 UNION ALL SELECT NULL::bigint, NULL::text)
     SELECT w.name, count(c.id)::int AS total,
       count(c.id) FILTER (WHERE ${MONTH('c.created_at')} = ${MONTH('now()')})::int AS "thisMonth",
       count(c.id) FILTER (WHERE ${VIEW.progress})::int AS progress, count(c.id) FILTER (WHERE ${VIEW.approved})::int AS approved,
       count(c.id) FILTER (WHERE ${VIEW.rejected})::int AS rejected, count(c.id) FILTER (WHERE ${VIEW.new})::int AS new,
       count(c.id) FILTER (WHERE c.informed)::int AS informed,
       (SELECT count(*)::int FROM notifications n JOIN customers x ON x.id = n.customer_id
         WHERE x.owner = $1 AND x.operator_id IS NOT DISTINCT FROM w.id AND n.ok AND n.mode IN ('live', 'chat')) AS sent
     FROM who w LEFT JOIN customers c ON c.owner = $1 AND c.operator_id IS NOT DISTINCT FROM w.id
     GROUP BY w.id, w.name ORDER BY w.name IS NULL, lower(w.name)`,
    [owner],
  );
  return rows.filter(r => r.name !== null || r.total > 0);
}

async function adminReport() {
  const { rows: users } = await query(
    `SELECT u.user_id AS "userId", count(c.id)::int AS total,
       count(c.id) FILTER (WHERE ${MONTH('c.created_at')} = ${MONTH('now()')})::int AS "thisMonth",
       count(c.id) FILTER (WHERE ${VIEW.approved})::int AS approved, count(c.id) FILTER (WHERE ${VIEW.rejected})::int AS rejected,
       (SELECT count(*)::int FROM notifications n JOIN customers x ON x.id = n.customer_id WHERE x.owner = u.id AND n.ok AND n.mode IN ('live', 'chat')) AS sent
     FROM users u LEFT JOIN customers c ON c.owner = u.id
     WHERE u.role = 'user' AND u.status <> 'pending' GROUP BY u.id ORDER BY u.user_id`,
  );
  return { users, months: await months() };
}

// For the public status page. Both numbers must match, and only the service and
// status come back: never a name, remarks or which user it belongs to.
async function publicStatus(applicationNo, whatsapp) {
  const { rows } = await query(
    `SELECT c.type, c.status, c.found, ${STAGE} AS stage, COALESCE(c.status_changed_at, c.last_checked, c.created_at) AS updated
     FROM customers c WHERE c.application_no = ANY($1) AND c.whatsapp = $2 ORDER BY updated DESC LIMIT 1`,
    [[applicationNo, applicationNo.replace(/^U-/, '')], whatsapp], // PAN receipts show a U- that isn't saved
  );
  return rows[0] || null;
}

// The phone app's lists: accepted, rejected, and those already called. Only what a
// call needs, never Aadhaar or notes. Freshest results first.
const CALL_VIEW = {
  accepted: `${VIEW.approved} AND NOT c.informed`,
  rejected: `c.found AND c.status ~* 'reject|cancel' AND NOT c.informed`,
  called: `c.informed AND (${VIEW.approved} OR (c.found AND c.status ~* 'reject|cancel'))`,
};
async function calls(owner, { type, agency, view, q }) {
  const params = [owner, type];
  const where = ['c.owner = $1', 'c.type = $2', CALL_VIEW[view]];
  if (agency) {
    params.push(agency);
    where.push(`c.pan_agency = $${params.length}`);
  }
  if (q) {
    params.push(like(q));
    where.push(MATCH(params.length));
  }
  const { rows } = await query(
    `SELECT c.id, c.type, c.name, c.application_no, c.whatsapp, c.status, c.pan_kind, c.pan_agency, c.applied_on, c.status_changed_at, c.last_checked, c.informed
     FROM customers c WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(c.status_changed_at, c.last_checked) DESC NULLS LAST, c.id LIMIT 300`,
    params,
  );
  const counts = (await query(
    `SELECT c.type, c.pan_agency, count(*) FILTER (WHERE ${CALL_VIEW.accepted})::int AS accepted,
       count(*) FILTER (WHERE ${CALL_VIEW.rejected})::int AS rejected, count(*) FILTER (WHERE ${CALL_VIEW.called})::int AS called
     FROM customers c WHERE c.owner = $1 GROUP BY c.type, c.pan_agency`,
    [owner],
  )).rows;
  return {
    items: rows.map(r => ({
      id: r.id, type: r.type, name: r.name, applicationNo: r.application_no, whatsapp: r.whatsapp, status: r.status,
      panKind: r.pan_kind, panAgency: r.pan_agency, appliedOn: r.applied_on, informed: r.informed, found: true,
      lastChecked: iso(r.last_checked), statusChangedAt: iso(r.status_changed_at || r.last_checked),
    })),
    counts: counts.map(r => ({ type: r.type, agency: r.pan_agency, accepted: r.accepted, rejected: r.rejected, called: r.called })),
  };
}

// Everything the home dashboard shows, in one go: each service's counts, the last
// six months, and this month's work by operator.
async function dashboard(owner) {
  const { rows: services } = await query(
    `SELECT c.type, c.pan_agency AS agency, count(*)::int AS total,
       count(*) FILTER (WHERE ${VIEW.new})::int AS new, count(*) FILTER (WHERE ${VIEW.progress})::int AS progress,
       count(*) FILTER (WHERE ${VIEW.approved})::int AS approved, count(*) FILTER (WHERE ${VIEW.rejected})::int AS rejected,
       count(*) FILTER (WHERE c.notify_due)::int AS due,
       count(*) FILTER (WHERE (${CALL_VIEW.accepted}) OR (${CALL_VIEW.rejected}))::int AS "toTell"
     FROM customers c WHERE c.owner = $1 GROUP BY c.type, c.pan_agency`,
    [owner],
  );
  return { services, months: await months(owner), operators: await operatorReport(owner) };
}

// The side bar's numbers on every page: applications and how many wait to send, per
// service (PAN by agency), and the TTD bookings ready to book. Keyed by page address.
const NAV = { certificate: '/', smartcard: '/tnpds', voter: '/voter', aadhaar: '/aadhaar' };
async function navCounts(owner) {
  const { rows } = await query(
    `SELECT c.type, c.pan_agency AS agency, count(*)::int AS n, count(*) FILTER (WHERE c.notify_due)::int AS due
     FROM customers c WHERE c.owner = $1 GROUP BY c.type, c.pan_agency`,
    [owner],
  );
  const out = Object.fromEntries([...Object.values(NAV), '/pan/uti', '/pan/nsdl'].map(href => [href, { n: 0, due: 0 }]));
  for (const r of rows) {
    const href = r.type === 'pan' ? (r.agency === 'NSDL' ? '/pan/nsdl' : '/pan/uti') : NAV[r.type];
    if (!href) continue;
    out[href].n += r.n;
    out[href].due += r.due;
  }
  const ttd = (await query("SELECT count(*)::int AS n FROM ttd_bookings WHERE owner = $1 AND status = 'ready'", [owner])).rows[0].n;
  out['/ttd'] = { n: ttd, due: 0 };
  return out;
}

module.exports = { navCounts, dashboard, calls, byPhone, operatorReport, sameNumber, sealedAadhaar, removeAadhaar, resetOwner, page, summary, exportBox, edit, addNote, removeNote, report, adminReport, publicStatus, ownedBy, find, add, remove, saveStatus, addNotification, undoChat, waitingIds, dueForChecks, lastRun, saveRun, claimSlot };
