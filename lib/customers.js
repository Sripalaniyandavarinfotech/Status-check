// Customers and their WhatsApp history in the database.
const { query } = require('./db');

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
  SELECT c.*, COALESCE((
    SELECT json_agg(jsonb_strip_nulls(jsonb_build_object(
      'at', n.sent_at, 'status', n.status, 'mode', n.mode, 'ok', n.ok,
      'messageId', n.message_id, 'error', n.error, 'text', n.body
    )) ORDER BY n.id DESC)
    FROM notifications n WHERE n.customer_id = c.id
  ), '[]') AS notifications, COALESCE((
    SELECT json_agg(jsonb_build_object('id', n.id, 'author', n.author, 'body', n.body, 'at', n.created_at) ORDER BY n.id DESC)
    FROM customer_notes n WHERE n.customer_id = c.id
  ), '[]') AS notes
  FROM customers c`;

const iso = d => (d ? d.toISOString() : null);

const fromRow = r => ({
  id: r.id,
  owner: r.owner,
  type: r.type,
  name: r.name,
  applicationNo: r.application_no,
  whatsapp: r.whatsapp,
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
});

// One page of a service box, with its filter and search applied.
async function page(owner, { type, view, q, page: wanted }) {
  const params = [owner, type];
  const where = ['c.owner = $1', 'c.type = $2'];
  if (VIEW[view]) where.push(VIEW[view]);
  if (q) {
    params.push(like(q));
    where.push(MATCH(params.length));
  }
  const clause = where.join(' AND ');
  const total = (await query(`SELECT count(*)::int n FROM customers c WHERE ${clause}`, params)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const at = Math.min(Math.max(1, Number(wanted) || 1), pages);
  const { rows } = await query(`${SELECT} WHERE ${clause} ORDER BY c.created_at DESC, c.id LIMIT ${PAGE} OFFSET ${(at - 1) * PAGE}`, params);
  return { items: rows.map(fromRow), page: at, pages, total };
}

// The counts around the list, without loading the customers themselves.
async function summary(owner, type, q) {
  const search = q ? like(q) : null;
  const boxes = (await query(
    `SELECT c.type, count(*)::int AS total, count(*) FILTER (WHERE c.notify_due)::int AS due,
       count(*) FILTER (WHERE $2::text IS NULL OR ${MATCH(2)})::int AS matches
     FROM customers c WHERE c.owner = $1 GROUP BY c.type`,
    [owner, search],
  )).rows;
  const { rows: [views] } = await query(
    `SELECT count(*)::int AS "all", count(*) FILTER (WHERE c.notify_due)::int AS waiting,
       count(*) FILTER (WHERE ${VIEW.progress})::int AS progress, count(*) FILTER (WHERE ${VIEW.approved})::int AS approved,
       count(*) FILTER (WHERE ${VIEW.rejected})::int AS rejected, count(*) FILTER (WHERE ${VIEW.new})::int AS new
     FROM customers c WHERE c.owner = $1 AND c.type = $2`,
    [owner, type],
  );
  const { rows: [all] } = await query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.notify_due)::int AS due, count(*) FILTER (WHERE ${VIEW.progress})::int AS progress
     FROM customers c WHERE c.owner = $1`,
    [owner],
  );
  const waiting = (await query(
    'SELECT c.id, c.name, c.type, c.status FROM customers c WHERE c.owner = $1 AND c.notify_due ORDER BY c.created_at DESC LIMIT 200',
    [owner],
  )).rows;
  return { boxes, views, ...all, waiting };
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

// Null when this user already saved this number for this service.
async function add(c) {
  const { rows } = await query(
    `INSERT INTO customers (id, owner, type, name, application_no, whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner, type, application_no) DO NOTHING
     RETURNING *, '[]'::json AS notifications, '[]'::json AS notes`,
    [c.id, c.owner, c.type, c.name, c.applicationNo, c.whatsapp],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

// Null when another customer of this user already has that number. A new number
// is a different application, so its old status is cleared.
async function edit(c, { name, applicationNo, whatsapp }) {
  const changed = applicationNo !== c.applicationNo;
  try {
    await query(
      `UPDATE customers SET name = $2, application_no = $3, whatsapp = $4 ${changed
        ? ', status = NULL, previous_status = NULL, found = NULL, service = NULL, remarks = NULL, notify_due = false, last_checked = NULL, status_changed_at = NULL'
        : ''} WHERE id = $1`,
      [c.id, name, applicationNo, whatsapp],
    );
  } catch (e) {
    if (e.code === '23505') return null;
    throw e;
  }
  return find(c.id);
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
       notify_due = $7, last_checked = $8, status_changed_at = $9
     WHERE id = $1`,
    [c.id, c.status, c.previousStatus, c.found, c.service, c.remarks, !!c.notifyDue, c.lastChecked, c.statusChangedAt],
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

const waitingIds = async owner => (await query('SELECT id FROM customers WHERE owner = $1 AND notify_due ORDER BY created_at DESC', [owner])).rows.map(r => r.id);

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
         WHERE ($1::text IS NULL OR c.owner = $1) AND n.ok AND n.mode = 'live' AND ${MONTH('n.sent_at')} = m.month) AS sent
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
  return { services, months: await months(owner) };
}

async function adminReport() {
  const { rows: users } = await query(
    `SELECT u.user_id AS "userId", count(c.id)::int AS total,
       count(c.id) FILTER (WHERE ${MONTH('c.created_at')} = ${MONTH('now()')})::int AS "thisMonth",
       count(c.id) FILTER (WHERE ${VIEW.approved})::int AS approved, count(c.id) FILTER (WHERE ${VIEW.rejected})::int AS rejected,
       (SELECT count(*)::int FROM notifications n JOIN customers x ON x.id = n.customer_id WHERE x.owner = u.id AND n.ok AND n.mode = 'live') AS sent
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
     FROM customers c WHERE c.application_no = $1 AND c.whatsapp = $2 ORDER BY updated DESC LIMIT 1`,
    [applicationNo, whatsapp],
  );
  return rows[0] || null;
}

module.exports = { page, summary, exportBox, edit, addNote, removeNote, report, adminReport, publicStatus, ownedBy, find, add, remove, saveStatus, addNotification, waitingIds, dueForChecks, lastRun, saveRun, claimSlot };
