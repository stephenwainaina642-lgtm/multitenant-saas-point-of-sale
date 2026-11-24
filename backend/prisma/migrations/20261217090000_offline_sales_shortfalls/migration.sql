-- Offline selling support. Additive only.
--  * sales.offline_sold_at: when the till says the sale was rung up while it had no internet (NULL for every existing sale).
--  * offline_stock_shortfalls: when an offline sale reaches the server after the stock has run out, the sale is still
--    recorded (the customer was served), stock is taken down to zero (never below: the non-negative stock CHECKs stay),
--    and the missing quantity is written here for a manager to review and resolve.

ALTER TABLE "sales" ADD COLUMN "offline_sold_at" TIMESTAMPTZ(6);

CREATE TABLE "offline_stock_shortfalls" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "quantity_short" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" BIGINT,
    "resolved_note" VARCHAR(300),
    CONSTRAINT "offline_stock_shortfalls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offline_stock_shortfalls_qty_positive" CHECK ("quantity_short" > 0),
    CONSTRAINT "offline_stock_shortfalls_resolved_complete" CHECK (
      ("resolved_at" IS NULL AND "resolved_note" IS NULL) OR ("resolved_at" IS NOT NULL AND "resolved_note" IS NOT NULL))
);
CREATE UNIQUE INDEX "offline_stock_shortfalls_public_id_key" ON "offline_stock_shortfalls"("public_id");
CREATE UNIQUE INDEX "offline_stock_shortfalls_sale_product_key" ON "offline_stock_shortfalls"("sale_id","product_id");
CREATE INDEX "offline_stock_shortfalls_business_open_idx" ON "offline_stock_shortfalls"("business_id","created_at") WHERE "resolved_at" IS NULL;
ALTER TABLE "offline_stock_shortfalls" ADD CONSTRAINT "offline_stock_shortfalls_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offline_stock_shortfalls" ADD CONSTRAINT "offline_stock_shortfalls_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offline_stock_shortfalls" ADD CONSTRAINT "offline_stock_shortfalls_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offline_stock_shortfalls" ADD CONSTRAINT "offline_stock_shortfalls_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offline_stock_shortfalls" ADD CONSTRAINT "offline_stock_shortfalls_resolved_by_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
