-- Additive only. Payments made to suppliers against a purchase invoice.
-- Existing purchases and supplier balances are NOT modified by this migration.
CREATE TABLE "supplier_payments" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "purchase_id" BIGINT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" VARCHAR(50) NOT NULL,
    "reference" VARCHAR(255),
    "notes" TEXT,
    "created_by" BIGINT,
    "payment_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_payments_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "supplier_payments_business_id_idx" ON "supplier_payments"("business_id");
CREATE INDEX "supplier_payments_purchase_id_idx" ON "supplier_payments"("purchase_id");

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER supplier_payments_same_business_purchase BEFORE INSERT OR UPDATE OF purchase_id, business_id ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('purchase_id', 'purchases');
