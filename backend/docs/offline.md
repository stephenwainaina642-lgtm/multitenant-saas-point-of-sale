# Offline till (phase 1)

The till keeps selling when the internet drops. This is what it does and, just as important, what it does not do.

## What works offline
- The app opens without internet (a service worker keeps the app's own files; it never caches `/api`).
- Prices, this branch's stock levels, customer names/phones and the business's VAT settings are saved on the device each time the till loads online, and used when offline.
- Sales are saved on the device first (the existing outbox), each with its own idempotency key, and are sent automatically when the connection returns. A sale sent twice is recorded once.
- Cash, and M-PESA with the code typed in, work offline. The code is checked by the server when the sale syncs.

## What does not work offline
- **Signing in.** Sign in once while online; the session then survives an offline reload of the same tab. No password or token is stored for offline use.
- **VAT-registered businesses cannot sell offline yet.** VAT totals are worked out by the server and must match exactly, so the till refuses an offline sale for them with a clear message. (Phase 2: port the VAT maths with parity tests.)
- STK push, Pesapal checkout and anything else that needs a provider are hidden/blocked offline.

## Stock that ran out meanwhile
The database forbids negative stock. If an offline sale reaches the server after the stock was sold elsewhere, the sale is **still recorded** (the customer was served), stock stops at **zero**, only the units that really existed are deducted, and the difference is stored in `offline_stock_shortfalls`. Inventory shows these under "Offline sales to review"; a manager recounts, corrects stock if needed and marks it reviewed with a note. Marking reviewed never changes stock or the sale.

Only sales that carry `offlineSoldAt` (set by the till when it was offline) get this treatment. Online sales are still refused when stock is short.

## Limits to know
- `offlineSoldAt` must be a real time, not in the future (5 min allowance) and not older than 14 days; otherwise the sale is rejected.
- The sale's date in reports is the time it reached the server; the real time is kept in `sales.offline_sold_at`.
- Data on the device is cleared on sign out. Signing out is blocked while unsent sales remain.
- Cached stock can be stale; two tills offline can both sell the last unit. That is exactly the shortfall case above.

## Deploying
Migration `20261217090000_offline_sales_shortfalls` is additive (one column, one table). Back up first, then `migrate deploy`, then redeploy the API and the frontend.
