const { query, getClient } = require('../config/db');
const { generateReceiptNo } = require('../utils/helpers');
const { setFlash } = require('../middleware/flash');
const { getStoreSettings } = require('../utils/storeSettings');

async function posScreen(req, res, next) {
  try {
    const { rows: products } = await query(
      'SELECT * FROM products WHERE active = TRUE AND stock_quantity > 0 ORDER BY name'
    );
    res.render('pos/index', { title: 'Point of Sale', products });
  } catch (err) {
    next(err);
  }
}

async function searchProducts(req, res, next) {
  try {
    const q = `%${req.query.q || ''}%`;
    const { rows: products } = await query(
      `SELECT id, name, barcode, unit, selling_price, stock_quantity
       FROM products WHERE active = TRUE AND (name ILIKE $1 OR barcode ILIKE $1) ORDER BY name LIMIT 20`,
      [q]
    );
    res.json(products);
  } catch (err) {
    next(err);
  }
}

const PAYMENT_METHODS = ['cash', 'gcash', 'card'];

async function checkout(items, amountPaid, userId, paymentMethod = 'cash', paymentRef = null) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    let total = 0;
    const resolvedItems = [];

    for (const item of items) {
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 AND active = TRUE FOR UPDATE', [
        item.productId,
      ]);
      const product = rows[0];
      if (!product) throw new Error('Product not found.');
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid quantity for ${product.name}.`);
      if (product.stock_quantity < quantity) {
        throw new Error(`Not enough stock for "${product.name}" (only ${product.stock_quantity} ${product.unit} left).`);
      }
      const subtotal = product.selling_price * quantity;
      total += subtotal;
      resolvedItems.push({ product, quantity, subtotal });
    }

    if (resolvedItems.length === 0) throw new Error('Cart is empty.');
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Choose a payment method.');
    // GCash and card payments are for the exact total, so there's no change.
    if (paymentMethod !== 'cash') amountPaid = total;
    if (amountPaid < total) throw new Error('Amount paid is less than the total.');

    const receiptNo = generateReceiptNo();
    const saleResult = await client.query(
      `INSERT INTO sales (receipt_no, user_id, total_amount, amount_paid, change_amount, payment_method, payment_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [receiptNo, userId, total, amountPaid, amountPaid - total, paymentMethod, paymentMethod === 'cash' ? null : paymentRef]
    );
    const saleId = saleResult.rows[0].id;

    for (const { product, quantity, subtotal } of resolvedItems) {
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
        [saleId, product.id, product.name, product.selling_price, quantity, subtotal]
      );
      await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [
        product.stock_quantity - quantity,
        product.id,
      ]);
    }

    await client.query('COMMIT');
    return saleId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postCheckout(req, res) {
  try {
    const items = JSON.parse(req.body.items || '[]');
    const amountPaid = Number(req.body.amount_paid);
    const paymentRef = (req.body.payment_ref || '').trim().slice(0, 60) || null;
    const saleId = await checkout(items, amountPaid, req.session.user.id, req.body.payment_method || 'cash', paymentRef);
    res.redirect(`/pos/receipt/${saleId}`);
  } catch (err) {
    setFlash(req, 'error', err.message);
    res.redirect('/pos');
  }
}

async function viewReceipt(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
    const sale = rows[0];
    if (!sale) return res.status(404).render('error', { title: 'Not Found', message: 'Receipt not found.' });
    const [{ rows: items }, store] = await Promise.all([
      query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]),
      getStoreSettings(),
    ]);
    res.render('pos/receipt', { title: 'Receipt', sale, items, store });
  } catch (err) {
    next(err);
  }
}

// ---- Inventory (view stock + submit reports) ----

async function inventoryScreen(req, res, next) {
  try {
    const [products, myReports] = await Promise.all([
      query('SELECT * FROM products WHERE active = TRUE ORDER BY name').then((r) => r.rows),
      query(
        `SELECT inventory_reports.*, COALESCE(products.name, 'Deleted product') AS product_name
         FROM inventory_reports LEFT JOIN products ON products.id = inventory_reports.product_id
         WHERE inventory_reports.user_id = $1
         ORDER BY inventory_reports.created_at DESC LIMIT 20`,
        [req.session.user.id]
      ).then((r) => r.rows),
    ]);
    res.render('pos/inventory', { title: 'Inventory', products, myReports });
  } catch (err) {
    next(err);
  }
}

async function submitReport(productId, type, quantityChange, note, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    const product = rows[0];
    if (!product) throw new Error('Product not found.');

    const newQuantity = product.stock_quantity + quantityChange;
    if (newQuantity < 0) throw new Error(`That would bring "${product.name}" below zero stock.`);

    await client.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [
      newQuantity,
      productId,
    ]);
    await client.query(
      'INSERT INTO inventory_reports (user_id, product_id, type, quantity_change, note) VALUES ($1, $2, $3, $4, $5)',
      [userId, productId, type, quantityChange, note || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postInventoryReport(req, res) {
  const { product_id, type, quantity, note } = req.body;
  const qty = Number(quantity);
  try {
    if (!Number.isFinite(qty) || qty === 0) throw new Error('Enter a non-zero quantity.');
    const signedQty = type === 'restock' ? Math.abs(qty) : -Math.abs(qty);
    await submitReport(Number(product_id), type, signedQty, note, req.session.user.id);
    setFlash(req, 'success', 'Inventory report submitted.');
  } catch (err) {
    setFlash(req, 'error', err.message);
  }
  res.redirect('/pos/inventory');
}

module.exports = {
  posScreen,
  searchProducts,
  postCheckout,
  viewReceipt,
  inventoryScreen,
  postInventoryReport,
};
