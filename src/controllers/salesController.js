const { query, getClient } = require('../config/db');
const { setFlash } = require('../middleware/flash');
const { getStoreSettings } = require('../utils/storeSettings');
const { STORE_TZ, PAYMENT_LABELS, storeToday, pageList, toCsv, shortDateTime } = require('../utils/helpers');

const PAGE_SIZE = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Reads the filter bar. With no dates in the URL it defaults to the last 7
// days; dates that are present but blank mean "no limit".
function readFilters(q) {
  const date = (v, fallback) => (v === undefined ? fallback : DATE_PATTERN.test(v) ? v : '');
  return {
    q: (q.q || '').trim().slice(0, 100),
    from: date(q.from, storeToday(-6)),
    to: date(q.to, storeToday()),
    cashier: /^\d+$/.test(q.cashier || '') ? q.cashier : '',
    payment: PAYMENT_LABELS[q.payment] ? q.payment : '',
  };
}

// WHERE clause for the filters; $1 is always the store timezone.
function filterSql(f) {
  const params = [STORE_TZ];
  const where = [];
  if (f.from) {
    params.push(f.from);
    where.push(`s.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE $1`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`s.created_at < ($${params.length}::date + 1)::timestamp AT TIME ZONE $1`);
  }
  if (f.cashier) {
    params.push(Number(f.cashier));
    where.push(`s.user_id = $${params.length}`);
  }
  if (f.payment) {
    params.push(f.payment);
    where.push(`s.payment_method = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = params.length;
    where.push(`(s.receipt_no ILIKE $${n}
                 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_name ILIKE $${n}))`);
  }
  // Keep $1 referenced even with no date filter, so Postgres can type it.
  where.push('$1::text IS NOT NULL');
  return { where: where.join(' AND '), params };
}

const SALE_COLUMNS = `s.id, s.receipt_no, s.created_at, s.total_amount, s.amount_paid, s.change_amount,
  s.payment_method, s.payment_ref, s.status, s.refunded_at, u.full_name AS cashier,
  (SELECT string_agg(si.product_name || CASE WHEN si.quantity > 1 THEN ' ×' || si.quantity ELSE '' END, ', ' ORDER BY si.id)
   FROM sale_items si WHERE si.sale_id = s.id) AS items_summary,
  (SELECT COALESCE(SUM(si.quantity), 0)::int FROM sale_items si WHERE si.sale_id = s.id) AS item_count`;

function queryString(f, extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...f, ...extra }).forEach(([k, v]) => {
    if (k === 'from' || k === 'to' || (v !== '' && v !== undefined && v !== null)) params.set(k, v);
  });
  return params.toString();
}

async function loadSale(id) {
  const { rows } = await query(
    `SELECT s.*, u.full_name AS cashier, r.full_name AS refunded_by_name
     FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.refunded_by
     WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: items } = await query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [id]);
  return { ...rows[0], items };
}

async function listSales(req, res, next) {
  const f = readFilters(req.query);
  const { where, params } = filterSql(f);
  try {
    const [totals, cashiers] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(total_amount), 0) AS gross,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'refunded'), 0) AS refunds,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed' AND payment_method = 'cash'), 0) AS cash,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed' AND payment_method = 'gcash'), 0) AS gcash,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed' AND payment_method = 'card'), 0) AS card
         FROM sales s WHERE ${where}`,
        params
      ).then((r) => r.rows[0]),
      query(
        `SELECT id, full_name FROM users
         WHERE role = 'sales_rep' OR id IN (SELECT DISTINCT user_id FROM sales)
         ORDER BY full_name`
      ).then((r) => r.rows),
    ]);

    const pageCount = Math.max(1, Math.ceil(totals.count / PAGE_SIZE));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pageCount);
    const { rows: sales } = await query(
      `SELECT ${SALE_COLUMNS}
       FROM sales s JOIN users u ON u.id = s.user_id
       WHERE ${where}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params
    );

    const selectedId = /^\d+$/.test(req.query.selected || '') ? Number(req.query.selected) : sales[0] && sales[0].id;
    const [selected, store] = await Promise.all([selectedId ? loadSale(selectedId) : null, getStoreSettings()]);

    const paid = totals.cash + totals.gcash + totals.card;
    const split = ['cash', 'gcash', 'card'].map((m) => (paid ? Math.round((totals[m] / paid) * 100) : 0));

    res.render('admin/sales', {
      title: 'Sales',
      store,
      filters: f,
      cashiers,
      totals: { ...totals, net: totals.gross - totals.refunds, split, hasPaid: paid > 0 },
      sales,
      selected,
      page,
      pageCount,
      pages: pageList(page, pageCount),
      showingFrom: totals.count ? (page - 1) * PAGE_SIZE + 1 : 0,
      showingTo: (page - 1) * PAGE_SIZE + sales.length,
      queryString: (extra) => queryString(f, extra),
      currentUrl: req.originalUrl,
    });
  } catch (err) {
    next(err);
  }
}

async function exportSales(req, res, next) {
  const f = readFilters(req.query);
  const { where, params } = filterSql(f);
  try {
    const { rows } = await query(
      `SELECT ${SALE_COLUMNS}
       FROM sales s JOIN users u ON u.id = s.user_id
       WHERE ${where}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 20000`,
      params
    );
    const csv = toCsv([
      ['Receipt', 'Date', 'Cashier', 'Payment', 'Reference', 'Status', 'Items', 'Item count', 'Total', 'Amount paid', 'Change'],
      ...rows.map((s) => [
        s.receipt_no,
        shortDateTime(s.created_at),
        s.cashier,
        PAYMENT_LABELS[s.payment_method],
        s.payment_ref,
        s.status === 'refunded' ? 'Refunded' : 'Completed',
        s.items_summary,
        s.item_count,
        s.total_amount.toFixed(2),
        s.amount_paid.toFixed(2),
        s.change_amount.toFixed(2),
      ]),
    ]);
    const name = `sales-${f.from || 'start'}-to-${f.to || storeToday()}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send('﻿' + csv); // BOM so Excel reads ₱ and accents correctly
  } catch (err) {
    next(err);
  }
}

// Marks the sale refunded and puts its items back on the shelf.
async function refundSale(req, res, next) {
  const back = typeof req.body.back === 'string' && req.body.back.startsWith('/admin/sales') ? req.body.back : '/admin/sales';
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT id, receipt_no, status FROM sales WHERE id = $1 FOR UPDATE", [
      req.params.id,
    ]);
    const sale = rows[0];
    if (!sale || sale.status !== 'completed') {
      await client.query('ROLLBACK');
      setFlash(req, 'error', sale ? `Receipt ${sale.receipt_no} was already refunded.` : 'Sale not found.');
      return res.redirect(back);
    }
    await client.query(
      "UPDATE sales SET status = 'refunded', refunded_at = NOW(), refunded_by = $2 WHERE id = $1",
      [sale.id, req.session.user.id]
    );
    await client.query(
      `UPDATE products p SET stock_quantity = p.stock_quantity + returned.qty, updated_at = NOW()
       FROM (SELECT product_id, SUM(quantity) AS qty FROM sale_items
             WHERE sale_id = $1 AND product_id IS NOT NULL GROUP BY product_id) returned
       WHERE p.id = returned.product_id`,
      [sale.id]
    );
    await client.query('COMMIT');
    setFlash(req, 'success', `Receipt ${sale.receipt_no} refunded. Items are back in stock.`);
    res.redirect(back);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function viewSale(req, res, next) {
  try {
    const sale = await loadSale(req.params.id);
    if (!sale) return res.status(404).render('error', { title: 'Not Found', message: 'Sale not found.' });
    res.render('admin/sale_detail', { title: 'Sale Detail', sale, items: sale.items });
  } catch (err) {
    next(err);
  }
}

module.exports = { listSales, exportSales, refundSale, viewSale };
