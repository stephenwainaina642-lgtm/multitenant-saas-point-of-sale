-- Kenya integrations (M-PESA, Pesapal, eTIMS): per-business provider connections with encrypted credentials.
-- Purely additive: four new tables, no existing table is touched, nothing is backfilled.

CREATE TABLE "integration_connections" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" BIGINT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "environment" VARCHAR(12) NOT NULL DEFAULT 'sandbox',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_test_status" VARCHAR(10),
    "last_test_at" TIMESTAMPTZ(6),
    "last_test_message" VARCHAR(300),
    "last_test_version" INTEGER,
    "settings_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" BIGINT,
    "updated_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_connections_provider_check" CHECK ("provider" IN ('mpesa','pesapal','etims')),
    CONSTRAINT "integration_connections_environment_check" CHECK ("environment" IN ('sandbox','production')),
    CONSTRAINT "integration_connections_test_status_check" CHECK ("last_test_status" IS NULL OR "last_test_status" IN ('ok','failed'))
);
CREATE UNIQUE INDEX "integration_connections_public_id_key" ON "integration_connections"("public_id");
CREATE UNIQUE INDEX "integration_connections_business_id_provider_key" ON "integration_connections"("business_id","provider");
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_secrets" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "hint" VARCHAR(12),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_secrets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_secrets_connection_id_name_key" ON "integration_secrets"("connection_id","name");
CREATE INDEX "integration_secrets_business_id_idx" ON "integration_secrets"("business_id");
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_events" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "idempotency_key" VARCHAR(100),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_events_business_id_connection_id_idempotency_key_key"
  ON "integration_events"("business_id","connection_id","idempotency_key");
CREATE INDEX "integration_events_business_id_connection_id_created_at_idx"
  ON "integration_events"("business_id","connection_id","created_at");
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "connection_id" BIGINT,
    "provider" VARCHAR(20) NOT NULL,
    "user_id" BIGINT,
    "action" VARCHAR(40) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "integration_audit_logs_business_id_created_at_idx" ON "integration_audit_logs"("business_id","created_at");
ALTER TABLE "integration_audit_logs" ADD CONSTRAINT "integration_audit_logs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_audit_logs" ADD CONSTRAINT "integration_audit_logs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A secret, event or connection row must belong to the same business as its connection.
CREATE OR REPLACE FUNCTION nexa_integration_same_business() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = NEW.connection_id AND c.business_id = NEW.business_id) THEN
    RAISE EXCEPTION 'integration row belongs to a different business than its connection';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER integration_secrets_same_business BEFORE INSERT OR UPDATE OF connection_id, business_id ON "integration_secrets"
  FOR EACH ROW EXECUTE FUNCTION nexa_integration_same_business();
CREATE TRIGGER integration_events_same_business BEFORE INSERT OR UPDATE OF connection_id, business_id ON "integration_events"
  FOR EACH ROW EXECUTE FUNCTION nexa_integration_same_business();
