// Creates the admin account, or resets its password if the user ID already exists.
// Run in a terminal:  node create-admin.js
const readline = require('readline');
require('./lib/env');
const db = require('./lib/db');
const users = require('./lib/users');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
const show = rl._writeToOutput.bind(rl);
rl._writeToOutput = text => { if (!hidden) show(text); };

const ask = (question, secret) => new Promise(resolve => {
  rl.question(question, answer => {
    if (secret) process.stdout.write('\n');
    hidden = false;
    resolve(answer);
  });
  hidden = !!secret;
});

(async () => {
  const userId = await ask('Admin user ID: ');
  const password = await ask('Password (nothing shows as you type): ', true);
  const again = await ask('Password again: ', true);
  rl.close();
  if (password !== again) throw new Error('The passwords did not match');
  await db.setup();
  await users.saveAdmin(userId, password);
  await db.close();
  console.log('Admin saved. Log in at /admin with this user ID.');
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
