require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool, DEFAULT_ADMIN } = require('../config/db');

async function upsertUser({ username, password, fullName, role }) {
  const { rows } = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (rows.length) return;
  const hash = bcrypt.hashSync(password, 10);
  await query('INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)', [
    username,
    hash,
    fullName,
    role,
  ]);
  console.log(`Created ${role} user "${username}" with password "${password}"`);
}

async function upsertCategory(name) {
  await query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  const { rows } = await query('SELECT id FROM categories WHERE name = $1', [name]);
  return rows[0].id;
}

async function upsertProduct(p) {
  const { rows } = await query('SELECT id FROM products WHERE name = $1', [p.name]);
  if (rows.length) return;
  await query(
    `INSERT INTO products (name, barcode, category_id, unit, cost_price, selling_price, stock_quantity, reorder_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [p.name, p.barcode, p.category_id, p.unit, p.cost_price, p.selling_price, p.stock_quantity, p.reorder_level]
  );
}

async function main() {
  await upsertUser({ ...DEFAULT_ADMIN, role: 'admin' });
  await upsertUser({ username: 'cashier1', password: 'cashier123', fullName: 'Juana Cruz', role: 'sales_rep' });

  const snacks = await upsertCategory('Snacks');
  const beverages = await upsertCategory('Beverages');
  const household = await upsertCategory('Household');

  await upsertProduct({ name: 'Instant Noodles', barcode: '4800016641234', category_id: snacks, unit: 'pack', cost_price: 8, selling_price: 12, stock_quantity: 50, reorder_level: 10 });
  await upsertProduct({ name: 'Canned Sardines', barcode: '4800016642345', category_id: snacks, unit: 'can', cost_price: 15, selling_price: 22, stock_quantity: 40, reorder_level: 10 });
  await upsertProduct({ name: 'Soft Drinks 1.5L', barcode: '4800016643456', category_id: beverages, unit: 'bottle', cost_price: 45, selling_price: 65, stock_quantity: 24, reorder_level: 6 });
  await upsertProduct({ name: 'Bottled Water 500mL', barcode: '4800016644567', category_id: beverages, unit: 'bottle', cost_price: 7, selling_price: 12, stock_quantity: 60, reorder_level: 12 });
  await upsertProduct({ name: 'Laundry Soap Bar', barcode: '4800016645678', category_id: household, unit: 'pc', cost_price: 10, selling_price: 15, stock_quantity: 30, reorder_level: 8 });
  await upsertProduct({ name: 'Cooking Oil 1L', barcode: '4800016646789', category_id: household, unit: 'bottle', cost_price: 60, selling_price: 80, stock_quantity: 15, reorder_level: 5 });

  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
