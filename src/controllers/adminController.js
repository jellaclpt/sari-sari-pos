const bcrypt = require('bcryptjs');
const { query, getClient } = require('../config/db');
const { setFlash } = require('../middleware/flash');
const { tempPassword, STORE_TZ, storeToday } = require('../utils/helpers');

// ---- Users ----

async function listUsers(req, res, next) {
  try {
    const [{ rows: users }, { rows: accessRequests }, { rows: resetRequests }] = await Promise.all([
      query(
        `SELECT id, username, full_name, role, active, contact, must_change_password, created_at
         FROM users ORDER BY active DESC, role, username`
      ),
      query("SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at"),
      query(
        `SELECT password_reset_requests.*, users.username, users.full_name, users.contact
         FROM password_reset_requests JOIN users ON users.id = password_reset_requests.user_id
         WHERE password_reset_requests.status = 'pending' ORDER BY password_reset_requests.created_at`
      ),
    ]);
    res.render('admin/users', { title: 'Users', users, accessRequests, resetRequests });
  } catch (err) {
    next(err);
  }
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

async function createUser(req, res, next) {
  const username = String(req.body.username || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const contact = String(req.body.contact || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'sales_rep';
  // Without a password, the account gets a temporary one to hand over.
  const temporary = !password;
  try {
    let problem = null;
    if (!fullName) problem = 'Enter a full name.';
    else if (!USERNAME_PATTERN.test(username)) problem = 'Usernames use 3–30 lowercase letters, numbers, dots, dashes or underscores.';
    else if (!temporary && password.length < 6) problem = 'Passwords need at least 6 characters.';
    if (!problem) {
      const { rows } = await query('SELECT 1 FROM users WHERE LOWER(username) = $1', [username]);
      if (rows.length) problem = `The username "${username}" is already taken.`;
    }
    if (problem) {
      setFlash(req, 'error', problem);
      return res.redirect('/admin/users');
    }

    const finalPassword = temporary ? tempPassword() : password;
    await query(
      `INSERT INTO users (username, password_hash, full_name, role, contact, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [username, bcrypt.hashSync(finalPassword, 10), fullName, role, contact || null, temporary]
    );
    if (temporary) {
      setFlash(req, 'notice', `Created "${username}". Temporary password: ${finalPassword} — they'll choose their own when they sign in.`);
    } else {
      setFlash(req, 'success', `User "${username}" created.`);
    }
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

// Admin hands a user a new temporary password (e.g. they forgot theirs and
// didn't file a request).
async function resetUserPassword(req, res, next) {
  const id = Number(req.params.id);
  try {
    if (id === req.session.user.id) {
      setFlash(req, 'error', 'Change your own password from Settings.');
      return res.redirect('/admin/users');
    }
    const password = tempPassword();
    const { rows } = await query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2 RETURNING username',
      [bcrypt.hashSync(password, 10), id]
    );
    if (!rows.length) {
      setFlash(req, 'error', 'User not found.');
      return res.redirect('/admin/users');
    }
    await query(
      "UPDATE password_reset_requests SET status = 'resolved', resolved_at = NOW() WHERE user_id = $1 AND status = 'pending'",
      [id]
    );
    setFlash(req, 'notice', `Temporary password for "${rows[0].username}": ${password}. They'll choose a new one when they sign in.`);
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

async function toggleUserActive(req, res, next) {
  const { id } = req.params;
  try {
    if (Number(id) === req.session.user.id) {
      setFlash(req, 'error', 'You cannot deactivate your own account.');
      return res.redirect('/admin/users');
    }
    const { rows } = await query('UPDATE users SET active = NOT active WHERE id = $1 RETURNING username, active', [id]);
    if (rows.length) setFlash(req, 'success', `"${rows[0].username}" ${rows[0].active ? 'activated' : 'deactivated'}.`);
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

// ---- Access & password-reset requests ----

// Shared on every admin page so the sidebar can flag requests waiting for
// review and inventory reports filed today.
async function pendingRequestCount(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT (SELECT COUNT(*) FROM access_requests WHERE status = 'pending')
            + (SELECT COUNT(*) FROM password_reset_requests WHERE status = 'pending') AS count,
              (SELECT COUNT(*) FROM inventory_reports
               WHERE created_at >= ($2::date)::timestamp AT TIME ZONE $1) AS reports_today`,
      [STORE_TZ, storeToday()]
    );
    res.locals.pendingRequests = Number(rows[0].count);
    res.locals.reportsToday = Number(rows[0].reports_today);
    next();
  } catch (err) {
    next(err);
  }
}

async function approveAccessRequest(req, res, next) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT * FROM access_requests WHERE id = $1 AND status = 'pending' FOR UPDATE",
      [req.params.id]
    );
    const request = rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      setFlash(req, 'error', 'That request was already handled.');
      return res.redirect('/admin/users');
    }

    const { rows: taken } = await client.query('SELECT 1 FROM users WHERE LOWER(username) = $1', [request.username]);
    if (taken.length) {
      await client.query('ROLLBACK');
      setFlash(req, 'error', `The username "${request.username}" is already taken. Reject this request or add the user manually.`);
      return res.redirect('/admin/users');
    }

    // Requests only ever create sales reps, even ones submitted before the
    // Admin option was disabled; admins are added with the "Add User" form.
    const password = tempPassword();
    await client.query(
      `INSERT INTO users (username, password_hash, full_name, role, contact, must_change_password)
       VALUES ($1, $2, $3, 'sales_rep', $4, TRUE)`,
      [request.username, bcrypt.hashSync(password, 10), request.full_name, request.contact]
    );
    await client.query("UPDATE access_requests SET status = 'approved', resolved_at = NOW() WHERE id = $1", [
      request.id,
    ]);
    await client.query('COMMIT');

    setFlash(
      req,
      'notice',
      `Created "${request.username}". Temporary password: ${password} — send it to ${request.contact}. They'll choose their own when they sign in.`
    );
    res.redirect('/admin/users');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function rejectAccessRequest(req, res, next) {
  try {
    await query("UPDATE access_requests SET status = 'rejected', resolved_at = NOW() WHERE id = $1 AND status = 'pending'", [
      req.params.id,
    ]);
    setFlash(req, 'success', 'Access request rejected.');
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

async function resolvePasswordReset(req, res, next) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT password_reset_requests.id, users.id AS user_id, users.username, users.contact
       FROM password_reset_requests JOIN users ON users.id = password_reset_requests.user_id
       WHERE password_reset_requests.id = $1 AND password_reset_requests.status = 'pending'
       FOR UPDATE OF password_reset_requests`,
      [req.params.id]
    );
    const request = rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      setFlash(req, 'error', 'That request was already handled.');
      return res.redirect('/admin/users');
    }

    const password = tempPassword();
    await client.query('UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2', [
      bcrypt.hashSync(password, 10),
      request.user_id,
    ]);
    await client.query("UPDATE password_reset_requests SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [
      request.id,
    ]);
    await client.query('COMMIT');

    const reach = request.contact ? ` Send it to ${request.contact}.` : '';
    setFlash(
      req,
      'notice',
      `Temporary password for "${request.username}": ${password}.${reach} They'll choose a new one when they sign in.`
    );
    res.redirect('/admin/users');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function dismissPasswordReset(req, res, next) {
  try {
    await query(
      "UPDATE password_reset_requests SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'pending'",
      [req.params.id]
    );
    setFlash(req, 'success', 'Password reset request dismissed.');
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

// ---- Inventory reports (submitted by sales reps) ----

const REPORT_TYPES = ['restock', 'damaged', 'lost', 'correction'];

async function listInventoryReports(req, res, next) {
  const filters = {
    type: REPORT_TYPES.includes(req.query.type) ? req.query.type : '',
    q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '',
    staff: /^\d+$/.test(req.query.staff || '') ? req.query.staff : '',
  };
  const where = [];
  const params = [];
  if (filters.type) {
    params.push(filters.type);
    where.push(`inventory_reports.type = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`COALESCE(products.name, '') ILIKE $${params.length}`);
  }
  if (filters.staff) {
    params.push(Number(filters.staff));
    where.push(`inventory_reports.user_id = $${params.length}`);
  }
  try {
    const [{ rows: reports }, { rows: summaryRows }, { rows: staff }] = await Promise.all([
      query(
        `SELECT inventory_reports.*, COALESCE(products.name, 'Deleted product') AS product_name,
                products.unit, users.full_name AS reported_by
         FROM inventory_reports
         LEFT JOIN products ON products.id = inventory_reports.product_id
         JOIN users ON users.id = inventory_reports.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY inventory_reports.created_at DESC LIMIT 200`,
        params
      ),
      // Totals for the last 30 days, by store-local date.
      query(
        `SELECT COUNT(*)::int AS reports,
                COALESCE(SUM(quantity_change) FILTER (WHERE type = 'restock'), 0)::int AS added,
                COALESCE(-SUM(quantity_change) FILTER (WHERE type IN ('damaged', 'lost')), 0)::int AS lost,
                COALESCE(SUM(quantity_change) FILTER (WHERE type = 'correction'), 0)::int AS corrected
         FROM inventory_reports
         WHERE created_at >= ($2::date)::timestamp AT TIME ZONE $1`,
        [STORE_TZ, storeToday(-29)]
      ),
      query(
        `SELECT DISTINCT users.id, users.full_name FROM users
         JOIN inventory_reports ON inventory_reports.user_id = users.id ORDER BY users.full_name`
      ),
    ]);
    res.render('admin/inventory_reports', {
      title: 'Inventory Reports',
      reports,
      summary: summaryRows[0],
      staff,
      filters,
      reportTypes: REPORT_TYPES,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  createUser,
  toggleUserActive,
  resetUserPassword,
  pendingRequestCount,
  approveAccessRequest,
  rejectAccessRequest,
  resolvePasswordReset,
  dismissPasswordReset,
  listInventoryReports,
};
