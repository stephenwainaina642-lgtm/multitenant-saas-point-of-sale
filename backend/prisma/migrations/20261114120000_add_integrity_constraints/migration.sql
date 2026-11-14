-- Integrity safety nets. ADDITIVE and NON-DESTRUCTIVE:
--  * CHECK constraints are added NOT VALID: they are enforced for every new
--    INSERT/UPDATE but existing rows are NOT scanned or rejected. After
--    reviewing existing data (see docs below) run VALIDATE CONSTRAINT per table.
--  * Tenant guards are triggers (not foreign keys), so the Prisma models and
--    generated client are unchanged and the migration can never fail on old data.
--  * The roles uniqueness index is only created when no duplicates exist.
-- Nothing here updates, deletes or rewrites any existing row.

-- ---------------------------------------------------------------- CHECKs --
ALTER TABLE "products" ADD CONSTRAINT "products_stock_quantity_nonneg" CHECK ("stock_quantity" >= 0) NOT VALID;
ALTER TABLE "products" ADD CONSTRAINT "products_prices_nonneg" CHECK ("cost_price" >= 0 AND "selling_price" >= 0 AND ("wholesale_price" IS NULL OR "wholesale_price" >= 0) AND "minimum_stock" >= 0) NOT VALID;
ALTER TABLE "customers" ADD CONSTRAINT "customers_balance_nonneg" CHECK ("balance" >= 0 AND "credit_limit" >= 0) NOT VALID;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_balance_nonneg" CHECK ("balance" >= 0) NOT VALID;

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_nonneg" CHECK ("amount" >= 0) NOT VALID;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK ("type" IN ('IN','OUT','ADJUSTMENT')) NOT VALID;

ALTER TABLE "sales" ADD CONSTRAINT "sales_amounts_consistent" CHECK (
  "total" >= 0 AND "amount_paid" >= 0 AND "amount_paid" <= "total"
  AND "balance_due" = "total" - "amount_paid") NOT VALID;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_consistent" CHECK (
  "total" >= 0 AND "amount_paid" >= 0 AND "amount_paid" <= "total"
  AND "balance_due" = "total" - "amount_paid") NOT VALID;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_consistent" CHECK (
  "total" >= 0 AND "amount_paid" >= 0 AND "balance_due" >= 0) NOT VALID;

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_values_valid" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0) NOT VALID;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_values_valid" CHECK ("quantity" > 0 AND "unit_cost" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0) NOT VALID;

-- ------------------------------------------------------ tenant-safe links --
-- A row may only reference parents that belong to the SAME business.
CREATE FUNCTION nexa_enforce_same_business() RETURNS trigger AS $$
DECLARE
  fk_column text := TG_ARGV[0];
  parent_table text := TG_ARGV[1];
  child_fk bigint;
  parent_business bigint;
BEGIN
  EXECUTE format('SELECT ($1).%I', fk_column) INTO child_fk USING NEW;
  IF child_fk IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT business_id FROM %I WHERE id = $1', parent_table)
    INTO parent_business USING child_fk;
  -- Roles may be global (NULL business_id); every other parent must match.
  IF parent_business IS NOT NULL AND parent_business <> NEW.business_id THEN
    RAISE EXCEPTION 'Cross-business reference: %.% points at a % of another business',
      TG_TABLE_NAME, fk_column, parent_table USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Child tables that carry their own business_id.
CREATE TRIGGER sales_same_business_customer BEFORE INSERT OR UPDATE OF customer_id, business_id ON "sales"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('customer_id', 'customers');
CREATE TRIGGER payments_same_business_sale BEFORE INSERT OR UPDATE OF sale_id, business_id ON "payments"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('sale_id', 'sales');
CREATE TRIGGER purchases_same_business_supplier BEFORE INSERT OR UPDATE OF supplier_id, business_id ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('supplier_id', 'suppliers');
CREATE TRIGGER inventory_movements_same_business_product BEFORE INSERT OR UPDATE OF product_id, business_id ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('product_id', 'products');
CREATE TRIGGER invoices_same_business_customer BEFORE INSERT OR UPDATE OF customer_id, business_id ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('customer_id', 'customers');
CREATE TRIGGER invoices_same_business_sale BEFORE INSERT OR UPDATE OF sale_id, business_id ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('sale_id', 'sales');
CREATE TRIGGER quotations_same_business_customer BEFORE INSERT OR UPDATE OF customer_id, business_id ON "quotations"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('customer_id', 'customers');
CREATE TRIGGER products_same_business_category BEFORE INSERT OR UPDATE OF category_id, business_id ON "products"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('category_id', 'categories');
CREATE TRIGGER business_users_same_business_role BEFORE INSERT OR UPDATE OF role_id, business_id ON "business_users"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('role_id', 'roles');

-- Item tables have no business_id: compare the item's product with its parent document.
CREATE FUNCTION nexa_enforce_item_business() RETURNS trigger AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  parent_fk text := TG_ARGV[1];
  doc_business bigint;
  product_business bigint;
  doc_id bigint;
BEGIN
  EXECUTE format('SELECT ($1).%I', parent_fk) INTO doc_id USING NEW;
  EXECUTE format('SELECT business_id FROM %I WHERE id = $1', parent_table) INTO doc_business USING doc_id;
  SELECT business_id INTO product_business FROM products WHERE id = NEW.product_id;
  IF doc_business IS NOT NULL AND product_business IS NOT NULL AND doc_business <> product_business THEN
    RAISE EXCEPTION 'Cross-business reference: % row uses a product of another business', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sale_items_same_business BEFORE INSERT OR UPDATE OF product_id, sale_id ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_item_business('sales', 'sale_id');
CREATE TRIGGER purchase_items_same_business BEFORE INSERT OR UPDATE OF product_id, purchase_id ON "purchase_items"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_item_business('purchases', 'purchase_id');
CREATE TRIGGER invoice_items_same_business BEFORE INSERT OR UPDATE OF product_id, invoice_id ON "invoice_items"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_item_business('invoices', 'invoice_id');
CREATE TRIGGER quotation_items_same_business BEFORE INSERT OR UPDATE OF product_id, quotation_id ON "quotation_items"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_item_business('quotations', 'quotation_id');

-- --------------------------------------------------- global role uniqueness --
-- (business_id, name) is unique only when business_id is NOT NULL. Make global
-- role names unique too, but only if existing data allows it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "roles" WHERE "business_id" IS NULL GROUP BY lower("name") HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Skipped roles_global_name_unique: duplicate global role names already exist. Clean them up, then create the index manually.';
  ELSE
    CREATE UNIQUE INDEX "roles_global_name_unique" ON "roles" (lower("name")) WHERE "business_id" IS NULL;
  END IF;
END $$;
