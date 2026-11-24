import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData, withRollback } from "../support/db.js";

const EXPECTED_TABLES = [
  "audit_logs", "branch_stock", "branches", "business_invites", "business_users", "businesses", "categories", "customers", "dining_tables", "document_sequences", "expenses",
  "integration_audit_logs", "integration_connections", "integration_events", "integration_secrets", "inventory_movements", "invoice_items", "invoices", "menu_addons", "mpesa_c2b_payments", "mpesa_payment_requests", "offline_stock_shortfalls", "password_reset_tokens", "payments", "pesapal_payment_requests", "platform_admins", "platform_audit_logs", "products",
  "purchase_items", "purchases", "quotation_items", "quotations", "refunds", "register_shifts", "roles",
  "sale_items", "sales", "stock_transfer_items", "stock_transfers", "supplier_payments", "suppliers", "table_order_items", "table_orders", "tax_rates", "users",
];

// Tables that must carry business_id (directly business-owned).
const TENANT_TABLES = [
  "audit_logs", "business_users", "categories", "customers", "document_sequences", "expenses",
  "inventory_movements", "invoices", "payments", "products", "purchases", "register_shifts",
  "quotations", "sales", "suppliers", "integration_audit_logs", "integration_connections", "integration_events", "integration_secrets", "mpesa_c2b_payments", "mpesa_payment_requests", "offline_stock_shortfalls", "pesapal_payment_requests", "branches", "branch_stock", "stock_transfers", "dining_tables", "table_orders", "table_order_items",
];

describe("migrations and schema", () => {
  beforeAll(resetData);

  it("all migrations applied to an empty database produce the expected tables", async () => {
    const rows = await query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname='public' order by 1`
    );
    expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);
  });

  it("every directly business-owned table has a NOT NULL business_id", async () => {
    for (const table of TENANT_TABLES) {
      const [col] = await query(
        `select is_nullable from information_schema.columns
          where table_name = $1 and column_name = 'business_id'`,
        [table]
      );
      expect(col, `${table}.business_id`).toBeTruthy();
      expect(col!.is_nullable, `${table}.business_id nullable`).toBe("NO");
    }
  });

  it("money columns are numeric(12,2) and quantities numeric(12,3)", async () => {
    const cols = await query<{ table_name: string; column_name: string; numeric_precision: number; numeric_scale: number }>(
      `select table_name, column_name, numeric_precision, numeric_scale
         from information_schema.columns
        where table_schema='public' and data_type='numeric'
          and column_name not in ('vat_rate', 'tax_rate', 'rate', 'service_charge_rate', 'catering_levy_rate')   -- percentages: numeric(5,2), checked below`
    );
    expect(cols.length).toBeGreaterThan(30);
    for (const c of cols) {
      const isQty = /(^|_)quantity$|minimum_stock|quantity_short/.test(c.column_name);
      expect(c.numeric_precision, `${c.table_name}.${c.column_name}`).toBe(12);
      expect(c.numeric_scale, `${c.table_name}.${c.column_name}`).toBe(isQty ? 3 : 2);
    }
  });

  it("the VAT rate is a percentage numeric(5,2)", async () => {
    const [c] = await query<{ numeric_precision: number; numeric_scale: number }>(
      `select numeric_precision, numeric_scale from information_schema.columns
        where table_name = 'businesses' and column_name = 'vat_rate'`
    );
    expect([c!.numeric_precision, c!.numeric_scale]).toEqual([5, 2]);
  });

  it("every foreign key is enforced", async () => {
    await withRollback(async (c) => {
      await expect(
        c.query(`insert into products(business_id, name) values (999999, 'orphan')`)
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
});

describe("unique constraints", () => {
  const seedBusiness = async (c: { query: (s: string, p?: unknown[]) => Promise<any> }) => {
    const b = await c.query(`insert into businesses(name) values ('T') returning id`);
    return b.rows[0].id as string;
  };

  it("user email is unique", async () => {
    await withRollback(async (c) => {
      await c.query(`insert into users(name,email,password_hash) values ('a','dup@x','h')`);
      await expect(c.query(`insert into users(name,email,password_hash) values ('b','dup@x','h')`)).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("product sku and barcode are unique per business", async () => {
    await withRollback(async (c) => {
      const b = await seedBusiness(c);
      await c.query(`insert into products(business_id,name,sku,barcode) values ($1,'p1','S1','B1')`, [b]);
      await c.query("savepoint s1");
      await expect(c.query(`insert into products(business_id,name,sku) values ($1,'p2','S1')`, [b])).rejects.toMatchObject({ code: "23505" });
      await c.query("rollback to savepoint s1");
      await expect(c.query(`insert into products(business_id,name,barcode) values ($1,'p3','B1')`, [b])).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("receipt number is unique per business, and a membership is unique per (business, user)", async () => {
    await withRollback(async (c) => {
      const b = await seedBusiness(c);
      await c.query(`insert into sales(business_id, receipt_number) values ($1,'R1')`, [b]);
      await c.query("savepoint s1");
      await expect(c.query(`insert into sales(business_id, receipt_number) values ($1,'R1')`, [b])).rejects.toMatchObject({ code: "23505" });
      await c.query("rollback to savepoint s1");
      const u = (await c.query(`insert into users(name,email,password_hash) values ('u','u@x','h') returning id`)).rows[0].id;
      const r = (await c.query(`insert into roles(name,business_id) values ('owner',$1) returning id`, [b])).rows[0].id;
      await c.query(`insert into business_users(business_id,user_id,role_id) values ($1,$2,$3)`, [b, u, r]);
      await expect(c.query(`insert into business_users(business_id,user_id,role_id) values ($1,$2,$3)`, [b, u, r])).rejects.toMatchObject({ code: "23505" });
    });
  });
});

// The database itself refuses bad data, independent of application code.
describe("database-level safety nets", () => {
  it("negative stock is rejected by a CHECK constraint", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('T') returning id`)).rows[0].id;
      await expect(
        c.query(`insert into products(business_id,name,stock_quantity) values ($1,'neg',-5)`, [b])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("negative or zero payment amounts are rejected by a CHECK constraint", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('T') returning id`)).rows[0].id;
      const s = (await c.query(`insert into sales(business_id,receipt_number) values ($1,'R') returning id`, [b])).rows[0].id;
      await expect(
        c.query(`insert into payments(business_id,sale_id,amount,method) values ($1,$2,-100,'cash')`, [b, s])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("a sale cannot reference a customer from another business", async () => {
    await withRollback(async (c) => {
      const a = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const b = (await c.query(`insert into businesses(name) values ('B') returning id`)).rows[0].id;
      const cust = (await c.query(`insert into customers(business_id,name) values ($1,'c') returning id`, [a])).rows[0].id;
      await expect(
        c.query(`insert into sales(business_id,customer_id,receipt_number) values ($1,$2,'X')`, [b, cust])
      ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("Cross-business") });
    });
  });

  it("a payment cannot belong to a different business than its sale", async () => {
    await withRollback(async (c) => {
      const a = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const b = (await c.query(`insert into businesses(name) values ('B') returning id`)).rows[0].id;
      const sale = (await c.query(`insert into sales(business_id,receipt_number) values ($1,'R') returning id`, [a])).rows[0].id;
      await expect(
        c.query(`insert into payments(business_id,sale_id,amount,method) values ($1,$2,10,'cash')`, [b, sale])
      ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("Cross-business") });
    });
  });

  it("two global (NULL-business) roles cannot share a name", async () => {
    await withRollback(async (c) => {
      await c.query(`insert into roles(name,business_id) values ('owner',null)`);
      await expect(c.query(`insert into roles(name,business_id) values ('owner',null)`)).rejects.toMatchObject({ code: "23505" });
    });
  });
});

describe("more integrity rules", () => {
  it("sale and sale-item rows cannot use another business's product", async () => {
    await withRollback(async (c) => {
      const a = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const b = (await c.query(`insert into businesses(name) values ('B') returning id`)).rows[0].id;
      const prod = (await c.query(`insert into products(business_id,name) values ($1,'p') returning id`, [a])).rows[0].id;
      const sale = (await c.query(`insert into sales(business_id,receipt_number) values ($1,'R') returning id`, [b])).rows[0].id;
      await expect(
        c.query(`insert into sale_items(sale_id,product_id,quantity,unit_price,total) values ($1,$2,1,1,1)`, [sale, prod])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("inconsistent sale money (balance_due != total - amount_paid, or overpaid) is rejected", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      await c.query("savepoint s1");
      await expect(
        c.query(`insert into sales(business_id,receipt_number,total,amount_paid,balance_due) values ($1,'R1',100,40,10)`, [b])
      ).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint s1");
      await expect(
        c.query(`insert into sales(business_id,receipt_number,total,amount_paid,balance_due) values ($1,'R2',100,150,-50)`, [b])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("an unknown inventory movement type is rejected", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const p = (await c.query(`insert into products(business_id,name) values ($1,'p') returning id`, [b])).rows[0].id;
      await expect(
        c.query(`insert into inventory_movements(business_id,product_id,type,quantity) values ($1,$2,'TELEPORT',1)`, [b, p])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("the new CHECK constraints are NOT VALID, so existing rows are never scanned or rejected", async () => {
    const rows = await query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
        where contype = 'c' and connamespace = 'public'::regnamespace
          and conname not in ('refunds_amount_positive','supplier_payments_amount_positive','businesses_tax_pin_format','businesses_vat_rate_range','products_tax_class_valid','tax_rates_rate_range','tax_rates_code_not_builtin','businesses_inclusive_needs_vat','platform_audit_reason_not_blank','register_shifts_status_valid','register_shifts_float_nonneg','register_shifts_closed_complete','sales_channel_valid','branches_name_not_blank','branches_main_is_active','branch_stock_quantity_nonneg','stock_transfers_different_branches','stock_transfer_items_quantity_positive','integration_connections_provider_check','integration_connections_environment_check','integration_connections_test_status_check','mpesa_payment_requests_status_check','mpesa_payment_requests_amount_positive','mpesa_payment_requests_paid_complete','mpesa_payment_requests_dismissal_complete','mpesa_c2b_payments_amount_positive','mpesa_c2b_payments_trans_id_format','pesapal_payment_requests_status_check','pesapal_payment_requests_amount_positive','pesapal_payment_requests_paid_complete','pesapal_payment_requests_contact_present','pesapal_payment_requests_dismissal_complete','offline_stock_shortfalls_qty_positive','offline_stock_shortfalls_resolved_complete','dining_tables_name_not_blank','dining_tables_seats_positive','table_orders_status_check','table_orders_covers_positive','table_orders_billed_has_sale','table_orders_closed_complete','table_order_items_qty_positive','table_order_items_price_nonneg','table_order_items_void_complete','businesses_service_charge_range','businesses_catering_levy_range','menu_addons_name_not_blank','menu_addons_price_nonneg','table_order_items_addons_array','table_order_items_void_not_billed')`
    );
    expect(rows.length).toBe(13); // 12 earlier + businesses_approval_status_valid
    for (const r of rows) expect(r.convalidated, r.conname).toBe(false);
  });
});
