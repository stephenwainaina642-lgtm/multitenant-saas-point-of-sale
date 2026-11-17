-- Additive only. VAT-inclusive pricing is OFF by default, so every existing business, sale and
-- quotation keeps today's VAT-exclusive meaning. Nothing existing is rewritten.
ALTER TABLE "businesses" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_inclusive_needs_vat"
  CHECK ("prices_include_vat" = false OR "vat_registered" = true);

-- Snapshot of the mode a document was priced in, so edits, reprints and refunds keep its meaning
-- even if the owner later changes the business setting.
ALTER TABLE "sales" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "quotations" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;
