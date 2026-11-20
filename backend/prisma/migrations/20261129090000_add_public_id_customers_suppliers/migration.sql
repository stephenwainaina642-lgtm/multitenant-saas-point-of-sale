-- Random public identifiers for customers and suppliers (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "customers" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "customers_public_id_key" ON "customers"("public_id");
ALTER TABLE "suppliers" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "suppliers_public_id_key" ON "suppliers"("public_id");
