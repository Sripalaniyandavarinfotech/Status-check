// CRM server: customers, status lookups and automatic checks.
// Each status source (certificate, smart card, voter, ...) is a provider in ./providers.
require('./lib/env'); // settings from .env
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { byId, publicList, isValidNumber } = require('./providers');
const whatsapp = require('./lib/whatsapp');
const db = require('./lib/db');
const os = require('os');
const users = require('./lib/users');
const customers = require('./lib/customers');
const aadhaar = require('./lib/aadhaar');
const operators = require('./lib/operators');
const epan = require('./lib/epan');
const notices = require('./lib/notices');
const ttdApi = require('./lib/ttd-api');
const ttd = require('./lib/ttd');
const activity = require('./lib/activity');
const mail = require('./lib/mail');
const money = require('./lib/money');
const followups = require('./lib/followups');
const renewals = require('./lib/renewals');
const monthly = require('./lib/monthly');
const plans = require('./lib/plans');
const cases = require('./lib/cases');

const PORT = process.env.PORT || 3000;

// Accepts 10-digit Indian numbers with or without +91 / 0 prefix; stores as 91XXXXXXXXXX.
function normalizeWhatsapp(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return /^91[6-9]\d{9}$/.test(d) ? d : null;
}

// An error the person can be told about, with the status code to answer with.
const httpError = (status, message) => Object.assign(new Error(message), { status });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', d => {
      if (tooBig) return; // keep reading so the error can still be delivered
      data += d;
      if (data.length > 1e6) {
        tooBig = true;
        data = '';
        reject(httpError(413, 'That is too large to send'));
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, 'The server could not read that request'));
      }
    });
    req.on('error', reject);
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

function setStatus(c, status, found) {
  const now = new Date().toISOString();
  if (c.lastChecked && c.status !== status) {
    c.previousStatus = c.status;
    c.statusChangedAt = now;
  }
  c.lastChecked = now;
  c.found = found;
  c.status = status;
}

// A problem on the government website, not on this server.
async function lookup(provider, number) {
  try {
    return await provider.lookup(number);
  } catch (e) {
    throw httpError(502, e.message || 'The government website did not answer');
  }
}

// Government pages sometimes pad text with long runs of dots or dashes
// ("Recommended ........"). Those runs are dropped, and the spaces tidied.
const tidyText = text => String(text || '').replace(/([.\-_=*~·…])\1{3,}/g, ' ').replace(/\s{2,}/g, ' ').trim();

async function refreshCustomer(c) {
  const provider = byId[c.type];
  if (!provider) throw new Error(`Unknown service type "${c.type}"`);
  const r = await lookup(provider, c.applicationNo);
  setStatus(c, r.found ? r.status : r.message, r.found);
  c.service = tidyText(r.title) || c.service || '';
  c.remarks = tidyText(r.remarks);
  return c;
}

async function notifyCustomer(c) {
  const rec = await whatsapp.sendStatusUpdate(c, byId[c.type]?.name || c.type);
  c.notifications = [rec, ...(c.notifications || [])].slice(0, 20);
  if (rec.ok && rec.mode === 'live') c.notifyDue = false; // test mode reaches nobody, so keep waiting
  await customers.addNotification(c.id, rec, c.notifyDue);
  return rec;
}

// Final results of a manual stage: the only ones "Send WhatsApp updates" sends.
const isFinal = status => /approved|accepted|e-?roll updated|reject/i.test(status);
const wasSent = (c, status) => (c.notifications || []).some(n => n.ok && ['live', 'chat'].includes(n.mode) && n.status === status);

// An email from UTIITSL or Protean moved a PAN application on. A stage never goes
// backwards, and only Approved puts the customer on the WhatsApp list.
// False when no PAN customer of this user has the number.
const PAN_STEPS = { Submitted: 1, 'In Process': 2, Approved: 3 };
async function panEmail(owner, number, stage, note, date) {
  if (!plans.allows(await users.planOf(owner), 'epan')) return false; // e-PAN email reading is Premium
  const found = (await db.query("SELECT id FROM customers WHERE owner = $1 AND type = 'pan' AND application_no = $2", [owner, number])).rows[0];
  if (!found) return false;
  const customer = await customers.find(found.id);
  const now = PAN_STEPS[customer.status] ?? (!customer.status ? 0 : isFinal(customer.status) ? 3 : 1);
  if (PAN_STEPS[stage] <= now) return true; // already there, by hand or by an earlier email
  setStatus(customer, stage, true);
  customer.remarks = note;
  customer.informed = false;
  customer.notifyDue = isFinal(stage) && !wasSent(customer, stage);
  await customers.saveStatus(customer);
  const when = date ? new Date(date).toLocaleDateString('en-GB', { timeZone: TZ }) : '';
  await activity.log({ actor: { userId: 'PAN email' }, action: 'customer.status', owner, detail: `${customer.name} (${number}): ${stage}${when ? `, email of ${when}` : ''}` });
  return true;
}

// Looks up one customer, saves the result, and messages them on WhatsApp if the
// status moved to a new stage.
async function refreshAndSave(id, actor) {
  const customer = await customers.find(id);
  if (!customer) return null;
  const before = customer.status;
  const wasChecked = !!customer.lastChecked;
  await refreshCustomer(customer);
  if (customer.status !== before) customer.informed = false; // there is new news to tell them
  if (!await customers.saveStatus(customer)) return null; // deleted while checking
  if (customer.status !== before) await activity.log({ actor, action: 'customer.status', owner: customer.owner, detail: `${customer.name} (${customer.applicationNo}): ${customer.status}` });
  // Not on the very first check (that's the starting point), and not for "not found".
  if (wasChecked && customer.found && customer.status !== before) {
    // Messages sent by the WhatsApp API on their own are Premium. Other shops send
    // them from their own WhatsApp with one click, so the customer waits in that list.
    if (whatsapp.mode() === 'live' && !plans.allows(await users.planOf(customer.owner), 'autoWhatsapp')) {
      customer.notifyDue = !customer.informed && !wasSent(customer, customer.status);
      await customers.saveStatus(customer);
    } else await notifyCustomer(customer);
  }
  return customer;
}

// Sends the waiting manual updates one by one, saving after each so a failure
// part way through can't send anyone a second message.
const sendingUpdates = new Set(); // users whose updates are going out now
async function sendWaitingUpdates(owner, type) {
  const result = { sent: 0, failed: 0, test: 0, error: '' };
  for (const id of await customers.waitingIds(owner, type)) {
    const customer = await customers.find(id);
    if (!customer?.notifyDue) continue;
    const rec = await notifyCustomer(customer);
    if (!rec.ok) {
      result.failed++;
      result.error = rec.error;
    } else if (rec.mode === 'test') result.test++;
    else result.sent++;
  }
  return result;
}

// ---- Automatic checks: every customer, one by one, at fixed times each day (India time) ----
const CHECK_TIMES = (process.env.CHECK_TIMES || '09:00,13:00,17:00,21:00').split(',').map(s => s.trim()).filter(Boolean);
const GAP_MS = Number(process.env.CHECK_GAP_SECONDS || 5) * 1000; // pause between customers
const TZ = 'Asia/Kolkata';

let progress = null; // { owners: { id: { done, total } } } while a run is in progress

// Current date and HH:MM in India time.
function istNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function nextRunLabel() {
  const { time } = istNow();
  const sorted = [...CHECK_TIMES].sort();
  const next = sorted.find(t => t > time);
  return next ? `Today ${next}` : `Tomorrow ${sorted[0]}`;
}

// With `onlyOwner`, one user's "Run check now"; without it, every active user.
// Suspended users are skipped, and one suspended part way through a run stops there.
async function runAllChecks(trigger, onlyOwner) {
  if (progress) return false;
  progress = { owners: {} };
  try {
    const types = Object.values(byId).filter(p => p.ready).map(p => p.id);
    const due = await customers.dueForChecks(types, onlyOwner);
    const startedAt = new Date().toISOString();
    const runs = {}; // this run's result for each user
    for (const c of due) {
      runs[c.owner] ||= { trigger, startedAt, total: 0, checked: 0, changed: [], failed: 0 };
      runs[c.owner].total++;
      progress.owners[c.owner] ||= { done: 0, total: 0 };
      progress.owners[c.owner].total++;
    }
    console.log(`[auto-check] ${trigger}: checking ${due.length} customers one by one`);

    for (const [i, { id, owner }] of due.entries()) {
      if (await users.isActive(owner) && plans.canChange(await users.planOf(owner))) {
        const run = runs[owner];
        try {
          const c = await refreshAndSave(id);
          if (c) {
            run.checked++;
            if (c.statusChangedAt && c.statusChangedAt >= startedAt) run.changed.push({ name: c.name, applicationNo: c.applicationNo, from: c.previousStatus, to: c.status });
          }
        } catch (e) {
          run.failed++;
          console.error(`[auto-check] ${id}: ${e.message}`);
        }
        if (i < due.length - 1) await new Promise(r => setTimeout(r, GAP_MS));
      }
      progress.owners[owner].done++;
    }

    const finishedAt = new Date().toISOString();
    for (const [owner, run] of Object.entries(runs)) await customers.saveRun(owner, { ...run, finishedAt });
    console.log(`[auto-check] done: ${due.length} customers`);
  } finally {
    progress = null;
  }
  return true;
}

// Tick every 30s; run each slot at most once per day.
setInterval(async () => {
  const { date, time } = istNow();
  try {
    if (CHECK_TIMES.includes(time) && await customers.claimSlot(`${date} ${time}`)) await runAllChecks(`Scheduled ${time}`);
  } catch (e) {
    console.error('[auto-check]', e.message);
  }
}, 30000);

// /api/plan: where the shop stands, what it would pay, "I have paid", receipts.
async function planApi(req, res, url, user) {
  const [, , , section, id, action] = url.pathname.split('/');
  const fresh = await users.planOf(user.id);
  if (req.method === 'GET' && !section) {
    return send(res, 200, {
      ...plans.status(fresh), prices: plans.PRICES, premium: plans.PREMIUM, graceDays: plans.GRACE_DAYS, upi: plans.upi(),
      payments: await plans.paymentsOf(user.id),
      quotes: {
        standard: { monthly: plans.quote(fresh, { plan: 'standard', billing: 'monthly' }), yearly: plans.quote(fresh, { plan: 'standard', billing: 'yearly' }) },
        premium: { monthly: plans.quote(fresh, { plan: 'premium', billing: 'monthly' }), yearly: plans.quote(fresh, { plan: 'premium', billing: 'yearly' }) },
        upgrade: plans.quote(fresh, { kind: 'upgrade' }),
      },
    });
  }
  if (req.method === 'GET' && section === 'qr') {
    const file = plans.qrFile();
    if (!file) return send(res, 404, { error: 'No QR code saved yet' });
    res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'GET' && section === 'receipt' && /^[0-9]{1,18}$/.test(id || '')) {
    const html = await plans.receipt(id, user.id);
    if (!html) return send(res, 404, { error: 'Receipt not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (req.method === 'POST' && section === 'pay') {
    const key = `plan-pay|${user.id}`;
    if (users.limited(key, 10)) return send(res, 429, { error: 'Too many tries. Wait an hour and try again.' });
    users.countTry(key, 60 * 60 * 1000);
    const result = await plans.requestPayment(fresh, await readBody(req));
    if (result.error) return send(res, result.code || 400, { error: result.error });
    await activity.log({ actor: user, action: 'plan.pay', owner: user.id });
    return send(res, 201, result);
  }
  if (req.method === 'POST' && section === 'cancel' && /^[0-9]{1,18}$/.test(id || '')) {
    if (!await plans.cancelPayment(user.id, id)) return send(res, 409, { error: 'This payment is not waiting any more' });
    return send(res, 200, { ok: true });
  }
  void action;
  return send(res, 404, { error: 'Not found' });
}

// Plan reminders in the shop inboxes, checked twice an hour.
setInterval(async () => {
  try {
    const shops = (await users.forAdmin()).filter(u => u.status === 'active');
    await plans.sendReminders(shops);
  } catch (e) {
    console.error('[plan reminders]', e.message);
  }
}, 30 * 60 * 1000);

// Sends a month's report to the shop's own email address, by hand from /report.
async function emailReport(req, res, user) {
  const body = await readBody(req);
  const ym = monthly.validMonth(body.month) ? body.month : monthly.lastMonth();
  const email = (await users.profile(user.id))?.email;
  if (!email) return send(res, 400, { error: 'Add an email address to your profile first' });
  const key = `report|${user.id}`;
  if (users.limited(key, 5)) return send(res, 429, { error: 'Too many tries. Wait an hour and try again.' });
  users.countTry(key, 60 * 60 * 1000);
  const report = await monthly.build(user.id, ym);
  try {
    await mail.sendReport(email, `eThunaivan report: ${monthly.monthName(ym)}`, monthly.text(report, user.userId));
  } catch (e) {
    console.error('[report email]', e.message);
    return send(res, 502, { error: 'The email could not be sent. Please try again later.' });
  }
  await activity.log({ actor: user, action: 'report.email', owner: user.id, detail: monthly.monthName(ym) });
  return send(res, 200, { ok: true, email });
}

// On the 1st of each month at 08:00 (India time), last month's report goes to every
// active shop with an email address. Each shop and month is sent once.
async function sendMonthlyReports() {
  const ym = monthly.lastMonth();
  const { rows } = await db.query(
    `SELECT u.id, u.user_id, u.email FROM users u WHERE u.role = 'user' AND u.status = 'active' AND u.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM monthly_sent m WHERE m.owner = u.id AND m.month = $1)`,
    [ym],
  );
  for (const u of rows) {
    let error = null;
    try {
      const report = await monthly.build(u.id, ym);
      await mail.sendReport(u.email, `eThunaivan report: ${monthly.monthName(ym)}`, monthly.text(report, u.user_id));
    } catch (e) {
      error = e.message.slice(0, 300);
      console.error(`[monthly report] ${u.user_id}: ${error}`);
    }
    await db.query('INSERT INTO monthly_sent (owner, month, ok, error) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [u.id, ym, !error, error]);
    await new Promise(r => setTimeout(r, 3000)); // one at a time
  }
  if (rows.length) console.log(`[monthly report] ${ym}: ${rows.length} shops`);
}

let sendingReports = false;
setInterval(() => {
  const { date, time } = istNow();
  if (date.endsWith('-01') && time >= (process.env.REPORT_TIME || '08:00') && !sendingReports) {
    sendingReports = true;
    sendMonthlyReports().catch(e => console.error('[monthly report]', e.message)).finally(() => { sendingReports = false; });
  }
}, 60000);

// Every action here works only on the signed-in user's own customers.
async function customersApi(req, res, url, user) {
  const [, , , id, action, noteId] = url.pathname.split('/');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const label = c => `${c.name} (${c.applicationNo})`;
  const record = (action, detail) => activity.log({ actor: user, action, owner: user.id, detail });
  const box = url.searchParams.get('type');
  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const kind = ['New', 'Correction'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : null;
  const agency = ['UTI', 'NSDL'].includes(url.searchParams.get('agency')) ? url.searchParams.get('agency') : null;

  if (req.method === 'GET' && !id) {
    return send(res, 200, await customers.page(user.id, { type: box, view: url.searchParams.get('view'), q: search, kind, agency, page: url.searchParams.get('page') }));
  }
  if (req.method === 'GET' && id === 'summary') return send(res, 200, await customers.summary(user.id, box, search, kind, agency));
  if (req.method === 'GET' && id === 'export') return send(res, 200, await customers.exportBox(user.id, box));
  if (req.method === 'GET' && id === 'by-phone') {
    const number = normalizeWhatsapp(url.searchParams.get('whatsapp'));
    if (!number) return send(res, 400, { error: 'Enter a valid 10-digit WhatsApp number' });
    return send(res, 200, await customers.byPhone(user.id, number));
  }

  // Checks a customer's details, for adding and editing. Returns the cleaned values.
  // PAN also needs the agency: a new customer's from the form, an existing one's stays.
  function details(type, keptAgency) {
    const provider = byId[type];
    const name = String(body.name || '').trim();
    const typedNo = String(body.applicationNo || '').trim().toUpperCase();
    const panAgency = type === 'pan' ? keptAgency || String(body.panAgency || '') : null;
    if (type === 'pan' && !provider.agencies[panAgency]) throw httpError(400, 'Choose UTI or NSDL');
    const rules = type === 'pan' ? { ...provider, ...provider.agencies[panAgency] } : provider;
    const applicationNo = panAgency === 'UTI' ? typedNo.replace(/^U-/, '') : typedNo; // UTI numbers are kept without the U-
    const whatsappNo = normalizeWhatsapp(body.whatsapp);
    const aadhaarNo = String(body.aadhaar || '').replace(/[\s-]/g, '');
    if (!provider) throw httpError(400, 'Choose a service type');
    if (!name || name.length > 200) throw httpError(400, 'Name is required');
    if (!isValidNumber(rules, applicationNo)) throw httpError(400, `Enter a valid ${rules.numberLabel.toLowerCase()}`);
    if (!whatsappNo) throw httpError(400, 'Enter a valid 10-digit WhatsApp number');
    if (aadhaarNo && !aadhaar.isValid(aadhaarNo)) throw httpError(400, 'Enter a valid 12-digit Aadhaar number');
    if (aadhaarNo && !aadhaar.ready()) throw httpError(503, 'Aadhaar numbers cannot be saved until AADHAAR_KEY is set');
    return { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider, panAgency };
  }

  // The application date is on every form. A new customer without one gets today's.
  // New or Correction is on the PAN and TNPDS forms. Date of birth is PAN only.
  // Dates are kept as they appear on the receipt.
  function dateDetails(type, isNew) {
    const appliedOn = String(body.appliedOn || '').trim();
    if (appliedOn && !isDate(appliedOn)) throw httpError(400, 'Enter the application date as DD/MM/YYYY');
    const dates = { appliedOn: appliedOn || (isNew ? new Date().toLocaleDateString('en-GB', { timeZone: TZ }) : '') };
    if (type !== 'pan' && type !== 'smartcard') return dates;
    const panKind = String(body.panKind || '');
    if (panKind && !['New', 'Correction'].includes(panKind)) throw httpError(400, 'Choose New or Correction');
    if (type !== 'pan') return { ...dates, panKind };
    const birthDate = String(body.birthDate || '').trim();
    if (birthDate && !isDate(birthDate)) throw httpError(400, 'Enter the date of birth as DD/MM/YYYY');
    return { ...dates, panKind, birthDate };
  }

  // Stops the same application being entered twice, even in the wrong service.
  async function refuseDuplicate(applicationNo, exceptId) {
    const twin = await customers.sameNumber(user.id, applicationNo, exceptId);
    if (twin) throw httpError(409, `${applicationNo} is already saved for ${twin.name} under ${byId[twin.type]?.name || twin.type}`);
  }

  // Paid or not paid, and the optional amounts: the fee, and "paid now" saved as
  // the first payment.
  function feeDetails() {
    const payment = ['paid', 'unpaid'].includes(body.payment) ? body.payment : null;
    const fee = body.fee === undefined || body.fee === null || body.fee === '' ? null : money.rupees(body.fee);
    if (fee === null && body.fee !== undefined && body.fee !== null && body.fee !== '') throw httpError(400, 'Enter the fee in whole rupees');
    const paid = body.paidNow === undefined || body.paidNow === null || body.paidNow === '' ? 0 : money.rupees(body.paidNow);
    if (paid === null) throw httpError(400, 'Enter the amount paid in whole rupees');
    if (!paid) return { fee, payment, pay: null };
    if (!['cash', 'upi'].includes(body.payMode)) throw httpError(400, 'Choose Cash or UPI');
    return { fee, payment, pay: { amount: paid, mode: body.payMode } };
  }

  async function chosenOperator() {
    const operatorId = String(body.operatorId || '');
    if (!operatorId) return null;
    if (!/^[0-9]{1,18}$/.test(operatorId) || !await operators.owned(operatorId, user.id)) throw httpError(400, 'Choose an operator from your list');
    return operatorId;
  }

  // The full number is never saved in plain text, and the last 4 digits are for display.
  const aadhaarFields = (customerId, number) => (number
    ? { aadhaarLast4: number.slice(-4), aadhaarSealed: aadhaar.seal(number, customerId) }
    : {});

  if (req.method === 'POST' && !id) {
    const { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider, panAgency } = details(body.type);
    await refuseDuplicate(applicationNo);
    const operatorId = await chosenOperator();
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const { fee, payment, pay } = feeDetails();
    const customer = await customers.add({ id: newId, owner: user.id, type: provider.id, name, applicationNo, whatsapp: whatsappNo, operatorId, panAgency, fee, payment, ...dateDetails(provider.id, true), ...aadhaarFields(newId, aadhaarNo) });
    if (!customer) return send(res, 409, { error: `${applicationNo} is already saved under ${provider.name}` });
    await record('customer.add', label(customer));
    if (pay) {
      const t = await money.target(user.id, { customerId: customer.id });
      await money.addPayment(user.id, t, { ...pay, operatorId, by: user.userId });
      await record('money.paid', `${label(customer)}: ₹${pay.amount} ${pay.mode === 'upi' ? 'UPI' : 'cash'}`);
      return send(res, 201, await customers.find(customer.id));
    }
    return send(res, 201, customer);
  }

  if (req.method === 'POST' && id === 'send-updates') {
    if (sendingUpdates.has(user.id)) return send(res, 409, { error: 'Updates are already being sent' });
    sendingUpdates.add(user.id);
    try {
      const result = await sendWaitingUpdates(user.id, byId[body.type] ? body.type : null);
      await record('whatsapp.send', `${result.sent} sent, ${result.failed} failed`);
      return send(res, 200, result);
    } finally {
      sendingUpdates.delete(user.id);
    }
  }

  const customer = await customers.ownedBy(id, user.id);
  if (!customer) return send(res, 404, { error: 'Customer not found' });

  if (req.method === 'DELETE' && !action) {
    await customers.remove(id, user.id);
    await record('customer.delete', label(customer));
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && action === 'notes') {
    const updated = await customers.removeNote(id, noteId);
    await record('note.delete', label(customer));
    return send(res, 200, updated);
  }

  if (req.method === 'POST' && action === 'edit') {
    const { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider } = details(customer.type, customer.panAgency || 'UTI');
    await refuseDuplicate(applicationNo, customer.id);
    const updated = await customers.edit(customer, { name, applicationNo, whatsapp: whatsappNo, operatorId: await chosenOperator(), ...dateDetails(customer.type, false), ...aadhaarFields(customer.id, aadhaarNo) });
    if (!updated) return send(res, 409, { error: `${applicationNo} is already saved under ${provider.name}` });
    await record('customer.edit', label(updated));
    return send(res, 200, updated);
  }

  // Every look at a full number is limited and recorded in the activity log.
  if (req.method === 'POST' && action === 'aadhaar') {
    const key = `aadhaar|${user.id}`;
    if (users.limited(key, 30)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes and try again.' });
    users.countTry(key, 10 * 60 * 1000);
    const sealed = await customers.sealedAadhaar(id);
    if (!sealed) return send(res, 404, { error: 'No Aadhaar number is saved for this customer' });
    let number;
    try {
      number = aadhaar.open(sealed, id);
    } catch {
      return send(res, 500, { error: 'This Aadhaar number cannot be read. Check AADHAAR_KEY.' });
    }
    await record('aadhaar.view', label(customer));
    return send(res, 200, { aadhaar: number });
  }

  if (req.method === 'POST' && action === 'aadhaar-remove') {
    await record('aadhaar.remove', label(customer));
    return send(res, 200, await customers.removeAadhaar(id));
  }

  if (req.method === 'POST' && action === 'notes') {
    const note = String(body.body || '').trim();
    if (!note || note.length > 1000) return send(res, 400, { error: 'Enter a note of up to 1000 characters' });
    const updated = await customers.addNote(id, user.userId, note);
    await record('note.add', label(customer));
    return send(res, 200, updated);
  }

  // Re-send the current status on WhatsApp by hand.
  if (req.method === 'POST' && action === 'notify') {
    if (!customer.lastChecked || !customer.found) return send(res, 400, { error: 'Check the status first' });
    const rec = await notifyCustomer(customer);
    await record('whatsapp.one', label(customer));
    return rec.ok ? send(res, 200, customer) : send(res, 502, { error: rec.error, customer });
  }

  // Staff set the stage by hand for services the CRM can't check itself. Nothing is
  // sent here: approved and rejected customers wait for "Send WhatsApp updates".
  if (req.method === 'POST' && action === 'status') {
    const status = String(body.status || '').trim();
    if (!byId[customer.type]?.manual) return send(res, 400, { error: 'This service is checked automatically' });
    if (!status || status.length > 100) return send(res, 400, { error: 'Enter a status of up to 100 characters' });
    if (status !== customer.status) customer.informed = false; // there is new news to tell them
    setStatus(customer, status, true);
    customer.notifyDue = !customer.informed && isFinal(status) && !wasSent(customer, status);
    await customers.saveStatus(customer);
    await record('customer.status', `${label(customer)}: ${status}`);
    return send(res, 200, customer);
  }

  // The user sends these from their own WhatsApp, so the site only keeps a record.
  if (req.method === 'POST' && action === 'chat-sent') {
    if (!customer.found) return send(res, 400, { error: 'Check the status first' });
    const rec = whatsapp.chatRecord(customer, byId[customer.type]?.name || customer.type);
    await customers.addNotification(id, { ...rec, text: String(body.text || rec.text).slice(0, 1000) }, false);
    await record('whatsapp.one', label(customer));
    return send(res, 200, await customers.find(id));
  }

  if (req.method === 'POST' && action === 'chat-undo') {
    await record('whatsapp.undo', label(customer));
    return send(res, 200, await customers.undoChat(id, body.wasDue === true));
  }

  // Someone told the customer, by WhatsApp or any other way, so nothing is left to send.
  if (req.method === 'POST' && action === 'informed') {
    customer.informed = body.informed === true;
    customer.notifyDue = !customer.informed && !!customer.found && isFinal(customer.status || '') && !wasSent(customer, customer.status);
    await customers.saveStatus(customer);
    await record(customer.informed ? 'customer.informed' : 'customer.not-informed', label(customer));
    return send(res, 200, customer);
  }

  if (req.method === 'POST' && action === 'refresh') {
    const updated = await refreshAndSave(id, user);
    return updated ? send(res, 200, updated) : send(res, 404, { error: 'Customer not found' });
  }

  send(res, 405, { error: 'Not allowed' });
}

// The phone app: accepted and rejected customers to call, and a "Called" tick, which
// is the same as Informed on the website. Nothing else can change from here.
async function callsApi(req, res, url, user) {
  const [, , , id, action] = url.pathname.split('/');
  if (req.method === 'GET' && !id) {
    const type = url.searchParams.get('type');
    if (!byId[type]) return send(res, 400, { error: 'Unknown service type' });
    const view = ['accepted', 'rejected', 'called'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'accepted';
    const agency = type === 'pan' && ['UTI', 'NSDL'].includes(url.searchParams.get('agency')) ? url.searchParams.get('agency') : null;
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    return send(res, 200, await customers.calls(user.id, { type, agency, view, q }));
  }
  if (req.method === 'POST' && id && action === 'called') {
    const body = await readBody(req);
    const customer = await customers.ownedBy(id, user.id);
    if (!customer) return send(res, 404, { error: 'Customer not found' });
    customer.informed = body.called === true;
    customer.notifyDue = !customer.informed && !!customer.found && isFinal(customer.status || '') && !wasSent(customer, customer.status);
    await customers.saveStatus(customer);
    await activity.log({ actor: user, action: customer.informed ? 'customer.informed' : 'customer.not-informed', owner: user.id, detail: `${customer.name} (${customer.applicationNo}), from the phone app` });
    return send(res, 200, { id: customer.id, informed: customer.informed });
  }
  send(res, 405, { error: 'Not allowed' });
}

// ---- Login, registration and the admin panel ----
const COOKIE = 'crm_session';

function sessionToken(req) {
  const found = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  return found ? found.slice(COOKIE.length + 1) : null;
}

// HttpOnly keeps it from scripts; SameSite=Strict keeps other websites from using it.
function sessionCookie(token, maxAgeMs) {
  const secure = process.env.COOKIE_SECURE === 'on' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

const isDate = text => {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1;
};

const publicUser = u => ({ userId: u.userId, role: u.role, app: u.app || null, plan: u.role === 'user' ? plans.status(u) : null });

// Through a tunnel every visitor arrives from this computer, and Cloudflare names
// the real one. Only trusted when the request really came from the local tunnel.
function visitorAddress(req) {
  const from = req.socket.remoteAddress;
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(from);
  const named = process.env.BEHIND_TUNNEL === 'on' && local && req.headers['cf-connecting-ip'];
  return named ? String(named).slice(0, 64) : from;
}

// The customer's own lookup. It needs no login, so it gives away as little as
// possible: the same answer for a wrong number and a wrong WhatsApp number.
async function publicStatus(req, res) {
  const key = `status|${visitorAddress(req)}`;
  if (users.limited(key, 20)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes and try again.' });
  users.countTry(key, 10 * 60 * 1000);
  const body = await readBody(req);
  const applicationNo = String(body.applicationNo || '').trim().toUpperCase().slice(0, 40);
  const number = normalizeWhatsapp(body.whatsapp);
  const found = applicationNo && number ? await customers.publicStatus(applicationNo, number) : null;
  if (!found) return send(res, 200, { found: false });
  return send(res, 200, {
    found: true,
    service: byId[found.type]?.name || found.type,
    status: found.status,
    stage: found.stage,
    updated: found.updated,
  });
}

// Clears a user's own customers. Their password is the proof it is really them.
async function resetData(req, res, user) {
  const key = `reset-data|${user.id}`;
  if (users.limited(key, 5)) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes and try again.' });
  const body = await readBody(req);
  if (!await users.passwordIsRight(user.id, body.password)) {
    users.countTry(key, 15 * 60 * 1000);
    return send(res, 400, { error: 'Your password is wrong' });
  }
  users.clearTries(key);
  if (progress?.owners[user.id] || sendingUpdates.has(user.id)) return send(res, 409, { error: 'Wait for the running check or WhatsApp sending to finish' });
  const removed = await customers.resetOwner(user.id);
  await activity.log({ actor: user, action: 'data.reset', owner: user.id, detail: `${removed} customers removed` });
  send(res, 200, { removed });
}

// The user's list of operators, kept on their Profile page.
async function operatorsApi(req, res, url, user) {
  const id = url.pathname.split('/')[3];
  if (id && !/^[0-9]{1,18}$/.test(id)) return send(res, 404, { error: 'Operator not found' });
  const record = (action, detail) => activity.log({ actor: user, action, owner: user.id, detail });

  if (req.method === 'GET' && !id) return send(res, 200, await operators.list(user.id));

  if (req.method === 'DELETE' && id) {
    if (!await operators.remove(id, user.id)) return send(res, 404, { error: 'Operator not found' });
    await record('operator.remove', '');
    return send(res, 200, { ok: true });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });
  const body = await readBody(req);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) return send(res, 400, { error: 'Enter an operator name of up to 60 characters' });
  const taken = { error: `${name} is already in your list` };

  if (!id) {
    const added = await operators.add(user.id, name);
    if (!added) return send(res, 409, taken);
    await record('operator.add', name);
    return send(res, 201, added);
  }

  const changed = await operators.rename(id, user.id, name);
  if (changed === 'duplicate') return send(res, 409, taken);
  if (!changed) return send(res, 404, { error: 'Operator not found' });
  await record('operator.rename', name);
  return send(res, 200, { id, name });
}

async function authApi(req, res, url) {
  const action = url.pathname.split('/')[3];
  const ip = visitorAddress(req);

  if (req.method === 'GET' && action === 'me') {
    const user = await users.userForToken(sessionToken(req));
    return send(res, 200, { user: user ? publicUser(user) : null });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });

  if (action === 'register') {
    const key = `register|${ip}`;
    if (users.limited(key, 10)) return send(res, 429, { error: 'Too many registrations. Try again later.' });
    const result = await users.register(await readBody(req));
    if (result.error) return send(res, result.code || 400, { error: result.error });
    users.countTry(key, 60 * 60 * 1000);
    return send(res, 201, { ok: true });
  }

  if (action === 'login') {
    const body = await readBody(req);
    const key = `login|${ip}|${String(body.userId || '').trim().toLowerCase()}`;
    if (users.limited(key, 5)) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const result = await users.login(body.userId, body.password, body.area);
    if (result.code === 401) users.countTry(key, 15 * 60 * 1000);
    if (result.error) return send(res, result.code, { error: result.error });
    users.clearTries(key);
    const app = body.app === 'calls' ? 'calls' : null;
    res.setHeader('Set-Cookie', sessionCookie(await users.startSession(result.user.id, app), app ? users.APP_SESSION_MS : users.SESSION_MS));
    await activity.log({ actor: result.user, action: 'login', owner: result.user.id, detail: app ? 'Phone app' : undefined });
    return send(res, 200, { user: publicUser({ ...result.user, app }) });
  }

  // The answer is the same whether or not the account exists, and comes before
  // the email is sent, so nobody can use this to find out who has an account.
  if (action === 'forgot') {
    const body = await readBody(req);
    const ipKey = `forgot|${ip}`;
    const who = String(body.userId || '').trim().toLowerCase();
    send(res, 200, { ok: true });
    if (users.limited(ipKey, 10) || users.limited(`forgot|${who}`, 1)) return;
    users.countTry(ipKey, 60 * 60 * 1000);
    users.countTry(`forgot|${who}`, 5 * 60 * 1000);
    const reset = await users.startReset(who);
    if (reset) mail.sendResetLink(reset.email, reset.userId, reset.token).catch(e => console.error('[reset email]', e.message));
    return;
  }

  if (action === 'reset') {
    const body = await readBody(req);
    const result = await users.finishReset(body.token, body.password);
    return result.error ? send(res, result.code || 400, { error: result.error }) : send(res, 200, { ok: true });
  }

  // Changing your own password logs out your other devices, but not this one.
  if (action === 'password') {
    const user = await users.userForToken(sessionToken(req));
    if (!user) return send(res, 401, { error: 'Please log in' });
    if (user.app) return send(res, 403, { error: 'Change your password on the website' });
    const key = `password|${user.id}`;
    if (users.limited(key, 5)) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const body = await readBody(req);
    const result = await users.changeOwnPassword(user.id, body.current, body.password);
    if (result.error) {
      if (result.error.includes('current')) users.countTry(key, 15 * 60 * 1000);
      return send(res, result.code || 400, { error: result.error });
    }
    users.clearTries(key);
    res.setHeader('Set-Cookie', sessionCookie(await users.startSession(user.id), users.SESSION_MS));
    await activity.log({ actor: user, action: 'password.own', owner: user.id });
    return send(res, 200, { ok: true });
  }

  if (action === 'logout') {
    await users.endSession(sessionToken(req));
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

async function adminApi(req, res, url, admin) {
  const [, , , section, id, action] = url.pathname.split('/'); // /api/admin/users/<id>/<action>
  if (req.method === 'GET' && section === 'activity') return send(res, 200, await activity.forAdmin(Number(url.searchParams.get('page'))));
  if (req.method === 'GET' && section === 'reports') return send(res, 200, await customers.adminReport());
  if (section === 'notices') {
    if (req.method === 'GET' && !id) return send(res, 200, await notices.forAdmin());
    if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });
    if (!id) {
      const form = await readBody(req);
      const result = await notices.send(form);
      if (result.error) return send(res, 400, { error: result.error });
      await activity.log({ actor: admin, action: 'notice.send', target: form.to ? String(form.to).trim().toLowerCase() : null, detail: String(form.title || '').trim().slice(0, 120) });
      return send(res, 201, result);
    }
    if (action === 'delete') {
      const result = await notices.remove(id);
      if (result.error) return send(res, result.code, { error: result.error });
      await activity.log({ actor: admin, action: 'notice.delete' });
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'Not found' });
  }
  if (section === 'billing' && req.method === 'GET') {
    const shops = (await users.forAdmin()).map(u => ({ ...u, plan: plans.status(u) }));
    return send(res, 200, await plans.billing(shops));
  }
  if (section === 'payments' && /^[0-9]{1,18}$/.test(id || '')) {
    if (req.method === 'GET' && action === 'receipt') {
      const html = await plans.receipt(id, null);
      if (!html) return send(res, 404, { error: 'Receipt not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });
    const body = await readBody(req);
    const result = action === 'confirm' ? await plans.confirmPayment(id, admin.userId)
      : action === 'reject' ? await plans.rejectPayment(id, admin.userId, String(body.note || '').trim().slice(0, 200))
        : { error: 'Not found', code: 404 };
    if (result.error) return send(res, result.code || 400, { error: result.error });
    await activity.log({ actor: admin, action: `plan.payment-${action}`, target: await users.userIdOf(result.owner), detail: result.receipt || null });
    return send(res, 200, result);
  }
  if (section !== 'users') return send(res, 404, { error: 'Not found' });
  if (req.method === 'GET' && !id) return send(res, 200, (await users.forAdmin()).map(u => ({ ...u, planState: plans.status(u) })));
  if (req.method === 'POST' && id && ['plan', 'trial', 'payment'].includes(action)) {
    const body = await readBody(req);
    const result = action === 'plan' ? await plans.changePlan(id, admin.userId, body.plan)
      : action === 'trial' ? await plans.extendTrial(id, admin.userId, body.days)
        : await plans.recordPayment(id, admin.userId, body);
    if (result.error) return send(res, result.code || 400, { error: result.error });
    await activity.log({ actor: admin, action: `plan.${action}`, target: await users.userIdOf(id), detail: result.receipt || (body.plan || (body.days ? `${body.days} days` : null)) });
    return send(res, 200, result);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });
  const body = await readBody(req);
  const target = id ? await users.userIdOf(id) : String(body.userId || '').trim().toLowerCase();
  const result = !id ? await users.addUser(body)
    : action === 'password' ? await users.setPassword(id, body.password)
      : action === 'refuse' ? await users.refuse(id)
        : await users.changeStatus(id, action);
  if (result.error) return send(res, result.code || 400, { error: result.error });
  await activity.log({ actor: admin, action: `user.${id ? action : 'add'}`, target });
  return send(res, 200, { ok: true });
}

// The React site from client/, built by `npm run build`.
const PUBLIC = path.join(__dirname, 'dist');
const TYPES = { '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive' };

const PAGES = {
  400: ['Bad request', 'The address could not be understood. Please check it and try again.'],
  403: ['Not allowed', 'You do not have permission to open this page.'],
  404: ['Page not found', 'This page does not exist, or it may have moved.'],
  405: ['Not allowed', 'This page cannot be used that way.'],
  500: ['Something went wrong', 'The server hit a problem. Please try again in a moment.'],
  503: ['Website not ready', 'The website is being updated. Please try again in a moment.'],
};

// A complete page on its own, so it still works if the website files are missing.
function sendPage(res, code) {
  const [title, message] = PAGES[code];
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} - eThunaivan</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#f3edde;color:#0b0f0d;font:400 16px/1.5 system-ui,sans-serif}
header{background:#1f2a1f;color:#fff;padding:18px 24px;font-size:20px;font-weight:700}
main{flex:1;display:grid;place-items:center;padding:24px 16px}
section{width:min(440px,100%);background:#fffdf8;border-radius:12px;padding:28px 24px;text-align:center;box-shadow:0 16px 44px -14px rgba(31,42,31,.45)}
b{display:block;font-size:52px;line-height:1.1;color:#b08d57}
h1{margin:8px 0;font-size:24px;line-height:1.2;color:#1f2a1f}
p{margin:0 0 20px;color:#535e52}
a{display:inline-block;padding:11px 20px;border-radius:8px;background:#1f2a1f;color:#fff;font-weight:600;text-decoration:none}
</style>
</head>
<body>
<header>eThunaivan</header>
<main><section><b>${code}</b><h1>${title}</h1><p>${message}</p><a href="/">Go to home page</a></section></main>
</body>
</html>
`);
}

// Pages the React site handles; everything else must be a real file in dist.
const SITE_PAGES = ['/', '/home', '/aadhaar/name', '/plan', '/admin/billing', '/followups', '/dues', '/renewals', '/report', '/operators', '/tnpds', '/voter', '/aadhaar', '/pan', '/pan/uti', '/pan/nsdl', '/login', '/register', '/forgot', '/reset', '/status', '/activity', '/reports', '/profile', '/admin', '/admin/activity', '/admin/reports', '/admin/profile', '/admin/notices', '/calls', '/ttd', '/ttd/book'];

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendPage(res, 405);
  }
  const page = SITE_PAGES.includes(pathname);
  const file = path.join(PUBLIC, page ? 'index.html' : path.normalize(pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return sendPage(res, 403);
  fs.readFile(file, (err, data) => {
    if (err) return sendPage(res, !page ? 404 : err.code === 'ENOENT' ? 503 : 500); // a page's file missing means it isn't built
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- For search engines: only the public pages ----
function sitemap(res) {
  const base = mail.appUrl();
  const urls = ['/', '/status', '/login', '/register', '/forgot'].map(p => `  <url><loc>${base}${p}</loc></url>`).join('\n');
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
}

function robots(res) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`User-agent: *
Disallow: /api/
Disallow: /admin
Disallow: /reset

Sitemap: ${mail.appUrl()}/sitemap.xml
`);
}

// A write must come from this site's own pages.
function fromOtherSite(req) {
  const origin = req.headers.origin;
  if (!origin || req.method === 'GET') return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendPage(res, 400); // an address that can't be read
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      if (fromOtherSite(req)) return send(res, 403, { error: 'Not allowed' });
      if (url.pathname.startsWith('/api/auth/')) return await authApi(req, res, url);
      if (url.pathname === '/api/public/status' && req.method === 'POST') return await publicStatus(req, res);

      const user = await users.userForToken(sessionToken(req));
      if (!user) return send(res, 401, { error: 'Please log in' });

      // The phone app only reads lists and marks calls. Hiding buttons isn't enough,
      // so its session can't reach anything else, whoever sends the request.
      if (user.app === 'calls') {
        if (user.role !== 'user') return send(res, 403, { error: 'The admin account has no customers' });
        if (!plans.allows(user, 'calls')) return send(res, 402, { error: 'The phone app is part of the Premium plan. Renew or upgrade on the website, under My plan.', code: 'premium' });
        if (url.pathname === '/api/providers' && req.method === 'GET') return send(res, 200, publicList());
        if (url.pathname === '/api/calls' || url.pathname.startsWith('/api/calls/')) return await callsApi(req, res, url, user);
        return send(res, 403, { error: 'The phone app can only show lists. Use the website for this.' });
      }

      if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/admin') {
        return user.role === 'admin' ? await adminApi(req, res, url, user) : send(res, 403, { error: 'Admins only' });
      }
      if (url.pathname === '/api/profile') return send(res, 200, await users.profile(user.id));
      if (user.role !== 'user') return send(res, 403, { error: 'The admin account has no customers' });

      if (url.pathname === '/api/providers') return send(res, 200, publicList());

      // The shop's plan, and paying for it. These work even when the plan has ended.
      if (url.pathname === '/api/plan' || url.pathname.startsWith('/api/plan/')) return await planApi(req, res, url, user);
      // A plan that has ended leaves the site read-only: looking, searching and CSV work,
      // changes don't. Premium parts need Premium. The server decides, not the buttons.
      const writing = req.method !== 'GET';
      if (writing && !plans.canChange(user) && url.pathname !== '/api/inbox/read') {
        return send(res, 402, { error: 'Your plan has ended. Renew under My plan to continue. Nothing has been deleted.', code: 'readonly' });
      }
      if ((url.pathname === '/api/calls' || url.pathname.startsWith('/api/calls/')) && !plans.allows(user, 'calls')) {
        return send(res, 402, { error: 'The phone list is part of the Premium plan.', code: 'premium' });
      }
      if ((url.pathname === '/api/ttd' || url.pathname.startsWith('/api/ttd/')) && writing && !plans.allows(user, 'ttd')) {
        return send(res, 402, { error: 'The TTD booking helper is part of the Premium plan. Your saved bookings can still be seen.', code: 'premium' });
      }
      if (writing && whatsapp.mode() === 'live' && !plans.allows(user, 'autoWhatsapp') && (url.pathname === '/api/customers/send-updates' || /^\/api\/customers\/[^/]+\/notify$/.test(url.pathname))) {
        return send(res, 402, { error: 'Sending through the WhatsApp API is part of the Premium plan. Use Send on WhatsApp instead.', code: 'premium' });
      }
      // The shop's notice inbox: news, updates and price changes from the admin.
      if (url.pathname === '/api/inbox' && req.method === 'GET') return send(res, 200, await notices.forUser(user.id));
      if (url.pathname === '/api/inbox/read' && req.method === 'POST') {
        const body = await readBody(req);
        await notices.markRead(user.id, body.ids);
        return send(res, 200, await notices.forUser(user.id));
      }
      if (url.pathname === '/api/activity') return send(res, 200, await activity.forUser(user.id, Number(url.searchParams.get('page'))));
      if (url.pathname === '/api/reports') return send(res, 200, await customers.report(user.id));
      if (url.pathname === '/api/reports/operators') return send(res, 200, await customers.operatorReport(user.id));
      if (url.pathname === '/api/nav-counts') {
        const counts = await customers.navCounts(user.id);
        const owed = await money.dues(user.id);
        counts['/followups'] = { n: await followups.dueCount(user.id), due: 0 };
        counts['/dues'] = { n: owed.length, due: 0 };
        counts['/renewals'] = { n: await renewals.dueCount(user.id), due: 0 };
        const nc = await cases.counts(user.id);
        counts['/aadhaar/name'] = { n: nc.open, due: 0 };
        return send(res, 200, counts);
      }
      if (url.pathname === '/api/dashboard') {
        const recent = (await activity.forUser(user.id, 1)).items.slice(0, 6);
        return send(res, 200, {
          ...await customers.dashboard(user.id), recent, ttd: await ttd.summary(user.id),
          money: await money.today(user.id), followUps: (await followups.list(user.id)).due, renewalsDue: await renewals.dueCount(user.id),
          nameChanges: await cases.counts(user.id),
        });
      }
      const helpers = { send, readBody, httpError, activity, operators };
      if (url.pathname.startsWith('/api/money/')) return await money.moneyApi(req, res, url, user, helpers);
      if (url.pathname === '/api/followups' || url.pathname.startsWith('/api/followups/')) return await followups.followupsApi(req, res, url, user, helpers);
      if (url.pathname === '/api/renewals' || url.pathname.startsWith('/api/renewals/')) return await renewals.renewalsApi(req, res, url, user, helpers);
      if (url.pathname === '/api/cases' || url.pathname.startsWith('/api/cases/')) {
        return await cases.casesApi(req, res, url, user, { ...helpers, normalizeWhatsapp, customers, byId, isValidNumber, users });
      }
      if (url.pathname === '/api/report' && req.method === 'GET') {
        const ym = url.searchParams.get('month') || monthly.lastMonth();
        if (!monthly.validMonth(ym)) return send(res, 400, { error: 'Choose a month' });
        const report = await monthly.build(user.id, ym);
        const me = await users.profile(user.id);
        return send(res, 200, { ...report, text: monthly.text(report, user.userId), email: me?.email || null, phone: me?.phone || null });
      }
      if (url.pathname === '/api/report/email' && req.method === 'POST') return await emailReport(req, res, user);

      // /api/status?type=certificate&no=TN-...  (type defaults to certificate)
      if (url.pathname === '/api/status') {
        const provider = byId[url.searchParams.get('type') || 'certificate'];
        const appNo = (url.searchParams.get('no') || '').trim().toUpperCase();
        if (!provider) return send(res, 400, { error: 'Unknown service type' });
        if (!isValidNumber(provider, appNo)) return send(res, 400, { error: `Enter a valid ${provider.numberLabel.toLowerCase()}` });
        return send(res, 200, await lookup(provider, appNo));
      }

      if (url.pathname === '/api/schedule') {
        if (req.method === 'POST') {
          const started = !progress;
          if (started) await activity.log({ actor: user, action: 'check.run', owner: user.id });
          if (started) runAllChecks('Manual', user.id).catch(e => console.error('[auto-check]', e.message));
          return send(res, started ? 202 : 409, started ? { ok: true } : { error: 'A check is already running' });
        }
        return send(res, 200, { times: CHECK_TIMES, timezone: TZ, gapSeconds: GAP_MS / 1000, nextRun: nextRunLabel(), running: progress?.owners[user.id] || null, lastRun: await customers.lastRun(user.id), whatsapp: whatsapp.mode() === 'live' && !plans.allows(user, 'autoWhatsapp') ? 'manual' : whatsapp.mode(), epan: plans.allows(user, 'epan') ? epan.status() : { on: false, premium: true } });
      }

      if (url.pathname === '/api/reset-data' && req.method === 'POST') return await resetData(req, res, user);
      if (url.pathname.startsWith('/api/customers')) return await customersApi(req, res, url, user);
      if (url.pathname === '/api/calls' || url.pathname.startsWith('/api/calls/')) return await callsApi(req, res, url, user);
      if (url.pathname === '/api/operators' || url.pathname.startsWith('/api/operators/')) return await operatorsApi(req, res, url, user);
      if (url.pathname === '/api/ttd' || url.pathname.startsWith('/api/ttd/')) {
        return await ttdApi(req, res, url, user, { send, readBody, httpError, normalizeWhatsapp, activity, users, operators });
      }

      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e.status) return res.headersSent ? undefined : send(res, e.status, { error: e.message }); // a mistake in the request, not a fault
      console.error(url.pathname, e.message);
      if (res.headersSent) return;
      // Everything else is on our side. The detail stays in the server log.
      return send(res, e.code ? 503 : 500, { error: e.code ? 'The database is not responding. Please try again in a moment.' : 'The server hit a problem. Please try again.' });
    }
  }

  // The customers page was merged into the main page.
  if (url.pathname === '/customers') {
    res.writeHead(301, { Location: '/' + url.search });
    return res.end();
  }

  // The Android app checks a shop link with this before opening it. Nothing private.
  if (url.pathname === '/ping.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    return res.end('{"app":"sp-crm"}');
  }
  // The shop's own certificate authority, so phones and computers on the network can
  // trust https://ethunaivan.local once. It is public: it can't log in or read anything.
  if (url.pathname === '/ethunaivan-ca.crt' && req.method === 'GET') {
    const file = path.join(CERT_DIR, 'ca.crt');
    if (!fs.existsSync(file)) return sendPage(res, 404);
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="ethunaivan-ca.crt"', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  if (url.pathname === '/sitemap.xml') return sitemap(res);
  if (url.pathname === '/robots.txt') return robots(res);

  serveStatic(req, res, url.pathname);
}

const server = http.createServer(handle);

// HTTPS as well, once `node create-https-cert.js` has made a certificate.
// Plain http stays on PORT for the phone app and the tunnel.
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const CERT_DIR = path.join(__dirname, 'data', 'https');
function httpsServer() {
  if (process.env.HTTPS === 'off') return null;
  try {
    const key = fs.readFileSync(path.join(CERT_DIR, 'server.key'));
    const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'));
    return https.createServer({ key, cert }, handle);
  } catch {
    return null; // no certificate yet
  }
}

// This computer's addresses on the local network.
function networkAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
}

// A mistake in one request must not stop the site for everyone.
process.on('unhandledRejection', e => console.error('[unexpected]', e));

db.setup().then(() => {
  server.listen(PORT, process.env.HOST || undefined, async () => {
    const at = (scheme, host, port) => `${scheme}://${host}${(scheme === 'http' && String(port) === '80') || (scheme === 'https' && String(port) === '443') ? '' : `:${port}`}`;
    console.log(`CRM running at ${at('http', 'localhost', PORT)}`);
    if (!process.env.HOST) for (const address of networkAddresses()) console.log(`Other devices on your network: ${at('http', address, PORT)}`);
    const secure = httpsServer();
    if (secure) {
      secure.on('error', e => console.error(`HTTPS could not start: ${e.message}`));
      secure.listen(HTTPS_PORT, process.env.HOST || undefined, () => {
        console.log(`Secure (HTTPS): ${at('https', 'localhost', HTTPS_PORT)}`);
        if (!process.env.HOST) for (const address of networkAddresses()) console.log(`Secure on your network: ${at('https', address, HTTPS_PORT)}`);
        if (process.env.LAN_NAME) console.log(`By name on your network: ${at('https', process.env.LAN_NAME, HTTPS_PORT)}`);
      });
    } else if (process.env.HTTPS !== 'off') {
      console.log('For HTTPS, run: node create-https-cert.js');
    }
    if (!await users.hasAdmin()) console.log('No admin yet. Create one with: node create-admin.js');
    if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) console.log('The website is not built yet. Run: npm run build');
    if (epan.start(panEmail)) console.log('Reading e-PAN emails every few minutes');
  });
}).catch(e => {
  console.error(`Could not connect to the database: ${e.message}`);
  process.exit(1);
});
