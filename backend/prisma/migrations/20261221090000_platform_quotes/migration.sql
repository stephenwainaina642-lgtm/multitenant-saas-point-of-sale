-- Super-admin quotations (installations, trainings, subscriptions...). Platform-level: not tied to any tenant business.
-- Additive only. No existing table is changed.

CREATE TABLE "platform_quote_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "company_name" VARCHAR(150) NOT NULL DEFAULT '',
    "address" VARCHAR(300) NOT NULL DEFAULT '',
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "email" VARCHAR(255) NOT NULL DEFAULT '',
    "kra_pin" VARCHAR(20) NOT NULL DEFAULT '',
    "payment_details" TEXT NOT NULL DEFAULT '',
    "default_terms" TEXT NOT NULL DEFAULT '',
    "default_validity_days" INTEGER NOT NULL DEFAULT 14,
    "default_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_quote_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_quote_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "platform_quote_settings_validity_range" CHECK ("default_validity_days" BETWEEN 1 AND 365),
    CONSTRAINT "platform_quote_settings_vat_range" CHECK ("default_vat_rate" >= 0 AND "default_vat_rate" <= 50)
);
INSERT INTO "platform_quote_settings"("id") VALUES (1);

CREATE TABLE "platform_quote_counters" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "platform_quote_counters_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "platform_quote_counters_seq_nonneg" CHECK ("last_seq" >= 0)
);

CREATE TABLE "platform_quotes" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_number" VARCHAR(20) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
    "title" VARCHAR(150) NOT NULL DEFAULT '',
    "client_name" VARCHAR(150) NOT NULL,
    "client_business" VARCHAR(150) NOT NULL DEFAULT '',
    "client_email" VARCHAR(255) NOT NULL DEFAULT '',
    "client_phone" VARCHAR(40) NOT NULL DEFAULT '',
    "client_address" VARCHAR(300) NOT NULL DEFAULT '',
    "client_kra_pin" VARCHAR(20) NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "valid_until" DATE NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "terms" TEXT NOT NULL DEFAULT '',
    "payment_details" TEXT NOT NULL DEFAULT '',
    "internal_notes" TEXT NOT NULL DEFAULT '',
    "issuer" JSONB,
    "created_by_admin_id" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_quotes_status_valid" CHECK ("status" IN ('draft','sent','accepted','declined')),
    CONSTRAINT "platform_quotes_client_not_blank" CHECK (btrim("client_name") <> ''),
    CONSTRAINT "platform_quotes_vat_range" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 50),
    CONSTRAINT "platform_quotes_money_nonneg" CHECK ("discount" >= 0 AND "subtotal" >= 0 AND "vat_amount" >= 0 AND "total" >= 0),
    CONSTRAINT "platform_quotes_discount_within_subtotal" CHECK ("discount" <= "subtotal"),
    CONSTRAINT "platform_quotes_issued_has_issuer" CHECK ("status" = 'draft' OR "issuer" IS NOT NULL)
);
CREATE UNIQUE INDEX "platform_quotes_public_id_key" ON "platform_quotes"("public_id");
CREATE UNIQUE INDEX "platform_quotes_quote_number_key" ON "platform_quotes"("quote_number");
CREATE INDEX "platform_quotes_status_created_idx" ON "platform_quotes"("status", "created_at" DESC);
ALTER TABLE "platform_quotes" ADD CONSTRAINT "platform_quotes_admin_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_quote_items" (
    "id" BIGSERIAL NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" VARCHAR(20) NOT NULL DEFAULT 'other',
    "description" VARCHAR(200) NOT NULL,
    "details" VARCHAR(1000) NOT NULL DEFAULT '',
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "platform_quote_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_quote_items_category_valid" CHECK ("category" IN ('installation','training','subscription','hardware','support','other')),
    CONSTRAINT "platform_quote_items_desc_not_blank" CHECK (btrim("description") <> ''),
    CONSTRAINT "platform_quote_items_qty_positive" CHECK ("quantity" > 0),
    CONSTRAINT "platform_quote_items_price_nonneg" CHECK ("unit_price" >= 0 AND "line_total" >= 0)
);
CREATE UNIQUE INDEX "platform_quote_items_position_key" ON "platform_quote_items"("quote_id", "position");
ALTER TABLE "platform_quote_items" ADD CONSTRAINT "platform_quote_items_quote_fkey" FOREIGN KEY ("quote_id") REFERENCES "platform_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The price list the super admin picks from when building a quote. Starts empty: prices are the owner's decision.
CREATE TABLE "platform_quote_services" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(20) NOT NULL DEFAULT 'other',
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "unit" VARCHAR(30) NOT NULL DEFAULT 'each',
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_quote_services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_quote_services_category_valid" CHECK ("category" IN ('installation','training','subscription','hardware','support','other')),
    CONSTRAINT "platform_quote_services_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "platform_quote_services_price_nonneg" CHECK ("unit_price" >= 0)
);
CREATE UNIQUE INDEX "platform_quote_services_public_id_key" ON "platform_quote_services"("public_id");
CREATE UNIQUE INDEX "platform_quote_services_name_key" ON "platform_quote_services"("name");
