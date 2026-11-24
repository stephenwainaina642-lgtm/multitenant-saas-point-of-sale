-- Hotel slice 3: bill a table in parts (split bill). Additive only.
--  * table_order_items.sale_id: the sale a line was billed on (null = not billed yet). Existing rows stay null; orders
--    already billed as a whole keep their link through table_orders.sale_id as before.
--  * A removed (voided) line can never be billed.
ALTER TABLE "table_order_items" ADD COLUMN "sale_id" BIGINT;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_order_items" ADD CONSTRAINT "table_order_items_void_not_billed" CHECK ("voided_at" IS NULL OR "sale_id" IS NULL);
CREATE INDEX "table_order_items_sale_idx" ON "table_order_items"("sale_id");
