-- Additive: lets the platform owner hide ("delete") a business without removing any data.
-- A hidden business cannot be signed in to; it can be restored, or erased for good from the Super Admin.
ALTER TABLE "businesses" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
