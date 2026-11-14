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

CREATE INDEX IF NOT EXISTS customers_list ON customers(owner, type, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_number ON customers(application_no);

CREATE TABLE IF NOT EXISTS customer_notes (
  id          bigserial PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author      text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_notes_customer ON customer_notes(customer_id, id DESC);

CREATE TABLE IF NOT EXISTS activity (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor_ref text,
  actor     text NOT NULL,
  action    text NOT NULL,
  owner     text,
  target    text,
  detail    text
);
CREATE INDEX IF NOT EXISTS activity_actor ON activity(actor_ref, id DESC);
CREATE INDEX IF NOT EXISTS activity_owner ON activity(owner, id DESC);

CREATE TABLE IF NOT EXISTS check_runs (
  owner text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  run   jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS aadhaar_last4 text CHECK (aadhaar_last4 ~ '^[0-9]{4}$');
ALTER TABLE customers ADD COLUMN IF NOT EXISTS aadhaar_sealed text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS informed boolean NOT NULL DEFAULT false;
-- 'calls' = logged in from the phone app, which can only read lists and mark calls.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS app text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pan_kind text CHECK (pan_kind IN ('New', 'Correction'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_date text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS applied_on text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pan_agency text CHECK (pan_agency IN ('UTI', 'NSDL'));
-- PAN customers from before NSDL was added were all UTIITSL.
UPDATE customers SET pan_agency = 'UTI' WHERE type = 'pan' AND pan_agency IS NULL;

-- PAN numbers are kept without the U- from the receipt.
UPDATE customers c SET application_no = substr(c.application_no, 3)
WHERE c.type = 'pan' AND c.application_no ~ '^U-[A-Z][0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM customers x WHERE x.owner = c.owner AND x.type = 'pan' AND x.application_no = substr(c.application_no, 3));

CREATE TABLE IF NOT EXISTS operators (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS operators_owner_name ON operators (owner, lower(name));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS operator_id bigint REFERENCES operators(id) ON DELETE SET NULL;

-- Subscription plans. Every shop starts with a 14-day Premium trial (existing shops from the
-- day this was added). paid_until is the last day paid for.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'standard', 'premium'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing text NOT NULL DEFAULT 'monthly' CHECK (billing IN ('monthly', 'yearly'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends timestamptz DEFAULT (now() + interval '14 days');
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_until date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_request text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_request_at timestamptz;
-- Aadhaar storage is switched on per shop by the admin. Shops that already saved
-- Aadhaar numbers before plans existed keep it on (done once, see app_state).
ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhaar_on boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_state WHERE key = 'plans.aadhaar') THEN
    UPDATE users u SET aadhaar_on = true WHERE EXISTS (SELECT 1 FROM customers c WHERE c.owner = u.id AND c.aadhaar_sealed IS NOT NULL);
    INSERT INTO app_state (key, value) VALUES ('plans.aadhaar', 'done');
  END IF;
END $$;

-- Notices from the admin to shops. target NULL = every shop. Price notices carry the new price and its start date.
CREATE TABLE IF NOT EXISTS notices (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('update', 'price', 'notice')),
  title      text NOT NULL,
  body       text NOT NULL,
  target     text REFERENCES users(id) ON DELETE CASCADE,
  important  boolean NOT NULL DEFAULT false,
  price      integer,
  starts_on  date,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- TTD bookings: a group of pilgrims, prepared before the quota opens. Aadhaar only sealed.
CREATE TABLE IF NOT EXISTS ttd_bookings (
  id          text PRIMARY KEY,
  owner       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('sed300', 'angapradakshinam', 'edip', 'senior')),
  date_mode   text CHECK (date_mode IN ('fixed', 'range', 'any')),
  date_from   date,
  date_to     date,
  email       text NOT NULL,
  city        text NOT NULL,
  state       text NOT NULL,
  country     text NOT NULL,
  pincode     text NOT NULL,
  whatsapp    text NOT NULL,
  operator_id bigint REFERENCES operators(id) ON DELETE SET NULL,
  notes       text,
  status      text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'booked', 'failed')),
  ref_no      text,
  booked_at   timestamptz,
  ticket      bytea,
  ticket_name text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ttd_bookings_owner ON ttd_bookings(owner, status);
CREATE TABLE IF NOT EXISTS ttd_pilgrims (
  id             text PRIMARY KEY,
  booking_id     text NOT NULL REFERENCES ttd_bookings(id) ON DELETE CASCADE,
  position       integer NOT NULL,
  name           text NOT NULL,
  age            integer NOT NULL CHECK (age BETWEEN 1 AND 120),
  gender         text NOT NULL CHECK (gender IN ('Male', 'Female', 'Other')),
  id_type        text NOT NULL DEFAULT 'Aadhaar',
  aadhaar_last4  text CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  aadhaar_sealed text
);
CREATE INDEX IF NOT EXISTS ttd_pilgrims_booking ON ttd_pilgrims(booking_id, position);

CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id bigint NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_ref  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_ref)
);

-- Fees and payments. The shop's own price list fills in a new customer's fee.
-- TTD prices are per person. Amounts are whole rupees.
CREATE TABLE IF NOT EXISTS prices (
  owner  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key    text NOT NULL,
  amount integer NOT NULL CHECK (amount BETWEEN 0 AND 100000),
  PRIMARY KEY (owner, key)
);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fee integer CHECK (fee BETWEEN 0 AND 100000);
ALTER TABLE ttd_bookings ADD COLUMN IF NOT EXISTS fee integer CHECK (fee BETWEEN 0 AND 100000);
-- A payment keeps its label, so the day's total stays right after a customer is deleted.
CREATE TABLE IF NOT EXISTS payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  ttd_id      text REFERENCES ttd_bookings(id) ON DELETE SET NULL,
  label       text NOT NULL,
  amount      integer NOT NULL CHECK (amount BETWEEN 1 AND 100000),
  mode        text NOT NULL CHECK (mode IN ('cash', 'upi')),
  operator_id bigint REFERENCES operators(id) ON DELETE SET NULL,
  taken_by    text NOT NULL,
  paid_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_owner ON payments(owner, paid_at);
CREATE INDEX IF NOT EXISTS payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS payments_ttd ON payments(ttd_id);
-- Paid or not paid is what the shop tracks; the amounts above are optional detail.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment text CHECK (payment IN ('paid', 'unpaid'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_at timestamptz;
ALTER TABLE ttd_bookings ADD COLUMN IF NOT EXISTS payment text CHECK (payment IN ('paid', 'unpaid'));
ALTER TABLE ttd_bookings ADD COLUMN IF NOT EXISTS payment_at timestamptz;
CREATE INDEX IF NOT EXISTS customers_unpaid ON customers(owner) WHERE payment = 'unpaid';

-- Follow-up reminders on a customer or a TTD booking.
CREATE TABLE IF NOT EXISTS followups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id text REFERENCES customers(id) ON DELETE CASCADE,
  ttd_id      text REFERENCES ttd_bookings(id) ON DELETE CASCADE,
  due_on      date NOT NULL,
  note        text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  CHECK ((customer_id IS NULL) <> (ttd_id IS NULL))
);
CREATE INDEX IF NOT EXISTS followups_open ON followups(owner, due_on) WHERE done_at IS NULL;

-- Income and OBC certificates are renewed after a year: a reminder at 11 months.
-- 'sent' or 'skipped'. Only approvals from a year before this feature started count.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS renewal text CHECK (renewal IN ('sent', 'skipped'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS renewal_at timestamptz;
INSERT INTO app_state (key, value) VALUES ('renewals.start', now()::text) ON CONFLICT (key) DO NOTHING;

-- Monthly reports already emailed, one row per shop and month.
CREATE TABLE IF NOT EXISTS monthly_sent (
  owner   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month   text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  ok      boolean NOT NULL,
  error   text,
  PRIMARY KEY (owner, month)
);

-- Subscription payments. A shop asks ("I have paid", with the UPI reference), the
-- admin confirms, and the paid-until date moves on. The admin can also record one.
CREATE TABLE IF NOT EXISTS plan_payments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('renew', 'upgrade')),
  plan         text NOT NULL CHECK (plan IN ('standard', 'premium')),
  billing      text NOT NULL CHECK (billing IN ('monthly', 'yearly')),
  amount       integer NOT NULL CHECK (amount BETWEEN 0 AND 1000000),
  mode         text NOT NULL DEFAULT 'upi' CHECK (mode IN ('upi', 'cash', 'bank', 'other')),
  utr          text,
  note         text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  period_from  date,
  period_to    date,
  receipt_no   text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   text
);
CREATE INDEX IF NOT EXISTS plan_payments_owner ON plan_payments(owner, id DESC);
CREATE INDEX IF NOT EXISTS plan_payments_pending ON plan_payments(status) WHERE status = 'pending';

-- Every change to a shop's plan, and the reminders already sent.
CREATE TABLE IF NOT EXISTS plan_events (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at     timestamptz NOT NULL DEFAULT now(),
  actor  text NOT NULL,
  event  text NOT NULL,
  detail text
);
CREATE INDEX IF NOT EXISTS plan_events_owner ON plan_events(owner, event, detail);

-- Plans go live: every shop that has not paid gets a fresh 14-day Premium trial, once.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_state WHERE key = 'plans.live') THEN
    UPDATE users SET trial_ends = now() + interval '14 days' WHERE role = 'user' AND paid_until IS NULL;
    INSERT INTO app_state (key, value) VALUES ('plans.live', now()::text);
  END IF;
END $$;

-- Aadhaar name change: one case per customer. Community and Income certificates,
-- then OBC (when needed), then enrolment at the Aadhaar centre (SID). The stage is
-- worked out from the linked applications, so it moves by itself as they are checked.
CREATE TABLE IF NOT EXISTS name_cases (
  id             text PRIMARY KEY,
  owner          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  new_name_en    text NOT NULL,
  new_name_ta    text NOT NULL,
  whatsapp       text NOT NULL,
  aadhaar_last4  text CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  aadhaar_sealed text,
  requested_on   date NOT NULL,
  obc_needed     boolean NOT NULL DEFAULT true,
  operator_id    bigint REFERENCES operators(id) ON DELETE SET NULL,
  note           text,
  payment        text CHECK (payment IN ('paid', 'unpaid')),
  payment_at     timestamptz,
  fee            integer CHECK (fee BETWEEN 0 AND 100000),
  sid            text,
  enrolled_at    timestamptz,
  final          text CHECK (final IN ('updated', 'rejected')),
  finished_at    timestamptz,
  ready_sent_at  timestamptz,
  done_sent_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS name_cases_owner ON name_cases(owner, created_at DESC);
-- The certificates and the Aadhaar update of a case are ordinary customers, linked here.
ALTER TABLE name_cases ADD COLUMN IF NOT EXISTS name_ta text; -- the old name in Tamil, when the Aadhaar has one
ALTER TABLE customers ADD COLUMN IF NOT EXISTS case_id text REFERENCES name_cases(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS case_role text CHECK (case_role IN ('community', 'income', 'obc', 'aadhaar'));
CREATE INDEX IF NOT EXISTS customers_case ON customers(case_id) WHERE case_id IS NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS case_id text REFERENCES name_cases(id) ON DELETE SET NULL;
ALTER TABLE followups ADD COLUMN IF NOT EXISTS case_id text REFERENCES name_cases(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followups_check' AND conrelid = 'followups'::regclass) THEN
    ALTER TABLE followups DROP CONSTRAINT followups_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followups_one_target' AND conrelid = 'followups'::regclass) THEN
    ALTER TABLE followups ADD CONSTRAINT followups_one_target CHECK (num_nonnulls(customer_id, ttd_id, case_id) = 1);
  END IF;
END $$;
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
