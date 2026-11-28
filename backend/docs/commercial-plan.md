# nexaPOS Commercial Control Centre: audit and phased plan

Date: 2026-11-28. Source: the 26-section brief. Status: Phase 1 built (2026-11-28) and tested; Phases 2 to 7 not started.

## 1. Audit: what already exists in the Super Admin

| Brief area | Today |
|---|---|
| Super Admin sign-in, TOTP 2FA, session cut-off | Built (single platform admin role, no staff roles) |
| Business list, usage, suspend / reactivate, approve / reject, reset owner | Built |
| Delete (hide) / restore / erase forever | Built (2026-11-28) |
| Package per business (retail, hotel) + optional modules | Built, but fixed in code (`lib/packages.ts`), not editable data, no prices or limits |
| Registration invitations (single use, expiry, revoke, auto-approve) | Built (`business_invites`); no price or package terms attached |
| Quotations, services price list, premium print layout | Built (`platform_quotes*`). Documented as quotations, not tax invoices |
| Admin audit log | Built (`platform_audit_logs`); actions only, not sign-ins |
| Employee invite links with PIN | Built (business level) |
| M-Pesa (C2B, STK) and Pesapal | Built, but for a BUSINESS collecting from ITS customers, using each business's own credentials |
| Subscriptions, billing cycles, renewals, grace period, reminders | Not present |
| Platform payments / receipts / refunds / revenue (MRR, ARR, churn) | Not present |
| Background jobs / scheduler | Not present (no cron, no job table) |
| Licensing (local installs), installation / training tracking, support tickets | Not present |
| Platform staff roles beyond one admin | Not present |
| Entitlement limits (locations, terminals, employees) enforced on the backend | Not present (only module on/off is enforced) |

Hosting facts that shape the design: backend on Render free (sleeps, so no in-process timers; manual deploy), Supabase free (no automatic backups), Vercel for the site. So scheduled work must be database-backed and triggered from outside (free option: a GitHub Actions schedule calling a secured endpoint).

## 2. Phases (each ends with tests, a browser check, a backup-then-migrate step for you, and a report)

1. **Packages, subscriptions, manual payments, entitlements.** Editable packages (prices, trial, limits, features), a subscription per business with explicit states (trial, pending payment, active, past due, grace, suspended, cancelled, expired) and history, manual payment recording and approval (cash, bank, M-Pesa paybill statement), receipts, backend enforcement of limits (employees, branches, modules), grace-period policy that restricts but never deletes data, and a renewal page shown to a restricted business. This phase delivers the commercial core with no payment-provider dependency.
2. **Customer links and portal.** Hashed, expiring, revocable, single-use links tied to customer + package + price; branded landing page; customer billing page (status, history, receipts, renew).
3. **Provider payments.** Platform's own M-Pesa Daraja STK and Pesapal checkout, server-side verification, duplicate-callback protection, automatic activation / renewal. Needs your platform credentials (see section 3).
4. **Scheduler and reminders.** DB-backed job table, idempotent renewal / expiry / grace jobs, reminders by e-mail (and SMS / WhatsApp once a provider is chosen), message templates.
5. **Revenue dashboard and commercial documents.** MRR, ARR, revenue by package / method, churn, upcoming renewals, CSV export; subscription invoices and receipts with PDF print.
6. **Operations.** Installation and training tracking, support tickets, integration health page, platform staff roles with permissions, global settings.
7. **Licensing for local installs** (ties to the Electron installer): signed offline licence files, device binding, revalidation period.

## 3. What only you can provide (cannot be built around)

- A platform M-Pesa Paybill/Till with Daraja credentials, and a Pesapal merchant account, in nexaPOS's own name (separate from any customer's).
- An SMS provider (e.g. Africa's Talking) and/or WhatsApp Business provider, if you want those channels. E-mail needs the SMTP variables on Render.
- Card tokenisation / automatic recurring card billing needs a provider whose product supports it on your merchant account. Not assumed; ordinary STK Push is not a recurring debit.
- Decisions: real package names and prices, trial length, grace-period days.

## 4. Safety rules for all phases

Additive migrations only; backup before each; no existing business data changed; existing businesses start with a free "legacy / active" subscription so nobody is locked out when Phase 1 ships; money never marked paid from a browser redirect; every activation is idempotent; every privileged action audited.


## 5. Phase 1: what exists now (2026-11-28)

**Super Admin, new tabs and screens:** Plans (create, edit, archive, delete if unused), Payments (all businesses; approve, reject, mark refunded, print receipt), and a Subscription button on every business (assign or change plan, record payment, edit terms, extend, suspend, reactivate, cancel, full history).

**Rules enforced on the server**
- Plan limits (staff including the owner and pending sign-in links, branches) stop new additions only; nobody already there is removed.
- A subscription becomes active only by an approved payment or an explicit complimentary grant. Approving is idempotent (a double click or retry cannot extend twice) and two approvals at once each add their own period.
- Dates move a subscription on its own: active, then grace (default 7 days, configurable per plan and per customer), then expired. After that, changes return HTTP 402 while reading and exporting still work and the owner's billing screen stays open. Nothing is ever deleted.
- A payment never lifts a deliberate suspension. A refund marks the payment only; it does not remove paid time.
- Businesses with no subscription ("legacy") are unlimited and never restricted, so deploying this locks nobody out.
- Payments and history have no link to the business, so "Erase forever" keeps the platform's revenue record.

**Business owner:** a banner when the trial or period is ending, in grace, or restricted; Settings > Subscription shows plan, renewal date, usage against limits and receipts. Sales made offline wait in the queue while a subscription is restricted and send after renewal.

**Not in Phase 1 (by design):** provider payments (Daraja/Pesapal for nexaPOS's own account), automatic reminders and scheduled transitions, customer links and portal, revenue charts, installation/training tracking, tickets, platform staff roles, licensing. A plan's features today are the existing four modules plus the two limits; terminal count, API access and similar entitlements have nothing to enforce yet and are not offered.

**To deploy:** back up, run `npx prisma migrate deploy --config prisma7.config.ts` (adds 4 tables, 1 sequence, changes nothing existing), redeploy Render manually, let Vercel redeploy.
