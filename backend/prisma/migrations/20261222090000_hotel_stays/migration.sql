-- Hotel slice 4: guest stays and charge-to-room. Additive only; no existing table or row is changed.
--  * hotel_stays: one row per guest stay (room, guest = an ordinary customer, check-in/out, optional deposit and a
--    per-stay credit limit). The guest's charges live on the existing customer credit ledger (customers.balance and
--    sales.balance_due), so there is no second ledger to reconcile.
--  * hotel_stay_sales: links a stay to the sales charged to its room (one sale belongs to at most one stay).
--  * Only one in-house stay per room per business.

CREATE TABLE "hotel_stays" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "room_name" VARCHAR(40) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'in_house',
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(300),
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deposit_method" VARCHAR(30),
    "deposit_reference" VARCHAR(100),
    "deposit_applied" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deposit_refunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refund_method" VARCHAR(30),
    "refund_reference" VARCHAR(100),
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_out_at" TIMESTAMPTZ(6),
    "created_by" BIGINT NOT NULL,
    "checked_out_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hotel_stays_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hotel_stays_room_not_blank" CHECK (btrim("room_name") <> ''),
    CONSTRAINT "hotel_stays_status_valid" CHECK ("status" IN ('in_house','checked_out')),
    CONSTRAINT "hotel_stays_credit_limit_nonneg" CHECK ("credit_limit" >= 0),
    CONSTRAINT "hotel_stays_deposit_nonneg" CHECK ("deposit_amount" >= 0 AND "deposit_applied" >= 0 AND "deposit_refunded" >= 0),
    CONSTRAINT "hotel_stays_deposit_within" CHECK ("deposit_applied" + "deposit_refunded" <= "deposit_amount"),
    CONSTRAINT "hotel_stays_checkout_consistent" CHECK (("status" = 'checked_out') = ("checked_out_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "hotel_stays_public_id_key" ON "hotel_stays"("public_id");
CREATE INDEX "hotel_stays_business_status_idx" ON "hotel_stays"("business_id","status");
CREATE INDEX "hotel_stays_customer_idx" ON "hotel_stays"("customer_id");
CREATE UNIQUE INDEX "hotel_stays_one_in_house_per_room" ON "hotel_stays"("business_id", lower("room_name")) WHERE "status" = 'in_house';
ALTER TABLE "hotel_stays" ADD CONSTRAINT "hotel_stays_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stays" ADD CONSTRAINT "hotel_stays_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stays" ADD CONSTRAINT "hotel_stays_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stays" ADD CONSTRAINT "hotel_stays_checked_out_by_fkey" FOREIGN KEY ("checked_out_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hotel_stay_sales" (
    "stay_id" BIGINT NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hotel_stay_sales_pkey" PRIMARY KEY ("stay_id","sale_id")
);
CREATE UNIQUE INDEX "hotel_stay_sales_sale_id_key" ON "hotel_stay_sales"("sale_id");
ALTER TABLE "hotel_stay_sales" ADD CONSTRAINT "hotel_stay_sales_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "hotel_stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stay_sales" ADD CONSTRAINT "hotel_stay_sales_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
