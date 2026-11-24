-- Hotel slice 2. Additive only; every default keeps today's behaviour (no charges, no add-ons).
--  * businesses.service_charge_rate / catering_levy_rate: percent added to a table bill at billing time (0 = off).
--  * menu_addons: extras a guest can add to a dish ("extra cheese"), each with an optional price.
--  * table_order_items.addons: the add-ons chosen for that line, copied (name + price) when added, so later price
--    changes never alter an open bill.

ALTER TABLE "businesses" ADD COLUMN "service_charge_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "businesses" ADD COLUMN "catering_levy_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_service_charge_range" CHECK ("service_charge_rate" >= 0 AND "service_charge_rate" <= 50);
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_catering_levy_range" CHECK ("catering_levy_rate" >= 0 AND "catering_levy_rate" <= 50);

CREATE TABLE "menu_addons" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_addons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "menu_addons_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "menu_addons_price_nonneg" CHECK ("price" >= 0)
);
CREATE UNIQUE INDEX "menu_addons_public_id_key" ON "menu_addons"("public_id");
CREATE UNIQUE INDEX "menu_addons_business_name_key" ON "menu_addons"("business_id","name");
ALTER TABLE "menu_addons" ADD CONSTRAINT "menu_addons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_order_items" ADD COLUMN "addons" JSONB;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_addons_array" CHECK ("addons" IS NULL OR jsonb_typeof("addons") = 'array');
