-- Random public identifiers for purchases, invoices, customer payments and supplier payments (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "purchases" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "purchases_public_id_key" ON "purchases"("public_id");
ALTER TABLE "invoices" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "invoices_public_id_key" ON "invoices"("public_id");
ALTER TABLE "payments" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "payments_public_id_key" ON "payments"("public_id");
ALTER TABLE "supplier_payments" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "supplier_payments_public_id_key" ON "supplier_payments"("public_id");
