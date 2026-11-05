// A record of who did what. `detail` can name a customer, so only the person who
// did the action sees it. The admin sees who, what, and which user it was about.
const { query } = require('./db');

const PAGE = 50;

// Never lets a logging problem stop the action itself.
async function log({ actor, action, owner = null, target = null, detail = null }) {
  try {
    await query(
      'INSERT INTO activity (actor_ref, actor, action, owner, target, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [actor?.id || null, actor?.userId || 'Automatic check', action, owner, target, detail],
    );
  } catch (e) {
    console.error('[activity]', e.message);
  }
}

async function read(where, params, page, columns) {
  const total = (await query(`SELECT count(*)::int n FROM activity WHERE ${where}`, params)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const at = Math.min(Math.max(1, page || 1), pages);
  const { rows } = await query(
    `SELECT id, at, action, ${columns} FROM activity WHERE ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${(at - 1) * PAGE}`,
    params,
  );
  return { items: rows, page: at, pages, total };
}

// A user's own actions, plus automatic checks on their customers.
const forUser = (id, page) => read('actor_ref = $1 OR (actor_ref IS NULL AND owner = $1)', [id], page, 'actor, target, detail');

// Everything, without the customer detail.
const forAdmin = page => read('true', [], page, 'actor, target');

module.exports = { log, forUser, forAdmin };
