# Packages and modules

Every business has a **package** (`retail` or `hotel`) and a list of switched-on **modules**.

| Module | Pages / API it controls |
| --- | --- |
| `tables` | Tables & orders, kitchen tickets, split bills, recipes (`/api/hotel` except stays) |
| `rooms` | Rooms & stays, charge-to-room (`/api/hotel/stays*`, billing with `stayId`) |
| `purchasing` | Suppliers and purchases (`/api/suppliers`, `/api/purchases`) |
| `documents` | Quotations and invoices (`/api/quotations`, `/api/invoices`) |

Defaults: retail = purchasing + documents. Hotel = tables + rooms + purchasing + documents.
A restaurant business type gets the hotel package without rooms. Branches are not a module.

## Enforcement
The server refuses a switched-off module for every user (including the owner) in `requireBusinessAccess`
(403 "<Module> is not included in this business's package. Contact support to add it."). The app menu hides the same
pages. Switching a module off deletes nothing; switching it on restores access.

## Super admin
* Businesses tab: each row shows its package and modules; **Package** changes the package (which resets modules to that
  package's defaults) and toggles modules. A reason is required; audited as `business.package` / `business.modules`.
* Invitations: choose the package for the new client; it applies when they sign up.
* Hotel starter roles (waiter, receptionist, head chef) are created only for new hotel-package businesses. Changing an
  existing business's package does not touch its roles.

## Deploying
Migration `20261224090000_business_packages` is additive. Back up first, then run
`npx prisma migrate deploy --config prisma7.config.ts`, then redeploy the backend.
Existing businesses are backfilled: hotel package for business types hotel/restaurant or any business that already uses
tables, stays, add-ons or recipes (rooms on for type hotel or existing stays); everything else is retail.
