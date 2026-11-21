-- Configurable VAT rates. Additive only: a new table and two optional columns. No existing row is changed.
CREATE TABLE "tax_rates" (
  "id" BIGSERIAL PRIMARY KEY,
  "business_id" BIGINT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "rate" DECIMAL(5,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "tax_rates_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
  CONSTRAINT "tax_rates_code_not_builtin" CHECK ("code" NOT IN ('standard', 'zero_rated', 'exempt'))
);
CREATE UNIQUE INDEX "tax_rates_business_id_code_key" ON "tax_rates"("business_id", "code");

ALTER TABLE "sale_items" ADD COLUMN "tax_class" VARCHAR(20);
ALTER TABLE "sale_items" ADD COLUMN "tax_rate" DECIMAL(5,2);

-- Products may now use a business's own rate, so the fixed three-value check is replaced by a rule
-- that is just as strict: the class must be a built-in one or a rate defined by the same business.
ALTER TABLE "products" DROP CONSTRAINT "products_tax_class_valid";

CREATE OR REPLACE FUNCTION nexa_check_product_tax_class() RETURNS trigger AS $$
BEGIN
  IF NEW.tax_class IN ('standard', 'zero_rated', 'exempt') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_rates r WHERE r.business_id = NEW.business_id AND r.code = NEW.tax_class) THEN
    RAISE EXCEPTION 'products_tax_class_valid: unknown tax class % for this business', NEW.tax_class USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_tax_class_valid
  BEFORE INSERT OR UPDATE OF tax_class, business_id ON "products"
  FOR EACH ROW EXECUTE FUNCTION nexa_check_product_tax_class();

CREATE OR REPLACE FUNCTION nexa_block_used_tax_rate_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products p WHERE p.business_id = OLD.business_id AND p.tax_class = OLD.code) THEN
    RAISE EXCEPTION 'Tax rate % is still used by products', OLD.code USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tax_rates_in_use_guard
  BEFORE DELETE ON "tax_rates"
  FOR EACH ROW EXECUTE FUNCTION nexa_block_used_tax_rate_delete();
