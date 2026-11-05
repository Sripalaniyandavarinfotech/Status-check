// The PostgreSQL connection and tables. Tables are created when the server starts.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from .env. See README.md, "Database".');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// Without this, losing the database connection would stop the whole server.
pool.on('error', e => console.error('[database]', e.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  user_id       text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  phone         text,
  email         text UNIQUE,
  role          text NOT NULL CHECK (role IN ('user', 'admin')),
  status        text NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  reset_hash    text,
  reset_expires timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_ref   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_ref);

-- A user can't be removed while they have customers, so nothing is lost by accident.
CREATE TABLE IF NOT EXISTS customers (
  id                text PRIMARY KEY,
  owner             text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type              text NOT NULL,
  name              text NOT NULL,
  application_no    text NOT NULL,
  whatsapp          text NOT NULL,
  service           text,
  status            text,
  previous_status   text,
  remarks           text,
  found             boolean,
  notify_due        boolean NOT NULL DEFAULT false,
  last_checked      timestamptz,
  status_changed_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, type, application_no)
);
CREATE INDEX IF NOT EXISTS customers_due ON customers(owner) WHERE notify_due;
CREATE INDEX IF NOT EXISTS customers_type ON customers(type);

CREATE TABLE IF NOT EXISTS notifications (
  id          bigserial PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sent_at     timestamptz NOT NULL,
  status      text,
  mode        text,
  ok          boolean NOT NULL,
  message_id  text,
  error       text,
  body        text
);
CREATE INDEX IF NOT EXISTS notifications_customer ON notifications(customer_id, id DESC);

CREATE TABLE IF NOT EXISTS check_runs (
  owner text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  run   jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key   text PRIMARY KEY,
  value text NOT NULL
);
`;

const setup = () => pool.query(SCHEMA);

const query = (text, params) => pool.query(text, params);

// Runs several statements as one: all of them are saved, or none.
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const close = () => pool.end();

module.exports = { setup, query, transaction, close };
