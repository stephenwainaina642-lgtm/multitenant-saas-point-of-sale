# Applying the Stage 2b migrations to a real database

Three additive migrations were added. None of them deletes, rewrites or rejects existing rows.

| Migration | What it does |
|---|---|
| `20261113120000_add_sequences_and_idempotency` | New `document_sequences` table; nullable `idempotency_key` on `sales` and `payments` |
| `20261114090000_add_role_permissions` | `roles.permissions` column (empty = use the built-in defaults for the role name) |
| `20261114120000_add_integrity_constraints` | CHECK constraints (**NOT VALID**), tenant-guard triggers, global role uniqueness index (only if no duplicates) |

## Before you apply
1. **Back up first:** `pg_dump -Fc pos_system > pos_system_before_2b.dump`
2. Apply with `npx prisma migrate deploy --config prisma7.config.ts` (never `migrate reset` or `migrate dev --force`).

## Behaviour changes to expect after deploying
- **Receipt numbers** change format for new sales (`RCT-000001`, per business). Old `SALE-<timestamp>` receipts are untouched.
- **Unpaid or part-paid sales need a customer.** The balance is tracked on the customer, so anonymous walk-in sales must be paid in full.
- **Permissions are enforced.** Members whose role is not Owner, Manager, Inventory Manager, Salesperson, Cashier or Accountant (and who have no custom permissions) can no longer access anything. Check `select r.name, count(*) from business_users bu join roles r on r.id = bu.role_id group by r.name;` first.
- **The frontend is unchanged.** Screens that a role can no longer use will show an error until the Stage 3 UI work hides them.

## Optional: validate the CHECK constraints on old data
The constraints guard new and changed rows only. To also verify old rows, find violations first (each query should return 0 rows), then validate:

```sql
select id, stock_quantity from products where stock_quantity < 0;
select id, amount from payments where amount <= 0;
select id, total, amount_paid, balance_due from sales
 where not (total >= 0 and amount_paid >= 0 and amount_paid <= total and balance_due = total - amount_paid);
-- when clean:
ALTER TABLE products VALIDATE CONSTRAINT products_stock_quantity_nonneg;
ALTER TABLE payments VALIDATE CONSTRAINT payments_amount_positive;
ALTER TABLE sales    VALIDATE CONSTRAINT sales_amounts_consistent;
```
(`pg_constraint.convalidated = false` lists every constraint still unvalidated.)

## Customer balances for sales recorded before Stage 2b
Older credit sales never updated `customers.balance`. **Review before running** (this changes financial records, so it is not part of any migration):

```sql
-- preview: customers whose stored balance differs from their open sales
select c.id, c.name, c.balance as stored, coalesce(sum(s.balance_due),0) as from_sales
  from customers c left join sales s on s.customer_id = c.id
 group by c.id having c.balance <> coalesce(sum(s.balance_due),0);
-- apply only after reviewing the preview:
update customers c set balance = coalesce((select sum(balance_due) from sales s where s.customer_id = c.id), 0);
```
