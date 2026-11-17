-- Additive only: two new tables for the platform super admin. No existing table or row is changed.
-- platform_admins are deliberately separate from users: a business owner can never become one.
CREATE TABLE "platform_admins" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "name"                VARCHAR(255) NOT NULL,
  "email"               VARCHAR(255) NOT NULL,
  "password_hash"       TEXT NOT NULL,
  "totp_secret_enc"     TEXT NOT NULL,          -- authenticator-app secret, AES-256-GCM encrypted
  "totp_last_step"      BIGINT NOT NULL DEFAULT 0, -- last accepted 30-second step: a code works once
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "sessions_valid_after" TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins" (lower("email"));

CREATE TABLE "platform_audit_logs" (
  "id"          BIGSERIAL PRIMARY KEY,
  "admin_id"    BIGINT NOT NULL REFERENCES "platform_admins"("id"),
  "action"      VARCHAR(100) NOT NULL,
  "business_id" BIGINT,   -- no foreign key on purpose: the record must outlive a deleted business
  "user_id"     BIGINT,
  "reason"      TEXT NOT NULL,
  "details"     JSONB,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "platform_audit_reason_not_blank" CHECK (length(btrim("reason")) >= 3)
);
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs" ("created_at" DESC);
CREATE INDEX "platform_audit_logs_business_idx" ON "platform_audit_logs" ("business_id");
