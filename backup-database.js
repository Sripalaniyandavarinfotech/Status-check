// Saves a full copy of the database to backups/. Run:  npm run backup
// Keep copies somewhere other than this computer as well.
require('./lib/env');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const url = new URL(process.env.DATABASE_URL || 'postgres://missing');
const dir = path.join(__dirname, 'backups');
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = path.join(dir, `crm-${stamp}.sql`);

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
// The password goes through the environment so it never shows in the process list.
const result = spawnSync('pg_dump', ['--file', file], {
  stdio: 'inherit',
  env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) },
});
if (result.status !== 0) process.exit(result.status || 1);
fs.chmodSync(file, 0o600);
console.log(`Backup saved: ${file}`);
