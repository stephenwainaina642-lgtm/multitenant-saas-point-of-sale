# Integrations (M-PESA, Pesapal, eTIMS) — Milestone 1: settings only

This milestone stores each business's own merchant credentials safely and lets the owner test and switch them on.
**It does not take payments, register callbacks/IPNs, or submit anything to KRA, and the POS checkout is untouched.**

## Who can use it
Permission `integrations.manage`. The Owner always has it. The starter Manager role does **not**; the Owner can grant it
to any role in Roles. Existing businesses' roles are unchanged (nobody but the Owner gains access).

## Endpoints (all need sign-in + business + `integrations.manage`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/integrations` | the three providers with status; `encryptionReady` |
| GET | `/api/integrations/:provider` | one provider |
| PUT | `/api/integrations/:provider` | `{environment?, config?, secrets?}`; blank/omitted secret = keep saved |
| POST | `/api/integrations/:provider/test` | real credential check; optional `Idempotency-Key` header |
| POST | `/api/integrations/:provider/enable` | only after a passing test of the *current* credentials |
| POST | `/api/integrations/:provider/disable` | body `{confirm:true}` required |

`:provider` is `mpesa`, `pesapal` or `etims`. Saves and enable/disable are limited to 30 per 10 min and tests to 10 per
10 min, per signed-in person (`INTEGRATIONS_WRITE_LIMIT` / `INTEGRATIONS_TEST_LIMIT` override).

## Secrets
* AES-256-GCM, random IV per value, auth tag stored. Business, provider and field name are authenticated data, so a
  ciphertext moved to another tenant/field will not decrypt.
* Key: Render secret `INTEGRATIONS_ENCRYPTION_KEY` = 32 random bytes as base64 (`openssl rand -base64 32`) or 64 hex chars.
  It is independent of `JWT_SECRET`. If it is missing, saving credentials returns 503 and stores nothing.
* **Never lose or change that key casually:** stored credentials become unreadable (owners would re-enter them).
  Rotation: add `INTEGRATIONS_ENCRYPTION_KEY_V2`, set `INTEGRATIONS_KEY_VERSION=2`; old rows keep their version.
* The API never returns a secret. Only the Consumer Key shows its last 4 characters as a hint.
* Audit rows list *which fields* changed, never values.

## Tables (migration `20261211090000_add_integrations`, additive)
`integration_connections` (unique per business+provider), `integration_secrets`, `integration_events`
(unique business+connection+idempotency key), `integration_audit_logs`. Every row carries `business_id`; a DB trigger
rejects a secret/event whose business differs from its connection's. Deleting a business cascades; deleting a
connection keeps its audit history.

## What "Test connection" proves
* M-PESA: Safaricom issues an OAuth token for the Consumer Key/Secret in that environment. **Not** the shortcode or passkey.
* Pesapal: API 3.0 issues a token (an error body on HTTP 200 counts as failure). IPN is **not** registered.
* eTIMS: unavailable. KRA's approved specification and onboarding are required; nothing is invented or submitted.
* Changing credentials or environment invalidates the last test and switches the integration off.
* These endpoints have been exercised only against a local fake provider in tests, **not** against the live Safaricom or
  Pesapal sandboxes. Run "Test connection" with real sandbox credentials once to confirm.

---

# Milestone 2a — M-PESA STK Push (backend only)

No POS screen or sale changes yet (that is 2b). Nothing here creates a sale, payment row, stock movement or cash entry.

## Endpoints
| Method | Path | Permission |
|---|---|---|
| POST | `/api/integrations/mpesa/payment-requests` | `payments.create` (cashiers). Body `{amount, phone, accountReference?, description?}`; **`Idempotency-Key` header required** |
| GET | `/api/integrations/mpesa/payment-requests/:id` | `payments.create`. Returns the current status and, when unsettled, asks Safaricom |
| POST | `/api/integrations/callbacks/mpesa/:token` | public (Safaricom). The secret token in the URL is the credential |

Amount is whole shillings (Safaricom's STK Push takes no cents), max KES 250,000. Phone accepts `07…`, `01…`, `+254…`, `254…`.

## What "paid" means
`pending` = the prompt was sent. It is **not** payment. A request becomes `paid` only when Safaricom's own STK Query says
the push succeeded (a callback is a hint, never proof, because anyone who learns the URL could post to it). Paid is recorded at the
amount *we requested*. Statuses: `pending`, `paid`, `failed`, `cancelled`, `expired`, `unconfirmed`.
* `failed`: Safaricom refused the request. `cancelled`/`expired`: customer cancelled / did not answer. A later Safaricom-confirmed success still upgrades these to `paid` (late payment).
* `unconfirmed`: we cannot be sure (network failure while sending, a callback whose amount/receipt did not match, or a receipt already used). Check with the customer/Safaricom; never retry blindly.
* A paid request never changes. One M-PESA receipt can pay only one request per business (database-enforced).
* The callback URL token is stored only as a SHA-256 hash and is never returned by the API or written to logs.

## Server settings needed
* `PUBLIC_API_URL` (or `APP_URL`) — the public **https** address Safaricom can reach, e.g. `https://nexapos-api.onrender.com`. Without it requests are refused with a clear message.
* Optional: `MPESA_REQUEST_LIMIT` (default 20/min per person), `MPESA_CALLBACK_LIMIT` (default 120/min per IP), `MPESA_RECHECK_MS` (default 8000).

## Honest limits
* Exercised only against a local fake Safaricom. The real sandbox flow (OAuth, `processrequest`, `stkpushquery`, a real callback) is **not yet verified**.
* A callback whose receipt is missing/malformed still leads to `paid` if Safaricom confirms, but with no receipt number stored.
* Safaricom does not sign callbacks and its source IPs are not enforced here; protection is the secret URL plus the status query.
* No automatic background reconciliation yet: a lost callback is repaired when someone opens/polls the request.

---

# Milestone 2b — using a confirmed M-PESA payment at the till

* `GET /api/integrations/mpesa/status` (`payments.create`) returns only `{enabled, environment}` so a till knows whether to offer "Send request to phone".
* `POST /api/sales` accepts `mpesaPaymentRequestId`. Inside the sale's own transaction the server requires that request to belong to the
  business, be `paid`, equal the sale's `amountPaid` exactly, and be unused; it then links it (`mpesa_payment_requests.sale_id`, unique) and stores the
  Safaricom receipt as the payment reference (`STK-XXXXXXXX` if the callback carried no receipt). Three tills racing on one payment: exactly one sale wins.
* The method must be `mpesa`. A failed check creates no sale and leaves the payment unspent.
* Manual M-Pesa codes remain, unchanged, as the fallback (and the only option offline).
* Till UI: "Send request to phone" (waiting, then confirmed) or "Enter code manually". While a request is pending/paid the amount and method are locked. Complete sale is blocked until `paid`.
* Migration `20261213090000_link_mpesa_request_to_sale`: nullable `sale_id` (unique FK, RESTRICT) plus a trigger so only a **paid** request can be linked, and only to a sale of the same business.

## Known gaps
* A customer who paid but whose sale was never completed leaves a confirmed, unlinked request. There is no screen for these yet (find them with `select * from mpesa_payment_requests where status = 'paid' and sale_id is null`).
* Refunds of STK-paid sales are still recorded manually, as before; nothing is refunded through Safaricom.
* A sale queued offline with a request id is sent when the till reconnects; if the payment was spent elsewhere meanwhile it is rejected and appears as needing attention.
* Verified against a local fake Safaricom only, not the live sandbox.

---

# Payments needing attention (read-only)

`GET /api/integrations/mpesa/attention` (needs `payments.view`) returns `unlinked` (Safaricom-confirmed, no sale used it) and
`review` (`unconfirmed` in the last 30 days). Settings shows them under the integration cards, and hides the section when empty.

Clearing an unlinked payment: ring the sale up with method M-Pesa and type the receipt code, for **exactly** the confirmed amount. The sale
service then links that confirmed payment automatically. A different amount is still accepted as a manual code (as before) but the payment stays
listed for a person to look at. There is deliberately no "dismiss" button yet: that would need new columns to record who dismissed what and why,
which should be agreed first.

---

# Dismissing M-PESA payments that need attention

Migration `20261214090000_mpesa_request_dismissal` adds three nullable columns to `mpesa_payment_requests`
(`dismissed_at`, `dismissed_by_user_id`, `dismissed_note`) and a CHECK that a dismissal always has a time and a reason of 5+ characters.

* `POST /api/integrations/mpesa/payment-requests/:id/dismiss` `{note}` and `.../restore` need `integrations.manage` (not cashiers).
* Only a paid-but-unlinked or an unconfirmed request can be dismissed. Nothing is deleted; who/when/why stay on the row and in the audit log.
* `GET /api/integrations/mpesa/attention` now also returns `dismissed`, so a dismissal can be restored.

## Pesapal hosted checkout (milestone 3)

Status: **built and tested against a local fake Pesapal only. Not yet verified against a real Pesapal sandbox account.**

### What it does
- Settings → Integrations → Pesapal: save your own Consumer Key/Secret and merchant name, run a connection test, enable.
  Then press **Register notification address** (needs a passing test first). That calls Pesapal's `RegisterIPN` with
  `https://<PUBLIC_API_URL>/api/integrations/callbacks/pesapal/<connection id>/<secret token>` and stores Pesapal's `ipn_id`.
  The token is kept only as a SHA-256 hash and is compared in constant time. Changing the keys or environment makes the
  registration stale (status goes back to "not registered") and it must be registered again.
- At the till, a business with Pesapal enabled **and** registered, and an online till, gets a "Pesapal" payment method. The
  cashier enters the customer's phone or email and gets a payment link, a copy button and a QR code (drawn in the browser,
  the link is never sent to a QR service). The customer pays on Pesapal's page (card, M-PESA or bank, whatever the merchant
  account offers).
- The sale is completed with `pesapalPaymentRequestId` and `paymentMethod: "pesapal"`; the payment reference is
  Pesapal's confirmation code (or `PSP-XXXXXXXX` if Pesapal gave none).

### When is a payment "paid"?
Only when **Pesapal's own `GetTransactionStatus`** answers COMPLETED and all of these match: currency is KES, the
`merchant_reference` is the one we sent, and the amount equals the request exactly. An IPN, the customer's return page or
anything in a query string is only a hint to ask Pesapal; none of them can set "paid". A mismatching COMPLETED answer
becomes `unconfirmed` (and can still upgrade to paid on a later correct answer).

### Safety rules (same as M-PESA)
- A paid request never changes status. A later REVERSED answer sets `reversal_noticed_at` and shows on
  `GET /integrations/pesapal/attention`; a flagged payment cannot be used for a sale.
- One request pays at most one sale (unique `sale_id`, conditional update, database trigger: only `paid`, same business).
- One confirmation code settles at most one request per business (partial unique index).
- Creating an order needs an `Idempotency-Key`; a retry returns the same request. Network failure while creating the
  order gives `unconfirmed` (no tracking id exists to ask about) and never claims a page was created.
- Credentials are encrypted like every integration secret and are only ever sent to Pesapal's fixed base URLs.
- Rate limits: payment requests 20/min per user (`MPESA_REQUEST_LIMIT`), IPN 120/min per IP (`MPESA_CALLBACK_LIMIT`),
  status re-check no more than every 8 s per request (`PESAPAL_RECHECK_MS`).

### Database
Migration `20261215090000_add_pesapal_payment_requests`: one new table `pesapal_payment_requests` with CHECKs (status,
positive amount, paid-complete, contact present, dismissal complete) and two triggers. Additive only.

### Honest limits / not verified
- **Not run against a real Pesapal sandbox.** Field names for the order and status calls follow Pesapal's published API 3.0
  documentation, but a real account may differ in detail (for example, the exact IPN query parameter names:
  `OrderTrackingId`, `OrderMerchantReference`, `OrderNotificationType` are what we read; the docs do not list them).
  Even if they differ, payments are still confirmed by the status poll while the till waits.
- The till polls every 3 s while the customer pays. If the cashier closes the till before the customer pays, the payment
  appears on the attention list as "paid, no sale" once Pesapal confirms it (the list refreshes when the request is checked,
  e.g. by an IPN).
- Reversals after a sale is complete are only noticed when Pesapal notifies us or the request is checked again; there is no
  scheduled background check.
- No refunds through Pesapal: refunding the customer is done in your Pesapal dashboard.
- A manual "Pesapal" payment recorded outside the till flow is not verified by anything.

### Pesapal payments needing attention (screen, dismiss and restore)
Settings → Integrations shows "Pesapal payments needing attention" when there is something to look at: paid but no sale
was completed, could not confirm (30 days), and reversed by Pesapal (30 days). A user with `integrations.manage` can
**dismiss** an item with a written reason (5-300 characters) and **restore** it later. Dismissing never deletes anything and
never changes the payment's status or money; who, when and why are kept and audited. Only those three kinds can be
dismissed (a pending or already-used payment cannot). Viewing the list needs `payments.view`.
Limits: Pesapal refunds are done in Pesapal's dashboard; this list does not refund anything or fix a sale that was
completed before a later reversal.

## M-PESA live statement (C2B notifications)

Status: **built and tested against a local fake Safaricom only. Not yet tried against the real Safaricom sandbox or production.**

### What it does
A new page, **M-PESA Statement** (needs `payments.view`; owners and managers have it, cashiers do not by default), lists every
payment Safaricom tells us about for the business's shortcode, **including payments nobody prompted for**, refreshing every
5 seconds (paused while the tab is hidden), with today's total and count, search by receipt/phone/name/account, and paging.
Payments that also went through a till prompt are marked "Till prompt" / "Till sale". Sandbox rows are marked "Test".

Switch it on in Settings → Integrations → M-PESA → **Live statement** (needs a passing connection test; `integrations.manage`).
That calls Safaricom's `registerurl` with
`<PUBLIC_API_URL>/api/integrations/callbacks/c2b/<connection id>/<64-hex token>/confirmation` (and `/validation`). The token is
only kept as a SHA-256 hash and compared in constant time; it is hex so it can never contain words Safaricom forbids in
addresses (mpesa, safaricom, exec, cmd, sql, query); registration is refused if the server's own address contains one.
In the sandbox there is a **Send a test payment** button that makes Safaricom's simulator call the real notification path.

### What it deliberately does NOT do
- **A statement row never creates, changes or settles a sale, payment or STK request.** Safaricom does not sign these
  notifications and there is no query to double-check them (unlike STK Push), so they are *reports*. The only thing standing
  between a forged notification and a fake row is the secret address. Compare with the Safaricom portal for official records.
- The account balance Safaricom sends (`OrgAccountBalance`) is not stored.
- Safaricom masks the customer's phone number (e.g. `25470****149`); it is shown as received.

### Rules
- One Safaricom receipt is recorded once per business (unique index); Safaricom's retries (up to about 24 hours) are harmless.
- Junk behind a valid token (wrong shortcode, bad receipt, amount or time) is acknowledged but not stored, and logged as a
  rejected event. An unknown or wrong token gets 404 and nothing is recorded.
- The registration is tied to the environment and shortcode: change either and the old address stops being accepted until
  you switch it on again.
- Database: migration `20261216090000_add_mpesa_c2b_payments`, one new table with CHECKs (positive amount, receipt format),
  a same-business trigger, and a unique (business, receipt). Additive only.

### Safaricom limits you must know (from Safaricom's published docs)
- **Production registration is effectively one-time per shortcode.** Safaricom will not replace addresses already registered
  by another system (a bank, another POS). Changing them means deleting them in the Daraja portal's URL management or
  emailing Safaricom. The screen makes you acknowledge this before registering in production.
- Production addresses must be HTTPS. Whether a **Till** (Buy Goods) is registered with the same shortcode as STK Push is not
  clear from the docs: check with Safaricom when you go live.
- "Notifications are real time" is best effort: Safaricom can deliver late (it retries) and, rarely, not at all.

### Not verified / not built
- Not run against real Safaricom (sandbox or production). In particular `registerurl`/`simulate` response wording and the
  Till behaviour are untested.
- "Till prompt/Till sale" marking is code-reviewed but has no automated test.
- No export (CSV) of the statement yet; no push notification or sound when a payment arrives.
