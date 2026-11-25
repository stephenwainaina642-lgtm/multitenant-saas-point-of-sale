-- Hotel slice 5: recipes (ingredient costing). Additive only; no existing table or row is changed.
--  * recipe_items: what one portion of a dish uses (ingredient = an ordinary stock product, quantity in that product's unit).
--  * sale_ingredient_usage: the ingredient quantities actually taken from stock for a sale, so a void or an edit gives back
--    exactly what was used, even if the recipe was changed afterwards.

CREATE TABLE "recipe_items" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "ingredient_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recipe_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "recipe_items_not_self" CHECK ("product_id" <> "ingredient_id")
);
CREATE UNIQUE INDEX "recipe_items_product_ingredient_key" ON "recipe_items"("product_id", "ingredient_id");
CREATE INDEX "recipe_items_business_idx" ON "recipe_items"("business_id");
CREATE INDEX "recipe_items_ingredient_idx" ON "recipe_items"("ingredient_id");
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sale_ingredient_usage" (
    "sale_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    CONSTRAINT "sale_ingredient_usage_pkey" PRIMARY KEY ("sale_id", "product_id"),
    CONSTRAINT "sale_ingredient_usage_quantity_positive" CHECK ("quantity" > 0)
);
ALTER TABLE "sale_ingredient_usage" ADD CONSTRAINT "sale_ingredient_usage_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_ingredient_usage" ADD CONSTRAINT "sale_ingredient_usage_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
