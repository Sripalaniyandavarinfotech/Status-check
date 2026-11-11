// Accounts and login sessions. Passwords are stored only as salted scrypt hashes,
// and sessions only as hashes of their tokens, so the database holds nothing that can log in.
const crypto = require('crypto');
const { promisify } = require('util');
const { query, transaction } = require('./db');

const scrypt = promisify(crypto.scrypt);

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const APP_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // the phone app stays logged in longer
const RESET_MS = 30 * 60 * 1000;

const fromRow = r => r && {
  id: r.id,
  userId: r.user_id,
  passwordHash: r.password_hash,
  phone: r.phone,
  email: r.email,
  role: r.role,
  status: r.status,
  plan: r.plan,
  billing: r.billing,
  trialEnds: r.trial_ends,
  paidUntil: r.paid_until_day || null,
  aadhaarOn: r.aadhaar_on,
  planRequest: r.plan_request,
};

const cleanUserId = s => String(s || '').trim().toLowerCase();

function cleanPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const given = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(given, Buffer.from(hash, 'hex'));
}

const passwordProblem = p => (typeof p !== 'string' || p.length < 8 || p.length > 200
  ? 'Password must be at least 8 characters' : null);

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

// Phone and email are optional only for users the admin adds.
async function createUser({ userId, password, phone, email }, { status, optional }) {
  const id = cleanUserId(userId);
  const mobile = phone || !optional ? cleanPhone(phone) : '';
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(id)) return { error: 'User ID must be 3 to 30 letters or numbers' };
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  if (mobile === null) return { error: 'Enter a valid 10-digit phone number' };
  if ((mail || !optional) && (mail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))) return { error: 'Enter a valid email address' };

  const passwordHash = await hashPassword(password);
  try {
    await query(
      `INSERT INTO users (id, user_id, password_hash, phone, email, role, status) VALUES ($1, $2, $3, $4, $5, 'user', $6)`,
      [crypto.randomUUID(), id, passwordHash, mobile || null, mail || null, status],
    );
  } catch (e) {
    if (e.code !== '23505') throw e; // only "already exists" is the person's to fix
    return { error: /email/.test(e.constraint) ? 'This email is already registered' : 'This user ID is already taken', code: 409 };
  }
  return { ok: true };
}

// New users wait as "pending" until the admin accepts them.
const register = form => createUser(form, { status: 'pending' });

// Users the admin adds can log in straight away.
const addUser = form => createUser(form, { status: 'active', optional: true });

// A refused registration is removed, so that person can register again.
async function refuse(id) {
  const { rowCount } = await query(`DELETE FROM users WHERE id = $1 AND role = 'user' AND status = 'pending'`, [id]);
  return rowCount ? { ok: true } : problem(id);
}

async function problem(id) {
  const { rows } = await query(`SELECT status FROM users WHERE id = $1 AND role = 'user'`, [id]);
  return rows[0] ? { error: `This user is ${rows[0].status}`, code: 409 } : { error: 'User not found', code: 404 };
}

// Any new password ends the user's sessions and any reset link still open.
async function setPassword(id, password) {
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  const passwordHash = await hashPassword(password);
  const changed = await transaction(async db => {
    const { rowCount } = await db.query(
      `UPDATE users SET password_hash = $2, reset_hash = NULL, reset_expires = NULL WHERE id = $1 AND role = 'user'`,
      [id, passwordHash],
    );
    await db.query('DELETE FROM sessions WHERE user_ref = $1', [id]);
    return rowCount > 0;
  });
  return changed ? { ok: true } : { error: 'User not found', code: 404 };
}

// A person changing their own password must prove they know the current one.
async function changeOwnPassword(id, current, next) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [id]);
  const given = typeof current === 'string' ? current.slice(0, 200) : '';
  if (!rows[0] || !await checkPassword(given, rows[0].password_hash)) return { error: 'Your current password is wrong', code: 400 };
  const bad = passwordProblem(next);
  if (bad) return { error: bad };
  const passwordHash = await hashPassword(next);
  await transaction(async db => {
    await db.query('UPDATE users SET password_hash = $2, reset_hash = NULL, reset_expires = NULL WHERE id = $1', [id, passwordHash]);
    await db.query('DELETE FROM sessions WHERE user_ref = $1', [id]);
  });
  return { ok: true };
}

async function passwordIsRight(id, password) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [id]);
  const given = typeof password === 'string' ? password.slice(0, 200) : '';
  return !!rows[0] && checkPassword(given, rows[0].password_hash);
}

async function profile(id) {
  const { rows } = await query('SELECT user_id, phone, email, created_at FROM users WHERE id = $1', [id]);
  return { userId: rows[0].user_id, phone: rows[0].phone, email: rows[0].email, createdAt: rows[0].created_at };
}

const userIdOf = async id => (await query('SELECT user_id FROM users WHERE id = $1', [id])).rows[0]?.user_id || null;

// Used by create-admin.js. Running it again for the same ID resets that admin's password.
async function saveAdmin(userId, password) {
  const id = cleanUserId(userId);
  if (!/^[a-z0-9._-]{3,30}$/.test(id)) throw new Error('User ID must be 3 to 30 letters or numbers');
  const bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  const passwordHash = await hashPassword(password);
  const { rowCount } = await query(
    `INSERT INTO users (id, user_id, password_hash, role, status) VALUES ($1, $2, $3, 'admin', 'active')
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash WHERE users.role = 'admin'`,
    [crypto.randomUUID(), id, passwordHash],
  );
  if (!rowCount) throw new Error('That user ID belongs to a normal user');
}

const hasAdmin = async () => (await query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)).rowCount > 0;

// Unknown IDs cost the same time as wrong passwords, so IDs can't be guessed from timing.
const DUMMY = hashPassword('not a real password');

// Pending and suspended users only learn their state after giving the right password.
// The admin logs in only at /admin, and users only on the main page.
async function login(userId, password, area) {
  const { rows } = await query('SELECT * FROM users WHERE user_id = $1', [cleanUserId(userId)]);
  const user = fromRow(rows[0]);
  const given = typeof password === 'string' ? password.slice(0, 200) : '';
  const right = await checkPassword(given, user ? user.passwordHash : await DUMMY);
  if (!user || !right) return { error: 'Wrong user ID or password', code: 401 };
  if (area === 'admin' && user.role !== 'admin') return { error: 'Wrong user ID or password', code: 401 };
  if (area !== 'admin' && user.role === 'admin') return { error: 'Admins log in at /admin', code: 403 };
  if (user.status === 'pending') return { error: 'Your registration is waiting for the admin to accept it', code: 403 };
  if (user.status === 'suspended') return { error: 'Your account is suspended. Please contact the admin.', code: 403 };
  return { user };
}

// ---- Forgotten passwords ----
// Only active users with an email. Only the token's hash is kept.
async function startReset(idOrEmail) {
  const key = String(idOrEmail || '').trim().toLowerCase();
  if (!key) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await query(
    `UPDATE users SET reset_hash = $2, reset_expires = $3
     WHERE role = 'user' AND status = 'active' AND email IS NOT NULL AND (user_id = $1 OR email = $1)
     RETURNING user_id, email`,
    [key, tokenHash(token), new Date(Date.now() + RESET_MS)],
  );
  return rows[0] ? { userId: rows[0].user_id, email: rows[0].email, token } : null;
}

async function finishReset(token, password) {
  const { rows } = await query('SELECT id FROM users WHERE reset_hash = $1 AND reset_expires > now()', [tokenHash(String(token || ''))]);
  if (!rows[0]) return { error: 'This link has ended. Ask for a new one.', code: 400 };
  return setPassword(rows[0].id, password);
}

// ---- Admin actions ----
const MOVES = { accept: ['pending', 'active'], suspend: ['active', 'suspended'], activate: ['suspended', 'active'] };

async function changeStatus(id, action) {
  const move = MOVES[action];
  if (!move) return { error: 'Unknown action', code: 404 };
  const changed = await transaction(async db => {
    const { rowCount } = await db.query(`UPDATE users SET status = $3 WHERE id = $1 AND role = 'user' AND status = $2`, [id, ...move]);
    // The free trial starts when the admin accepts a registration, not while it waits.
    if (rowCount && action === 'accept') await db.query("UPDATE users SET trial_ends = now() + interval '14 days' WHERE id = $1 AND paid_until IS NULL", [id]);
    if (rowCount && move[1] === 'suspended') await db.query('DELETE FROM sessions WHERE user_ref = $1', [id]);
    return rowCount > 0;
  });
  return changed ? { ok: true } : problem(id);
}

const isActive = async id => (await query(`SELECT 1 FROM users WHERE id = $1 AND role = 'user' AND status = 'active'`, [id])).rowCount > 0;

// What the admin sees, and nothing more: never customers, emails or passwords.
async function forAdmin() {
  const { rows } = await query(`
    SELECT u.id, u.user_id, u.phone, u.status, u.plan, u.billing, u.trial_ends, to_char(u.paid_until, 'YYYY-MM-DD') AS paid_until_day,
      u.aadhaar_on, u.plan_request, u.plan_request_at, COUNT(DISTINCT c.whatsapp)::int AS numbers
    FROM users u LEFT JOIN customers c ON c.owner = u.id
    WHERE u.role = 'user' GROUP BY u.id ORDER BY u.created_at`);
  return rows.map(r => ({
    id: r.id, userId: r.user_id, phone: r.phone, status: r.status, whatsappNumbers: r.numbers,
    plan: r.plan, billing: r.billing, trialEnds: r.trial_ends, paidUntil: r.paid_until_day || null, aadhaarOn: r.aadhaar_on,
    planRequest: r.plan_request, planRequestAt: r.plan_request_at,
  }));
}

// ---- Plans ----
// The admin's changes to one shop's plan. Only user accounts, never the admin.
async function setPlan(id, { plan, billing }) {
  const { rowCount } = await query(
    "UPDATE users SET plan = $2, billing = $3, plan_request = NULL, plan_request_at = NULL WHERE id = $1 AND role = 'user'",
    [id, plan, billing],
  );
  return rowCount > 0;
}
async function setPaidUntil(id, day) {
  const { rowCount } = await query("UPDATE users SET paid_until = $2 WHERE id = $1 AND role = 'user'", [id, day]);
  return rowCount > 0;
}
async function extendTrial(id, days) {
  const { rowCount } = await query(
    "UPDATE users SET trial_ends = GREATEST(COALESCE(trial_ends, now()), now()) + make_interval(days => $2) WHERE id = $1 AND role = 'user'",
    [id, days],
  );
  return rowCount > 0;
}
async function setAadhaar(id, on) {
  const { rowCount } = await query("UPDATE users SET aadhaar_on = $2 WHERE id = $1 AND role = 'user'", [id, on]);
  return rowCount > 0;
}
async function requestPlan(id, request) {
  await query('UPDATE users SET plan_request = $2, plan_request_at = now() WHERE id = $1', [id, request]);
}
async function planOf(id) {
  const { rows } = await query("SELECT *, to_char(paid_until, 'YYYY-MM-DD') AS paid_until_day FROM users WHERE id = $1", [id]);
  return fromRow(rows[0]);
}

// ---- Sessions ----
async function startSession(userRef, app = null) {
  await query('DELETE FROM sessions WHERE expires < now()');
  const token = crypto.randomBytes(32).toString('hex');
  const life = app === 'calls' ? APP_SESSION_MS : SESSION_MS;
  await query('INSERT INTO sessions (token_hash, user_ref, expires, app) VALUES ($1, $2, $3, $4)', [tokenHash(token), userRef, new Date(Date.now() + life), app]);
  return token;
}

async function endSession(token) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}

// Reads the status every time, so a suspension takes effect on the very next request.
async function userForToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.*, to_char(u.paid_until, 'YYYY-MM-DD') AS paid_until_day, s.app FROM sessions s JOIN users u ON u.id = s.user_ref
     WHERE s.token_hash = $1 AND s.expires > now() AND u.status = 'active'`,
    [tokenHash(token)],
  );
  return rows[0] ? { ...fromRow(rows[0]), app: rows[0].app || null } : null;
}

// ---- Limits on repeated tries ----
const tries = new Map();

const limited = (key, max) => {
  const t = tries.get(key);
  return !!t && t.until > Date.now() && t.count >= max;
};

function countTry(key, windowMs) {
  const now = Date.now();
  if (tries.size > 10000) for (const [k, t] of tries) if (t.until < now) tries.delete(k);
  const t = tries.get(key);
  if (t && t.until > now) t.count++;
  else tries.set(key, { count: 1, until: now + windowMs });
}

const clearTries = key => tries.delete(key);

module.exports = { setPlan, setPaidUntil, extendTrial, setAadhaar, requestPlan, planOf, register, addUser, refuse, setPassword, changeOwnPassword, passwordIsRight, profile, userIdOf, saveAdmin, hasAdmin, login, startReset, finishReset, changeStatus, isActive, forAdmin, startSession, endSession, userForToken, limited, countTry, clearTries, SESSION_MS, APP_SESSION_MS };
