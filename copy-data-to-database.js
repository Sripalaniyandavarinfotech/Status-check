// Copies the old JSON files in data/ into the database, once.
// Anything already in the database is left alone, so running it twice is safe.
// Run:  node copy-data-to-database.js
require('./lib/env');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');

const read = (name, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
  } catch {
    return fallback;
  }
};

(async () => {
  await db.setup();
  const users = read('users.json', []);
  const customers = read('customers.json', []).map(c => ({ type: 'certificate', ...c }));
  const schedule = read('schedule.json', {});
  const owners = new Set(users.map(u => u.id));
  const homeless = customers.filter(c => !owners.has(c.owner));
  const count = { users: 0, customers: 0, notifications: 0 };

  await db.transaction(async t => {
    for (const u of users) {
      const { rowCount } = await t.query(
        `INSERT INTO users (id, user_id, password_hash, phone, email, role, status, reset_hash, reset_expires, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
        [u.id, u.userId, u.passwordHash, u.phone || null, u.email || null, u.role, u.status, u.resetHash || null, u.resetExpires ? new Date(u.resetExpires) : null, u.createdAt],
      );
      count.users += rowCount;
    }
    for (const c of customers.filter(x => owners.has(x.owner))) {
      const { rowCount } = await t.query(
        `INSERT INTO customers (id, owner, type, name, application_no, whatsapp, service, status, previous_status, remarks,
           found, notify_due, last_checked, status_changed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, now())) ON CONFLICT DO NOTHING`,
        [c.id, c.owner, c.type, c.name, c.applicationNo, c.whatsapp, c.service, c.status, c.previousStatus, c.remarks,
          c.found, !!c.notifyDue, c.lastChecked, c.statusChangedAt, c.createdAt],
      );
      count.customers += rowCount;
      if (!rowCount) continue;
      // Newest first in the file, so oldest goes in first here.
      for (const n of [...(c.notifications || [])].reverse()) {
        await t.query(
          `INSERT INTO notifications (customer_id, sent_at, status, mode, ok, message_id, error, body) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [c.id, n.at, n.status, n.mode, !!n.ok, n.messageId, n.error, n.text],
        );
        count.notifications++;
      }
    }
    for (const [owner, run] of Object.entries(schedule.lastRuns || {})) {
      if (owners.has(owner)) await t.query('INSERT INTO check_runs (owner, run) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, JSON.stringify(run)]);
    }
    if (schedule.lastSlot) await t.query(`INSERT INTO app_state (key, value) VALUES ('last_slot', $1) ON CONFLICT DO NOTHING`, [schedule.lastSlot]);
  });

  await db.close();
  console.log(`Copied ${count.users} users, ${count.customers} customers, ${count.notifications} WhatsApp records.`);
  if (homeless.length) console.log(`Left out ${homeless.length} customers with no user: ${homeless.map(c => c.name).join(', ')}`);
})().catch(e => {
  console.error(`Nothing was copied: ${e.message}`);
  process.exit(1);
});
