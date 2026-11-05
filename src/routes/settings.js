const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { setFlash } = require('../middleware/flash');
const { STORE_FIELDS, getStoreSettings, saveStoreSettings } = require('../utils/storeSettings');

const router = express.Router();

const MIN_PASSWORD = 6;
const SECTIONS = ['profile', 'password', 'store'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function render(req, res, { section = 'profile', errors = {}, values = {}, status = 200 } = {}) {
  const isAdmin = req.session.user.role === 'admin';
  if (section === 'store' && !isAdmin) section = 'profile';
  const [{ rows }, store] = await Promise.all([
    query('SELECT username, full_name, contact, role, created_at FROM users WHERE id = $1', [req.session.user.id]),
    isAdmin ? getStoreSettings() : Promise.resolve(null),
  ]);
  res.status(status).render('settings', {
    title: 'Settings',
    themed: true,
    section,
    account: rows[0],
    store: section === 'store' && Object.keys(values).length ? values : store,
    storeFields: STORE_FIELDS,
    values,
    errors,
    isAdmin,
  });
}

router.get('/', async (req, res, next) => {
  try {
    const section = SECTIONS.includes(req.query.section) ? req.query.section : 'profile';
    await render(req, res, { section });
  } catch (err) {
    next(err);
  }
});

// ---- Profile: name and contact ----
router.post('/profile', async (req, res, next) => {
  const values = { full_name: clean(req.body.full_name), contact: clean(req.body.contact) };
  const errors = {};
  try {
    if (!values.full_name) errors.full_name = 'Enter your full name.';
    else if (values.full_name.length > 80) errors.full_name = 'Keep it under 80 characters.';
    if (values.contact.length > 80) errors.contact = 'Keep it under 80 characters.';
    if (Object.keys(errors).length) return render(req, res, { section: 'profile', errors, values, status: 422 });

    await query('UPDATE users SET full_name = $1, contact = $2 WHERE id = $3', [
      values.full_name,
      values.contact || null,
      req.session.user.id,
    ]);
    req.session.user = { ...req.session.user, fullName: values.full_name };
    setFlash(req, 'success', 'Profile updated.');
    res.redirect('/settings');
  } catch (err) {
    next(err);
  }
});

// ---- Password: requires the current one ----
router.post('/password', async (req, res, next) => {
  const current = req.body.current_password || '';
  const password = req.body.password || '';
  const confirm = req.body.confirm_password || '';
  const errors = {};
  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
    const hash = rows[0] && rows[0].password_hash;

    if (!current) errors.current_password = 'Enter your current password.';
    else if (!hash || !bcrypt.compareSync(current, hash)) errors.current_password = 'That is not your current password.';

    if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
    else if (password === current) errors.password = 'Choose a password different from your current one.';
    else if (password !== confirm) errors.confirm_password = 'Passwords do not match.';

    if (Object.keys(errors).length) return render(req, res, { section: 'password', errors, status: 422 });

    await query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [
      bcrypt.hashSync(password, 10),
      req.session.user.id,
    ]);
    setFlash(req, 'success', 'Password changed.');
    res.redirect('/settings?section=password');
  } catch (err) {
    next(err);
  }
});

// ---- Store details on receipts (admin only) ----
router.post('/store', async (req, res, next) => {
  if (req.session.user.role !== 'admin') return res.redirect('/settings');
  const values = {};
  const errors = {};
  try {
    for (const [key, def] of Object.entries(STORE_FIELDS)) {
      values[key] = clean(req.body[key]);
      if (values[key].length > def.max) errors[key] = `Keep it under ${def.max} characters.`;
    }
    if (!values.store_name) errors.store_name = 'Enter the store name.';
    if (Object.keys(errors).length) return render(req, res, { section: 'store', errors, values, status: 422 });

    await saveStoreSettings(values);
    setFlash(req, 'success', 'Store details saved.');
    res.redirect('/settings?section=store');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
