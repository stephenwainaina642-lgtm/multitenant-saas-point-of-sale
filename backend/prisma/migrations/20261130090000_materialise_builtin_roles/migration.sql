-- Only the Owner is hardcoded from here on. The built-in role names (Manager, Cashier, ...) used to take
-- their permissions from code whenever a role row had an empty list. Write those lists into the rows so
-- every role is plain, editable data and nobody's current access changes.
-- Additive: touches only roles whose list is empty, and only adds missing starter roles.

UPDATE "roles" SET "permissions" = ARRAY['products.view', 'products.manage', 'inventory.view', 'inventory.adjust', 'customers.view', 'customers.manage', 'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.create', 'purchases.pay', 'purchases.void', 'sales.create', 'sales.view_own', 'sales.view_all', 'sales.edit', 'sales.void', 'payments.view', 'payments.create', 'expenses.view', 'expenses.manage', 'invoices.view', 'invoices.manage', 'quotations.view', 'quotations.manage', 'reports.view', 'audit.view', 'shifts.use', 'shifts.view_all', 'branches.manage', 'branches.all', 'stock.transfer']::text[]
 WHERE lower("name") = 'manager' AND coalesce(array_length("permissions", 1), 0) = 0;

UPDATE "roles" SET "permissions" = ARRAY['products.view', 'products.manage', 'inventory.view', 'inventory.adjust', 'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.create', 'stock.transfer']::text[]
 WHERE lower("name") = 'inventory manager' AND coalesce(array_length("permissions", 1), 0) = 0;

UPDATE "roles" SET "permissions" = ARRAY['products.view', 'customers.view', 'customers.manage', 'sales.create', 'sales.view_own', 'payments.create', 'shifts.use']::text[]
 WHERE lower("name") = 'salesperson' AND coalesce(array_length("permissions", 1), 0) = 0;

UPDATE "roles" SET "permissions" = ARRAY['products.view', 'customers.view', 'sales.create', 'sales.view_own', 'payments.create', 'shifts.use']::text[]
 WHERE lower("name") = 'cashier' AND coalesce(array_length("permissions", 1), 0) = 0;

UPDATE "roles" SET "permissions" = ARRAY['sales.view_all', 'payments.view', 'expenses.view', 'expenses.manage', 'purchases.view', 'purchases.pay', 'invoices.view', 'quotations.view', 'reports.view', 'shifts.view_all', 'branches.all']::text[]
 WHERE lower("name") = 'accountant' AND coalesce(array_length("permissions", 1), 0) = 0;

INSERT INTO "roles" ("name", "description", "business_id", "permissions")
SELECT 'Manager', 'Starter role (editable)', b."id", ARRAY['products.view', 'products.manage', 'inventory.view', 'inventory.adjust', 'customers.view', 'customers.manage', 'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.create', 'purchases.pay', 'purchases.void', 'sales.create', 'sales.view_own', 'sales.view_all', 'sales.edit', 'sales.void', 'payments.view', 'payments.create', 'expenses.view', 'expenses.manage', 'invoices.view', 'invoices.manage', 'quotations.view', 'quotations.manage', 'reports.view', 'audit.view', 'shifts.use', 'shifts.view_all', 'branches.manage', 'branches.all', 'stock.transfer']::text[]
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."business_id" = b."id" AND lower(r."name") = 'manager');

INSERT INTO "roles" ("name", "description", "business_id", "permissions")
SELECT 'Inventory Manager', 'Starter role (editable)', b."id", ARRAY['products.view', 'products.manage', 'inventory.view', 'inventory.adjust', 'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.create', 'stock.transfer']::text[]
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."business_id" = b."id" AND lower(r."name") = 'inventory manager');

INSERT INTO "roles" ("name", "description", "business_id", "permissions")
SELECT 'Salesperson', 'Starter role (editable)', b."id", ARRAY['products.view', 'customers.view', 'customers.manage', 'sales.create', 'sales.view_own', 'payments.create', 'shifts.use']::text[]
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."business_id" = b."id" AND lower(r."name") = 'salesperson');

INSERT INTO "roles" ("name", "description", "business_id", "permissions")
SELECT 'Cashier', 'Starter role (editable)', b."id", ARRAY['products.view', 'customers.view', 'sales.create', 'sales.view_own', 'payments.create', 'shifts.use']::text[]
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."business_id" = b."id" AND lower(r."name") = 'cashier');

INSERT INTO "roles" ("name", "description", "business_id", "permissions")
SELECT 'Accountant', 'Starter role (editable)', b."id", ARRAY['sales.view_all', 'payments.view', 'expenses.view', 'expenses.manage', 'purchases.view', 'purchases.pay', 'invoices.view', 'quotations.view', 'reports.view', 'shifts.view_all', 'branches.all']::text[]
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."business_id" = b."id" AND lower(r."name") = 'accountant');


