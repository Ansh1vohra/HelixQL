-- Sample database for local HelixQL development (MySQL 8.0+).
--
-- Same shape and same row counts as scripts/sample-db.sql (PostgreSQL): foreign
-- keys the model can infer joins from, and one table (payroll) that is
-- unrelated to any sensible sales question — useful for confirming the schema
-- pruner leaves it out of what gets sent upstream.
--
--   docker run -d --name helixql-mysql -e MYSQL_ROOT_PASSWORD=helix \
--     -e MYSQL_DATABASE=shopdb -e MYSQL_USER=helix -e MYSQL_PASSWORD=helix \
--     -p 33306:3306 mysql:8
--   docker exec -i helixql-mysql mysql -uhelix -phelix shopdb < scripts/sample-db.mysql.sql
--
-- Port 33306 rather than 3306, so it doesn't collide with a MySQL you may
-- already be running on the host.
--
-- Requires MySQL 8.0 for the recursive CTE that fans out the orders (MySQL has
-- no generate_series). See the 5.7 note above that INSERT if you need it.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS order_items, orders, products, users, payroll;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(200),
  state      VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  sku   VARCHAR(40) NOT NULL,
  title VARCHAR(200),
  price DECIMAL(10, 2)
);

CREATE TABLE orders (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  total      DECIMAL(10, 2),
  status     VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  quantity   INT DEFAULT 1,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

-- Deliberately unrelated to any sales question.
CREATE TABLE payroll (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  employee VARCHAR(100),
  salary   DECIMAL(12, 2)
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
--
-- MySQL has no generate_series, so `seq` is a recursive CTE counting to 20 and
-- each spec row joins to the first `cnt` of those. On MySQL 5.7 (no CTEs),
-- replace this statement with 52 literal VALUES rows.
INSERT INTO orders (user_id, total)
WITH RECURSIVE seq (n) AS (
            SELECT 1
  UNION ALL SELECT n + 1 FROM seq WHERE n < 20
),
spec (user_id, total, cnt) AS (
            SELECT 1, 100.00, 14
  UNION ALL SELECT 2,  50.00,  9
  UNION ALL SELECT 3,  75.00, 20
  UNION ALL SELECT 4,  30.00,  3
  UNION ALL SELECT 5,  60.00,  6
)
SELECT spec.user_id, spec.total
FROM spec JOIN seq ON seq.n <= spec.cnt;

INSERT INTO order_items (order_id, product_id, quantity)
  SELECT o.id, 1 + (o.id % 3), 1 + (o.id % 4) FROM orders o;

INSERT INTO payroll (employee, salary) VALUES
  ('CFO', 500000), ('CTO', 480000);

            SELECT 'users' AS table_name, count(*) AS n FROM users
  UNION ALL SELECT 'orders',      count(*) FROM orders
  UNION ALL SELECT 'products',    count(*) FROM products
  UNION ALL SELECT 'order_items', count(*) FROM order_items;
