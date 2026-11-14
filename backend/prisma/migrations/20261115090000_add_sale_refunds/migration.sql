-- Additive only. Refunds are stored separately so payment history is never edited.
CREATE TABLE "refunds" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" VARCHAR(50) NOT NULL,
    "reference" VARCHAR(255),
    "reason" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "refunds_business_id_idx" ON "refunds"("business_id");
CREATE INDEX "refunds_sale_id_idx" ON "refunds"("sale_id");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same tenant guard as the other business-owned links.
CREATE TRIGGER refunds_same_business_sale BEFORE INSERT OR UPDATE OF sale_id, business_id ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('sale_id', 'sales');
