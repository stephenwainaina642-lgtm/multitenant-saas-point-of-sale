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
