-- ============================================================
-- ShopOps — Database Schema (PostgreSQL)
-- Based on inventtx_multibranch_schema, extended for repair logs,
-- fund movements, bills, ratings, and local (non-Supabase) auth.
-- Idempotent: safe to run repeatedly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------- enums (guarded) ----------
-- Roles: owner (all branches), manager (full branch ops), sales (sell + cash),
-- technician (repair jobs), partner (read-only / investor view).
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('owner','manager','sales','technician','partner'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Idempotent upgrades for databases created before these roles existed.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'technician';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner';
DO $$ BEGIN CREATE TYPE movement_type AS ENUM ('purchase_in','sale','adjustment','transfer_out','transfer_in','return_in','damage_out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash','gcash','maya','card','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE po_status AS ENUM ('draft','ordered','partially_received','received','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE transfer_status AS ENUM ('pending','in_transit','received','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_status AS ENUM ('received','in_progress','ready_for_pickup','released'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE fund_direction AS ENUM ('in','out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE fund_category AS ENUM ('capital','owner_withdrawal','expense','bank_deposit','cash_sale','refund','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 1. BRANCHES ----------
CREATE TABLE IF NOT EXISTS branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text,
  city        text,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  opened_at   date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 2. USERS / STAFF (with local auth) ----------
CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          user_role NOT NULL DEFAULT 'sales',
  branch_id     uuid REFERENCES branches(id),  -- NULL for owner (sees all)
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- 3. PRODUCT CATALOG ----------
CREATE TABLE IF NOT EXISTS categories (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text NOT NULL UNIQUE,
  barcode       text,
  name          text NOT NULL,
  category_id   uuid REFERENCES categories(id),
  brand         text,
  image         text,                                  -- small base64 thumbnail (data URL) for quick visual ID
  cost_price    numeric(10,2) NOT NULL DEFAULT 0,
  selling_price numeric(10,2) NOT NULL DEFAULT 0,
  warranty_days integer NOT NULL DEFAULT 0,             -- default warranty offered when this item is sold
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- 4. STOCK PER BRANCH ----------
CREATE TABLE IF NOT EXISTS branch_inventory (
  branch_id   uuid NOT NULL REFERENCES branches(id),
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL DEFAULT 0,
  min_stock   integer NOT NULL DEFAULT 3,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id),
  CONSTRAINT non_negative_stock CHECK (quantity >= 0)
);

-- ---------- 5. STOCK MOVEMENTS (audit trail) ----------
CREATE TABLE IF NOT EXISTS stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  movement_type movement_type NOT NULL,
  quantity      integer NOT NULL,        -- positive in, negative out
  reference_id  uuid,
  reason        text,                    -- REQUIRED for 'adjustment' (app-enforced)
  performed_by  uuid NOT NULL REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_branch_date ON stock_movements (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_product     ON stock_movements (product_id);

-- ---------- 6. SALES ----------
CREATE TABLE IF NOT EXISTS sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  sale_number    bigserial,
  subtotal       numeric(10,2),
  discount       numeric(10,2) NOT NULL DEFAULT 0,
  total_amount   numeric(10,2) NOT NULL,
  payment_method payment_method NOT NULL DEFAULT 'cash',
  is_voided      boolean NOT NULL DEFAULT false,
  void_reason    text,
  voided_by      uuid REFERENCES app_users(id),
  sold_by        uuid NOT NULL REFERENCES app_users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sale_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10,2) NOT NULL,   -- snapshot at sale time
  unit_cost   numeric(10,2) NOT NULL,   -- snapshot for profit calc
  warranty_days integer NOT NULL DEFAULT 0  -- warranty for this item, runs from the sale date
);
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales (branch_id, created_at);

-- ---------- 7. DAILY CASH RECONCILIATION ----------
CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  business_date   date NOT NULL,
  expected_cash   numeric(10,2) NOT NULL,
  counted_cash    numeric(10,2) NOT NULL,
  variance        numeric(10,2) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  notes           text,
  photo_url       text,
  closed_by       uuid NOT NULL REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_date)
);

-- ---------- 8. SUPPLIERS & MATERIALS ORDERS (purchase orders) ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  contact     text,
  phone       text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id),
  po_number    bigserial,
  status       po_status NOT NULL DEFAULT 'draft',
  total_cost   numeric(10,2),
  notes        text,
  created_by   uuid NOT NULL REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  received_at  timestamptz
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id        uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id),
  qty_ordered  integer NOT NULL CHECK (qty_ordered > 0),
  qty_received integer NOT NULL DEFAULT 0,
  unit_cost    numeric(10,2) NOT NULL
);

-- ---------- 9. STOCK TRANSFERS BETWEEN BRANCHES ----------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number bigserial,
  from_branch_id  uuid NOT NULL REFERENCES branches(id),
  to_branch_id    uuid NOT NULL REFERENCES branches(id),
  status          transfer_status NOT NULL DEFAULT 'pending',
  requested_by    uuid NOT NULL REFERENCES app_users(id),
  received_by     uuid REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  received_at     timestamptz,
  CHECK (from_branch_id <> to_branch_id)
);
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id),
  quantity     integer NOT NULL CHECK (quantity > 0)
);

-- ---------- 9b. CUSTOMERS (repeat-customer directory) ----------
CREATE TABLE IF NOT EXISTS customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 10. REPAIR / SERVICE LOG ----------
CREATE TABLE IF NOT EXISTS service_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  claim_number bigserial,
  customer_id  uuid REFERENCES customers(id),
  customer     text NOT NULL,
  phone        text,
  device       text NOT NULL,
  model_number text,                                   -- model / board / chassis number
  serial_code  text,                                   -- serial number or KSU code
  issue        text,
  customer_details text,                               -- extra details from the customer
  tech_notes       text,                               -- technician's findings / additional details
  notes            text,                               -- internal notes
  remarks          text,                               -- remarks
  instructions     text,                               -- handling / repair instructions
  warranty_days    integer NOT NULL DEFAULT 0,         -- service warranty, runs from when the job is released
  images       jsonb NOT NULL DEFAULT '[]',            -- warranty / fault photos (array of base64 data URLs)
  fee          numeric(10,2) NOT NULL DEFAULT 0,
  amount_paid  numeric(10,2) NOT NULL DEFAULT 0,
  status       job_status NOT NULL DEFAULT 'received',
  tech_id      uuid REFERENCES app_users(id),
  received_at  timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz,                              -- set when status -> ready_for_pickup (for unclaimed-job alerts)
  released_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Idempotent add for databases created before ready_at existed.
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS ready_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_service_branch_status ON service_jobs (branch_id, status);

-- ---------- 11. FUND MOVEMENTS (cash in / out of the business) ----------
CREATE TABLE IF NOT EXISTS fund_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  direction    fund_direction NOT NULL,
  category     fund_category NOT NULL DEFAULT 'other',
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  notes        text,
  performed_by uuid NOT NULL REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funds_branch_date ON fund_movements (branch_id, created_at);

-- ---------- 12. BILLS & EXPENSES ----------
CREATE TABLE IF NOT EXISTS bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'Utilities',
  amount      numeric(10,2) NOT NULL,
  due_date    date,
  is_paid     boolean NOT NULL DEFAULT false,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 13. RATINGS ----------
CREATE TABLE IF NOT EXISTS ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  stars         integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  customer_name text,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- DASHBOARD VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_today_sales AS
SELECT b.id AS branch_id, b.name AS branch,
       COUNT(s.id)                      AS transactions,
       COALESCE(SUM(s.total_amount), 0) AS total_sales
FROM branches b
LEFT JOIN sales s
  ON s.branch_id = b.id
 AND (s.created_at AT TIME ZONE 'Asia/Manila')::date = (now() AT TIME ZONE 'Asia/Manila')::date
 AND s.is_voided = false
GROUP BY b.id, b.name;

CREATE OR REPLACE VIEW v_low_stock AS
SELECT b.id AS branch_id, b.name AS branch, p.id AS product_id, p.sku, p.name AS product,
       bi.quantity, bi.min_stock
FROM branch_inventory bi
JOIN branches b ON b.id = bi.branch_id
JOIN products p ON p.id = bi.product_id
WHERE bi.quantity <= bi.min_stock
  AND p.is_active = true;

CREATE OR REPLACE VIEW v_red_flags AS
SELECT 'voided_sale' AS flag_type, b.id AS branch_id, b.name AS branch,
       s.created_at, u.full_name AS by_user,
       s.total_amount AS amount, s.void_reason AS detail
FROM sales s
JOIN branches b ON b.id = s.branch_id
JOIN app_users u ON u.id = COALESCE(s.voided_by, s.sold_by)
WHERE s.is_voided = true
  AND s.created_at > now() - interval '7 days'
UNION ALL
SELECT 'stock_adjustment', b.id, b.name, m.created_at, u.full_name,
       m.quantity::numeric, m.reason
FROM stock_movements m
JOIN branches b ON b.id = m.branch_id
JOIN app_users u ON u.id = m.performed_by
WHERE m.movement_type = 'adjustment'
  AND m.created_at > now() - interval '7 days';
