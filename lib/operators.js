// Each user's own list of operators, chosen when adding a customer.
const { query } = require('./db');

const list = async owner => (await query('SELECT id, name FROM operators WHERE owner = $1 ORDER BY lower(name)', [owner])).rows;

const owned = async (id, owner) => (await query('SELECT 1 FROM operators WHERE id = $1 AND owner = $2', [id, owner])).rowCount > 0;

// Null when this user already has that name.
async function add(owner, name) {
  try {
    return (await query('INSERT INTO operators (owner, name) VALUES ($1, $2) RETURNING id, name', [owner, name])).rows[0];
  } catch (e) {
    if (e.code === '23505') return null;
    throw e;
  }
}

// Customers point at the operator, so a new name shows on all of them at once.
// Returns 'duplicate', or how many rows changed.
async function rename(id, owner, name) {
  try {
    return (await query('UPDATE operators SET name = $3 WHERE id = $1 AND owner = $2', [id, owner, name])).rowCount;
  } catch (e) {
    if (e.code === '23505') return 'duplicate';
    throw e;
  }
}

// Their customers stay, with no operator.
const remove = async (id, owner) => (await query('DELETE FROM operators WHERE id = $1 AND owner = $2', [id, owner])).rowCount > 0;

module.exports = { list, owned, add, rename, remove };
