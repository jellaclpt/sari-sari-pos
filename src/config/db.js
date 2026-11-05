const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool, types } = require('pg');

// Return NUMERIC columns (money, quantities stored as NUMERIC) as JS numbers
// instead of node-postgres's default string representation.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const connectionString =
  process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  throw new Error(
    'No Postgres connection string found. Set POSTGRES_URL (or DATABASE_URL) in your environment — ' +
      'e.g. via `vercel env pull` for a Vercel Postgres database, or a local Postgres instance for development.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
});

// Default admin account, created automatically when the database has no
// admin yet, so a fresh deployment can be signed into without running the
// seed script. Change this password after the first sign-in.
const DEFAULT_ADMIN = { username: 'admin01', password: 'Admin@123', fullName: 'Administrator' };

async function ensureDefaultAdmin() {
  const { rows } = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length) return;
  await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [DEFAULT_ADMIN.username, bcrypt.hashSync(DEFAULT_ADMIN.password, 10), DEFAULT_ADMIN.fullName]
  );
}

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    schemaReady = pool.query(schema).then(ensureDefaultAdmin).catch((err) => {
      schemaReady = null; // allow a retry on the next call if it failed
      throw err;
    });
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureSchema();
  return pool.query(text, params);
}

// For multi-statement transactions (checkout, inventory adjustments) where
// several writes must succeed or fail together. Caller is responsible for
// BEGIN/COMMIT/ROLLBACK and must always release the client.
async function getClient() {
  await ensureSchema();
  return pool.connect();
}

module.exports = { query, getClient, pool, ensureSchema, DEFAULT_ADMIN };
