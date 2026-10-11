-- Baseline for the existing businesses table
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "businesses" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "business_type" VARCHAR(100) NOT NULL DEFAULT 'retail',
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address" TEXT,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'KES',
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Nairobi',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);