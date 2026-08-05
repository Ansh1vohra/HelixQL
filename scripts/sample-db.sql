-- Sample database for local HelixQL development (PostgreSQL).
--
-- Small on purpose, but shaped like a real one: foreign keys the model can
-- infer joins from, a geography column to filter on, and one table
-- (payroll) that is unrelated to any sensible sales question — useful for
-- confirming the schema pruner leaves it out of what gets sent upstream.
--
--   docker run -d --name helixql-postgres -e POSTGRES_PASSWORD=helix \
--     -e POSTGRES_USER=helix -e POSTGRES_DB=shopdb -p 55432:5432 postgres:16
--   docker exec -i helixql-postgres psql -U helix -d shopdb < scripts/sample-db.sql
--
-- Port 55432 rather than 5432, so it doesn't collide with a PostgreSQL you
-- may already be running on the host.

DROP TABLE IF EXISTS order_items, orders, products, users, payroll CASCADE;

CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(200),
  state      VARCHAR(50),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE products (
  id    SERIAL PRIMARY KEY,
  sku   VARCHAR(40) NOT NULL,
  title VARCHAR(200),
  price NUMERIC(10, 2)
);

CREATE TABLE orders (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users (id),
  total      NUMERIC(10, 2),
  status     VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders (id),
  product_id INT NOT NULL REFERENCES products (id),
  quantity   INT DEFAULT 1
);

-- Deliberately unrelated to any sales question.
CREATE TABLE payroll (
  id       SERIAL PRIMARY KEY,
  employee VARCHAR(100),
  salary   NUMERIC(12, 2)
);

INSERT INTO users (name, email, state) VALUES
  ('Asha Patel',   'asha@example.com',   'Gujarat'),
  ('Raj Mehta',    'raj@example.com',    'Gujarat'),
  ('Priya Shah',   'priya@example.com',  'Maharashtra'),
  ('Vikram Desai', 'vikram@example.com', 'Gujarat'),
  ('Neha Iyer',    'neha@example.com',   'Karnataka');

INSERT INTO products (sku, title, price) VALUES
  ('A1', 'Widget',      9.99),
  ('B2', 'Gadget',     24.50),
  ('C3', 'Doohickey',  99.00);

-- Asha 14, Raj 9, Priya 20, Vikram 3, Neha 6. Priya leads overall, but Asha
-- leads within Gujarat — so "who ordered most from Gujarat?" has a different
-- answer than "who ordered most?", which makes it a useful test question.
INSERT INTO orders (user_id, total)
      SELECT 1, 100.00 FROM generate_series(1, 14)
UNION ALL SELECT 2,  50.00 FROM generate_series(1, 9)
UNION ALL SELECT 3,  75.00 FROM generate_series(1, 20)
UNION ALL SELECT 4,  30.00 FROM generate_series(1, 3)
UNION ALL SELECT 5,  60.00 FROM generate_series(1, 6);

INSERT INTO order_items (order_id, product_id, quantity)
  SELECT o.id, 1 + (o.id % 3), 1 + (o.id % 4) FROM orders o;

INSERT INTO payroll (employee, salary) VALUES
  ('CFO', 500000), ('CTO', 480000);

SELECT 'users' AS table_name, count(*) FROM users
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'order_items', count(*) FROM order_items;
