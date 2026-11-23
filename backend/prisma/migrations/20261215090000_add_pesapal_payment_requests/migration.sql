-- Pesapal hosted-checkout payment requests. Purely additive: one new table plus its own triggers.
-- No sale, payment, stock or M-PESA row is touched. ON DELETE RESTRICT on the connection and the sale.

CREATE TABLE "pesapal_payment_requests" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "environment" VARCHAR(12) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "description" VARCHAR(100) NOT NULL,
    "customer_phone" VARCHAR(20),
    "customer_email" VARCHAR(254),
    "merchant_reference" VARCHAR(50) NOT NULL,
    "order_tracking_id" VARCHAR(80),
    "redirect_url" VARCHAR(1000),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "result_desc" VARCHAR(200),
    "confirmation_code" VARCHAR(60),
    "pay_method" VARCHAR(60),
    "paid_amount_cents" BIGINT,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_by_user_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_checked_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "reversal_noticed_at" TIMESTAMPTZ(6),
    "sale_id" BIGINT,
    "dismissed_at" TIMESTAMPTZ(6),
    "dismissed_by_user_id" BIGINT,
    "dismissed_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pesapal_payment_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pesapal_payment_requests_status_check" CHECK ("status" IN ('pending','paid','failed','reversed','expired','unconfirmed')),
    CONSTRAINT "pesapal_payment_requests_amount_positive" CHECK ("amount_cents" > 0),
    CONSTRAINT "pesapal_payment_requests_paid_complete" CHECK ("status" <> 'paid' OR ("paid_amount_cents" IS NOT NULL AND "paid_at" IS NOT NULL)),
    CONSTRAINT "pesapal_payment_requests_contact_present" CHECK ("customer_phone" IS NOT NULL OR "customer_email" IS NOT NULL),
    CONSTRAINT "pesapal_payment_requests_dismissal_complete" CHECK (
      ("dismissed_at" IS NULL AND "dismissed_by_user_id" IS NULL AND "dismissed_note" IS NULL)
      OR ("dismissed_at" IS NOT NULL AND "dismissed_note" IS NOT NULL))
);
CREATE UNIQUE INDEX "pesapal_payment_requests_public_id_key" ON "pesapal_payment_requests"("public_id");
CREATE UNIQUE INDEX "pesapal_payment_requests_merchant_reference_key" ON "pesapal_payment_requests"("merchant_reference");
CREATE UNIQUE INDEX "pesapal_payment_requests_order_tracking_id_key" ON "pesapal_payment_requests"("order_tracking_id");
CREATE UNIQUE INDEX "pesapal_payment_requests_sale_id_key" ON "pesapal_payment_requests"("sale_id");
CREATE UNIQUE INDEX "pesapal_payment_requests_business_id_idempotency_key_key" ON "pesapal_payment_requests"("business_id","idempotency_key");
-- One Pesapal confirmation code can only ever settle one request in a business.
CREATE UNIQUE INDEX "pesapal_payment_requests_code_per_business" ON "pesapal_payment_requests"("business_id","confirmation_code") WHERE "confirmation_code" IS NOT NULL;
CREATE INDEX "pesapal_payment_requests_business_id_created_at_idx" ON "pesapal_payment_requests"("business_id","created_at");
ALTER TABLE "pesapal_payment_requests" ADD CONSTRAINT "pesapal_payment_requests_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pesapal_payment_requests" ADD CONSTRAINT "pesapal_payment_requests_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pesapal_payment_requests" ADD CONSTRAINT "pesapal_payment_requests_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pesapal_payment_requests" ADD CONSTRAINT "pesapal_payment_requests_dismissed_by_fkey"
  FOREIGN KEY ("dismissed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER pesapal_payment_requests_same_business BEFORE INSERT OR UPDATE OF connection_id, business_id ON "pesapal_payment_requests"
  FOR EACH ROW EXECUTE FUNCTION nexa_integration_same_business();

-- Only a PAID request can be linked, and only to a sale of the same business.
CREATE OR REPLACE FUNCTION nexa_pesapal_request_sale_link() RETURNS trigger AS $$
BEGIN
  IF NEW.sale_id IS NOT NULL THEN
    IF NEW.status <> 'paid' THEN
      RAISE EXCEPTION 'only a paid Pesapal request can be linked to a sale';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = NEW.sale_id AND s.business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'Pesapal request and sale belong to different businesses';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER pesapal_payment_requests_sale_link BEFORE INSERT OR UPDATE OF sale_id, status ON "pesapal_payment_requests"
  FOR EACH ROW EXECUTE FUNCTION nexa_pesapal_request_sale_link();
