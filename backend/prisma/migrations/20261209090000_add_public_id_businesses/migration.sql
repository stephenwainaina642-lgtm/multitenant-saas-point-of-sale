-- Random public identifier for businesses (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key (business_id columns everywhere); every existing row receives its own random value.
ALTER TABLE "businesses" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "businesses_public_id_key" ON "businesses"("public_id");
