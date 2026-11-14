// The monthly report: last month's applications, money and operators for one shop.
// Shown on /report for any month, and emailed to the shop owner on the 1st.
// It holds counts and totals only, never a customer's name or number.
const { query } = require('./db');
const money = require('./money');
const followups = require('./followups');
const renewals = require('./renewals');
const cases = require('./cases');

const MONTH = col => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`;
const OK = "COALESCE(c.found, false) AND COALESCE(c.status, '') !~* 'reject|cancel' AND COALESCE(c.status, '') ~* 'approved|accepted|e-?roll updated|issued|complet|sign|print|deliver'";
const BAD = "c.last_checked IS NOT NULL AND (NOT COALESCE(c.found, false) OR COALESCE(c.status, '') ~* 'reject|cancel')";
const CHANGED = 'COALESCE(c.status_changed_at, c.last_checked)';
const NAMES = { certificate: 'TNeDistrict', smartcard: 'TNPDS', voter: 'Voter', aadhaar: 'Aadhaar', pan: 'PAN' };

const validMonth = ym => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '');

// The month before this one, in India time.
function lastMonth() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function build(owner, ym) {
  const { rows: services } = await query(
    `SELECT c.type, c.pan_agency AS agency,
       count(*) FILTER (WHERE ${MONTH('c.created_at')} = $2)::int AS added,
       count(*) FILTER (WHERE ${OK} AND ${MONTH(CHANGED)} = $2)::int AS approved,
       count(*) FILTER (WHERE ${BAD} AND ${MONTH(CHANGED)} = $2)::int AS rejected
     FROM customers c WHERE c.owner = $1 GROUP BY c.type, c.pan_agency`,
    [owner, ym],
  );
  const { rows: [pending] } = await query(
    `SELECT count(*)::int AS n FROM customers c WHERE c.owner = $1 AND NOT (${OK}) AND NOT (${BAD})`,
    [owner],
  );
  const { rows: ops } = await query(
    `SELECT o.name, count(*)::int AS added FROM customers c LEFT JOIN operators o ON o.id = c.operator_id
     WHERE c.owner = $1 AND ${MONTH('c.created_at')} = $2 GROUP BY o.name`,
    [owner, ym],
  );
  const { rows: [ttd] } = await query(
    `SELECT count(*) FILTER (WHERE ${MONTH('created_at')} = $2)::int AS added,
       count(*) FILTER (WHERE status = 'booked' AND ${MONTH('booked_at')} = $2)::int AS booked
     FROM ttd_bookings WHERE owner = $1`,
    [owner, ym],
  );
  const cash = await money.month(owner, ym);
  const { rows: [marked] } = await query(
    `SELECT (SELECT count(*) FROM customers WHERE owner = $1 AND payment = 'paid' AND ${MONTH('payment_at')} = $2)
       + (SELECT count(*) FROM ttd_bookings WHERE owner = $1 AND payment = 'paid' AND ${MONTH('payment_at')} = $2)
       + (SELECT count(*) FROM name_cases WHERE owner = $1 AND payment = 'paid' AND ${MONTH('payment_at')} = $2) AS n`,
    [owner, ym],
  );
  const owed = await money.dues(owner);

  // Operators: applications added and money taken, the best first.
  const byName = new Map();
  for (const o of ops) byName.set(o.name || '', { name: o.name || '', added: o.added, collected: 0 });
  for (const o of cash.operators) {
    const row = byName.get(o.name || '') || { name: o.name || '', added: 0, collected: 0 };
    row.collected = o.collected;
    byName.set(o.name || '', row);
  }
  const operators = [...byName.values()].sort((a, b) => b.added - a.added || b.collected - a.collected);
  const best = operators.find(o => o.name && (o.added || o.collected)) || null;

  const label = r => (r.type === 'pan' ? `PAN ${r.agency || 'UTI'}` : NAMES[r.type] || r.type);
  const list = services.map(r => ({ service: label(r), added: r.added, approved: r.approved, rejected: r.rejected }))
    .filter(r => r.added || r.approved || r.rejected)
    .sort((a, b) => b.added - a.added);
  const sum = k => list.reduce((n, r) => n + r[k], 0);

  return {
    month: ym,
    applications: { added: sum('added'), approved: sum('approved'), rejected: sum('rejected'), pendingNow: pending.n },
    services: list,
    ttd,
    money: { paid: Number(marked.n), unpaidNow: owed.length, cash: cash.cash, upi: cash.upi, total: cash.total, payments: cash.count, outstandingNow: owed.reduce((n, d) => n + d.due, 0) },
    operators,
    best,
    nameChanges: await cases.month(owner, ym),
    renewalsSent: await renewals.sentIn(owner, ym),
    followUpsDone: await followups.doneIn(owner, ym),
  };
}

const rs = n => `₹${Number(n).toLocaleString('en-IN')}`;
const monthName = ym => new Date(`${ym}-15T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Plain lines, for the email and for WhatsApp.
function text(r, shop) {
  const lines = [
    `eThunaivan monthly report: ${monthName(r.month)}${shop ? ` (${shop})` : ''}`,
    '',
    `Applications added: ${r.applications.added}`,
    `Approved: ${r.applications.approved}`,
    `Rejected: ${r.applications.rejected}`,
    `Still pending today: ${r.applications.pendingNow}`,
  ];
  if (r.services.length) {
    lines.push('', 'By service:');
    for (const s of r.services) lines.push(`- ${s.service}: ${s.added} added, ${s.approved} approved, ${s.rejected} rejected`);
  }
  if (r.ttd.added || r.ttd.booked) lines.push('', `TTD: ${r.ttd.added} added, ${r.ttd.booked} booked`);
  lines.push('', `Marked paid: ${r.money.paid}`, `Not paid today: ${r.money.unpaidNow}`);
  if (r.money.total) lines.push(`Amounts entered: ${rs(r.money.total)} (cash ${rs(r.money.cash)}, UPI ${rs(r.money.upi)})`);
  if (r.operators.some(o => o.name)) {
    lines.push('', 'Operators:');
    for (const o of r.operators.filter(x => x.name)) lines.push(`- ${o.name}: ${o.added} added${o.collected ? `, ${rs(o.collected)} collected` : ''}`);
    if (r.best) lines.push(`Best operator: ${r.best.name}`);
  }
  const nc = r.nameChanges;
  if (nc && (nc.started || nc.enrolled || nc.finished)) lines.push('', `Aadhaar name changes: ${nc.started} started, ${nc.enrolled} enrolled, ${nc.finished} finished`);
  lines.push('', `Renewal reminders sent: ${r.renewalsSent}`, `Follow-ups done: ${r.followUpsDone}`);
  return lines.join('\n');
}

module.exports = { build, text, lastMonth, validMonth, monthName };
