-- Hotel / restaurant support. Additive only; no existing row changes meaning.
--  * products.tracks_stock (default true = today's behaviour). Made-to-order meals set it false: selling them neither
--    needs nor changes stock.
--  * products.is_available (default true). A meal marked unavailable ("sold out today") cannot be added to a table order.
--  * dining_tables, table_orders, table_order_items: open a table, add items over time, bill. Billing creates an ordinary
--    sale through the existing sale code, so payments, receipts, VAT and reports are unchanged.

ALTER TABLE "products" ADD COLUMN "tracks_stock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN "is_available" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "dining_tables" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "seats" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_tables_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "dining_tables_seats_positive" CHECK ("seats" IS NULL OR ("seats" > 0 AND "seats" <= 500))
);
CREATE UNIQUE INDEX "dining_tables_public_id_key" ON "dining_tables"("public_id");
CREATE UNIQUE INDEX "dining_tables_branch_name_key" ON "dining_tables"("branch_id","name");
CREATE INDEX "dining_tables_business_idx" ON "dining_tables"("business_id");

CREATE TABLE "table_orders" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "table_id" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "guest_name" VARCHAR(100),
    "covers" INTEGER,
    "notes" VARCHAR(300),
    "opened_by" BIGINT NOT NULL,
    "sale_id" BIGINT,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "table_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_orders_status_check" CHECK ("status" IN ('open','billed','cancelled')),
    CONSTRAINT "table_orders_covers_positive" CHECK ("covers" IS NULL OR "covers" > 0),
    CONSTRAINT "table_orders_billed_has_sale" CHECK ("status" <> 'billed' OR "sale_id" IS NOT NULL),
    CONSTRAINT "table_orders_closed_complete" CHECK (("status" = 'open' AND "closed_at" IS NULL) OR ("status" <> 'open' AND "closed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "table_orders_public_id_key" ON "table_orders"("public_id");
CREATE UNIQUE INDEX "table_orders_sale_id_key" ON "table_orders"("sale_id");
-- A table can have only one open order at a time.
CREATE UNIQUE INDEX "table_orders_one_open_per_table" ON "table_orders"("table_id") WHERE "status" = 'open';
CREATE INDEX "table_orders_business_status_idx" ON "table_orders"("business_id","status");

CREATE TABLE "table_order_items" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "note" VARCHAR(200),
    "sent_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "table_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_order_items_qty_positive" CHECK ("quantity" > 0),
    CONSTRAINT "table_order_items_price_nonneg" CHECK ("unit_price" >= 0),
    CONSTRAINT "table_order_items_void_complete" CHECK (("voided_at" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "table_order_items_public_id_key" ON "table_order_items"("public_id");
CREATE INDEX "table_order_items_order_idx" ON "table_order_items"("order_id");

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_orders" ADD CONSTRAINT "table_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_orders" ADD CONSTRAINT "table_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_orders" ADD CONSTRAINT "table_orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_orders" ADD CONSTRAINT "table_orders_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_orders" ADD CONSTRAINT "table_orders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "table_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
