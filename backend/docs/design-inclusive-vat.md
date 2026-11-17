# Design: VAT-inclusive pricing (needs your approval before any code)

Status: APPROVED as written and IMPLEMENTED (migration `20261121090000_add_prices_include_vat`, tests in `tests/api/vat-inclusive.test.ts`).

Deviation from the text below: `line.total` keeps its existing meaning (amount after the line's own discount, before the sale-level discount), so
"sum of line totals = sale total" holds only when there is no sale-level discount. The entered sale-level discount is recovered as
`sum(line totals) - sale total` and returned as `saleDiscount` on sales and quotations.

## Today
Prices are VAT-exclusive: `net = qty × price − discount`, `tax = 16% × net` (per line, half-up), `total = subtotal − discount + tax`.
Many Kenyan shops display VAT-inclusive shelf prices ("this phone is KSh 20,000"), which today means they must
enter prices that are not their shelf prices.

## The hard part
An inclusive price cannot always be turned into an exact 2-decimal exclusive price (KSh 100 inclusive = 86.2068… exclusive).
So we must never store a "derived exclusive unit price" and multiply it back. The rule has to be applied to the
**line gross** and the tax derived as the remainder, so `net + tax = gross` exactly.

## Proposed rule (inclusive mode, standard-rated lines only)
1. `gross = qty × price − line discount − allocated sale discount` (all VAT-inclusive amounts, exact cents).
2. `net = round_half_up(gross / (1 + rate))`, `tax = gross − net`. Zero-rated and exempt lines: `tax = 0`, `net = gross`.
3. `line.total = gross` (unchanged meaning: line total includes tax, in both modes), `line.tax = tax`.
4. Sale columns keep the existing invariant **`total = subtotal − discount + tax` with no schema CHECK changes**:
   `subtotal` = Σ net before discounts, `discount` = the discount expressed ex-VAT, `tax` = Σ line tax, `total` = Σ gross.
   The receipt can still show "Discount KSh X (incl. VAT)" because the entered amount is kept on the line.
5. Reports already use `total − tax` as net sales, so they stay correct without change.

## Schema (additive, nullable/defaulted, no data touched)
- `businesses.prices_include_vat boolean not null default false`
- `sales.prices_include_vat boolean not null default false` – snapshot at sale time so history, edits, refunds and
  reprints keep the mode they were sold in even if the owner later changes the setting.
- Same snapshot on `quotations` (they convert into sales).

## Decisions I need from you
1. **Approve the rule above?** (Alternative: keep exclusive-only and show an inclusive *display* price – simpler, but
   receipts and the till would not match the shelf price.)
2. **Switching the setting.** Product prices are never changed automatically. When an owner flips to inclusive, the
   existing price list is simply *interpreted* as inclusive from then on. I propose a confirmation screen saying exactly that,
   and only allowing the switch for VAT-registered businesses.
3. **Discounts** typed at the till are VAT-inclusive in this mode (what the customer sees).

## Impact and risk
Touches sale create/edit, quotations and conversion, receipts/invoices display, the till preview, CSV import wording,
and the audit script. Risk is rounding drift; the test plan is property-style: for thousands of random
carts (1–5 mixed-class lines, discounts, quantities with 3 decimals) assert `Σ line.total = sale.total`,
`net + tax = gross` per line, `total = subtotal − discount + tax`, and idempotent re-pricing on sale edit.

## Not covered
VAT returns (VAT3), eTIMS submission, withholding VAT.
