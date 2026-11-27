# Offline till (phase 1)

The till keeps selling when the internet drops. This is what it does and, just as important, what it does not do.

## What works offline
- The app opens without internet (a service worker keeps the app's own files; it never caches `/api`).
- Prices, this branch's stock levels, customer names/phones and the business's VAT settings are saved on the device each time the till loads online, and used when offline.
- Sales are saved on the device first (the existing outbox), each with its own idempotency key, and are sent automatically when the connection returns. A sale sent twice is recorded once.
- Cash, and M-PESA with the code typed in, work offline. The code is checked by the server when the sale syncs.

## What does not work offline
- **Signing in.** Sign in once while online; the session then survives an offline reload of the same tab. No password or token is stored for offline use.
- **VAT-registered businesses can sell offline.** The till works VAT out on the device with `frontend/src/vatMath.ts`, a line-for-line integer port of the server's `sale-calc.ts` (standard, zero-rated, exempt and custom rates; exclusive and inclusive pricing; sale discount spread over lines). `backend/tests/api/vat-parity.test.ts` checks it against the server's functions on 4,800 random sales and against the live `/sales/preview` endpoint, so a change to either side that breaks agreement fails the suite. The server still recalculates VAT when the sale syncs. The device keeps each product's tax class and the business's extra rates with the VAT settings, refreshed whenever the till loads online. If a price, tax class or rate was changed on the server after the device last refreshed, the recorded total can differ from what the offline receipt showed; a sale whose amount paid is more than the server's total is refused and stays in the outbox as failed with the reason, as with an offline price change.
- STK push, Pesapal checkout and anything else that needs a provider are hidden/blocked offline.

## Signing in with a PIN (no internet)
Normal sign-in needs the server. For a PC that must open the till with the internet down, a member can set a PIN for that PC
(Settings > "Sign in without internet"; their password is asked first). Which roles may do this is the permission
**"Use a PIN to sign in on a PC that has no internet"** (`offline.signin`): the owner always has it, new Manager roles get it, and the
owner ticks it on any other role (Employees > Roles). Existing roles are not changed automatically.

- **What is kept on the PC:** a salted PBKDF2-SHA256 hash of the PIN (210,000 rounds, never the PIN) and the person's name, role,
  permission list and modules as the server last reported them. No password, token or server session is kept.
- **When it can be used:** only when the server cannot be reached. If the server answers, the PIN screen sends the person to the
  password form. The sign-in screen offers it when the browser is offline or after a failed sign-in because the server was unreachable.
- **Lock:** 5 wrong PINs lock that PIN on that PC, across reloads, until the same person signs in with their password while online.
- **Choosing a PIN:** 4 to 6 digits; all-the-same-digit and straight runs (1234, 4321) are refused.
- **Sales made this way** wait in the till's queue like any offline sale. They are sent only when the person has a valid real
  sign-in. If the real sign-in has expired (it lasts 12 hours) or another person signed in on this browser, the till returns to the
  sign-in screen ("Sign in with your password so the sales made offline can be sent"), keeps the sales, and sends them right after the
  password sign-in. The server checks every permission again when each sale arrives. Sales are credited to the person who made them.
- **It is removed** when the person signs out (so close the window, do not sign out, to keep it), when they turn it off in Settings,
  when the server reports the account closed or their access to the business removed, and the next time the till loads online after
  their role lost the permission. A PC that stays offline cannot be told; the owner's change reaches it the next time it is online.
- **Limits to know:** a 4 to 6 digit PIN is guessable by someone who can copy the browser's saved data off the PC and try
  PINs outside the app (the lock only applies inside the app). It is meant for a shop's till PC, not as strong protection. Use a
  Windows account password and keep the PC physically safe. The offline till still shows only what the person's role allowed at
  the last online load.

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
