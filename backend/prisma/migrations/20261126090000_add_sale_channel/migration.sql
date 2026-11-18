-- Additive only: records HOW a sale was made. Existing sales become 'walk_in' (the default).
ALTER TABLE "sales" ADD COLUMN "channel" VARCHAR(20) NOT NULL DEFAULT 'walk_in';
ALTER TABLE "sales" ADD CONSTRAINT "sales_channel_valid" CHECK ("channel" IN ('walk_in','online','phone','delivery','other'));
