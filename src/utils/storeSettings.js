const { query } = require('../config/db');

// Store details printed on receipts. Admins edit them in Settings.
const STORE_FIELDS = {
  store_name: { label: 'Store name', max: 60, fallback: 'MOON' },
  store_address: { label: 'Address', max: 160, fallback: '' },
  store_contact: { label: 'Contact', max: 80, fallback: '' },
  receipt_footer: { label: 'Receipt message', max: 160, fallback: 'Thank you for shopping with us!' },
};

async function getStoreSettings() {
  const { rows } = await query('SELECT key, value FROM store_settings');
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const [key, def] of Object.entries(STORE_FIELDS)) {
    out[key] = key in saved ? saved[key] : def.fallback;
  }
  return out;
}

async function saveStoreSettings(values) {
  for (const key of Object.keys(STORE_FIELDS)) {
    await query(
      `INSERT INTO store_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, values[key] ?? '']
    );
  }
}

module.exports = { STORE_FIELDS, getStoreSettings, saveStoreSettings };
