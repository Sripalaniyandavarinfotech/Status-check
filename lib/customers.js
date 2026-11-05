// Customers and their WhatsApp history in the database.
const { query } = require('./db');

const HISTORY = 20; // send records kept for each customer

const SELECT = `
  SELECT c.*, COALESCE((
    SELECT json_agg(jsonb_strip_nulls(jsonb_build_object(
      'at', n.sent_at, 'status', n.status, 'mode', n.mode, 'ok', n.ok,
      'messageId', n.message_id, 'error', n.error, 'text', n.body
    )) ORDER BY n.id DESC)
    FROM notifications n WHERE n.customer_id = c.id
  ), '[]') AS notifications
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
});

async function forOwner(owner) {
  const { rows } = await query(`${SELECT} WHERE c.owner = $1 ORDER BY c.created_at DESC, c.id`, [owner]);
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
     RETURNING *, '[]'::json AS notifications`,
    [c.id, c.owner, c.type, c.name, c.applicationNo, c.whatsapp],
  );
  return rows[0] ? fromRow(rows[0]) : null;
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

module.exports = { forOwner, ownedBy, find, add, remove, saveStatus, addNotification, waitingIds, dueForChecks, lastRun, saveRun, claimSlot };
