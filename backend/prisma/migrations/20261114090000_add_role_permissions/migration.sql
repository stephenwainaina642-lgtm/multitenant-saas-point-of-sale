-- Additive only. Existing roles keep working: an empty list means "use the
-- built-in defaults for this role name" (owner = everything).
ALTER TABLE "roles" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
