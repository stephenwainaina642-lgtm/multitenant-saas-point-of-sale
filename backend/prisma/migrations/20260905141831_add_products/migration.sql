-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "category_id" BIGINT,
    "name" VARCHAR(255) NOT NULL,
    "sku" VARCHAR(100),
    "barcode" VARCHAR(100),
    "description" TEXT,
    "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "selling_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wholesale_price" DECIMAL(12,2),
    "unit_of_measure" VARCHAR(50) NOT NULL DEFAULT 'piece',
    "stock_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimum_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_business_id_idx" ON "products"("business_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_barcode_key" ON "products"("business_id", "barcode");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
