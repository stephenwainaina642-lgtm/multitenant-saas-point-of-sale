# Hosting nexaPOS (Vercel frontend + Render API + managed Postgres)

Config files here are written but **not yet exercised on the real platforms** — first deploy is where problems will show.
The production build itself (`npm run build` + `node dist/server.js`) was run locally and passed `/api/health/ready`.

## Order of work
1. **Database**: create a managed PostgreSQL (Render Postgres, Neon or Supabase). Copy its *external* connection string.
   Pick a paid/backed-up tier before real customers: free tiers can expire or lack backups.
2. **Apply migrations from your own computer** (after reading deployment.md §3), pointing at the new empty database:
   `cd backend && DATABASE_URL='<external url>' npx prisma migrate deploy --config prisma7.config.ts`
3. **API on Render**: New → Blueprint → pick this repo/branch (uses `render.yaml`). Fill the secrets:
   - `DATABASE_URL` = the connection string (add `?sslmode=require` if the provider needs it)
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
