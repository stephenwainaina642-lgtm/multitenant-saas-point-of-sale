-- Additive only. One M-Pesa transaction code can pay for one payment in a business.
-- The index only covers payments created from this date on, so it can never fail on (or
-- reject) old data, even if an older business already has the same code recorded twice.
-- The application also checks all earlier payments before accepting a new one.
CREATE UNIQUE INDEX "payments_mpesa_reference_unique"
  ON "payments" ("business_id", upper("reference"))
  WHERE "method" = 'mpesa'
    AND "reference" IS NOT NULL
    AND "created_at" >= TIMESTAMPTZ '2026-11-17 00:00:00+00';
