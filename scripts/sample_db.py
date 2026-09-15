#!/usr/bin/env python3
"""
Generates the sample e-commerce database for local HelixQL development.

One generator, two dialects: the same seed produces the same rows for MySQL
and PostgreSQL, so a question can be checked against both and the answers
compared. Output goes to stdout, to be piped straight into the database:

  docker run -d --name helixql-mysql -e MYSQL_ROOT_PASSWORD=helix \\
    -e MYSQL_DATABASE=shopdb -e MYSQL_USER=helix -e MYSQL_PASSWORD=helix \\
    -p 33306:3306 mysql:8
  python3 scripts/sample_db.py mysql | docker exec -i helixql-mysql mysql -uhelix -phelix shopdb

  docker run -d --name helixql-postgres -e POSTGRES_PASSWORD=helix \\
    -e POSTGRES_USER=helix -e POSTGRES_DB=shopdb -p 55432:5432 postgres:16
  python3 scripts/sample_db.py postgres | docker exec -i helixql-postgres psql -q -U helix -d shopdb

Ports 33306 / 55432 rather than the defaults, so neither collides with a
database you may already be running on the host.

What the data is shaped to exercise:

- Joins several hops deep: a review reaches a customer's state through
  order_items → orders → customers, and a category through products →
  categories → its parent category.
- Anti-joins: some customers never ordered and some products never sold.
- Self-references: categories have parents, customers have referrers.
- Time: orders span ~2.5 years up to the anchor date, grow over time, and
  spike every October–November, so "this month", "last quarter" and
  month-over-month questions all have something to find.
- Pruning: `payroll` is unrelated to any sales question and should never be
  sent upstream for one.
- Casing: state and city names are stored capitalized ("Gujarat"), so a
  question typed in lowercase only works if matching ignores case.

Dates are relative to --anchor (default: today), so "last 30 days" stays
meaningful whenever the script is run. Pass a fixed --anchor for output that
is identical byte for byte.

Standard library only — no install step.
"""

from __future__ import annotations

import argparse
import datetime as dt
import random
import sys
from collections.abc import Iterable, Sequence

# --- Reference data --------------------------------------------------------

# state → (weight, cities). Weights roughly track online-retail volume.
STATES: dict[str, tuple[int, list[str]]] = {
    "Maharashtra": (18, ["Mumbai", "Pune", "Nagpur", "Nashik"]),
    "Karnataka": (14, ["Bengaluru", "Mysuru", "Mangaluru"]),
    "Gujarat": (12, ["Ahmedabad", "Surat", "Vadodara", "Rajkot"]),
    "Delhi": (11, ["New Delhi"]),
    "Tamil Nadu": (10, ["Chennai", "Coimbatore", "Madurai"]),
    "Telangana": (9, ["Hyderabad", "Warangal"]),
    "West Bengal": (7, ["Kolkata", "Siliguri"]),
    "Uttar Pradesh": (7, ["Lucknow", "Noida", "Kanpur"]),
    "Rajasthan": (5, ["Jaipur", "Udaipur", "Jodhpur"]),
    "Kerala": (4, ["Kochi", "Thiruvananthapuram"]),
    "Punjab": (3, ["Ludhiana", "Amritsar"]),
}

FIRST_NAMES = [
    "Aarav", "Aditi", "Akash", "Ananya", "Arjun", "Asha", "Bhavna", "Deepak", "Divya", "Farhan",
    "Gaurav", "Ishita", "Karan", "Kavya", "Manish", "Meera", "Nikhil", "Neha", "Pooja", "Pranav",
    "Priya", "Rahul", "Raj", "Riya", "Rohan", "Sanjay", "Sara", "Shreya", "Siddharth", "Sneha",
    "Tanvi", "Varun", "Vikram", "Zoya", "Imran", "Joseph", "Lakshmi", "Harpreet", "Anil", "Fatima",
]
LAST_NAMES = [
    "Patel", "Mehta", "Shah", "Desai", "Iyer", "Sharma", "Verma", "Gupta", "Reddy", "Nair",
    "Menon", "Rao", "Kulkarni", "Joshi", "Chopra", "Kapoor", "Singh", "Khan", "Das", "Banerjee",
    "Mukherjee", "Pillai", "Fernandes", "D'Souza", "Gill", "Bose", "Chatterjee", "Agarwal", "Jain", "Pandey",
]

# parent → [(child, price range, brands, item nouns)]
CATEGORIES: dict[str, list[tuple[str, tuple[int, int], list[str], list[str]]]] = {
    "Electronics": [
        ("Mobiles", (8000, 90000), ["Nova", "Pixelon", "Zenfone"], ["5G Smartphone", "Pro Phone", "Lite Phone"]),
        ("Laptops", (30000, 150000), ["Voltbook", "Aeron", "Thinkbyte"], ["14-inch Laptop", "Ultrabook", "Gaming Laptop"]),
        ("Audio", (800, 25000), ["Boomer", "Sonique"], ["Wireless Earbuds", "Bluetooth Speaker", "Headphones"]),
        ("Accessories", (199, 3500), ["Voltix", "Portronic"], ["USB-C Cable", "Power Bank", "Phone Case", "Wall Charger"]),
    ],
    "Home & Kitchen": [
        ("Cookware", (400, 6000), ["Prestige Home", "Hawkins Line"], ["Pressure Cooker", "Non-stick Pan", "Kadai"]),
        ("Appliances", (1500, 45000), ["Kelvinator One", "Bajaj Nova"], ["Mixer Grinder", "Air Fryer", "Water Purifier"]),
        ("Furniture", (2500, 40000), ["WoodCraft", "Urban Nest"], ["Study Table", "Bookshelf", "Office Chair"]),
    ],
    "Fashion": [
        ("Men's Clothing", (399, 4500), ["Roadstar", "Peter Lane"], ["Cotton Shirt", "Denim Jeans", "Kurta"]),
        ("Women's Clothing", (499, 6000), ["Biba Lane", "W Studio"], ["Anarkali Kurta", "Saree", "Palazzo Set"]),
        ("Footwear", (599, 9000), ["Stride", "Metro Walk"], ["Running Shoes", "Sandals", "Sneakers"]),
    ],
    "Books": [
        ("Fiction", (199, 899), ["Penguin House", "Westland"], ["Mystery Novel", "Historical Novel", "Short Stories"]),
        ("Non-fiction", (249, 1299), ["Harper Line", "Rupa"], ["Business Handbook", "Biography", "Self-help Guide"]),
    ],
    "Sports & Fitness": [
        ("Fitness Equipment", (499, 25000), ["Cosco Pro", "FitGear"], ["Yoga Mat", "Dumbbell Set", "Treadmill"]),
        ("Outdoor", (699, 12000), ["Trekmate", "Wildcraft Co"], ["Backpack", "Tent", "Cycling Helmet"]),
    ],
    "Beauty": [
        ("Skincare", (199, 2500), ["Mamaearth Lab", "Plum Leaf"], ["Face Wash", "Sunscreen", "Moisturizer"]),
        ("Haircare", (149, 1800), ["Indulekha Co", "Tresmark"], ["Hair Oil", "Shampoo", "Hair Serum"]),
    ],
}

SUPPLIER_WORDS = ["Shree", "Ganesh", "Omkar", "Sai", "Balaji", "Krishna", "Global", "Apex", "Sunrise", "Unity"]
SUPPLIER_KINDS = ["Traders", "Enterprises", "Distributors", "Industries", "Imports", "Retail Pvt Ltd"]

# name, city, state, the states it ships to
WAREHOUSES = [
    ("Bhiwandi FC", "Bhiwandi", "Maharashtra", {"Maharashtra"}),
    ("Gurugram FC", "Gurugram", "Haryana", {"Delhi", "Uttar Pradesh", "Rajasthan", "Punjab"}),
    ("Bengaluru FC", "Bengaluru", "Karnataka", {"Karnataka", "Kerala"}),
    ("Kolkata FC", "Kolkata", "West Bengal", {"West Bengal"}),
    ("Hyderabad FC", "Hyderabad", "Telangana", {"Telangana", "Tamil Nadu"}),
    ("Ahmedabad FC", "Ahmedabad", "Gujarat", {"Gujarat"}),
]

# carrier → (weight, delivery days range)
CARRIERS = {
    "Delhivery": (35, (2, 5)),
    "Blue Dart": (25, (1, 3)),
    "Ecom Express": (20, (3, 6)),
    "Shadowfax": (12, (1, 4)),
    "India Post": (8, (5, 10)),
}

PAYMENT_METHODS = {"upi": 42, "card": 25, "cod": 18, "netbanking": 8, "wallet": 7}
CHANNELS = {"mobile_app": 45, "web": 40, "marketplace": 15}
RETURN_REASONS = ["damaged in transit", "wrong item delivered", "size or fit issue", "not as described", "changed mind"]
TICKET_CATEGORIES = {"delivery delay": 30, "refund status": 22, "payment issue": 15, "product quality": 20, "account access": 13}
REVIEW_TITLES = {
    5: ["Excellent", "Totally worth it", "Love it"],
    4: ["Good value", "Pretty good", "Happy with it"],
    3: ["Okay for the price", "Average", "Does the job"],
    2: ["Disappointed", "Not great", "Below expectations"],
    1: ["Waste of money", "Stopped working", "Terrible"],
}
DEPARTMENTS = ["Finance", "Engineering", "Operations", "Marketing", "HR"]


def weighted(rng: random.Random, options: dict[str, int]) -> str:
    return rng.choices(list(options), weights=list(options.values()))[0]


# --- Row generation -----------------------------------------------------------


def generate(rng: random.Random, anchor: dt.datetime, scale: float) -> dict[str, list[tuple]]:
    tables: dict[str, list[tuple]] = {}
    start = anchor - dt.timedelta(days=900)

    def between(lo: dt.datetime, hi: dt.datetime) -> dt.datetime:
        seconds = max(int((hi - lo).total_seconds()), 1)
        return lo + dt.timedelta(seconds=rng.randrange(seconds))

    # Categories: parents first, so the self-reference always resolves.
    categories: list[tuple] = []
    leaves: list[tuple[int, tuple[int, int], list[str], list[str]]] = []
    for parent, children in CATEGORIES.items():
        parent_id = len(categories) + 1
        categories.append((parent_id, parent, None))
        for child, price_range, brands, nouns in children:
            child_id = len(categories) + 1
            categories.append((child_id, child, parent_id))
            leaves.append((child_id, price_range, brands, nouns))
    tables["categories"] = categories

    suppliers = []
    supplier_names: set[str] = set()
    while len(suppliers) < 25:
        name = f"{rng.choice(SUPPLIER_WORDS)} {rng.choice(SUPPLIER_WORDS)} {rng.choice(SUPPLIER_KINDS)}"
        if name in supplier_names:
            continue
        supplier_names.add(name)
        state = rng.choice(list(STATES))
        suppliers.append((len(suppliers) + 1, name, rng.choice(STATES[state][1]), state, "India"))
    tables["suppliers"] = suppliers

    # Products, with a popularity weight driving sales and a quality score
    # driving ratings. Some products get zero popularity: never sold.
    products: list[tuple] = []
    popularity: list[float] = []
    quality: dict[int, float] = {}
    for category_id, (lo, hi), brands, nouns in leaves:
        for brand in brands:
            for noun in nouns:
                product_id = len(products) + 1
                price = round(rng.uniform(lo, hi) / 10) * 10 - 1
                cost = round(price * rng.uniform(0.55, 0.8), 2)
                launched = (start - dt.timedelta(days=rng.randrange(0, 400))).date()
                active = rng.random() > 0.08
                sku = f"{brand[:3].upper()}-{category_id:02d}{product_id:04d}"
                products.append(
                    (product_id, sku, f"{brand} {noun}", category_id, rng.randrange(1, 26), f"{price:.2f}", f"{cost:.2f}", launched, active)
                )
                popularity.append(0.0 if rng.random() < 0.07 or not active else rng.paretovariate(1.3))
                quality[product_id] = rng.uniform(2.2, 4.8)
    tables["products"] = products

    warehouses = [(i + 1, name, city, state) for i, (name, city, state, _) in enumerate(WAREHOUSES)]
    tables["warehouses"] = warehouses
    warehouse_for_state = {s: i + 1 for i, (_, _, _, served) in enumerate(WAREHOUSES) for s in served}

    inventory = []
    for warehouse_id, *_ in warehouses:
        for product in products:
            reorder = rng.choice([10, 20, 25, 40, 50])
            on_hand = rng.randrange(0, reorder) if rng.random() < 0.12 else rng.randrange(reorder, 600)
            inventory.append((warehouse_id, product[0], on_hand, reorder))
    tables["inventory"] = inventory

    coupons = []
    for code, pct, days_ago, length in [
        ("WELCOME10", 10, 900, 900), ("DIWALI20", 20, 700, 30), ("NEWYEAR15", 15, 640, 10),
        ("MONSOON12", 12, 480, 45), ("DIWALI25", 25, 340, 30), ("REPUBLIC10", 10, 280, 7),
        ("SUMMER15", 15, 150, 60), ("FLASH30", 30, 40, 3), ("LOYAL5", 5, 365, 365),
    ]:
        valid_from = (anchor - dt.timedelta(days=days_ago)).date()
        coupons.append((len(coupons) + 1, code, pct, valid_from, valid_from + dt.timedelta(days=length)))
    tables["coupons"] = coupons

    # Customers: signups grow over time (square-root skew toward the anchor).
    customer_count = int(2000 * scale)
    customers = []
    for customer_id in range(1, customer_count + 1):
        first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        state = rng.choices(list(STATES), weights=[w for w, _ in STATES.values()])[0]
        signup = start + dt.timedelta(seconds=int((anchor - start).total_seconds() * rng.random() ** 0.7))
        email_last = last.lower().replace("'", "")
        dob = dt.date(rng.randrange(1965, 2006), rng.randrange(1, 13), rng.randrange(1, 29))
        referred_by = rng.randrange(1, customer_id) if customer_id > 20 and rng.random() < 0.15 else None
        customers.append(
            [customer_id, first, last, f"{first.lower()}.{email_last}{customer_id}@example.com",
             f"+91 9{rng.randrange(100000000, 999999999)}", rng.choice(STATES[state][1]), state,
             dob, signup, "bronze", referred_by]
        )

    def seasonal(moment: dt.datetime) -> float:
        return {10: 1.8, 11: 1.6, 12: 1.2, 1: 0.9, 3: 1.1}.get(moment.month, 1.0)

    orders, items, payments, shipments, returns, reviews, tickets = [], [], [], [], [], [], []
    lifetime_spend: dict[int, float] = {}

    for customer in customers:
        customer_id, signup, state = customer[0], customer[8], customer[6]
        if rng.random() < 0.12:
            continue  # never ordered
        order_count = min(1 + int(rng.expovariate(1 / 5)), 60)
        dates = []
        while len(dates) < order_count:
            moment = between(signup, anchor)
            if rng.random() < seasonal(moment) / 1.8:
                dates.append(moment)
        for ordered_at in sorted(dates):
            order_id = len(orders) + 1
            age = (anchor - ordered_at).days
            if age < 3:
                status = weighted(rng, {"processing": 60, "shipped": 40})
            elif age < 10:
                status = weighted(rng, {"shipped": 45, "delivered": 50, "cancelled": 5})
            else:
                status = weighted(rng, {"delivered": 88, "cancelled": 7, "returned": 5})

            live_coupons = [c for c in coupons if c[3] <= ordered_at.date() <= c[4]]
            coupon = rng.choice(live_coupons) if live_coupons and rng.random() < 0.18 else None

            picks = rng.choices(range(len(products)), weights=popularity, k=rng.choices([1, 2, 3, 4], [55, 28, 12, 5])[0])
            order_items = []
            subtotal = 0.0
            for index in dict.fromkeys(picks):
                product = products[index]
                quantity = rng.choices([1, 2, 3], [80, 15, 5])[0]
                unit_price = round(float(product[5]) * rng.choice([1, 1, 1, 0.95, 0.9]), 2)
                discount = round(unit_price * quantity * coupon[2] / 100, 2) if coupon else 0.0
                item_id = len(items) + 1
                items.append((item_id, order_id, product[0], quantity, f"{unit_price:.2f}", f"{discount:.2f}"))
                order_items.append((item_id, product[0], unit_price * quantity - discount))
                subtotal += unit_price * quantity - discount

            shipping_fee = 0 if subtotal >= 499 else 49
            amount = round(subtotal + shipping_fee, 2)
            orders.append(
                (order_id, customer_id, ordered_at, status, weighted(rng, CHANNELS), coupon[0] if coupon else None,
                 f"{shipping_fee:.2f}", warehouse_for_state[state])
            )

            method = weighted(rng, PAYMENT_METHODS)
            if rng.random() < 0.05 and method != "cod":
                payments.append((len(payments) + 1, order_id, method, f"{amount:.2f}", "failed", ordered_at))
                method = weighted(rng, {"upi": 60, "card": 40})

            delivered_at = None
            if status in ("shipped", "delivered", "returned"):
                carrier = rng.choices(list(CARRIERS), [w for w, _ in CARRIERS.values()])[0]
                shipped_at = ordered_at + dt.timedelta(hours=rng.randrange(10, 48))
                if status != "shipped":
                    lo, hi = CARRIERS[carrier][1]
                    delivered_at = shipped_at + dt.timedelta(days=rng.randrange(lo, hi + 1), hours=rng.randrange(0, 12))
                    delivered_at = min(delivered_at, anchor)
                shipments.append((len(shipments) + 1, order_id, carrier, f"AWB{order_id:08d}", shipped_at, delivered_at))

            if status == "cancelled":
                if method != "cod":
                    payments.append((len(payments) + 1, order_id, method, f"{amount:.2f}", "refunded", ordered_at + dt.timedelta(minutes=2)))
            elif method == "cod":
                if delivered_at:
                    payments.append((len(payments) + 1, order_id, method, f"{amount:.2f}", "captured", delivered_at))
                else:
                    payments.append((len(payments) + 1, order_id, method, f"{amount:.2f}", "pending", ordered_at))
            else:
                payments.append((len(payments) + 1, order_id, method, f"{amount:.2f}", "captured", ordered_at + dt.timedelta(minutes=2)))

            if status in ("delivered", "returned"):
                lifetime_spend[customer_id] = lifetime_spend.get(customer_id, 0.0) + amount

            if status == "returned" and delivered_at:
                item_id, _, line_total = rng.choice(order_items)
                refund_status = weighted(rng, {"refunded": 75, "approved": 12, "rejected": 13})
                refund = f"{line_total:.2f}" if refund_status != "rejected" else "0.00"
                returns.append((len(returns) + 1, item_id, rng.choice(RETURN_REASONS), refund_status, refund,
                                delivered_at + dt.timedelta(days=rng.randrange(1, 8))))

            if status == "delivered" and delivered_at:
                for item_id, product_id, _ in order_items:
                    if rng.random() < 0.3:
                        rating = max(1, min(5, round(rng.gauss(quality[product_id], 0.9))))
                        reviewed_at = min(delivered_at + dt.timedelta(days=rng.randrange(1, 20)), anchor)
                        reviews.append((len(reviews) + 1, product_id, customer_id, rating,
                                        rng.choice(REVIEW_TITLES[rating]), reviewed_at))

            if rng.random() < 0.09:
                category = weighted(rng, TICKET_CATEGORIES)
                opened = min(ordered_at + dt.timedelta(days=rng.randrange(1, 10)), anchor)
                resolved = None if rng.random() < 0.1 else min(opened + dt.timedelta(hours=rng.randrange(2, 200)), anchor)
                tickets.append((len(tickets) + 1, customer_id, order_id, category,
                                weighted(rng, {"low": 40, "medium": 40, "high": 20}), opened, resolved))

    # Loyalty tier follows delivered spend, so tier questions agree with
    # what the order tables say.
    for customer in customers:
        spend = lifetime_spend.get(customer[0], 0.0)
        customer[9] = "platinum" if spend >= 600000 else "gold" if spend >= 250000 else "silver" if spend >= 75000 else "bronze"

    tables["customers"] = [tuple(c) for c in customers]
    tables["orders"] = orders
    tables["order_items"] = items
    tables["payments"] = payments
    tables["shipments"] = shipments
    tables["returns"] = returns
    tables["reviews"] = reviews
    tables["support_tickets"] = tickets
    tables["payroll"] = [
        (i + 1, f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", rng.choice(DEPARTMENTS),
         f"{rng.randrange(400000, 4500000, 1000):.2f}")
        for i in range(40)
    ]
    return tables


# --- SQL rendering ----------------------------------------------------------

# Written once in a neutral dialect; `{ts}` and `{bool}` are the only
# places MySQL and PostgreSQL disagree. MySQL's DATETIME rather than
# TIMESTAMP: TIMESTAMP there is time-zone converted and ends in 2038.
DDL = """
CREATE TABLE categories (
  id        INT PRIMARY KEY,
  name      VARCHAR(80) NOT NULL,
  parent_id INT,
  FOREIGN KEY (parent_id) REFERENCES categories (id)
);

CREATE TABLE suppliers (
  id      INT PRIMARY KEY,
  name    VARCHAR(120) NOT NULL,
  city    VARCHAR(80),
  state   VARCHAR(80),
  country VARCHAR(80)
);

CREATE TABLE products (
  id          INT PRIMARY KEY,
  sku         VARCHAR(40) NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  category_id INT NOT NULL,
  supplier_id INT NOT NULL,
  price       DECIMAL(10, 2) NOT NULL,
  cost        DECIMAL(10, 2) NOT NULL,
  launched_on DATE,
  is_active   {bool} NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories (id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
);

CREATE TABLE warehouses (
  id    INT PRIMARY KEY,
  name  VARCHAR(80) NOT NULL,
  city  VARCHAR(80),
  state VARCHAR(80)
);

CREATE TABLE inventory (
  warehouse_id     INT NOT NULL,
  product_id       INT NOT NULL,
  quantity_on_hand INT NOT NULL,
  reorder_level    INT NOT NULL,
  PRIMARY KEY (warehouse_id, product_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE coupons (
  id           INT PRIMARY KEY,
  code         VARCHAR(40) NOT NULL UNIQUE,
  discount_pct INT NOT NULL,
  valid_from   DATE NOT NULL,
  valid_to     DATE NOT NULL
);

CREATE TABLE customers (
  id            INT PRIMARY KEY,
  first_name    VARCHAR(80) NOT NULL,
  last_name     VARCHAR(80) NOT NULL,
  email         VARCHAR(200) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  city          VARCHAR(80),
  state         VARCHAR(80),
  date_of_birth DATE,
  signed_up_at  {ts} NOT NULL,
  loyalty_tier  VARCHAR(20) NOT NULL,
  referred_by   INT,
  FOREIGN KEY (referred_by) REFERENCES customers (id)
);

CREATE TABLE orders (
  id           INT PRIMARY KEY,
  customer_id  INT NOT NULL,
  ordered_at   {ts} NOT NULL,
  status       VARCHAR(20) NOT NULL,
  channel      VARCHAR(20) NOT NULL,
  coupon_id    INT,
  shipping_fee DECIMAL(10, 2) NOT NULL,
  warehouse_id INT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  FOREIGN KEY (coupon_id) REFERENCES coupons (id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
);

CREATE TABLE order_items (
  id         INT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  quantity   INT NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  discount   DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE payments (
  id       INT PRIMARY KEY,
  order_id INT NOT NULL,
  method   VARCHAR(20) NOT NULL,
  amount   DECIMAL(10, 2) NOT NULL,
  status   VARCHAR(20) NOT NULL,
  paid_at  {ts} NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE shipments (
  id              INT PRIMARY KEY,
  order_id        INT NOT NULL,
  carrier         VARCHAR(40) NOT NULL,
  tracking_number VARCHAR(40) NOT NULL,
  shipped_at      {ts} NOT NULL,
  delivered_at    {ts},
  FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE returns (
  id            INT PRIMARY KEY,
  order_item_id INT NOT NULL,
  reason        VARCHAR(80) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  refund_amount DECIMAL(10, 2) NOT NULL,
  requested_at  {ts} NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items (id)
);

CREATE TABLE reviews (
  id          INT PRIMARY KEY,
  product_id  INT NOT NULL,
  customer_id INT NOT NULL,
  rating      INT NOT NULL,
  title       VARCHAR(120),
  created_at  {ts} NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products (id),
  FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE support_tickets (
  id          INT PRIMARY KEY,
  customer_id INT NOT NULL,
  order_id    INT,
  category    VARCHAR(40) NOT NULL,
  priority    VARCHAR(10) NOT NULL,
  opened_at   {ts} NOT NULL,
  resolved_at {ts},
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  FOREIGN KEY (order_id) REFERENCES orders (id)
);

-- Deliberately unrelated to any sales question.
CREATE TABLE payroll (
  id          INT PRIMARY KEY,
  employee    VARCHAR(100) NOT NULL,
  department  VARCHAR(40) NOT NULL,
  salary      DECIMAL(12, 2) NOT NULL
);
"""

# Insert order: every foreign key points at a table already loaded.
TABLE_ORDER = [
    "categories", "suppliers", "products", "warehouses", "inventory", "coupons", "customers",
    "orders", "order_items", "payments", "shipments", "returns", "reviews", "support_tickets", "payroll",
]

# Tables from the earlier, smaller sample database, dropped so a re-run over
# an old shopdb doesn't leave a stale `users` table beside `customers`.
LEGACY_TABLES = ["users"]

# MySQL indexes foreign keys on its own; PostgreSQL does not, and without
# these every join in an EXPLAIN plan would show as a sequential scan.
POSTGRES_FK_INDEXES = [
    ("categories", "parent_id"), ("products", "category_id"), ("products", "supplier_id"),
    ("inventory", "product_id"), ("customers", "referred_by"), ("orders", "customer_id"),
    ("orders", "coupon_id"), ("orders", "warehouse_id"), ("order_items", "order_id"),
    ("order_items", "product_id"), ("payments", "order_id"), ("shipments", "order_id"),
    ("returns", "order_item_id"), ("reviews", "product_id"), ("reviews", "customer_id"),
    ("support_tickets", "customer_id"), ("support_tickets", "order_id"),
]

BATCH_SIZE = 1000


def literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dt.datetime):
        return f"'{value:%Y-%m-%d %H:%M:%S}'"
    if isinstance(value, dt.date):
        return f"'{value:%Y-%m-%d}'"
    # No backslashes appear in the data, so doubling quotes is enough in both
    # dialects (MySQL would otherwise treat a backslash as an escape).
    return "'" + str(value).replace("'", "''") + "'"


def render_inserts(table: str, rows: Sequence[tuple]) -> Iterable[str]:
    for offset in range(0, len(rows), BATCH_SIZE):
        batch = rows[offset : offset + BATCH_SIZE]
        values = ",\n".join("  (" + ", ".join(literal(v) for v in row) + ")" for row in batch)
        yield f"INSERT INTO {table} VALUES\n{values};\n"


def render(dialect: str, tables: dict[str, list[tuple]]) -> Iterable[str]:
    every_table = ", ".join(reversed(TABLE_ORDER + LEGACY_TABLES))
    yield "-- Generated by scripts/sample_db.py. Edit the generator, not this output.\n"

    if dialect == "mysql":
        yield "SET FOREIGN_KEY_CHECKS = 0;\n"
        yield f"DROP TABLE IF EXISTS {every_table};\n"
        yield "SET FOREIGN_KEY_CHECKS = 1;\n"
        yield DDL.format(ts="DATETIME", bool="BOOLEAN")
        yield "START TRANSACTION;\n"
    else:
        yield "SET client_min_messages = warning;\n"
        yield f"DROP TABLE IF EXISTS {every_table} CASCADE;\n"
        yield DDL.format(ts="TIMESTAMP", bool="BOOLEAN")
        yield "BEGIN;\n"

    for table in TABLE_ORDER:
        yield from render_inserts(table, tables[table])
    yield "COMMIT;\n"

    yield "CREATE INDEX idx_orders_ordered_at ON orders (ordered_at);\n"
    if dialect == "postgres":
        for table, column in POSTGRES_FK_INDEXES:
            yield f"CREATE INDEX idx_{table}_{column} ON {table} ({column});\n"
        # Fresh statistics, so EXPLAIN estimates in the diagnostics panel
        # reflect the data rather than planner defaults.
        yield "ANALYZE;\n"

    counts = "\n  UNION ALL ".join(f"SELECT '{t}' AS table_name, COUNT(*) AS row_count FROM {t}" for t in TABLE_ORDER)
    yield f"SELECT * FROM (\n  {counts}\n) AS loaded;\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dialect", choices=["mysql", "postgres"])
    parser.add_argument("--scale", type=float, default=1.0, help="multiplies the customer count (default 1.0 ≈ 2,000 customers)")
    parser.add_argument("--anchor", type=dt.date.fromisoformat, default=dt.date.today(), help="the 'today' the data ends at (YYYY-MM-DD)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.scale <= 0:
        parser.error("--scale must be positive")

    rng = random.Random(args.seed)
    # End the data at 18:00 on the anchor day, so the anchor day itself has
    # orders in it rather than stopping at midnight.
    anchor = dt.datetime.combine(args.anchor, dt.time(18, 0))
    tables = generate(rng, anchor, args.scale)

    out = sys.stdout
    for chunk in render(args.dialect, tables):
        out.write(chunk)


if __name__ == "__main__":
    main()
