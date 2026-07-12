-- mira-db schema (source of truth; live D1 b08406b8-d1f5-4aad-ae43-fbbbd56f685c)
-- exported 2026-07-12

CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT DEFAULT 'PT',
  stripe_customer_id TEXT,
  points INTEGER DEFAULT 0,
  lang TEXT DEFAULT 'en',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
, marketing_ok INTEGER DEFAULT 0, birthday TEXT, wholesale INTEGER DEFAULT 0, company TEXT, nif TEXT);

CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT DEFAULT '',
  qty REAL DEFAULT 0,
  low_at REAL DEFAULT 0,
  supplier TEXT DEFAULT '',
  note TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
, cost REAL DEFAULT 0);

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
, ip TEXT);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  stripe_session_id TEXT UNIQUE NOT NULL,
  amount_total INTEGER,
  currency TEXT DEFAULT 'eur',
  mode TEXT,
  summary TEXT,
  shipping_option TEXT,
  points_earned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
, items TEXT, ship_name TEXT, ship_phone TEXT, ship_line1 TEXT, ship_line2 TEXT, ship_postal TEXT, ship_city TEXT, ship_method TEXT, status TEXT DEFAULT 'new');

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
, verified INTEGER DEFAULT 0);

CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE sqlite_sequence(name,seq);

CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE INDEX idx_sessions_customer ON sessions(customer_id);

