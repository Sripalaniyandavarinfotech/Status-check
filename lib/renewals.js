// Income and OBC certificates are renewed every year. Eleven months after one is
// approved, the customer shows in "Renewals due" so the shop can remind them on
// WhatsApp. Each customer is reminded (or skipped) once.
const { query } = require('./db');

// TN e-District service names, for example "REV-103 Income Certificate".
const SERVICE = "c.service ~* '(income|obc|other backward)'";
const APPROVED = "c.found AND c.status ~* 'approved|issued|complet|sign|print|deliver' AND c.status !~* 'reject|cancel'";
const APPROVED_AT = 'COALESCE(c.status_changed_at, c.last_checked)';
// Approvals from before a year ahead of this feature's start are left out, so old
// customers don't all arrive at once.
const STARTED = "(SELECT value::timestamptz FROM app_state WHERE key = 'renewals.start')";
const DUE = `c.type = 'certificate' AND ${SERVICE} AND ${APPROVED} AND c.renewal IS NULL
  AND ${APPROVED_AT} <= now() - interval '11 months' AND ${APPROVED_AT} >= ${STARTED} - interval '12 months'`;

const certificate = service => (/income/i.test(service || '') ? 'income' : 'obc');

async function list(owner) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.application_no, c.whatsapp, c.service, ${APPROVED_AT} AS approved_at
     FROM customers c WHERE c.owner = $1 AND ${DUE} ORDER BY ${APPROVED_AT}, c.id LIMIT 300`,
    [owner],
  );
  return rows.map(r => ({
    id: r.id, name: r.name, applicationNo: r.application_no, whatsapp: r.whatsapp, service: r.service,
    certificate: certificate(r.service), approvedAt: r.approved_at,
  }));
}

async function dueCount(owner) {
  return (await query(`SELECT count(*)::int AS n FROM customers c WHERE c.owner = $1 AND ${DUE}`, [owner])).rows[0].n;
}

async function mark(owner, id, state) {
  const { rows } = await query(
    `UPDATE customers c SET renewal = $3, renewal_at = now() WHERE c.id = $1 AND c.owner = $2 AND ${DUE} RETURNING c.name, c.application_no`,
    [id, owner, state],
  );
  return rows[0] || null;
}

async function sentIn(owner, ym) {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM customers WHERE owner = $1 AND renewal = 'sent' AND to_char(renewal_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $2",
    [owner, ym],
  );
  return rows[0].n;
}

// /api/renewals/...
async function renewalsApi(req, res, url, user, { send, activity }) {
  const [, , , id, action] = url.pathname.split('/');
  if (req.method === 'GET' && !id) return send(res, 200, await list(user.id));
  if (req.method === 'POST' && id && ['sent', 'skip'].includes(action)) {
    const done = await mark(user.id, id, action === 'sent' ? 'sent' : 'skipped');
    if (!done) return send(res, 404, { error: 'This customer is not due for a renewal reminder' });
    await activity.log({ actor: user, action: action === 'sent' ? 'renewal.sent' : 'renewal.skip', owner: user.id, detail: `${done.name} (${done.application_no})` });
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'Not allowed' });
}

module.exports = { renewalsApi, list, dueCount, sentIn };
