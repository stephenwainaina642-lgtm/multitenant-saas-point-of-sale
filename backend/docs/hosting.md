# Hosting nexaPOS (Vercel frontend + Render API + Supabase Postgres)

Config files here are written but **not yet exercised on the real platforms** — first deploy is where problems will show.
Not yet verified against Supabase specifically (pooler behaviour with the app's start-up time-zone setting is the thing to watch at first connect; if sales dates look shifted, tell me).
The production build itself (`npm run build` + `node dist/server.js`) was run locally and passed `/api/health/ready`.

## Order of work
1. **Database (Supabase)**: create a project (pick the region nearest your users; Nairobi has none, Europe/Middle East/South Africa are the usual choices) and save the database password.
   Then, in the project, press **Connect** and copy the **Session pooler** string (port 5432, host like `aws-0-<region>.pooler.supabase.com`, user `postgres.<project-ref>`).
   - Use the **session pooler** for both the API and migrations. Render only speaks IPv4 and Supabase's direct host is IPv6-only on the free plan, so the direct string will not connect from Render.
   - Avoid the **transaction pooler** (port 6543): the app uses interactive transactions and sets the connection time zone at start-up, which transaction pooling can break.
   - **Security — do this before anything else:** nexaPOS talks to Postgres directly and does not use Supabase's auto-generated Data API. Tables in the `public` schema are exposed through that API to anyone holding the public anon key unless protected. In Project Settings → Data API, turn the Data API **off** (or at minimum do not use the anon key anywhere). Do not rely on the default.
   - Free projects pause after about a week of inactivity and have no real backups; use a paid plan (daily backups) before real customers.
2. **Apply migrations from your own computer** (after reading deployment.md §3), pointing at the new empty database:
   `cd backend && DATABASE_URL='<session pooler url>' npx prisma migrate deploy --config prisma7.config.ts`
   If your password contains special characters (`@ : / ?`), URL-encode them in the string.
3. **API on Render**: New → Blueprint → pick this repo/branch (uses `render.yaml`). Fill the secrets:
   - `DATABASE_URL` = the session pooler string (add `?sslmode=require` if the connection is refused without it)
   - `JWT_SECRET` = a long random value (e.g. `openssl rand -base64 48`) — never reuse the dev one
   - `CORS_ORIGINS` = your Vercel address, e.g. `https://nexapos.vercel.app` (no trailing slash)
   - `APP_URL` = same Vercel address (used in reset e-mails)
   Check `https://<api>.onrender.com/api/health/ready` returns 200.
4. **Frontend on Vercel**: import the repo, Root Directory `frontend`, add env `VITE_API_URL=https://<api>.onrender.com/api`, deploy.
   (`vercel.json` makes page refreshes work.) If you later add a custom domain, update `CORS_ORIGINS` and `APP_URL`.
5. **Smoke test** (deployment.md §3 step 6): register a test business, make a sale, check Reports.
6. Optional: SMTP settings for password-reset e-mail (see `.env.example`).

## Cautions
- Render free web services sleep after idle time (first request is slow) — use a paid plan for a till that must always respond.
- Backups: use the provider's automatic backups *and* `scripts/backup.sh` occasionally; test a restore with `scripts/restore-check.sh`.
- Not done: Dockerfile (no Docker daemon here to test it), custom domain/HTTPS setup (platforms do HTTPS for you), log shipping.

## Platform super admin (after the migration `add_platform_admin` is applied)
1. Apply migrations to the database as in step 2 above (`prisma migrate deploy`).
2. On your computer, in `backend/`, with `DATABASE_URL` and the **same `JWT_SECRET` as the live API** set in the environment:
   `npx tsx scripts/create-platform-admin.ts` — enter name, e-mail, a 12+ character password. It prints a setup key:
   add it in Google/Microsoft Authenticator ("Enter a setup key", time-based).
3. Sign in at `https://<your site>/#platform` with e-mail, password and the 6-digit code.
4. Lost phone, or you rotated `JWT_SECRET`: run `npx tsx scripts/create-platform-admin.ts reset-2fa` and add the new key.
Do not share the address or the key. Admin actions are listed on the "Admin activity" tab.
