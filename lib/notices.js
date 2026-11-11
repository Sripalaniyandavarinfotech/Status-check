// Notices from the admin to shops: new features and updates, price changes, and
// anything else. Each shop sees those sent to everyone or to it alone, from the day
// its account was made, and which ones it has read.
const { query } = require('./db');

const KINDS = ['update', 'price', 'notice'];
const iso = d => (d ? d.toISOString() : null);

const fromRow = r => ({
  id: Number(r.id),
  kind: r.kind,
  title: r.title,
  body: r.body,
  important: r.important,
  price: r.price,
  startsOn: r.starts_day || null, // as text, so the time zone can't move it a day
  at: iso(r.created_at),
  read: r.read,
});

// The newest 50 for one shop, and how many it hasn't read.
async function forUser(userRef) {
  const { rows } = await query(
    `SELECT n.*, to_char(n.starts_on, 'YYYY-MM-DD') AS starts_day, (r.notice_id IS NOT NULL) AS read
     FROM notices n JOIN users u ON u.id = $1
     LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.user_ref = $1
     WHERE (n.target IS NULL OR n.target = $1) AND n.created_at >= u.created_at
     ORDER BY n.id DESC LIMIT 50`,
    [userRef],
  );
  const items = rows.map(fromRow);
  return { items, unread: items.filter(n => !n.read).length };
}

// Marks notices read. Only ones this shop can see; everything it can see when `ids` is empty.
async function markRead(userRef, ids) {
  const some = Array.isArray(ids) && ids.length ? ids.map(Number).filter(Number.isInteger).slice(0, 100) : null;
  await query(
    `INSERT INTO notice_reads (notice_id, user_ref)
     SELECT n.id, $1 FROM notices n JOIN users u ON u.id = $1
     WHERE (n.target IS NULL OR n.target = $1) AND n.created_at >= u.created_at
       AND ($2::bigint[] IS NULL OR n.id = ANY($2))
     ON CONFLICT DO NOTHING`,
    [userRef, some],
  );
}

// Everything sent, with how many shops it reached and how many have read it.
async function forAdmin() {
  const { rows } = await query(
    `SELECT n.*, to_char(n.starts_on, 'YYYY-MM-DD') AS starts_day, t.user_id AS target_user,
       (SELECT count(*)::int FROM notice_reads r WHERE r.notice_id = n.id) AS reads,
       CASE WHEN n.target IS NOT NULL THEN 1 ELSE
         (SELECT count(*)::int FROM users u WHERE u.role = 'user' AND u.status = 'active' AND u.created_at <= n.created_at) END AS audience
     FROM notices n LEFT JOIN users t ON t.id = n.target
     ORDER BY n.id DESC LIMIT 200`,
  );
  return rows.map(r => ({ ...fromRow({ ...r, read: true }), to: r.target_user || null, reads: r.reads, audience: r.audience }));
}

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Checks and saves a new notice. `to` is a shop's user ID, or empty for every shop.
async function send(form) {
  const kind = KINDS.includes(form.kind) ? form.kind : null;
  const title = String(form.title || '').trim();
  const body = String(form.body || '').trim();
  const to = String(form.to || '').trim().toLowerCase();
  if (!kind) return { error: 'Choose what kind of notice this is' };
  if (!title || title.length > 120) return { error: 'Enter a title of up to 120 characters' };
  if (!body || body.length > 2000) return { error: 'Enter a message of up to 2000 characters' };
  let price = null;
  let startsOn = null;
  if (kind === 'price') {
    price = Number(form.price);
    if (!Number.isInteger(price) || price < 1 || price > 100000) return { error: 'Enter the new price in rupees' };
    startsOn = String(form.startsOn || '').trim();
    if (!isDay(startsOn)) return { error: 'Choose the date the new price starts' };
  }
  let target = null;
  if (to) {
    target = (await query("SELECT id FROM users WHERE user_id = $1 AND role = 'user'", [to])).rows[0]?.id;
    if (!target) return { error: 'No shop has that user ID' };
  }
  const { rows } = await query(
    `INSERT INTO notices (kind, title, body, target, important, price, starts_on) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [kind, title, body, target, form.important === true || kind === 'price', price, startsOn],
  );
  return { id: Number(rows[0].id) };
}

async function remove(id) {
  const { rowCount } = await query('DELETE FROM notices WHERE id = $1', [Number(id) || 0]);
  return rowCount ? { ok: true } : { error: 'Notice not found', code: 404 };
}

module.exports = { forUser, markRead, forAdmin, send, remove, KINDS };
