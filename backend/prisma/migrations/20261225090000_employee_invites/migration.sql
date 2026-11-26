-- Employee sign-in links: single-use, expiring, email-locked, with a PIN handed over separately.
-- Only hashes of the link token and PIN are stored. Additive: no existing table is changed.
CREATE TABLE "employee_invites" (
  "id"              BIGSERIAL PRIMARY KEY,
  "business_id"     BIGINT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "role_id"         BIGINT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "token_hash"      VARCHAR(64) NOT NULL,
  "pin_hash"        VARCHAR(64) NOT NULL,
  "email"           VARCHAR(255) NOT NULL,
  "name"            VARCHAR(255) NOT NULL,
  "phone"           VARCHAR(40),
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "created_by"      BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at"      TIMESTAMPTZ NOT NULL,
  "used_at"         TIMESTAMPTZ,
  "used_user_id"    BIGINT,
  "revoked_at"      TIMESTAMPTZ,
  CONSTRAINT "employee_invites_failed_attempts_nonneg" CHECK ("failed_attempts" >= 0)
);
CREATE UNIQUE INDEX "employee_invites_token_hash_key" ON "employee_invites"("token_hash");
CREATE INDEX "employee_invites_business_id_idx" ON "employee_invites"("business_id", "created_at" DESC);
CREATE INDEX "employee_invites_email_idx" ON "employee_invites"("email");
