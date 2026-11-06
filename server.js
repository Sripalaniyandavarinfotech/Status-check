// CRM server: customers, status lookups and automatic checks.
// Each status source (certificate, smart card, voter, ...) is a provider in ./providers.
require('./lib/env'); // settings from .env
const http = require('http');
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
const activity = require('./lib/activity');
const mail = require('./lib/mail');

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

async function refreshCustomer(c) {
  const provider = byId[c.type];
  if (!provider) throw new Error(`Unknown service type "${c.type}"`);
  const r = await lookup(provider, c.applicationNo);
  setStatus(c, r.found ? r.status : r.message, r.found);
  c.service = r.title || c.service || '';
  c.remarks = r.remarks || '';
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
  if (wasChecked && customer.found && customer.status !== before) await notifyCustomer(customer);
  return customer;
}

// Sends the waiting manual updates one by one, saving after each so a failure
// part way through can't send anyone a second message.
const sendingUpdates = new Set(); // users whose updates are going out now
async function sendWaitingUpdates(owner) {
  const result = { sent: 0, failed: 0, test: 0, error: '' };
  for (const id of await customers.waitingIds(owner)) {
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
      if (await users.isActive(owner)) {
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

// Every action here works only on the signed-in user's own customers.
async function customersApi(req, res, url, user) {
  const [, , , id, action, noteId] = url.pathname.split('/');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const label = c => `${c.name} (${c.applicationNo})`;
  const record = (action, detail) => activity.log({ actor: user, action, owner: user.id, detail });
  const box = url.searchParams.get('type');
  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);

  if (req.method === 'GET' && !id) {
    return send(res, 200, await customers.page(user.id, { type: box, view: url.searchParams.get('view'), q: search, page: url.searchParams.get('page') }));
  }
  if (req.method === 'GET' && id === 'summary') return send(res, 200, await customers.summary(user.id, box, search));
  if (req.method === 'GET' && id === 'export') return send(res, 200, await customers.exportBox(user.id, box));

  // Checks a customer's details, for adding and editing. Returns the cleaned values.
  function details(type) {
    const provider = byId[type];
    const name = String(body.name || '').trim();
    const applicationNo = String(body.applicationNo || '').trim().toUpperCase();
    const whatsappNo = normalizeWhatsapp(body.whatsapp);
    const aadhaarNo = String(body.aadhaar || '').replace(/[\s-]/g, '');
    if (!provider) throw httpError(400, 'Choose a service type');
    if (!name || name.length > 200) throw httpError(400, 'Name is required');
    if (!isValidNumber(provider, applicationNo)) throw httpError(400, `Enter a valid ${provider.numberLabel.toLowerCase()}`);
    if (!whatsappNo) throw httpError(400, 'Enter a valid 10-digit WhatsApp number');
    if (aadhaarNo && !aadhaar.isValid(aadhaarNo)) throw httpError(400, 'Enter a valid 12-digit Aadhaar number');
    if (aadhaarNo && !aadhaar.ready()) throw httpError(503, 'Aadhaar numbers cannot be saved until AADHAAR_KEY is set');
    return { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider };
  }

  // Details only the PAN form has. Dates are kept as they appear on the receipt.
  function panDetails(type) {
    if (type !== 'pan') return {};
    const panKind = String(body.panKind || '');
    const birthDate = String(body.birthDate || '').trim();
    const appliedOn = String(body.appliedOn || '').trim();
    if (panKind && !['New', 'Correction'].includes(panKind)) throw httpError(400, 'Choose New or Correction');
    if (birthDate && !isDate(birthDate)) throw httpError(400, 'Enter the date of birth as DD/MM/YYYY');
    if (appliedOn && !isDate(appliedOn)) throw httpError(400, 'Enter the application date as DD/MM/YYYY');
    return { panKind, birthDate, appliedOn };
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
    const { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider } = details(body.type);
    const operatorId = await chosenOperator();
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const customer = await customers.add({ id: newId, owner: user.id, type: provider.id, name, applicationNo, whatsapp: whatsappNo, operatorId, ...panDetails(provider.id), ...aadhaarFields(newId, aadhaarNo) });
    if (!customer) return send(res, 409, { error: `${applicationNo} is already saved under ${provider.name}` });
    await record('customer.add', label(customer));
    return send(res, 201, customer);
  }

  if (req.method === 'POST' && id === 'send-updates') {
    if (sendingUpdates.has(user.id)) return send(res, 409, { error: 'Updates are already being sent' });
    sendingUpdates.add(user.id);
    try {
      const result = await sendWaitingUpdates(user.id);
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
    const { name, applicationNo, whatsapp: whatsappNo, aadhaarNo, provider } = details(customer.type);
    const updated = await customers.edit(customer, { name, applicationNo, whatsapp: whatsappNo, operatorId: await chosenOperator(), ...panDetails(customer.type), ...aadhaarFields(customer.id, aadhaarNo) });
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

const publicUser = u => ({ userId: u.userId, role: u.role });

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
    res.setHeader('Set-Cookie', sessionCookie(await users.startSession(result.user.id), users.SESSION_MS));
    await activity.log({ actor: result.user, action: 'login', owner: result.user.id });
    return send(res, 200, { user: publicUser(result.user) });
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
  if (section !== 'users') return send(res, 404, { error: 'Not found' });
  if (req.method === 'GET' && !id) return send(res, 200, await users.forAdmin());
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
const TYPES = { '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

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
<title>${title} - Sir Palaniyandavar Info Tech</title>
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
<header>Sir Palaniyandavar Info Tech</header>
<main><section><b>${code}</b><h1>${title}</h1><p>${message}</p><a href="/">Go to home page</a></section></main>
</body>
</html>
`);
}

// Pages the React site handles; everything else must be a real file in dist.
const SITE_PAGES = ['/', '/home', '/pan', '/login', '/register', '/forgot', '/reset', '/status', '/activity', '/reports', '/profile', '/admin', '/admin/activity', '/admin/reports', '/admin/profile'];

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

const server = http.createServer(async (req, res) => {
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

      if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/admin') {
        return user.role === 'admin' ? await adminApi(req, res, url, user) : send(res, 403, { error: 'Admins only' });
      }
      if (url.pathname === '/api/profile') return send(res, 200, await users.profile(user.id));
      if (user.role !== 'user') return send(res, 403, { error: 'The admin account has no customers' });

      if (url.pathname === '/api/providers') return send(res, 200, publicList());
      if (url.pathname === '/api/activity') return send(res, 200, await activity.forUser(user.id, Number(url.searchParams.get('page'))));
      if (url.pathname === '/api/reports') return send(res, 200, await customers.report(user.id));

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
        return send(res, 200, { times: CHECK_TIMES, timezone: TZ, gapSeconds: GAP_MS / 1000, nextRun: nextRunLabel(), running: progress?.owners[user.id] || null, lastRun: await customers.lastRun(user.id), whatsapp: whatsapp.mode() });
      }

      if (url.pathname === '/api/reset-data' && req.method === 'POST') return await resetData(req, res, user);
      if (url.pathname.startsWith('/api/customers')) return await customersApi(req, res, url, user);
      if (url.pathname === '/api/operators' || url.pathname.startsWith('/api/operators/')) return await operatorsApi(req, res, url, user);

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

  if (url.pathname === '/sitemap.xml') return sitemap(res);
  if (url.pathname === '/robots.txt') return robots(res);

  serveStatic(req, res, url.pathname);
});

// This computer's addresses on the local network.
function networkAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
}

// A mistake in one request must not stop the site for everyone.
process.on('unhandledRejection', e => console.error('[unexpected]', e));

db.setup().then(() => {
  server.listen(PORT, process.env.HOST || undefined, async () => {
    console.log(`CRM running at http://localhost:${PORT}`);
    if (!process.env.HOST) for (const address of networkAddresses()) console.log(`Other devices on your network: http://${address}:${PORT}`);
    if (!await users.hasAdmin()) console.log('No admin yet. Create one with: node create-admin.js');
    if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) console.log('The website is not built yet. Run: npm run build');
  });
}).catch(e => {
  console.error(`Could not connect to the database: ${e.message}`);
  process.exit(1);
});
