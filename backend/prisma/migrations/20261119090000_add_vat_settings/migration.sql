-- Additive only. VAT is OFF by default (vat_registered = false), so existing businesses
-- keep the manual tax entry they have today. Existing products become 'standard'.
ALTER TABLE "businesses" ADD COLUMN "vat_registered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 16.00;
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_vat_rate_range" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100);

ALTER TABLE "products" ADD COLUMN "tax_class" VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE "products" ADD CONSTRAINT "products_tax_class_valid" CHECK ("tax_class" IN ('standard', 'zero_rated', 'exempt'));
