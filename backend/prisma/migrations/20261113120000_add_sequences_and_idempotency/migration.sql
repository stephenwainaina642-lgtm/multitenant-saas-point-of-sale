-- Additive only: new table and nullable columns. No existing data is changed.

-- Per-business gap-free-ish document counters (receipt numbers).
CREATE TABLE "document_sequences" (
    "business_id" BIGINT NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("business_id","kind")
);

ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotency keys stop duplicate submissions (double click, retry).
-- Unique indexes ignore NULLs, so existing rows are unaffected.
ALTER TABLE "sales" ADD COLUMN "idempotency_key" VARCHAR(100);
ALTER TABLE "payments" ADD COLUMN "idempotency_key" VARCHAR(100);

CREATE UNIQUE INDEX "sales_business_id_idempotency_key_key" ON "sales"("business_id", "idempotency_key");
CREATE UNIQUE INDEX "payments_business_id_idempotency_key_key" ON "payments"("business_id", "idempotency_key");
