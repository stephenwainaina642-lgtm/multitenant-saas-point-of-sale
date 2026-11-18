-- Additive only. (1) payments get a nullable "received by" column, filled for payments made from now on; old rows stay NULL.
-- (2) A new table for till shifts / end-of-day cash-up. No existing row is changed.
ALTER TABLE "payments" ADD COLUMN "created_by" BIGINT REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX "payments_created_by_payment_date_idx" ON "payments" ("created_by", "payment_date");

CREATE TABLE "register_shifts" (
  "id"               BIGSERIAL PRIMARY KEY,
  "business_id"      BIGINT NOT NULL REFERENCES "businesses"("id"),
  "opened_by"        BIGINT NOT NULL REFERENCES "users"("id"),
  "opened_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "opening_float"    NUMERIC(12,2) NOT NULL,
  "status"           VARCHAR(10) NOT NULL DEFAULT 'open',
  "closed_by"        BIGINT REFERENCES "users"("id"),
  "closed_at"        TIMESTAMPTZ(6),
  "cash_received"    NUMERIC(12,2),   -- cash payments taken during the shift
  "cash_refunded"    NUMERIC(12,2),   -- cash refunds paid out
  "cash_supplier"    NUMERIC(12,2),   -- cash paid to suppliers
  "cash_paid_out"    NUMERIC(12,2),   -- other cash taken from the drawer, declared at close
  "expected_cash"    NUMERIC(12,2),
  "counted_cash"     NUMERIC(12,2),
  "variance"         NUMERIC(12,2),   -- counted minus expected: negative = short, positive = over
  "totals_by_method" JSONB,
  "close_note"       TEXT,
  "manager_note"     TEXT,
  CONSTRAINT "register_shifts_status_valid" CHECK ("status" IN ('open','closed')),
  CONSTRAINT "register_shifts_float_nonneg" CHECK ("opening_float" >= 0),
  CONSTRAINT "register_shifts_closed_complete" CHECK (
    ("status" = 'open' AND "closed_at" IS NULL AND "counted_cash" IS NULL)
    OR ("status" = 'closed' AND "closed_at" IS NOT NULL AND "closed_by" IS NOT NULL AND "expected_cash" IS NOT NULL
        AND "counted_cash" IS NOT NULL AND "counted_cash" >= 0 AND "variance" IS NOT NULL
        AND "variance" = "counted_cash" - "expected_cash")
  )
);
-- One open shift per cashier per business.
CREATE UNIQUE INDEX "register_shifts_one_open_per_user" ON "register_shifts" ("business_id", "opened_by") WHERE "status" = 'open';
CREATE INDEX "register_shifts_business_opened_idx" ON "register_shifts" ("business_id", "opened_at" DESC);

-- A closed shift is a financial record: after closing, only the manager's note may change, and it can never be deleted.
CREATE FUNCTION "register_shifts_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'closed' THEN RAISE EXCEPTION 'A closed shift cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'closed' THEN
    IF (to_jsonb(NEW) - 'manager_note') IS DISTINCT FROM (to_jsonb(OLD) - 'manager_note') THEN
      RAISE EXCEPTION 'A closed shift cannot be changed (only the manager note can be)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "register_shifts_guard_trg" BEFORE UPDATE OR DELETE ON "register_shifts"
  FOR EACH ROW EXECUTE FUNCTION "register_shifts_guard"();
