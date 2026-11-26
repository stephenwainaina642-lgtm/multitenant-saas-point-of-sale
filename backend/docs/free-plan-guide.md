# Running nexaPOS on the free plans (Supabase free + Render free + Vercel)

This works for a pilot or a first client, with three habits to cover what the free plans do not.

1. **Back up yourself, before every deploy and at least weekly.** Supabase free has no automatic backups.
   Install the PostgreSQL client tools once (the "Command Line Tools" option of the Windows PostgreSQL installer is enough),
   then in PowerShell, in `backend`: `$env:DATABASE_URL = Read-Host "Paste DATABASE_URL"` and `.\scripts\backup.ps1`.
   It writes a checked `.dump` file to `~\nexapos-backups` and keeps the last 14. Copy the folder off the laptop now and then.
   Once a month, restore one into a throwaway database to prove it works (`scripts/restore-check.sh`, or ask me for a Windows version).
2. **Keep the backend awake.** Render's free service sleeps after ~15 minutes idle, and the first request afterwards takes about a minute.
   Add a free monitor (for example UptimeRobot, 5-minute interval) on `https://multitenant-saas-point-of-sale.onrender.com/api/health`.
   Tills already keep selling offline while the server wakes, and sales sync afterwards.
3. **Keep the database awake.** Supabase free pauses a project after a week with no activity. Real daily use, or the same monitor
   pointed at `/api/health/ready` (which touches the database), prevents that. If it does pause, press Restore in the Supabase dashboard.

Limits to remember: ~500 MB database on Supabase free, and no Nairobi region (expect roughly 150-250 ms per request from Kenya).
The offline till is what makes that acceptable at the counter. Upgrade when a client's trading depends on it, not before.
