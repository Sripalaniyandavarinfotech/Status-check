// CRM server: customers, status lookups and automatic checks.
// Each status source (certificate, smart card, voter, ...) is a provider in ./providers.
require('./lib/env'); // settings from .env
const http = require('http');
const fs = require('fs');
const path = require('path');
const { byId, publicList, isValidNumber } = require('./providers');
const whatsapp = require('./lib/whatsapp');
const db = require('./lib/db');
const users = require('./lib/users');
const customers = require('./lib/customers');
const mail = require('./lib/mail');

const PORT = process.env.PORT || 3000;

// Accepts 10-digit Indian numbers with or without +91 / 0 prefix; stores as 91XXXXXXXXXX.
function normalizeWhatsapp(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return /^91[6-9]\d{9}$/.test(d) ? d : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', d => {
      data += d;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
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

async function refreshCustomer(c) {
  const provider = byId[c.type];
  if (!provider) throw new Error(`Unknown service type "${c.type}"`);
  const r = await provider.lookup(c.applicationNo);
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
const wasSent = (c, status) => (c.notifications || []).some(n => n.ok && n.mode === 'live' && n.status === status);

// Looks up one customer, saves the result, and messages them on WhatsApp if the
// status moved to a new stage.
async function refreshAndSave(id) {
  const customer = await customers.find(id);
  if (!customer) return null;
  const before = customer.status;
  const wasChecked = !!customer.lastChecked;
  await refreshCustomer(customer);
  if (!await customers.saveStatus(customer)) return null; // deleted while checking
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
  const id = url.pathname.split('/')[3];
  const action = url.pathname.split('/')[4];
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (req.method === 'GET' && !id) return send(res, 200, await customers.forOwner(user.id));

  if (req.method === 'POST' && !id) {
    const provider = byId[body.type];
    const name = String(body.name || '').trim();
    const applicationNo = String(body.applicationNo || '').trim().toUpperCase();
    const whatsappNo = normalizeWhatsapp(body.whatsapp);
    if (!provider) return send(res, 400, { error: 'Choose a service type' });
    if (!name) return send(res, 400, { error: 'Name is required' });
    if (!isValidNumber(provider, applicationNo)) return send(res, 400, { error: `Enter a valid ${provider.numberLabel.toLowerCase()}` });
    if (!whatsappNo) return send(res, 400, { error: 'Enter a valid 10-digit WhatsApp number' });

    const customer = await customers.add({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), owner: user.id, type: provider.id, name, applicationNo, whatsapp: whatsappNo });
    if (!customer) return send(res, 409, { error: `${applicationNo} is already saved under ${provider.name}` });
    return send(res, 201, customer);
  }

  if (req.method === 'POST' && id === 'send-updates') {
    if (sendingUpdates.has(user.id)) return send(res, 409, { error: 'Updates are already being sent' });
    sendingUpdates.add(user.id);
    try {
      return send(res, 200, await sendWaitingUpdates(user.id));
    } finally {
      sendingUpdates.delete(user.id);
    }
  }

  const customer = await customers.ownedBy(id, user.id);
  if (!customer) return send(res, 404, { error: 'Customer not found' });

  if (req.method === 'DELETE' && !action) {
    await customers.remove(id, user.id);
    return send(res, 200, { ok: true });
  }

  // Re-send the current status on WhatsApp by hand.
  if (req.method === 'POST' && action === 'notify') {
    if (!customer.lastChecked || !customer.found) return send(res, 400, { error: 'Check the status first' });
    const rec = await notifyCustomer(customer);
    return rec.ok ? send(res, 200, customer) : send(res, 502, { error: rec.error, customer });
  }

  // Staff set the stage by hand for services the CRM can't check itself. Nothing is
  // sent here: approved and rejected customers wait for "Send WhatsApp updates".
  if (req.method === 'POST' && action === 'status') {
    const status = String(body.status || '').trim();
    if (!byId[customer.type]?.manual) return send(res, 400, { error: 'This service is checked automatically' });
    if (!status || status.length > 100) return send(res, 400, { error: 'Enter a status of up to 100 characters' });
    setStatus(customer, status, true);
    customer.notifyDue = isFinal(status) && !wasSent(customer, status);
    await customers.saveStatus(customer);
    return send(res, 200, customer);
  }

  if (req.method === 'POST' && action === 'refresh') {
    const updated = await refreshAndSave(id);
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

const publicUser = u => ({ userId: u.userId, role: u.role });

async function authApi(req, res, url) {
  const action = url.pathname.split('/')[3];
  const ip = req.socket.remoteAddress;

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

  if (action === 'logout') {
    await users.endSession(sessionToken(req));
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

async function adminApi(req, res, url) {
  const [, , , , id, action] = url.pathname.split('/'); // /api/admin/users/<id>/<action>
  if (req.method === 'GET' && !id) return send(res, 200, await users.forAdmin());
  if (req.method !== 'POST') return send(res, 405, { error: 'Not allowed' });
  const body = await readBody(req);
  const result = !id ? await users.addUser(body)
    : action === 'password' ? await users.setPassword(id, body.password)
      : action === 'refuse' ? await users.refuse(id)
        : await users.changeStatus(id, action);
  return result.error ? send(res, result.code || 400, { error: result.error }) : send(res, 200, { ok: true });
}

// The React site from client/, built by `npm run build`.
const PUBLIC = path.join(__dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function serveStatic(res, pathname) {
  if (['/', '/login', '/register', '/forgot', '/reset', '/admin'].includes(pathname)) pathname = '/index.html';
  const file = path.join(PUBLIC, path.normalize(pathname));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
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
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    try {
      if (fromOtherSite(req)) return send(res, 403, { error: 'Not allowed' });
      if (url.pathname.startsWith('/api/auth/')) return await authApi(req, res, url);

      const user = await users.userForToken(sessionToken(req));
      if (!user) return send(res, 401, { error: 'Please log in' });

      if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/admin') {
        return user.role === 'admin' ? await adminApi(req, res, url) : send(res, 403, { error: 'Admins only' });
      }
      if (user.role !== 'user') return send(res, 403, { error: 'The admin account has no customers' });

      if (url.pathname === '/api/providers') return send(res, 200, publicList());

      // /api/status?type=certificate&no=TN-...  (type defaults to certificate)
      if (url.pathname === '/api/status') {
        const provider = byId[url.searchParams.get('type') || 'certificate'];
        const appNo = (url.searchParams.get('no') || '').trim().toUpperCase();
        if (!provider) return send(res, 400, { error: 'Unknown service type' });
        if (!isValidNumber(provider, appNo)) return send(res, 400, { error: `Enter a valid ${provider.numberLabel.toLowerCase()}` });
        return send(res, 200, await provider.lookup(appNo));
      }

      if (url.pathname === '/api/schedule') {
        if (req.method === 'POST') {
          const started = !progress;
          if (started) runAllChecks('Manual', user.id).catch(e => console.error('[auto-check]', e.message));
          return send(res, started ? 202 : 409, started ? { ok: true } : { error: 'A check is already running' });
        }
        return send(res, 200, { times: CHECK_TIMES, timezone: TZ, gapSeconds: GAP_MS / 1000, nextRun: nextRunLabel(), running: progress?.owners[user.id] || null, lastRun: await customers.lastRun(user.id), whatsapp: whatsapp.mode() });
      }

      if (url.pathname.startsWith('/api/customers')) return await customersApi(req, res, url, user);

      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error(url.pathname, e.message);
      // Database errors stay in the server log; the person just gets a plain message.
      if (!res.headersSent) send(res, 502, { error: e.code ? 'The server could not finish that. Please try again.' : e.message });
      return;
    }
  }

  // The customers page was merged into the main page.
  if (url.pathname === '/customers') {
    res.writeHead(301, { Location: '/' + url.search });
    return res.end();
  }

  serveStatic(res, url.pathname);
});

db.setup().then(() => {
  server.listen(PORT, async () => {
    console.log(`CRM running at http://localhost:${PORT}`);
    if (!await users.hasAdmin()) console.log('No admin yet. Create one with: node create-admin.js');
    if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) console.log('The website is not built yet. Run: npm run build');
  });
}).catch(e => {
  console.error(`Could not connect to the database: ${e.message}`);
  process.exit(1);
});
