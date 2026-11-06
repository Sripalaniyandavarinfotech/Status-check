// Adds AADHAAR_KEY to .env, once. Without this key saved numbers can't be read,
// so keep a private copy of it. Run:  node create-aadhaar-key.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '.env');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (/^AADHAAR_KEY=[0-9a-f]{64}\s*$/im.test(text)) {
  console.log('AADHAAR_KEY is already set.');
} else {
  const rest = text.replace(/^AADHAAR_KEY=.*\n?/gm, '');
  const start = rest && !rest.endsWith('\n') ? `${rest}\n` : rest;
  fs.writeFileSync(file, `${start}AADHAAR_KEY=${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log('AADHAAR_KEY added to .env. Restart the server, and keep a private copy of this key.');
}
