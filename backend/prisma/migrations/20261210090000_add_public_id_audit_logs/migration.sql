-- Random public identifiers for audit-log rows and register shifts (see docs/public-ids.md).
-- Additive: the numeric id stays the internal key; every existing row receives its own random value.
-- Audit history itself is not rewritten: entity / user / business ids are mapped to public ids when the log is read.
ALTER TABLE "audit_logs" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "audit_logs_public_id_key" ON "audit_logs"("public_id");
ALTER TABLE "register_shifts" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "register_shifts_public_id_key" ON "register_shifts"("public_id");
