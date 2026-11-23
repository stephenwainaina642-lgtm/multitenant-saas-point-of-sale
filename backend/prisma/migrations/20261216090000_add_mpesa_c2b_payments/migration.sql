-- Incoming M-PESA payments reported by Safaricom's C2B confirmation notifications (a live statement).
-- Purely additive: one new table. Nothing existing is changed. These rows are RECORDS OF NOTIFICATIONS: they are
-- never linked to sales and never create or change any sale, payment or STK request.

CREATE TABLE "mpesa_c2b_payments" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "environment" VARCHAR(12) NOT NULL,
    "trans_id" VARCHAR(10) NOT NULL,
    "trans_type" VARCHAR(40),
    "trans_time" TIMESTAMPTZ(6) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "short_code" VARCHAR(20) NOT NULL,
    "bill_ref" VARCHAR(60),
    "invoice_number" VARCHAR(60),
    "msisdn" VARCHAR(30),
    "first_name" VARCHAR(60),
    "middle_name" VARCHAR(60),
    "last_name" VARCHAR(60),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mpesa_c2b_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mpesa_c2b_payments_amount_positive" CHECK ("amount_cents" > 0),
    CONSTRAINT "mpesa_c2b_payments_trans_id_format" CHECK ("trans_id" ~ '^[A-Z0-9]{10}$')
);
CREATE UNIQUE INDEX "mpesa_c2b_payments_public_id_key" ON "mpesa_c2b_payments"("public_id");
-- A Safaricom receipt is recorded once per business, however many times Safaricom retries the notification.
CREATE UNIQUE INDEX "mpesa_c2b_payments_business_id_trans_id_key" ON "mpesa_c2b_payments"("business_id","trans_id");
CREATE INDEX "mpesa_c2b_payments_business_id_trans_time_idx" ON "mpesa_c2b_payments"("business_id","trans_time" DESC);
ALTER TABLE "mpesa_c2b_payments" ADD CONSTRAINT "mpesa_c2b_payments_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mpesa_c2b_payments" ADD CONSTRAINT "mpesa_c2b_payments_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER mpesa_c2b_payments_same_business BEFORE INSERT OR UPDATE OF connection_id, business_id ON "mpesa_c2b_payments"
  FOR EACH ROW EXECUTE FUNCTION nexa_integration_same_business();
