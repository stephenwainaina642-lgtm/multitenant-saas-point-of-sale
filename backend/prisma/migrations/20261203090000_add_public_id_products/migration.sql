-- Random public identifier for products (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "products" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "products_public_id_key" ON "products"("public_id");
