-- Random public identifiers for users and business memberships (see docs/public-ids.md).
-- Additive: the numeric ids stay as internal keys (login tokens keep using them); every existing row receives its own random value.
ALTER TABLE "users" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");
ALTER TABLE "business_users" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "business_users_public_id_key" ON "business_users"("public_id");
