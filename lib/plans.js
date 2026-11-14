// Subscription plans: what each one includes, where a shop stands (trial, active,
// grace or read-only), the payments that move it on, receipts and reminders.
//
//   Trial (14 days, Premium) -> Active (paid until a date) -> Grace (5 days, all
//   still works) -> Read-only (view, search, call, CSV; no changes).
//
// Data is never deleted when a plan ends. Suspension stays a separate, manual action.
const fs = require('fs');
const path = require('path');
const { query, transaction } = require('./db');

const PRICES = {
  standard: { monthly: 399, yearly: 3990 },
  premium: { monthly: 599, yearly: 5990 },
};
const GRACE_DAYS = 5;
const TZ = 'Asia/Kolkata';

// Only Premium has these. Everything else is in both plans.
const PREMIUM = {
  ttd: 'TTD booking helper',
  epan: 'e-PAN email reading',
  calls: 'Phone app',
  autoWhatsapp: 'Automatic WhatsApp',
  custom: 'Custom features',
};

// ---- Days, in India time, as YYYY-MM-DD ----
const dayOf = d => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const today = () => dayOf(Date.now());
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const between = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
// One month or year on from a day, less one day: 12 Nov -> 11 Dec.
function periodEnd(from, billing) {
  const d = new Date(`${from}T00:00:00Z`);
  if (billing === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// The plan in use: a change booked for a later day applies from that day.
function planNow(u) {
  const due = u.planRequest && ['standard', 'premium'].includes(u.planRequest) && u.planRequestAt && new Date(u.planRequestAt) <= new Date();
  return due ? u.planRequest : ['standard', 'premium'].includes(u.plan) ? u.plan : null;
}

// Where a shop stands today. `u` is a user from lib/users.js.
function status(u) {
  const now = today();
  const trialDay = u.trialEnds ? dayOf(u.trialEnds) : null;
  const trialOn = !!u.trialEnds && new Date(u.trialEnds) > new Date();
  const paidOn = !!u.paidUntil && u.paidUntil >= now;
  const plan = planNow(u);
  let state;
  let effective;
  let endsOn;
  if (paidOn) {
    state = 'active';
    effective = plan || 'standard';
    endsOn = u.paidUntil;
    if (trialOn && trialDay > endsOn) { state = 'trial'; effective = 'premium'; endsOn = trialDay; }
  } else if (trialOn) {
    state = 'trial';
    effective = 'premium';
    endsOn = trialDay;
  } else {
    endsOn = later(u.paidUntil, trialDay);
    const paidLast = !!u.paidUntil && u.paidUntil === endsOn;
    if (endsOn && between(endsOn, now) <= GRACE_DAYS) {
      state = 'grace';
      effective = paidLast ? plan || 'standard' : 'premium';
    } else {
      state = 'readonly';
      effective = null;
    }
  }
  const daysLeft = endsOn ? between(now, endsOn) : 0;
  const graceEnds = endsOn ? addDays(endsOn, GRACE_DAYS) : null;
  const features = Object.fromEntries(Object.keys(PREMIUM).map(f => [f, state !== 'readonly' && effective === 'premium']));
  return {
    status: state, plan: effective, chosenPlan: plan, billing: u.billing || 'monthly', endsOn, daysLeft, graceEnds,
    trialEnds: trialDay, paidUntil: u.paidUntil || null,
    nextPlan: u.planRequest && u.planRequestAt && new Date(u.planRequestAt) > new Date() ? { plan: u.planRequest, from: dayOf(u.planRequestAt) } : null,
    canChange: state !== 'readonly', features,
  };
}

const allows = (u, feature) => status(u).features[feature] === true;
const canChange = u => status(u).status !== 'readonly';

// ---- Paying ----
function upi() {
  const id = (process.env.UPI_ID || '').trim();
  const name = (process.env.UPI_NAME || 'Palaniyandavar Info Tech').trim();
  return { id: /^[\w.-]{2,64}@[\w.-]{2,64}$/.test(id) ? id : null, name, hasQr: !!qrFile() };
}

// The shop's own UPI QR image (from GPay, PhonePe or the bank app), saved by hand.
function qrFile() {
  for (const name of ['upi-qr.png', 'upi-qr.jpg', 'upi-qr.jpeg']) {
    const file = path.join(__dirname, '..', 'data', name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// What the shop would pay. An upgrade pays only the difference for the days left.
function quote(u, { kind, plan, billing }) {
  const s = status(u);
  if (kind === 'upgrade') {
    if (s.status !== 'active' || s.plan !== 'standard' || !u.paidUntil) return { error: 'An upgrade is for shops on an active Standard plan' };
    const b = s.billing;
    const days = between(today(), u.paidUntil) + 1;
    const length = b === 'yearly' ? 365 : 30;
    const amount = Math.max(1, Math.ceil(((PRICES.premium[b] - PRICES.standard[b]) * Math.min(days, length)) / length));
    return { kind, plan: 'premium', billing: b, amount, from: today(), to: u.paidUntil };
  }
  if (!PRICES[plan] || !PRICES[plan][billing]) return { error: 'Choose a plan and monthly or yearly' };
  const from = nextStart(u);
  return { kind: 'renew', plan, billing, amount: PRICES[plan][billing], from, to: periodEnd(from, billing) };
}

// A new period starts after what is already paid for, or the trial; otherwise today.
function nextStart(u) {
  const now = today();
  let from = now;
  if (u.paidUntil && u.paidUntil >= now) from = addDays(u.paidUntil, 1);
  if (u.trialEnds && new Date(u.trialEnds) > new Date()) from = later(from, addDays(dayOf(u.trialEnds), 1));
  return from;
}

const fromPayment = r => ({
  id: String(r.id), kind: r.kind, plan: r.plan, billing: r.billing, amount: r.amount, mode: r.mode, utr: r.utr || '',
  note: r.note || '', status: r.status, from: r.period_from, to: r.period_to, receiptNo: r.receipt_no,
  createdAt: r.created_at, decidedAt: r.decided_at, shop: r.user_id,
});
const PAY_COLUMNS = `p.id, p.kind, p.plan, p.billing, p.amount, p.mode, p.utr, p.note, p.status, p.receipt_no, p.created_at, p.decided_at,
  to_char(p.period_from, 'YYYY-MM-DD') AS period_from, to_char(p.period_to, 'YYYY-MM-DD') AS period_to`;

async function paymentsOf(owner) {
  const { rows } = await query(`SELECT ${PAY_COLUMNS} FROM plan_payments p WHERE p.owner = $1 ORDER BY p.id DESC LIMIT 50`, [owner]);
  return rows.map(fromPayment);
}

const log = (db, owner, actor, event, detail) => db.query('INSERT INTO plan_events (owner, actor, event, detail) VALUES ($1, $2, $3, $4)', [owner, actor, event, detail || null]);

// "I have paid": one waiting request at a time.
async function requestPayment(u, body) {
  const q = quote(u, { kind: body.kind === 'upgrade' ? 'upgrade' : 'renew', plan: body.plan, billing: body.billing });
  if (q.error) return { error: q.error };
  const utr = String(body.utr || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(utr)) return { error: 'Enter the UPI reference number (UTR) from your payment, 6 to 30 letters or digits' };
  const { rows: waiting } = await query("SELECT 1 FROM plan_payments WHERE owner = $1 AND status = 'pending'", [u.id]);
  if (waiting.length) return { error: 'A payment is already waiting to be confirmed. Cancel it first to send a new one.', code: 409 };
  const { rows } = await query(
    `INSERT INTO plan_payments (owner, kind, plan, billing, amount, mode, utr) VALUES ($1, $2, $3, $4, $5, 'upi', $6) RETURNING id`,
    [u.id, q.kind, q.plan, q.billing, q.amount, utr],
  );
  await log({ query }, u.id, u.userId, 'payment.request', `${q.plan} ${q.billing} ₹${q.amount} UTR ${utr}`);
  return { ok: true, id: String(rows[0].id) };
}

async function cancelPayment(owner, id) {
  const { rowCount } = await query("UPDATE plan_payments SET status = 'cancelled', decided_at = now() WHERE id = $1 AND owner = $2 AND status = 'pending'", [id, owner]);
  return rowCount > 0;
}

// Confirming moves the paid-until date on, switches the plan (now, or when the new
// period starts) and gives the payment its receipt number.
async function confirmPayment(id, actor) {
  return transaction(async db => {
    const { rows: [p] } = await db.query("SELECT * FROM plan_payments WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]);
    if (!p) return { error: 'This payment is not waiting any more', code: 409 };
    const { rows: [row] } = await db.query("SELECT *, to_char(paid_until, 'YYYY-MM-DD') AS paid_until_day FROM users WHERE id = $1 FOR UPDATE", [p.owner]);
    const u = { id: row.id, userId: row.user_id, plan: row.plan, billing: row.billing, trialEnds: row.trial_ends, paidUntil: row.paid_until_day, planRequest: row.plan_request, planRequestAt: row.plan_request_at };
    let from;
    let to;
    if (p.kind === 'upgrade') {
      from = today();
      to = u.paidUntil && u.paidUntil >= from ? u.paidUntil : periodEnd(from, p.billing);
      await db.query("UPDATE users SET plan = 'premium', plan_request = NULL, plan_request_at = NULL, paid_until = GREATEST(COALESCE(paid_until, $2::date), $2::date) WHERE id = $1", [u.id, to]);
    } else {
      from = nextStart(u);
      to = periodEnd(from, p.billing);
      if (from <= today()) {
        await db.query('UPDATE users SET plan = $2, billing = $3, paid_until = $4, plan_request = NULL, plan_request_at = NULL WHERE id = $1', [u.id, p.plan, p.billing, to]);
      } else {
        // Already paid or on trial until then: the new plan starts on its first day.
        await db.query(
          `UPDATE users SET billing = $3, paid_until = $4, plan = CASE WHEN plan IN ('standard', 'premium') THEN plan ELSE $2 END,
             plan_request = $2, plan_request_at = ($5::date)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id = $1`,
          [u.id, p.plan, p.billing, to, from],
        );
      }
    }
    await db.query('LOCK TABLE plan_payments IN SHARE ROW EXCLUSIVE MODE');
    const year = today().slice(0, 4);
    const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM plan_payments WHERE receipt_no LIKE $1", [`PIT-${year}-%`]);
    const receipt = `PIT-${year}-${String(n.n + 1).padStart(4, '0')}`;
    await db.query(
      "UPDATE plan_payments SET status = 'confirmed', period_from = $2, period_to = $3, receipt_no = $4, decided_at = now(), decided_by = $5 WHERE id = $1",
      [id, from, to, receipt, actor],
    );
    await log(db, u.id, actor, 'payment.confirm', `${receipt}: ${p.plan} ${p.billing} ₹${p.amount}, ${from} to ${to}`);
    return { ok: true, receipt, from, to, owner: u.id, shop: u.userId };
  });
}

async function rejectPayment(id, actor, note) {
  const { rows } = await query(
    "UPDATE plan_payments SET status = 'rejected', note = $3, decided_at = now(), decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING owner",
    [id, actor, note || null],
  );
  if (!rows[0]) return { error: 'This payment is not waiting any more', code: 409 };
  await log({ query }, rows[0].owner, actor, 'payment.reject', note || null);
  return { ok: true, owner: rows[0].owner };
}

// The admin records money received another way (cash, bank, or UPI seen in the bank app).
async function recordPayment(owner, actor, body) {
  const plan = PRICES[body.plan] ? body.plan : null;
  const billing = ['monthly', 'yearly'].includes(body.billing) ? body.billing : null;
  if (!plan || !billing) return { error: 'Choose a plan and monthly or yearly' };
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000000) return { error: 'Enter the amount received in rupees' };
  const mode = ['upi', 'cash', 'bank', 'other'].includes(body.mode) ? body.mode : 'upi';
  const note = String(body.note || '').trim().slice(0, 200);
  const utr = String(body.utr || '').replace(/\s/g, '').toUpperCase().slice(0, 30);
  const { rows } = await query(
    "INSERT INTO plan_payments (owner, kind, plan, billing, amount, mode, utr, note) VALUES ($1, 'renew', $2, $3, $4, $5, $6, $7) RETURNING id",
    [owner, plan, billing, amount, mode, utr || null, note || null],
  );
  return confirmPayment(rows[0].id, actor);
}

async function changePlan(owner, actor, plan) {
  if (!PRICES[plan]) return { error: 'Choose Standard or Premium' };
  const { rowCount } = await query("UPDATE users SET plan = $2, plan_request = NULL, plan_request_at = NULL WHERE id = $1 AND role = 'user'", [owner, plan]);
  if (!rowCount) return { error: 'User not found', code: 404 };
  await log({ query }, owner, actor, 'plan.change', plan);
  return { ok: true };
}

async function extendTrial(owner, actor, days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 90) return { error: 'Enter 1 to 90 days' };
  const { rowCount } = await query(
    "UPDATE users SET trial_ends = GREATEST(COALESCE(trial_ends, now()), now()) + make_interval(days => $2) WHERE id = $1 AND role = 'user'",
    [owner, n],
  );
  if (!rowCount) return { error: 'User not found', code: 404 };
  await log({ query }, owner, actor, 'trial.extend', `${n} days`);
  return { ok: true };
}

// ---- The admin's billing page ----
async function billing(shops) {
  const { rows: pending } = await query(
    `SELECT ${PAY_COLUMNS}, u.user_id FROM plan_payments p JOIN users u ON u.id = p.owner WHERE p.status = 'pending' ORDER BY p.id`,
  );
  const { rows: recent } = await query(
    `SELECT ${PAY_COLUMNS}, u.user_id FROM plan_payments p JOIN users u ON u.id = p.owner WHERE p.status = 'confirmed' ORDER BY p.decided_at DESC LIMIT 30`,
  );
  const { rows: months } = await query(
    `SELECT to_char(decided_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month, sum(amount)::int AS total, count(*)::int AS count
     FROM plan_payments WHERE status = 'confirmed' AND decided_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1 DESC`,
  );
  const active = shops.filter(s => s.plan.status === 'active');
  const counts = { trial: 0, active: 0, grace: 0, readonly: 0, standard: 0, premium: 0 };
  for (const s of shops) {
    counts[s.plan.status] += 1;
    if (s.plan.status === 'active' || s.plan.status === 'grace') counts[s.plan.plan] += 1;
  }
  return {
    pending: pending.map(fromPayment),
    recent: recent.map(fromPayment),
    months,
    counts,
    dueSoon: shops.filter(s => ['active', 'trial'].includes(s.plan.status) && s.plan.daysLeft <= 7).map(s => ({ id: s.id, userId: s.userId, ...s.plan })),
    overdue: shops.filter(s => ['grace', 'readonly'].includes(s.plan.status)).map(s => ({ id: s.id, userId: s.userId, ...s.plan })),
    activeShops: active.length,
    upi: upi(),
  };
}

// ---- Receipts ----
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDay = day => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

async function receipt(id, owner) {
  const { rows: [p] } = await query(
    `SELECT ${PAY_COLUMNS}, u.user_id, u.phone FROM plan_payments p JOIN users u ON u.id = p.owner
     WHERE p.id = $1 AND p.status = 'confirmed' AND ($2::text IS NULL OR p.owner = $2)`,
    [id, owner || null],
  );
  if (!p) return null;
  const gstin = (process.env.GSTIN || '').trim();
  const name = { standard: 'Standard', premium: 'Premium' }[p.plan];
  const what = p.kind === 'upgrade' ? `Upgrade to Premium (${longDay(p.period_from)} to ${longDay(p.period_to)})` : `eThunaivan ${name} plan, ${p.billing} (${longDay(p.period_from)} to ${longDay(p.period_to)})`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(p.receipt_no)}</title>
<style>
body{margin:0;background:#f3edde;color:#0b0f0d;font:400 16px/1.5 system-ui,sans-serif}
.sheet{max-width:640px;margin:32px auto;background:#fffdf8;border:1px solid #d9d0bb;border-radius:12px;padding:32px}
h1{margin:0 0 4px;font-size:26px;color:#1f2a1f}.muted{color:#535e52;font-size:14px;margin:0}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #1f2a1f;padding-bottom:16px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:10px 0;border-bottom:1px solid #d9d0bb;vertical-align:top}
th{font-size:13px;color:#535e52;font-weight:600}.amt{text-align:right;white-space:nowrap}.total td{font-weight:700;font-size:18px;border-bottom:0}
.stamp{display:inline-block;margin-top:12px;padding:4px 12px;border:2px solid #2a7d46;color:#2a7d46;border-radius:6px;font-weight:700;letter-spacing:.05em}
button{margin:0 auto 32px;display:block;padding:10px 20px;border:0;border-radius:8px;background:#1f2a1f;color:#fff;font:inherit;font-weight:600;cursor:pointer}
@media print{body{background:#fff}.sheet{border:0;margin:0}button{display:none}}
</style></head><body>
<div class="sheet">
  <div class="top">
    <div><h1>Palaniyandavar Info Tech</h1><p class="muted">eThunaivan${gstin ? ` · GSTIN ${esc(gstin)}` : ''}</p></div>
    <div><p class="muted">${gstin ? 'Tax invoice' : 'Receipt'} no.</p><b>${esc(p.receipt_no)}</b><p class="muted">${esc(new Date(p.decided_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }))}</p></div>
  </div>
  <p class="muted">Received from</p>
  <p style="margin:0 0 8px"><b>${esc(p.user_id)}</b>${p.phone ? ` · +91 ${esc(p.phone)}` : ''}</p>
  <table>
    <tr><th>Description</th><th class="amt">Amount</th></tr>
    <tr><td>${esc(what)}</td><td class="amt">₹${p.amount.toLocaleString('en-IN')}</td></tr>
    <tr class="total"><td>Total paid</td><td class="amt">₹${p.amount.toLocaleString('en-IN')}</td></tr>
  </table>
  <p class="muted">Paid by ${esc({ upi: 'UPI', cash: 'cash', bank: 'bank transfer', other: 'other' }[p.mode])}${p.utr ? `, reference ${esc(p.utr)}` : ''}.</p>
  <span class="stamp">PAID</span>
</div>
<button onclick="print()">Print or save as PDF</button>
</body></html>`;
}

// ---- Reminders in the shop's inbox ----
// 7, 3 and 1 days before the end, when grace starts, and when it turns read-only.
// Each one once, for that end date.
async function sendReminders(list) {
  for (const u of list) {
    const s = status(u);
    let key = null;
    if (['active', 'trial'].includes(s.status) && [7, 3, 1].includes(s.daysLeft)) key = `ends-${s.daysLeft}`;
    else if (s.status === 'grace') key = 'grace';
    else if (s.status === 'readonly' && s.endsOn) key = 'readonly';
    if (!key) continue;
    const { rowCount } = await query("SELECT 1 FROM plan_events WHERE owner = $1 AND event = $2 AND detail = $3", [u.id, `reminder.${key}`, s.endsOn]);
    if (rowCount) continue;
    const what = s.status === 'trial' ? 'Your free trial' : 'Your plan';
    const [title, body] = key.startsWith('ends')
      ? [`${what} ends in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`, `${what} ends on ${longDay(s.endsOn)}. Open My plan to pay and keep everything working.\n\nஉங்கள் திட்டம் ${longDay(s.endsOn)} அன்று முடிகிறது. தொடர்ந்து பயன்படுத்த "என் திட்டம்" பக்கத்தில் பணம் செலுத்தவும்.`]
      : key === 'grace'
        ? [`${what} has ended`, `Everything still works until ${longDay(s.graceEnds)}. After that the site becomes read-only until you pay. Open My plan to renew.\n\nஉங்கள் திட்டம் முடிந்தது. ${longDay(s.graceEnds)} வரை அனைத்தும் வேலை செய்யும்; அதன் பிறகு பார்க்க மட்டுமே முடியும். "என் திட்டம்" பக்கத்தில் புதுப்பிக்கவும்.`]
        : ['Your account is read-only', 'You can still see and search your customers, but not add or change anything. Open My plan to renew; everything comes back at once. Nothing has been deleted.\n\nஉங்கள் கணக்கு இப்போது பார்க்க மட்டும். பணம் செலுத்தியதும் அனைத்தும் உடனே திரும்ப வரும். எதுவும் நீக்கப்படவில்லை.'];
    await query("INSERT INTO notices (kind, title, body, target, important) VALUES ('notice', $1, $2, $3, true)", [title, body, u.id]);
    await query("INSERT INTO plan_events (owner, actor, event, detail) VALUES ($1, 'system', $2, $3)", [u.id, `reminder.${key}`, s.endsOn]);
  }
}

module.exports = {
  PRICES, PREMIUM, GRACE_DAYS, status, allows, canChange, upi, qrFile, quote, paymentsOf, requestPayment, cancelPayment,
  confirmPayment, rejectPayment, recordPayment, changePlan, extendTrial, billing, receipt, sendReminders, today,
};
