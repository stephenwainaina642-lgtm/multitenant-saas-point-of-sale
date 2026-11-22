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
