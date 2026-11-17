-- nexaPOS data audit. READ ONLY: contains SELECT statements only and changes nothing.
-- Run it against a copy first, then the real database, before and after every deployment:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/audit-data.sql
--
-- Every row returned is a problem to look at. "No rows" under a heading means that check is clean.
-- Sections A are rules the application guarantees for everything it records today.
-- Section B lists known gaps in data recorded before the Stage 2b/3 changes (see docs/deployment.md).

\echo '== A1. sales: total = subtotal - discount + tax, balance_due = total - amount_paid, 0 <= paid <= total'
SELECT id, business_id, total, subtotal, discount, tax, amount_paid, balance_due
  FROM sales
 WHERE total <> subtotal - discount + tax
    OR balance_due <> total - amount_paid
    OR amount_paid < 0 OR amount_paid > total;

\echo '== A2. sales: amount_paid equals the sum of that sale''s payments'
SELECT s.id, s.business_id, s.amount_paid, COALESCE(SUM(p.amount), 0) AS payments
  FROM sales s LEFT JOIN payments p ON p.sale_id = s.id
 GROUP BY s.id HAVING s.amount_paid <> COALESCE(SUM(p.amount), 0);

\echo '== A3. completed sales: payment_status agrees with the amounts'
SELECT id, business_id, payment_status, amount_paid, balance_due
  FROM sales
 WHERE status = 'completed'
   AND ((payment_status = 'paid' AND balance_due <> 0)
     OR (payment_status = 'partial' AND (amount_paid = 0 OR balance_due = 0))
     OR (payment_status = 'unpaid' AND amount_paid <> 0));

\echo '== A4. customers: balance equals the sum of balance_due on their completed sales'
SELECT c.id, c.business_id, c.name, c.balance AS stored, COALESCE(SUM(s.balance_due), 0) AS from_sales
  FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND s.status = 'completed'
 GROUP BY c.id HAVING c.balance <> COALESCE(SUM(s.balance_due), 0);

\echo '== A5. voided sales: refunds equal what had been paid; completed sales have no refunds'
SELECT s.id, s.business_id, s.amount_paid, COALESCE(SUM(r.amount), 0) AS refunded
  FROM sales s LEFT JOIN refunds r ON r.sale_id = s.id
 WHERE s.status = 'voided'
 GROUP BY s.id HAVING s.amount_paid <> COALESCE(SUM(r.amount), 0)
UNION ALL
SELECT DISTINCT s.id, s.business_id, s.amount_paid, NULL::numeric FROM sales s JOIN refunds r ON r.sale_id = s.id WHERE s.status = 'completed';

\echo '== A6. products: no negative stock'
SELECT id, business_id, name, stock_quantity FROM products WHERE stock_quantity < 0;

\echo '== A7. purchases: balance_due = total - amount_paid'
SELECT id, business_id, total, amount_paid, balance_due FROM purchases WHERE balance_due <> total - amount_paid;

\echo '== A8. tenant isolation: rows pointing at another business''s records'
SELECT 'sales.customer' AS what, s.id, s.business_id, c.business_id AS other_business
  FROM sales s JOIN customers c ON c.id = s.customer_id WHERE c.business_id <> s.business_id
UNION ALL
SELECT 'sale_items.product', si.id, s.business_id, p.business_id
  FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE p.business_id <> s.business_id
UNION ALL
SELECT 'purchases.supplier', pu.id, pu.business_id, su.business_id
  FROM purchases pu JOIN suppliers su ON su.id = pu.supplier_id WHERE su.business_id <> pu.business_id;

\echo '== B1. KNOWN GAP: suppliers.balance vs the sum of balance_due on received purchases (older rows were never tracked)'
SELECT su.id, su.business_id, su.name, su.balance AS stored, COALESCE(SUM(p.balance_due), 0) AS from_purchases
  FROM suppliers su LEFT JOIN purchases p ON p.supplier_id = su.id AND p.status = 'received'
 GROUP BY su.id HAVING su.balance <> COALESCE(SUM(p.balance_due), 0);

\echo '== B2. KNOWN GAP: purchases whose amount_paid has no matching supplier_payments rows (recorded before supplier payments existed)'
SELECT p.id, p.business_id, p.amount_paid, COALESCE(SUM(sp.amount), 0) AS payment_rows
  FROM purchases p LEFT JOIN supplier_payments sp ON sp.purchase_id = p.id
 GROUP BY p.id HAVING p.amount_paid <> COALESCE(SUM(sp.amount), 0);

\echo '== B3. LOCK-OUT RISK: members whose role name is not built in and who have no custom permissions (they can do nothing)'
SELECT r.business_id, r.name AS role_name, COUNT(bu.*) AS members
  FROM roles r JOIN business_users bu ON bu.role_id = r.id
 WHERE lower(r.name) NOT IN ('owner', 'manager', 'inventory manager', 'salesperson', 'cashier', 'accountant')
   AND (r.permissions IS NULL OR cardinality(r.permissions) = 0)
 GROUP BY r.business_id, r.name;

\echo '== B4. INFO: products whose stock differs from the sum of their inventory movements (IN +, OUT -)'
SELECT p.id, p.business_id, p.name, p.stock_quantity AS stored,
       COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity WHEN m.type = 'OUT' THEN -m.quantity ELSE 0 END), 0) AS from_movements
  FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id
 GROUP BY p.id
HAVING p.stock_quantity <> COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity WHEN m.type = 'OUT' THEN -m.quantity ELSE 0 END), 0);

\echo '== B5. RUN BEFORE migration add_mpesa_reference_unique: the same M-Pesa code on more than one payment of a business since 2026-11-17 (the new unique index would refuse to build)'
SELECT business_id, upper(reference) AS code, COUNT(*) AS payments
  FROM payments
 WHERE method = 'mpesa' AND reference IS NOT NULL AND created_at >= TIMESTAMPTZ '2026-11-17 00:00:00+00'
 GROUP BY business_id, upper(reference) HAVING COUNT(*) > 1;

\echo '== done: any rows above need a look; section A rows are defects, section B rows are known history to review'
