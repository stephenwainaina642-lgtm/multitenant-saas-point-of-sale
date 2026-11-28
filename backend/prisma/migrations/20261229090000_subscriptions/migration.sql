-- Additive: plans, per-business subscriptions, manual platform payments and subscription history.
-- Nothing existing is changed. A business without a subscription row keeps working exactly as before ("legacy").
-- Payments and history deliberately have NO foreign key to businesses, so erasing a business never erases the
-- platform's own financial record.

CREATE SEQUENCE "platform_receipt_seq";

CREATE TABLE "platform_plans" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'KES',
    "monthly_price" DECIMAL(12,2),
    "annual_price" DECIMAL(12,2),
    "one_time_price" DECIMAL(12,2),
    "installation_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "training_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "grace_days" INTEGER,
    "max_branches" INTEGER,
    "max_employees" INTEGER,
    "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_plans_prices_valid" CHECK (
      coalesce("monthly_price",0) >= 0 AND coalesce("annual_price",0) >= 0 AND coalesce("one_time_price",0) >= 0
      AND "installation_fee" >= 0 AND "training_fee" >= 0 AND "discount_percent" BETWEEN 0 AND 100),
    CONSTRAINT "platform_plans_terms_valid" CHECK (
      "trial_days" BETWEEN 0 AND 365 AND ("grace_days" IS NULL OR "grace_days" BETWEEN 0 AND 90)
      AND ("max_branches" IS NULL OR "max_branches" >= 1) AND ("max_employees" IS NULL OR "max_employees" >= 1))
);
CREATE UNIQUE INDEX "platform_plans_public_id_key" ON "platform_plans"("public_id");
CREATE UNIQUE INDEX "platform_plans_code_key" ON "platform_plans"("code");

CREATE TABLE "platform_subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "plan_id" BIGINT,
    "plan_name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "billing_cycle" VARCHAR(10) NOT NULL,
    "agreed_price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'KES',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "max_branches" INTEGER,
    "max_employees" INTEGER,
    "cancelled_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_subscriptions_status_valid" CHECK ("status" IN ('trial','pending_payment','active','past_due','grace','suspended','cancelled','expired')),
    CONSTRAINT "platform_subscriptions_cycle_valid" CHECK ("billing_cycle" IN ('monthly','annual','one_time')),
    CONSTRAINT "platform_subscriptions_terms_valid" CHECK ("agreed_price" >= 0 AND "grace_days" BETWEEN 0 AND 90
      AND ("max_branches" IS NULL OR "max_branches" >= 1) AND ("max_employees" IS NULL OR "max_employees" >= 1))
);
CREATE UNIQUE INDEX "platform_subscriptions_public_id_key" ON "platform_subscriptions"("public_id");
CREATE UNIQUE INDEX "platform_subscriptions_business_id_key" ON "platform_subscriptions"("business_id");
CREATE INDEX "platform_subscriptions_status_idx" ON "platform_subscriptions"("status");
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_payments" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "business_name" VARCHAR(255) NOT NULL,
    "plan_name" VARCHAR(120),
    "amount" DECIMAL(12,2) NOT NULL,
    "expected_amount" DECIMAL(12,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'KES',
    "method" VARCHAR(20) NOT NULL,
    "reference" VARCHAR(120),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "billing_cycle" VARCHAR(10),
    "periods" INTEGER NOT NULL DEFAULT 1,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "period_from" TIMESTAMPTZ(6),
    "period_to" TIMESTAMPTZ(6),
    "receipt_no" VARCHAR(30),
    "note" TEXT,
    "recorded_by" BIGINT,
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_payments_amount_valid" CHECK ("amount" > 0 AND "periods" BETWEEN 1 AND 60),
    CONSTRAINT "platform_payments_method_valid" CHECK ("method" IN ('cash','bank','mpesa','card','other')),
    CONSTRAINT "platform_payments_status_valid" CHECK ("status" IN ('pending','approved','rejected','refunded'))
);
CREATE UNIQUE INDEX "platform_payments_public_id_key" ON "platform_payments"("public_id");
CREATE UNIQUE INDEX "platform_payments_receipt_no_key" ON "platform_payments"("receipt_no");
-- The same bank / M-Pesa reference cannot be counted twice (a rejected record frees it).
CREATE UNIQUE INDEX "platform_payments_method_reference_key" ON "platform_payments"("method", "reference") WHERE "reference" IS NOT NULL AND "status" <> 'rejected';
CREATE INDEX "platform_payments_business_idx" ON "platform_payments"("business_id", "created_at" DESC);
CREATE INDEX "platform_payments_status_idx" ON "platform_payments"("status");

CREATE TABLE "platform_subscription_events" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20),
    "details" JSONB,
    "admin_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_subscription_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_subscription_events_business_idx" ON "platform_subscription_events"("business_id", "created_at" DESC);
