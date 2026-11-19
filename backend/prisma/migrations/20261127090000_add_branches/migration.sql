-- Branches with per-branch stock (docs/design-branches.md, option B). Additive only:
-- nothing is dropped, renamed or re-priced. Every business gets one "Main" branch, every existing
-- sale/purchase/expense/shift/stock movement is tagged to it, and each product's existing
-- stock_quantity becomes the Main branch's quantity. products.stock_quantity stays as the
-- business-wide TOTAL, kept equal to the sum of branch_stock by the triggers below.

-- ----------------------------------------------------------------- branches --
CREATE TABLE "branches" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(50),
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_business_id_name_key" ON "branches"("business_id", "name");
CREATE INDEX "branches_business_id_idx" ON "branches"("business_id");
-- Exactly one main branch per business (not expressible in Prisma; same note as register_shifts).
CREATE UNIQUE INDEX "branches_one_main_per_business" ON "branches"("business_id") WHERE "is_main";
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "branches" ADD CONSTRAINT "branches_main_is_active" CHECK (NOT "is_main" OR "is_active");

-- Existing businesses get their Main branch.
INSERT INTO "branches" ("business_id", "name", "is_main") SELECT "id", 'Main', true FROM "businesses";

-- New businesses get one automatically, whichever code path creates them.
CREATE FUNCTION nexa_create_main_branch() RETURNS trigger AS $$
BEGIN
  INSERT INTO branches (business_id, name, is_main) VALUES (NEW.id, 'Main', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER businesses_create_main_branch AFTER INSERT ON "businesses"
  FOR EACH ROW EXECUTE FUNCTION nexa_create_main_branch();

-- ------------------------------------------------- tag existing records --
-- Rows without an explicit branch land in the business's Main branch.
CREATE FUNCTION nexa_default_branch() RETURNS trigger AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT id INTO NEW.branch_id FROM branches WHERE business_id = NEW.business_id AND is_main;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "sales"               ADD COLUMN "branch_id" BIGINT;
ALTER TABLE "purchases"           ADD COLUMN "branch_id" BIGINT;
ALTER TABLE "expenses"            ADD COLUMN "branch_id" BIGINT;
ALTER TABLE "register_shifts"     ADD COLUMN "branch_id" BIGINT;
ALTER TABLE "inventory_movements" ADD COLUMN "branch_id" BIGINT;

UPDATE "sales"               t SET "branch_id" = b.id FROM branches b WHERE b.business_id = t.business_id AND b.is_main;
UPDATE "purchases"           t SET "branch_id" = b.id FROM branches b WHERE b.business_id = t.business_id AND b.is_main;
UPDATE "expenses"            t SET "branch_id" = b.id FROM branches b WHERE b.business_id = t.business_id AND b.is_main;
-- Closed shifts are protected by a guard trigger; switch it off only for this one backfill.
ALTER TABLE "register_shifts" DISABLE TRIGGER "register_shifts_guard_trg";
UPDATE "register_shifts"     t SET "branch_id" = b.id FROM branches b WHERE b.business_id = t.business_id AND b.is_main;
ALTER TABLE "register_shifts" ENABLE TRIGGER "register_shifts_guard_trg";
UPDATE "inventory_movements" t SET "branch_id" = b.id FROM branches b WHERE b.business_id = t.business_id AND b.is_main;

ALTER TABLE "sales"               ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "purchases"           ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "expenses"            ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "register_shifts"     ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "inventory_movements" ALTER COLUMN "branch_id" SET NOT NULL;

ALTER TABLE "sales"               ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases"           ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses"            ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "register_shifts"     ADD CONSTRAINT "register_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "sales_business_id_branch_id_sale_date_idx" ON "sales"("business_id", "branch_id", "sale_date");
CREATE INDEX "purchases_branch_id_idx" ON "purchases"("branch_id");
CREATE INDEX "expenses_branch_id_idx" ON "expenses"("branch_id");
CREATE INDEX "register_shifts_branch_id_idx" ON "register_shifts"("branch_id");
CREATE INDEX "inventory_movements_branch_id_idx" ON "inventory_movements"("branch_id");

-- Default to Main when a writer omits the branch; and a branch must belong to the same business.
CREATE TRIGGER sales_default_branch BEFORE INSERT ON "sales" FOR EACH ROW EXECUTE FUNCTION nexa_default_branch();
CREATE TRIGGER purchases_default_branch BEFORE INSERT ON "purchases" FOR EACH ROW EXECUTE FUNCTION nexa_default_branch();
CREATE TRIGGER expenses_default_branch BEFORE INSERT ON "expenses" FOR EACH ROW EXECUTE FUNCTION nexa_default_branch();
CREATE TRIGGER register_shifts_default_branch BEFORE INSERT ON "register_shifts" FOR EACH ROW EXECUTE FUNCTION nexa_default_branch();
CREATE TRIGGER inventory_movements_default_branch BEFORE INSERT ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION nexa_default_branch();

CREATE TRIGGER sales_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "sales"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');
CREATE TRIGGER purchases_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');
CREATE TRIGGER expenses_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');
CREATE TRIGGER register_shifts_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "register_shifts"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');
CREATE TRIGGER inventory_movements_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');

-- Staff can be assigned to one branch (NULL = may work in any branch they are allowed to see).
ALTER TABLE "business_users" ADD COLUMN "branch_id" BIGINT;
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER business_users_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "business_users"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');

-- --------------------------------------------------------------- branch stock --
CREATE TABLE "branch_stock" (
    "branch_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branch_stock_pkey" PRIMARY KEY ("branch_id", "product_id")
);
CREATE INDEX "branch_stock_product_id_idx" ON "branch_stock"("product_id");
CREATE INDEX "branch_stock_business_id_idx" ON "branch_stock"("business_id");
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_quantity_nonneg" CHECK ("quantity" >= 0);
CREATE TRIGGER branch_stock_same_business_branch BEFORE INSERT OR UPDATE OF branch_id, business_id ON "branch_stock"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('branch_id', 'branches');
CREATE TRIGGER branch_stock_same_business_product BEFORE INSERT OR UPDATE OF product_id, business_id ON "branch_stock"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('product_id', 'products');

-- Legacy rows with NEGATIVE stock cannot be copied (a branch cannot hold less than nothing). They are
-- left exactly as they are; the first stock movement on such a product sets its total to the real sum.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM products WHERE stock_quantity < 0;
  IF n > 0 THEN RAISE NOTICE '% product(s) have negative legacy stock and were not copied into branch_stock', n; END IF;
END $$;

-- Today's stock becomes the Main branch's stock (copied; products.stock_quantity is untouched).
INSERT INTO "branch_stock" ("branch_id", "product_id", "business_id", "quantity")
SELECT b.id, p.id, p.business_id, p.stock_quantity
  FROM products p JOIN branches b ON b.business_id = p.business_id AND b.is_main
 WHERE p.stock_quantity > 0;

-- From here on products.stock_quantity can only change through branch_stock: this trigger adds the
-- change to the business total, and the guard below refuses any other direct change.
CREATE FUNCTION nexa_sync_product_stock() RETURNS trigger AS $$
DECLARE
  pid bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.product_id; ELSE pid := NEW.product_id; END IF;
  PERFORM set_config('nexa.stock_sync', '1', true);
  -- The total is always recomputed as the sum of the branches, so it cannot drift.
  UPDATE products
     SET stock_quantity = (SELECT coalesce(sum(quantity), 0) FROM branch_stock WHERE product_id = pid),
         updated_at = now()
   WHERE id = pid;
  PERFORM set_config('nexa.stock_sync', '', true);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER branch_stock_sync AFTER INSERT OR UPDATE OF quantity OR DELETE ON "branch_stock"
  FOR EACH ROW EXECUTE FUNCTION nexa_sync_product_stock();

CREATE FUNCTION nexa_guard_product_stock() RETURNS trigger AS $$
BEGIN
  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
     AND coalesce(current_setting('nexa.stock_sync', true), '') <> '1' THEN
    RAISE EXCEPTION 'products.stock_quantity is the total of branch_stock and cannot be changed directly'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER products_guard_stock BEFORE UPDATE OF stock_quantity ON "products"
  FOR EACH ROW EXECUTE FUNCTION nexa_guard_product_stock();

-- ----------------------------------------------------------- stock transfers --
CREATE TABLE "stock_transfers" (
    "id" BIGSERIAL NOT NULL,
    "business_id" BIGINT NOT NULL,
    "from_branch_id" BIGINT NOT NULL,
    "to_branch_id" BIGINT NOT NULL,
    "reference" VARCHAR(100),
    "notes" TEXT,
    "idempotency_key" VARCHAR(100),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "stock_transfer_items" (
    "id" BIGSERIAL NOT NULL,
    "transfer_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_transfers_business_id_idempotency_key_key" ON "stock_transfers"("business_id", "idempotency_key");
CREATE INDEX "stock_transfers_business_id_created_at_idx" ON "stock_transfers"("business_id", "created_at");
CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_different_branches" CHECK ("from_branch_id" <> "to_branch_id");
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_quantity_positive" CHECK ("quantity" > 0);
CREATE TRIGGER stock_transfers_same_business_from BEFORE INSERT OR UPDATE OF from_branch_id, business_id ON "stock_transfers"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('from_branch_id', 'branches');
CREATE TRIGGER stock_transfers_same_business_to BEFORE INSERT OR UPDATE OF to_branch_id, business_id ON "stock_transfers"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('to_branch_id', 'branches');
