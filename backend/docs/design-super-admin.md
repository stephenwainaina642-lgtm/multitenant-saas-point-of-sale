# Design: platform super admin (for approval — nothing built yet)

Goal: you, the platform owner, can see every business on nexaPOS and handle problems (suspend, help an owner back in)
without opening the database, and without being able to read businesses' customer or money details.

## What exists today
- `businesses.is_active` and `users.is_active` already exist, and the request middleware already rejects inactive ones
  (`business.middleware.ts`, `auth.middleware.ts`). So "suspend" needs no new mechanism, only a way to set it.
- Owner-side password reset by e-mail exists (needs SMTP); employees can be reset by their owner.
- Nothing lets one person see across businesses. Every query today is scoped to one business.

## 1. Who you are (sign-in)
- New table `platform_admins` (id, name, email unique, password_hash, is_active, created_at, sessions_valid_after).
  **Separate from `users`** so a business owner can never become a platform admin by any bug or edit.
- Separate login endpoint `POST /api/platform/login`; its token carries `aud: "platform"` and is rejected by all normal
  business routes (and normal tokens are rejected by platform routes). Short life (8 hours).
- **No public sign-up.** The first admin is created by a script run on your computer
  (`node scripts/create-platform-admin.mjs`) that asks for name, e-mail and password. Same password rules as users.
- Login rate-limited like normal login. Optional but recommended **later**: authenticator-app 2FA (not in v1).
- The screen lives at its own address (`/#platform`), not linked from the normal login page.

## 2. What you can see (read only)
Per business: name, type, owner name and e-mail, created date, active/suspended, number of users, products and sales,
**sales count in the last 30 days and date of last sale** (to tell dead tests from live shops), VAT-registered yes/no.
Totals across the platform: businesses, active in last 30 days, users.
**You cannot see:** customer names or phones, sale/payment amounts, product prices, expenses, any business documents.
(Counts and dates only — that keeps this a support tool, not a window into clients' finances.)

## 3. What you can do
- **Suspend / reactivate a business.** Users get a clear "This account is suspended — contact support" message and
  existing sessions stop working at the next request. Data is untouched. A reason is required.
- **Reset an owner's access**: sends the normal e-mail reset link when SMTP is set up; otherwise sets a one-time
  temporary password shown once on screen (their existing sessions are signed out, like any password change).
- **Not in v1, on purpose:** delete a business, "log in as" a business (impersonation), edit any business data,
  change plans/billing. Deleting stays a deliberate manual SQL job until we agree how it should work.

## 4. Safety and records
- New table `platform_audit_logs` (admin id, action, target business/user, reason, time). Every action writes one; the
  screen shows the history. Admin actions never edit or hide a business's own audit log.
- Every platform endpoint checks the platform token and the admin still being active. Responses never include password
  hashes, tokens or the reset link.
- Migration is **additive only** (two new tables). No existing table or data changes. Test database only for testing.

## 5. Tests I would write
Normal token rejected on platform routes and vice versa; no sign-up path exists; list shows counts but no amounts;
suspend blocks a business's users immediately and reactivate restores them; reason required; audit row written per
action; owner reset signs out old sessions; one business's admin action can't touch another; rate limit on login.

## Known limits (stated up front)
No 2FA in v1; no billing/plans; no impersonation or delete; "last active" is based on sales dates, so a shop that only
uses quotations looks quiet; support from a separate team (several admins with different powers) not designed.

## Decisions I need from you
1. Same website at `/#platform` (my recommendation) **or** a separate Vercel project?
2. Is "counts and dates only" the right level of visibility, or do you also want sale totals per business?
3. Is v1 without 2FA, delete and impersonation acceptable?
4. Temporary-password fallback when SMTP isn't configured: allowed?
