-- M-PESA STK Push requests. Purely additive: one new table. No sale, payment or stock row is touched.
-- ON DELETE RESTRICT on the connection: a connection with payment history cannot be deleted by accident.

CREATE TABLE "mpesa_payment_requests" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "environment" VARCHAR(12) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "phone" VARCHAR(12) NOT NULL,
    "account_reference" VARCHAR(12) NOT NULL,
    "description" VARCHAR(60) NOT NULL,
    "merchant_request_id" VARCHAR(60),
    "checkout_request_id" VARCHAR(80),
    "callback_token_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "result_code" INTEGER,
    "result_desc" VARCHAR(200),
    "mpesa_receipt" VARCHAR(20),
    "paid_amount_cents" BIGINT,
    "callback_claim" JSONB,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_by_user_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_checked_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mpesa_payment_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mpesa_payment_requests_status_check" CHECK ("status" IN ('pending','paid','failed','cancelled','expired','unconfirmed')),
    CONSTRAINT "mpesa_payment_requests_amount_positive" CHECK ("amount_cents" > 0),
    CONSTRAINT "mpesa_payment_requests_paid_complete" CHECK ("status" <> 'paid' OR ("paid_amount_cents" IS NOT NULL AND "paid_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "mpesa_payment_requests_public_id_key" ON "mpesa_payment_requests"("public_id");
CREATE UNIQUE INDEX "mpesa_payment_requests_checkout_request_id_key" ON "mpesa_payment_requests"("checkout_request_id");
CREATE UNIQUE INDEX "mpesa_payment_requests_callback_token_hash_key" ON "mpesa_payment_requests"("callback_token_hash");
CREATE UNIQUE INDEX "mpesa_payment_requests_business_id_idempotency_key_key" ON "mpesa_payment_requests"("business_id","idempotency_key");
-- One M-PESA receipt can only ever pay one request in a business (not expressible in Prisma, so SQL only).
CREATE UNIQUE INDEX "mpesa_payment_requests_receipt_per_business" ON "mpesa_payment_requests"("business_id","mpesa_receipt") WHERE "mpesa_receipt" IS NOT NULL;
CREATE INDEX "mpesa_payment_requests_business_id_created_at_idx" ON "mpesa_payment_requests"("business_id","created_at");
ALTER TABLE "mpesa_payment_requests" ADD CONSTRAINT "mpesa_payment_requests_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mpesa_payment_requests" ADD CONSTRAINT "mpesa_payment_requests_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER mpesa_payment_requests_same_business BEFORE INSERT OR UPDATE OF connection_id, business_id ON "mpesa_payment_requests"
  FOR EACH ROW EXECUTE FUNCTION nexa_integration_same_business();
