# Super-admin quotations (installations, trainings and more)

Open the platform screen (`/#platform`, signed in with your authenticator code) and choose **Quotations**. This is separate from the quotations tenants make for their own customers; business users cannot see or reach it.

## Set up once
1. **Company settings**: company name (required before sending), address, phone, email, KRA PIN, how clients pay (Paybill / bank), default terms, how many days a quotation stays valid, and a default VAT %. **Leave VAT at 0 unless your own company is VAT-registered**; the system assumes nothing.
2. **Price list**: your standard services (installation, training, subscription, hardware, support) with *your* prices. Nothing is pre-filled. A quotation keeps its own copy of each line, so changing or removing a price-list item never changes a quotation you already made.

## Making a quotation
New quotation -> client details, title and introduction, lines (from the price list or custom), optional discount, VAT %, valid-until date, how to pay, terms. Totals are worked out by the server in whole cents (prices are treated as VAT-exclusive; VAT is added on top after the discount); the browser's total is only a preview.

Numbers run `QT-<year>-0001`, `0002`... with no gaps or repeats.

## Life of a quotation
- **Draft**: editable, can be deleted.
- **Mark as sent**: locks it and freezes your company details on it (changing settings later never alters an issued quotation). Needs at least one line, a company name and a valid-until date that has not passed.
- **Client accepted / declined**: final. An expired quotation (past its valid-until date) cannot be accepted; use **Duplicate** to issue a fresh draft with a new number.
- **Reopen to edit**: pulls a *sent, undecided* quotation back to draft (recorded in the activity log).
- **Duplicate**: a fresh draft copy with a new number (use it to revise an accepted, declined or expired quotation).

Every create, edit, send, decision, reopen, delete and price-list/settings change is written to the **Admin activity** log.

## Printing and sending
**Print / Save as PDF** opens the browser's print dialog on a branded A4 page (choose "Save as PDF"; tick "Background graphics" if your browser asks, so the green header prints). **Email client** opens your mail app with a drafted message; attach the PDF yourself, because the system does not send email on your behalf. **Copy summary** puts a short text version on the clipboard.

## Limits
- There is no client-facing link or online acceptance; acceptance is recorded by you.
- One currency (KES). No recurring/instalment schedules.
- Reports/analytics on quotations are not included yet.

## Deploying
Migration `20261221090000_platform_quotes` is additive (five new tables and one settings row). Back up first, then `migrate deploy`, then redeploy the API and the frontend.
