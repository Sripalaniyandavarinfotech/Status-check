// Loads every provider file in this folder. Adding a new status source is just
// adding a new file here — see README.md.
const fs = require('fs');
const path = require('path');

const ORDER = ['certificate', 'smartcard', 'voter', 'aadhaar']; // display order; unknown ids go last

const providers = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_'))
  .map(f => require(path.join(__dirname, f)))
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));

const byId = Object.fromEntries(providers.map(p => [p.id, p]));

for (const p of providers) {
  for (const key of ['id', 'name', 'numberLabel', 'pattern', 'lookup']) {
    if (!p[key]) throw new Error(`Provider ${p.id || '(unnamed)'} is missing "${key}"`);
  }
}

// Public info for the browser (no functions).
const publicList = () => providers.map(({ id, name, shortName, numberLabel, placeholder, pattern, page, ready, manual, officialUrl, openLabel, stages }) =>
  ({ id, name, shortName: shortName || name, numberLabel, placeholder, pattern, page, ready: !!ready, manual: !!manual, officialUrl, openLabel, stages }));

const isValidNumber = (p, number) => new RegExp(p.pattern).test(number);

module.exports = { providers, byId, publicList, isValidNumber };
