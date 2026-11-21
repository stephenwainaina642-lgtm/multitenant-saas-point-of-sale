-- Invite-only sign-up and business approval. Additive: a new column (every existing business becomes
-- 'approved') and a new table. Only hashes of the link token and PIN are stored, never the values.
ALTER TABLE "businesses" ADD COLUMN "approval_status" VARCHAR(10) NOT NULL DEFAULT 'approved';
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_approval_status_valid"
  CHECK ("approval_status" IN ('approved', 'pending', 'rejected')) NOT VALID;

CREATE TABLE "business_invites" (
  "id" BIGSERIAL PRIMARY KEY,
  "token_hash" VARCHAR(64) NOT NULL,
  "pin_hash" VARCHAR(64) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "business_name" VARCHAR(255),
  "note" VARCHAR(500),
  "auto_approve" BOOLEAN NOT NULL DEFAULT true,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "created_by" BIGINT NOT NULL REFERENCES "platform_admins"("id"),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "used_business_id" BIGINT REFERENCES "businesses"("id"),
  "revoked_at" TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "business_invites_token_hash_key" ON "business_invites"("token_hash");
CREATE INDEX "business_invites_email_idx" ON "business_invites"("email");
