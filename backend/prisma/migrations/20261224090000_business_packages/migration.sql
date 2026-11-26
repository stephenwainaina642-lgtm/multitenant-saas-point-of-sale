-- Packaging: a business has a package (retail or hotel) and an explicit list of optional modules.
-- Additive only. Existing businesses keep every feature they use today:
--   * hotel and restaurant types, and any business that already has table, room or menu-extra data, become the hotel package;
--   * everyone else becomes retail. Their module list is written out explicitly (nothing is "implied").
ALTER TABLE "businesses" ADD COLUMN "package" VARCHAR(20) NOT NULL DEFAULT 'retail';
ALTER TABLE "businesses" ADD COLUMN "modules" TEXT[] NOT NULL DEFAULT ARRAY['purchasing','documents']::TEXT[];

UPDATE "businesses" b SET "package" = 'hotel'
 WHERE b."business_type" IN ('hotel','restaurant')
    OR EXISTS (SELECT 1 FROM "dining_tables" t WHERE t."business_id" = b."id")
    OR EXISTS (SELECT 1 FROM "hotel_stays" s WHERE s."business_id" = b."id")
    OR EXISTS (SELECT 1 FROM "menu_addons" m WHERE m."business_id" = b."id")
    OR EXISTS (SELECT 1 FROM "recipe_items" r WHERE r."business_id" = b."id");

UPDATE "businesses" b SET "modules" = ARRAY['tables','purchasing','documents']::TEXT[] WHERE b."package" = 'hotel';
UPDATE "businesses" b SET "modules" = ARRAY['tables','rooms','purchasing','documents']::TEXT[]
 WHERE b."package" = 'hotel' AND (b."business_type" = 'hotel' OR EXISTS (SELECT 1 FROM "hotel_stays" s WHERE s."business_id" = b."id"));

ALTER TABLE "businesses" ADD CONSTRAINT "businesses_package_valid" CHECK ("package" IN ('retail','hotel'));
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_modules_known" CHECK ("modules" <@ ARRAY['tables','rooms','purchasing','documents']::TEXT[]);

-- An invitation can say which package the client's business starts with (empty = by business type).
ALTER TABLE "business_invites" ADD COLUMN "package" VARCHAR(20);
ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_package_valid" CHECK ("package" IS NULL OR "package" IN ('retail','hotel'));
