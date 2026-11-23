-- Additive: lets an owner close an M-PESA request that needs attention, with a written reason. Existing rows get NULL.
ALTER TABLE "mpesa_payment_requests" ADD COLUMN "dismissed_at" TIMESTAMPTZ(6);
ALTER TABLE "mpesa_payment_requests" ADD COLUMN "dismissed_by_user_id" BIGINT;
ALTER TABLE "mpesa_payment_requests" ADD COLUMN "dismissed_note" VARCHAR(300);
ALTER TABLE "mpesa_payment_requests" ADD CONSTRAINT "mpesa_payment_requests_dismissed_by_fkey"
  FOREIGN KEY ("dismissed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Dismissal always carries a time and a real reason, or neither.
ALTER TABLE "mpesa_payment_requests" ADD CONSTRAINT "mpesa_payment_requests_dismissal_complete" CHECK (
  ("dismissed_at" IS NULL AND "dismissed_note" IS NULL)
  OR ("dismissed_at" IS NOT NULL AND "dismissed_note" IS NOT NULL AND char_length(btrim("dismissed_note")) >= 5)
);
