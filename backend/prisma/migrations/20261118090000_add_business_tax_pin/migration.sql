-- Additive only: the business's KRA PIN, printed on receipts and invoices.
-- Existing rows get NULL; the format check (letter, 9 digits, letter) cannot fail on them.
ALTER TABLE "businesses" ADD COLUMN "tax_pin" VARCHAR(20);
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_tax_pin_format"
  CHECK ("tax_pin" IS NULL OR "tax_pin" ~ '^[A-Z][0-9]{9}[A-Z]$');
