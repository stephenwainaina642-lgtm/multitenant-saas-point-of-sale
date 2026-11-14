# nexaPOS automated tests

The suite runs the real API against a **disposable PostgreSQL database**. It never reads `.env` or `DATABASE_URL`.

## Safety guard
`tests/support/env.ts` refuses to run unless **all** of these hold:
- the URL comes from `TEST_DATABASE_URL` only
- the database name ends in `_test`
- the name differs from `DATABASE_URL`'s database, `DB_NAME` and `pos_system`
- the host is local (override only with `ALLOW_REMOTE_TEST_DB=1`)

On every run the suite **drops and recreates** that database, applies `prisma/migrations/*/migration.sql` in order, then starts the API (`src/server.ts`) on port 5599 with `JWT_SECRET` and every DB variable pointed at the test database.

## Run it
```bash
# 1. disposable Postgres on port 5433 (data lives in memory, gone when stopped)
docker compose -f docker-compose.test.yml up -d

# 2. generate the Prisma client once (same as for development)
npx prisma generate --config prisma7.config.ts

# 3. run
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/nexapos_test
npm test              # deterministic suite
npm run test:race     # concurrency characterization (expected to fail until Stage 2b)
npm run test:typecheck
```
No Docker? Create any local PostgreSQL database whose name ends in `_test` and point `TEST_DATABASE_URL` at it. The user needs `CREATEDB`.

## Layout
| Path | Purpose |
|---|---|
| `tests/api/*.test.ts` | HTTP tests: auth, tenant isolation, sales/stock/payments, purchases/inventory, permissions |
| `tests/db/*.test.ts` | Migrations, constraints, database safety nets |
| `tests/race/*.test.ts` | Parallel-request tests (separate command, timing dependent) |
| `tests/support/seed.ts` | Realistic KES businesses: phone shop, perfume, hardware, wholesaler; `ledgerViolations()` invariants |

## Defect register
Tests named `KD-n` use `it.fails`: they assert the **correct** behaviour, are green while the defect exists, and **turn red the moment it is fixed**. Remove the `.fails` then. A `.fails` test can also pass for the *wrong* reason, so when you fix a defect, convert the test to a normal `it` and make sure it passes.

| ID | Defect | Status |
|---|---|---|
| KD-1 | No backend permission model; any member can do anything | fixed (permission catalog, route guards, `/api/roles`) |
| KD-2 | Item-level discount and tax ignored in sale total | fixed |
| KD-3 | Float arithmetic: 3 x 100.01 paid in full is "partial" | fixed |
| KD-4 | Receipt number `SALE-<Date.now()>` collides, returns 500 | fixed (per-business sequence `RCT-000001`) |
| KD-5 | Concurrent payments can overpay one sale | fixed (row lock) |
| KD-6 | Concurrent purchase receipts lose stock | fixed (atomic increment) |
| KD-7 | Decimal quantities rejected in sales | fixed |
| KD-8 | Credit sales do not update customer balance or enforce credit limit | fixed |
| KD-9 | No CHECK constraints, no tenant-safe FKs, duplicate NULL-business roles | open (Stage 2b-3) |
| KD-10 | Login is case-sensitive, register lowercases the email | fixed |

Still untested because the feature does not exist: sale edit/void/return, employee invitations, custom roles, quotation conversion, supplier balances.
Not yet verified: `prisma migrate diff` drift between `schema.prisma` and the migrations (needs the Prisma schema engine and a shadow database).
