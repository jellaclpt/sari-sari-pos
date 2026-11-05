CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sales_rep')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  barcode TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'pc',
  cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  receipt_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount NUMERIC(10, 2) NOT NULL,
  amount_paid NUMERIC(10, 2) NOT NULL,
  change_amount NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('restock', 'damaged', 'lost', 'correction')),
  quantity_change INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reports_created_at ON inventory_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

-- Accounts created or reset by an admin get a temporary password and must
-- choose their own on the next sign-in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact TEXT;

-- "Request access" submissions, waiting for an admin to approve or reject.
CREATE TABLE IF NOT EXISTS access_requests (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL,
  contact TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sales_rep')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- "Forgot password" submissions; an admin answers them with a temporary password.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON password_reset_requests(status);

-- Categories can be grouped one level deep, e.g. Tops > Collared. A category
-- with no parent is a group (or a stand-alone category).
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

-- Sizes and colors are tags on the product; stock is still one count per product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS colors TEXT[] NOT NULL DEFAULT '{}';

-- Product photos live in their own table so `SELECT * FROM products` stays light.
CREATE TABLE IF NOT EXISTS product_images (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  mime TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- How a sale was paid, and whether it was later refunded.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_ref TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS refunded_by INTEGER REFERENCES users(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_method_check') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('cash', 'gcash', 'card'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_status_check') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('completed', 'refunded'));
  END IF;
END $$;

-- Deleting a product keeps its past sales and inventory reports (sale items
-- carry their own product_name); the link to the product is cleared instead.
ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE inventory_reports ALTER COLUMN product_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_product_id_fkey' AND confdeltype <> 'n') THEN
    ALTER TABLE sale_items DROP CONSTRAINT sale_items_product_id_fkey;
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_reports_product_id_fkey' AND confdeltype <> 'n') THEN
    ALTER TABLE inventory_reports DROP CONSTRAINT inventory_reports_product_id_fkey;
    ALTER TABLE inventory_reports ADD CONSTRAINT inventory_reports_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);

-- The size and color choices offered in the product editor. Admins add and
-- remove them; products keep their own sizes/colors even if an option is removed.
CREATE TABLE IF NOT EXISTS product_attribute_options (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('size', 'color')),
  value TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, value)
);

-- One-time setup markers, so defaults are added once and stay deleted if removed.
CREATE TABLE IF NOT EXISTS app_flags (name TEXT PRIMARY KEY);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_flags WHERE name = 'attribute_options_seeded') THEN
    INSERT INTO product_attribute_options (kind, value, position) VALUES
      ('size', 'XS', 1), ('size', 'S', 2), ('size', 'M', 3), ('size', 'L', 4), ('size', 'XXL', 5),
      ('color', '#111113', 1), ('color', '#c4c4c8', 2), ('color', '#e8e1d4', 3)
    ON CONFLICT (kind, value) DO NOTHING;
    INSERT INTO app_flags (name) VALUES ('attribute_options_seeded') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Store details shown on receipts, editable from Settings (admin only).
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
