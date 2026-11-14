// Makes an HTTPS certificate so the site opens as https:// on this computer and
// on other devices on the shop's Wi-Fi. Run:  node create-https-cert.js
//
// It makes two things in data/https/ (never pushed to GitHub):
//   - a small "certificate authority" (ca.crt + ca.key), made once and kept.
//     Each computer or phone must trust ca.crt once (see docs/HTTPS.md).
//   - the site's own certificate (server.crt + server.key), for localhost and
//     this computer's current Wi-Fi addresses. Run this again if the Wi-Fi
//     address changes; the trust stays because ca.crt stays the same.
//
// Extra names or addresses can be added:  node create-https-cert.js crm.local 192.168.1.20
require('./lib/env'); // LAN_NAME from .env, for example ethunaivan.local
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(__dirname, 'data', 'https');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = name => path.join(dir, name);
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });

try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  console.error('openssl is needed. Install it, then run this again.');
  process.exit(1);
}

// The certificate authority: made once, so devices only trust it once.
if (!fs.existsSync(file('ca.key')) || !fs.existsSync(file('ca.crt'))) {
  openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650',
    '-keyout', file('ca.key'), '-out', file('ca.crt'),
    '-subj', '/O=Palaniyandavar Info Tech/CN=Palaniyandavar Info Tech local CA',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  fs.chmodSync(file('ca.key'), 0o600);
  console.log('Made a new certificate authority: data/https/ca.crt');
} else {
  console.log('Using the existing certificate authority: data/https/ca.crt');
}

// Names the site certificate covers.
const addresses = Object.values(os.networkInterfaces()).flat()
  .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
const extra = process.argv.slice(2).filter(a => /^[A-Za-z0-9.:-]+$/.test(a));
const isIp = a => /^\d{1,3}(\.\d{1,3}){3}$/.test(a) || a.includes(':');
const lanName = /^[A-Za-z0-9.-]+$/.test(process.env.LAN_NAME || '') ? [process.env.LAN_NAME] : [];
const names = [...new Set(['localhost', '127.0.0.1', '::1', os.hostname(), ...lanName, ...addresses, ...extra])];
const san = names.map(n => (isIp(n) ? `IP:${n}` : `DNS:${n}`)).join(',');

const ext = file('server.ext');
fs.writeFileSync(ext, [
  'basicConstraints=CA:FALSE',
  'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=${san}`,
].join('\n'));

openssl('req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
  '-keyout', file('server.key'), '-out', file('server.csr'), '-subj', '/CN=Palaniyandavar CRM');
// Browsers refuse site certificates longer than 825 days.
openssl('x509', '-req', '-in', file('server.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'),
  '-CAcreateserial', '-out', file('server.crt'), '-days', '825', '-sha256', '-extfile', ext);
fs.chmodSync(file('server.key'), 0o600);
for (const old of ['server.csr', 'server.ext']) fs.rmSync(file(old), { force: true });

console.log(`Made the site certificate for: ${names.join(', ')}`);
console.log('Next: trust data/https/ca.crt in your browser once (see docs/HTTPS.md), then restart the server.');
