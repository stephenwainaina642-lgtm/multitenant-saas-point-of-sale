# M-Pesa and KRA eTIMS: what is needed (nothing here is built)

I have deliberately **not** added M-Pesa or eTIMS buttons or screens. Both only work against live external systems, and
I cannot reach them from the build environment, so anything I wrote could not be tested and would look like a working
feature when it is not.

## M-Pesa (Safaricom Daraja)
What exists today: "M-Pesa" is a payment *method* the cashier selects; the money is confirmed by a human. No automatic check.

To build STK Push / payment confirmation you must provide:
- A Daraja developer account and an app (consumer key + secret), then **go-live approval** from Safaricom for production.
- The business's Paybill or Till number and the Lipa Na M-Pesa **passkey**.
- A public **HTTPS callback URL** for results (this needs the hosting you are deferring).
- Decision: one shortcode for the whole SaaS (you collect and settle for tenants – regulated, needs legal advice) or
  each business connects its own shortcode (credentials stored encrypted per business).

Buildable without credentials, if you want it now (small, real, testable): record the M-Pesa transaction code on the
payment and **reject the same code being used twice** in a business. This reduces reuse of a single SMS as proof for several sales.
It needs a partial unique index, which can fail if old data already has duplicate references, so I would first run a read-only
duplicate check and show you the result.

## KRA eTIMS
Required for VAT-registered businesses to issue tax invoices through KRA's system.
Needs: KRA PIN and eTIMS registration for each business, the integration type KRA approves for you
(OSCU/VSCU or the API route for software vendors), KRA sandbox/test credentials, device/branch initialisation,
item classification codes for each product (KRA codes, not our categories), tax-type mapping (A/B/C/D/E),
and signed invoice numbers/QR codes returned by KRA that must appear on receipts.

I can build it only after you obtain KRA sandbox access, because the submission format and responses must be tested against KRA.
Until then, do not market nexaPOS as eTIMS-compliant. Existing VAT support (exclusive pricing, KRA PIN on receipts) does not replace eTIMS.
