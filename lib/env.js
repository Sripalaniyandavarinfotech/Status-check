// Loads KEY=value lines from the project's .env file into process.env,
// so settings (like WhatsApp keys) work with a plain `node server.js`.
// Values already set in the real environment win.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env');

if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
