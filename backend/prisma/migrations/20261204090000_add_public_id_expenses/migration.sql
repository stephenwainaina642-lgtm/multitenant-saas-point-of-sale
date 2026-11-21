-- Random public identifier for expenses (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "expenses" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "expenses_public_id_key" ON "expenses"("public_id");
