// Reads PAN emails from UTIITSL and NSDL (Protean) in a mailbox kept only for them,
// and moves the matching PAN customer on: Submitted, In Process, then Approved.
//
// Only the subject line and sender are read, with the mailbox opened read-only:
// nothing is downloaded, marked as read, moved or deleted. Settings in .env:
//   EPAN_EMAIL, EPAN_APP_PASSWORD  the mailbox and its app password
//   EPAN_USER                      the CRM user whose PAN customers it updates
//   EPAN_CHECK_MINUTES             how often to look (default 5)
//   EPAN_IMAP_HOST                 default imap.gmail.com
//   EPAN_FROM                      senders to read, comma separated (default: the three below)
const { ImapFlow } = require('imapflow');
const { query } = require('./db');

const UTI = 'epan.service@utiitsl.com';
const PROTEAN = 'noreply@epan.proteantech.in';
const PROTEAN_RECEIPT = 'noreply@reprint.proteantech.in';
const SENDERS = [UTI, PROTEAN, PROTEAN_RECEIPT];

const config = () => ({
  email: process.env.EPAN_EMAIL || '',
  password: (process.env.EPAN_APP_PASSWORD || '').replace(/\s+/g, ''), // Google shows it in groups of 4
  userId: (process.env.EPAN_USER || '').trim().toLowerCase(),
  minutes: Math.max(2, Number(process.env.EPAN_CHECK_MINUTES) || 5),
  host: process.env.EPAN_IMAP_HOST || 'imap.gmail.com',
  from: (process.env.EPAN_FROM || SENDERS.join(',')).toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
});

const enabled = () => {
  const c = config();
  return !!(c.email && c.password && c.userId);
};

// What one email means, from its sender and subject only. Null for anything else.
function readSubject(sender, subject) {
  const text = String(subject || '');
  let m;
  // "Mesg from UTIITSL: Your PAN is allotted ! Your e-PAN Card for Application Coupon number:- A125737133"
  if (sender === UTI && /PAN is allotted/i.test(text) && (m = text.match(/Coupon\s*number\s*:?-?\s*(?:U-)?([A-Z][0-9]{6,12})\b/i))) {
    return { number: m[1].toUpperCase(), stage: 'Approved', note: 'PAN allotted (UTIITSL e-PAN email)' };
  }
  // "PAN allotment letter for your PAN application 990079730848272"
  if (sender === PROTEAN && (m = text.match(/PAN allotment letter for your PAN application\s+([0-9]{15})\b/i))) {
    return { number: m[1], stage: 'Approved', note: 'PAN allotted (Protean e-PAN email)' };
  }
  // "Your PAN application 990079730844164 dated 03/11/2026": documents found in order
  if (sender === PROTEAN && (m = text.match(/Your PAN application\s+([0-9]{15})\s+dated/i))) {
    return { number: m[1], stage: 'In Process', note: 'Documents in order, sent to the Income Tax Department (Protean email)' };
  }
  // "PAN Application - ack. No. N- 990079730848272"
  if (sender === PROTEAN_RECEIPT && (m = text.match(/ack\.?\s*No\.?\s*N-\s*([0-9]{15})\b/i))) {
    return { number: m[1], stage: 'Submitted', note: 'Application received (Protean email)' };
  }
  return null;
}

const allottedCoupon = subject => readSubject(UTI, subject)?.number || null;

const state = { lastRun: null, lastError: '', matched: 0, unmatched: [] };

const savedUid = async () => {
  const row = (await query("SELECT value FROM app_state WHERE key = 'epan_mail'")).rows[0];
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
};

const saveUid = mark => query(
  "INSERT INTO app_state (key, value) VALUES ('epan_mail', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
  [JSON.stringify(mark)],
);

// Looks once. `onEmail(owner, number, stage, note, date)` returns true when the number is a customer's.
// `connect` lets tests stand in for the mail server.
async function checkOnce(onEmail, connect = c => new ImapFlow(c)) {
  const c = config();
  const owner = (await query("SELECT id FROM users WHERE user_id = $1 AND role = 'user'", [c.userId])).rows[0]?.id;
  if (!owner) throw new Error(`EPAN_USER "${c.userId}" is not a staff user`);

  const client = connect({ host: c.host, port: 993, secure: true, auth: { user: c.email, pass: c.password }, logger: false });
  await client.connect();
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const mark = await savedUid();
    const sameBox = mark && String(mark.uidValidity) === String(box.uidValidity);
    // The first look goes back 30 days. After that only newer messages are read.
    const senders = c.from.length > 1 ? { or: c.from.map(from => ({ from })) } : { from: c.from[0] };
    const search = sameBox
      ? { ...senders, uid: `${mark.uid + 1}:*` }
      : { ...senders, since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    const uids = (await client.search(search, { uid: true })) || [];
    let last = sameBox ? mark.uid : 0;
    const fresh = uids.filter(u => u > last).sort((a, b) => a - b);
    if (fresh.length) {
      for (const msg of await client.fetchAll(fresh.join(','), { uid: true, envelope: true }, { uid: true })) {
        const sender = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
        const found = c.from.includes(sender) ? readSubject(sender, msg.envelope?.subject) : null;
        if (found) {
          if (await onEmail(owner, found.number, found.stage, found.note, msg.envelope?.date)) state.matched += 1;
          // Only allotments are listed: receipts often come before the customer is added.
          else if (found.stage === 'Approved' && !state.unmatched.includes(found.number)) state.unmatched = [...state.unmatched, found.number].slice(-20);
        }
        last = Math.max(last, msg.uid);
      }
    }
    await saveUid({ uidValidity: String(box.uidValidity), uid: Math.max(last, box.uidNext - 1, 0) });
  } finally {
    await client.logout().catch(() => {});
  }
}

let timer = null;
let busy = false;

function start(onEmail) {
  if (!enabled() || timer) return false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await checkOnce(onEmail);
      state.lastError = '';
    } catch (e) {
      state.lastError = e.authenticationFailed ? 'The email or app password was not accepted' : e.message || 'Could not read the mailbox';
      console.error(`[e-PAN mail] ${state.lastError}`);
    }
    state.lastRun = new Date().toISOString();
    busy = false;
  };
  run();
  timer = setInterval(run, config().minutes * 60 * 1000);
  return true;
}

// What the PAN page shows. Never includes the password.
const status = () => (enabled()
  ? { on: true, email: config().email, minutes: config().minutes, lastRun: state.lastRun, lastError: state.lastError, unmatched: state.unmatched }
  : { on: false });

module.exports = { start, status, checkOnce, readSubject, allottedCoupon, enabled, SENDERS };
