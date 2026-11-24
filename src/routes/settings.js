const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { setFlash } = require('../middleware/flash');
const { STORE_FIELDS, getStoreSettings, saveStoreSettings } = require('../utils/storeSettings');

const router = express.Router();

const MIN_PASSWORD = 6;
const SECTIONS = ['profile', 'password', 'store', 'categories'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function render(req, res, { section = 'profile', errors = {}, values = {}, status = 200 } = {}) {
  const isAdmin = req.session.user.role === 'admin';
  if ((section === 'store' || section === 'categories') && !isAdmin) section = 'profile';
  const [{ rows }, store, categoryResult] = await Promise.all([
    query('SELECT username, full_name, contact, role, created_at FROM users WHERE id = $1', [req.session.user.id]),
    isAdmin ? getStoreSettings() : Promise.resolve(null),
    section === 'categories' && isAdmin
      ? query('SELECT id, name, parent_id FROM categories ORDER BY parent_id NULLS FIRST, name')
      : Promise.resolve({ rows: [] }),
  ]);
  const categoryGroups = categoryResult.rows
    .filter((category) => !category.parent_id)
    .map((group) => ({ ...group, children: categoryResult.rows.filter((category) => category.parent_id === group.id) }));
  res.status(status).render('settings', {
    title: 'Settings',
    themed: true,
    section,
    account: rows[0],
    store: section === 'store' && Object.keys(values).length ? values : store,
    storeFields: STORE_FIELDS,
    categories: categoryResult.rows,
    categoryGroups,
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
// ---- Category and subcategory management (admin only) ----
router.post('/categories', async (req, res, next) => {
  if (req.session.user.role !== 'admin') return res.redirect('/settings');
  const name = clean(req.body.name).slice(0, 60);
  const parentId = /^\d+$/.test(String(req.body.parent_id || '')) ? Number(req.body.parent_id) : null;
  try {
    if (!name) {
      setFlash(req, 'error', 'Enter a category name.');
      return res.redirect('/settings?section=categories');
    }
    if (parentId) {
      const { rows } = await query('SELECT id, parent_id FROM categories WHERE id = $1', [parentId]);
      if (!rows[0] || rows[0].parent_id) {
        setFlash(req, 'error', 'Choose a valid top-level category.');
        return res.redirect('/settings?section=categories');
      }
    }
    const { rows } = await query(
      'INSERT INTO categories (name, parent_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id',
      [name, parentId]
    );
    if (!rows[0]) setFlash(req, 'error', `There is already a category named "${name}".`);
    else setFlash(req, 'success', `Category "${name}" added.`);
    res.redirect('/settings?section=categories');
  } catch (err) {
    next(err);
  }
});

router.post('/categories/:id/update', async (req, res, next) => {
  if (req.session.user.role !== 'admin') return res.redirect('/settings');
  const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
  const name = clean(req.body.name).slice(0, 60);
  const parentId = /^\d+$/.test(String(req.body.parent_id || '')) ? Number(req.body.parent_id) : null;
  if (!id || !name) {
    setFlash(req, 'error', 'Enter a category name.');
    return res.redirect('/settings?section=categories');
  }
  try {
    const { rows } = await query('SELECT id, parent_id FROM categories WHERE id = $1', [id]);
    if (!rows[0]) {
      setFlash(req, 'error', 'That category no longer exists.');
      return res.redirect('/settings?section=categories');
    }
    if (parentId) {
      if (parentId === id) {
        setFlash(req, 'error', 'A category cannot be its own subcategory.');
        return res.redirect('/settings?section=categories');
      }
      const [{ rows: parents }, { rows: children }] = await Promise.all([
        query('SELECT id, parent_id FROM categories WHERE id = $1', [parentId]),
        query('SELECT id FROM categories WHERE parent_id = $1 LIMIT 1', [id]),
      ]);
      if (!parents[0] || parents[0].parent_id) {
        setFlash(req, 'error', 'Choose a valid top-level category.');
        return res.redirect('/settings?section=categories');
      }
      if (children[0]) {
        setFlash(req, 'error', 'Move subcategories before making this category a subcategory.');
        return res.redirect('/settings?section=categories');
      }
    }
    await query('UPDATE categories SET name = $1, parent_id = $2 WHERE id = $3', [name, parentId, id]);
    setFlash(req, 'success', `Category renamed to "${name}".`);
    res.redirect('/settings?section=categories');
  } catch (err) {
    if (err.code === '23505') setFlash(req, 'error', `There is already a category named "${name}".`);
    else return next(err);
    res.redirect('/settings?section=categories');
  }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  if (req.session.user.role !== 'admin') return res.redirect('/settings');
  const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
  if (!id) return res.redirect('/settings?section=categories');
  try {
    const { rows: used } = await query('SELECT id FROM products WHERE category_id = $1 LIMIT 1', [id]);
    if (used[0]) {
      setFlash(req, 'error', 'This category is used by a product and cannot be deleted.');
      return res.redirect('/settings?section=categories');
    }
    const { rows } = await query('DELETE FROM categories WHERE id = $1 RETURNING name', [id]);
    if (rows[0]) setFlash(req, 'success', `Category "${rows[0].name}" deleted.`);
    else setFlash(req, 'error', 'That category no longer exists.');
    res.redirect('/settings?section=categories');
  } catch (err) {
    next(err);
  }
});

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
