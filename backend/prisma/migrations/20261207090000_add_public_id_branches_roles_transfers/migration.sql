-- Random public identifiers for branches, roles and stock transfers (see docs/public-ids.md).
-- Additive: the numeric id stays as the internal key; every existing row receives its own random value.
ALTER TABLE "branches" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "branches_public_id_key" ON "branches"("public_id");
ALTER TABLE "roles" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "roles_public_id_key" ON "roles"("public_id");
ALTER TABLE "stock_transfers" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "stock_transfers_public_id_key" ON "stock_transfers"("public_id");
