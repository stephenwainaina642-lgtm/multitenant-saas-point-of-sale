# nexaPOS – deployment & operations runbook

Status: written and the scripts were exercised on a scratch PostgreSQL 16 only. Nothing here has been run on a real
production host, with Docker, or in GitHub Actions – treat first deployment as a rehearsal on a staging copy.

## 1. Requirements
Node 22, PostgreSQL 16 (managed Postgres with daily backups is strongly recommended), HTTPS via a reverse proxy
(Nginx/Caddy/cloud load balancer), `pg_dump`/`pg_restore`/`psql` on the machine that runs backups.

## 2. Configuration (backend/.env – see `.env.example`)
| Variable | Notes |
|---|---|
| DATABASE_URL | required |
| JWT_SECRET | required, ≥32 chars in production. Changing it logs everyone out |
| NODE_ENV=production | enables JSON request logs and strict checks |
| CORS_ORIGINS | required in production, e.g. `https://app.example.co.ke` |
| TRUST_PROXY=3 | number of proxies in front of the app (0 = none; 1 = Render alone). On Vercel + Render use 3: it cannot be faked, but sees Vercel's forwarder, not the visitor (4 shows the visitor but Vercel keeps a client-sent X-Forwarded-For, so it can be faked). Per-account limiting covers guessing |
| ACCOUNT_LOGIN_FAILURES_MAX=10 | optional: failed sign-ins allowed per email address per 15 minutes, from any network (successful sign-ins do not count) |
| PORT, JWT_EXPIRES_IN, LOGIN_RATE_LIMIT_MAX, REGISTER_RATE_LIMIT_MAX | optional |

Frontend: build with `VITE_API_URL=https://api.example.co.ke/api npx vite build` and serve `frontend/dist` as static files.
Never commit `.env`.

## 3. First deploy / every release
1. **Back up first**: `DATABASE_URL=... backend/scripts/backup.sh /secure/backups`
2. **Audit before**: `psql "$DATABASE_URL" -f backend/scripts/audit-data.sql` (read-only). Section A rows are defects –
   stop and investigate. Section B rows are known history (see §6).
3. Install & build: `cd backend && npm ci && npx prisma generate --config prisma7.config.ts && npm run build`
4. **Apply migrations (additive only)**: `npx prisma migrate deploy --config prisma7.config.ts`
   Never run `migrate reset`, `migrate dev --force`, `db push --force-reset` against a real database.
   Migrations since Stage 2b: add_branches, add_sale_channel, add_register_shifts, add_platform_admin, add_password_reset_tokens, add_mpesa_reference_unique (run audit B5 first), add_prices_include_vat, add_user_sessions_valid_after, add_role_permissions, add_integrity_constraints, add_sale_refunds, add_supplier_payments,
   add_quotation_conversion, add_business_tax_pin, add_vat_settings (plus earlier ones). The CHECK constraints in
   add_integrity_constraints can fail if legacy rows violate them – that is a signal to review data, see
   `docs/stage-2b-migrations.md`.
5. Start: `npm run start:prod` (use systemd/pm2/your platform's supervisor so it restarts on exit).
6. **Smoke test**: `GET /api/health` → 200, `GET /api/health/ready` → 200 (503 = database unreachable),
   sign in, make a test sale in a test business, check the dashboard.
7. **Audit after**: rerun `audit-data.sql`.

Point your platform's health check at `/api/health/ready` (restart/readiness) and `/api/health` (liveness).
The server exits with code 1 at startup if the database is unreachable and shuts down gracefully on SIGTERM.

## 4. Backups & restore
- `scripts/backup.sh [dir]` – custom-format `pg_dump`, verified readable with `pg_restore --list`.
- `scripts/restore-check.sh file.dump <admin-url> <new-db-name>` – restores into a NEW database and runs the audit;
  refuses to reuse an existing database name. Do this regularly (monthly at least): an untested backup is not a backup.
- Schedule `backup.sh` daily (cron) and copy dumps off the server. Keep at least 14 days. Dumps contain customer data:
  encrypt and restrict access; never commit them.
- Real recovery = restore to a new database, run the audit, then point `DATABASE_URL` at it. Decide with the owner before
  replacing the live database; nothing in these scripts does that automatically.

## 5. Rollback
Migrations are additive, so rolling the application back to the previous build normally works against the migrated
schema. Do **not** try to reverse migrations by hand; if data is damaged, restore from the pre-release backup (§4).

## 6. Known limitations before go-live
- Prisma schema drift (`prisma migrate diff`) could not be run in the build sandbox: run locally
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --config prisma7.config.ts` against a
  restored copy and review the output.
- Suppliers' balances and purchase payments made before supplier payments existed are not back-filled (audit B1/B2).
- `npm audit` still reports advisories in the Prisma CLI toolchain (dev-time; not on the request path); fixing needs a Prisma upgrade.
- Changing a password signs out other devices (tokens issued in the same second as the change are not cut off). Forgot-password by e-mail exists but only works once SMTP is configured (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL; see .env.example). It is tested against a fake SMTP server only, not a real provider: after setting it up, send yourself a reset link and check it arrives and opens. Without SMTP the screen says so and points to the owner/admin reset in Employees. Links last 30 minutes, work once, and are limited to 3 requests per account per hour.
- Logs go to stdout as JSON; there is no log shipping, alerting or error tracker configured – add one (e.g. uptime check on `/api/health/ready`).
- eTIMS and VAT returns are not implemented. Do not market the app as KRA-compliant.

## Cookie sign-in (httpOnly session) — required settings

Browsers now sign in with an **httpOnly cookie**; no token is returned in the response or kept in browser storage.
A cookie is only sent back when the browser thinks the site and the API are the *same site*, so the frontend calls
`/api/...` on its own domain and Vercel forwards it to Render (see `frontend/vercel.json`).

Order matters, because the old and new versions do not understand each other:
1. Render: set `TRUST_PROXY=3` (see the variable table for why not 4). Deploy the backend first.
2. Vercel: nothing to set — production builds call `/api` by themselves (`VITE_API_URL` is ignored in production). Deploy the frontend (with the `vercel.json` rewrite).
3. `https://<your-vercel-site>/api/health/whoami` shows the proxy chain; at 3 the address is Vercel's forwarder (expected).
4. Everyone signs in once again (old tokens are no longer used by the browser). Sessions now last 12 hours (`JWT_EXPIRES_IN`).

Non-browser callers (scripts, tests) send `X-Auth-Mode: bearer` to receive the token in the body and use `Authorization: Bearer`.
