-- Random public identifier for categories (pilot of "public ids").
-- The numeric id stays as the internal key (nothing is renamed, dropped or rewritten); the API shows only public_id.
-- ADD COLUMN ... DEFAULT gen_random_uuid() fills every existing row with its own random value.
ALTER TABLE "categories" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "categories_public_id_key" ON "categories"("public_id");
