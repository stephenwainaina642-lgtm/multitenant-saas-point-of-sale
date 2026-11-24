# Hotel & restaurant module (phases A and B)

Menu items are ordinary products. A meal made to order has **"tracks stock" off**, so selling it neither needs nor changes stock; a drink or packaged item can keep stock tracking on. "Sold out today" is the `is_available` flag.

**Portions** are separate menu items with their own price (e.g. "Pilau – Half", "Pilau – Full").

## Tables and orders (Tables & Orders page)
- A table or room has at most one open order. Items are added over time; each line freezes its price when added.
- **Send to kitchen** marks new lines as sent and shows a printable kitchen ticket (table, items, add-ons, notes). Removing a sent line needs a reason and stays on the record; unsent lines are simply removed.
- **Bill** creates one ordinary sale through the normal sale code (same receipt numbers, VAT, payments, reports, voids). Pressing Bill twice, or retrying after a dropped connection, never makes a second sale. Nothing is sold or deducted until billing.
- Bills are paid in full on this screen (cash, M-PESA with the code typed in, card). Part payment or credit: use the Point of Sale screen.

## Split bill
At billing, tick the lines to include; each part is its own sale with its own receipt, paid its own way (cash, M-PESA code, card). The rest of the table stays open until every line is billed. Service charge and levy are worked out on each part separately (rounded per receipt, so the parts can differ from one whole-table rounding by a few cents).
- A line can be billed once only. Billed lines cannot be changed or removed; a table with billed lines cannot be cancelled (bill the rest).
- Sending the same part-bill again returns the same receipt; two tills billing the same line at once produce one sale (a per-order lock).
- Splitting a *single dish* between guests, or splitting the total equally, is not supported yet.
- If a part-bill sale is later voided, its lines stay marked as billed; re-ring them on the Point of Sale screen.

## Add-ons
A per-business list (name, price). Chosen add-ons are copied onto the line with their price, so later changes never alter an open bill. Lines merge only when dish, note and add-ons are identical.

## Service charge and catering levy
Percentages per business (0–50, default 0 = off), set under "Menu extras and charges" (needs *settings.manage*). At billing they become ordinary lines on the same sale ("Service charge", "Catering levy"), worked out in whole cents on the food and drink total (add-ons included). Consequences to know:
- VAT is applied by the existing sale code using the charge item's tax class (standard). For a VAT-inclusive business the charge amounts are treated as VAT-inclusive too. **Check the right VAT treatment for your clients with their accountant**; the rates and tax class are the business's decision, nothing here assumes a legal rate.
- In reports the charges appear as items named "Service charge" / "Catering levy".
- Changing a rate affects only later bills.

## Limits
- Needs a connection (no offline mode for tables yet).
- Not yet: charge to room and recipe/ingredient costing (phase C).

## Deploying
Migrations `20261218090000_hotel_tables_orders`, `20261219090000_hotel_charges_addons` and `20261220090000_table_order_split_billing` are additive (new tables, new columns with defaults that keep today's behaviour). Back up first, then `migrate deploy`, then redeploy API and frontend.
