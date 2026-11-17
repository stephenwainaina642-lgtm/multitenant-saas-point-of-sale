-- DESTRUCTIVE. Deletes EVERY business, user and all their data (sales, products, customers, ...).
-- Keeps the table structure and the migration history (_prisma_migrations), so the app works afterwards.
-- NEVER run this on a database holding real customers' data. Take a backup first (scripts/backup.sh).
-- Run:  psql "$DATABASE_URL" -v confirm=WIPE_ALL -f scripts/wipe-all-tenants.sql
\set ON_ERROR_STOP on
begin;
select 1 / (:'confirm' = 'WIPE_ALL')::int as confirmed;   -- stops here unless you passed -v confirm=WIPE_ALL
select (select count(*) from businesses) as businesses_to_delete, (select count(*) from users) as users_to_delete, (select count(*) from sales) as sales_to_delete;
truncate table
  audit_logs, invoice_items, invoices, quotation_items, quotations, refunds, supplier_payments, purchase_items, purchases,
  payments, sale_items, sales, inventory_movements, expenses, products, categories, customers, suppliers,
  document_sequences, password_reset_tokens, business_users, roles, businesses, users
  cascade;
select (select count(*) from businesses) as businesses_left, (select count(*) from users) as users_left;
commit;
