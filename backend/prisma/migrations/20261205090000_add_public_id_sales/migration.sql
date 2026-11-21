-- Random public identifier for sales (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "sales" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "sales_public_id_key" ON "sales"("public_id");
