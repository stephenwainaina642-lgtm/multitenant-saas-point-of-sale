# Public ids (hiding sequential database ids)

Goal: the API must not show or accept 1, 2, 3… so records cannot be counted or guessed. Each converted table gets a
random `public_id` (UUID v4). The numeric `id` stays as the internal primary key and foreign key; nothing is renamed,
dropped or rewritten, so existing data is never at risk.

## How one table is converted
1. Additive migration: `ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid()` + a unique index. Every existing
   row gets its own random value as the column is added. Needs PostgreSQL 13+ (Supabase is newer).
2. The API returns `public_id` as `id`, and accepts only a UUID in URLs and request bodies (including references from
   other tables, e.g. a product's `categoryId`). A numeric id gets 400, another business's id gets 404/400 as before.
3. Tests: ids are random UUIDs, numeric ids refused, other business refused, migration keeps rows and makes unique ids.

## Deploying a converted table
Run the migration FIRST (`npx prisma migrate deploy --config prisma7.config.ts`), then deploy the backend. The old code keeps
working on the migrated database (the column is only added), so there is no broken window.

## Status
| Table | Status |
|---|---|
| categories | DONE (migration `20261128090000_add_public_id_categories`) |
| customers, suppliers | DONE (migration `20261129090000_add_public_id_customers_suppliers`): own routes, sales (create/list/detail/edit), purchases, purchase payments, quotations, invoices, payments list, customer debt and receive-payment, reports |
| products | DONE (migration `20261203090000_add_public_id_products`): own routes, sales (create/list/detail/edit/preview), purchases and payments, quotations, invoices, inventory movements, branch stock and transfers, dashboard low-stock, reports (best sellers) |
| expenses | DONE (migration `20261204090000_add_public_id_expenses`) |
| quotations | DONE (migration `20261204090100_add_public_id_quotations`): own routes. `convertedSaleId` still shows the sale's numeric id until sales are converted |
| sales | DONE (migration `20261205090000_add_public_id_sales`): own routes (read, edit, void), payments (`saleId`), invoices (`saleId`), customer debt and settle-debt allocations, quotation `convertedSaleId` and conversion, reports, dashboard recent sales, employee profile recent sales |
| purchases, invoices, customer payments, supplier payments | DONE (migration `20261206090000_add_public_id_purchases_invoices_payments`): purchases and invoices have their own routes; payment ids appear only in responses |
| branches, roles, stock transfers | DONE (migration `20261207090000_add_public_id_branches_roles_transfers`): branch routes, transfer bodies, `X-Branch-ID`, the reports `branchId` filter, employee `branchId` and `role.id`, role routes |
| users and employee memberships | DONE (migration `20261208090000_add_public_id_users_memberships`): `/employees/:id`, branch staff `:userId`, `userId`/`salespersonId` on sales and the dashboard, `user.id` in sign-in and registration responses. The login token still carries the internal id (signed, HttpOnly, never in a body), so nobody is signed out |
| businesses, audit-log `entityId`/`userId` (inputs and outputs together) | not yet |

## Products: one thing to do before deploying
A sale saved on a device while offline keeps the product ids it was made with. After this change those ids must be the new
random ones, so a sale still waiting to sync from BEFORE the update would be refused (the screen shows an error toast and
keeps it). Make sure every till shows no "sales waiting to sync" badge before you deploy.

## Branches: the `X-Branch-ID` header
The header carries the branch UUID. A plain number is still accepted on this header only, so tills that saved a number before
the change (and sales queued offline with one) keep working. It is checked against the user's allowed branches either way.
Once no till holds an old value this fallback can be removed.

## Sales: notes
- Queued offline sales are unaffected: they carry product and customer ids (already random), never a sale id.
- `GET /sales/:id` used to answer 500 for a junk id; it now answers 400/404 like the other routes.
- Receipt numbers (RCT-000120) are sequential on purpose (they are the accounting document number), and stock-movement and
  payment references such as `SALE-<internal id>` still contain the internal number. These are not treated as secret.

## Known gaps until every table is converted
- `GET /api/audit-logs` still returns the numeric `entityId` for every entity type. It is mapped to public ids as the last step.
- Other tables' ids are still sequential and still shown in their own responses and URLs.
- Old bookmarks or saved links that contain a numeric category id stop working.
