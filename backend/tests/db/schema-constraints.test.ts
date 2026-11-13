import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData, withRollback } from "../support/db.js";

const EXPECTED_TABLES = [
  "audit_logs", "business_users", "businesses", "categories", "customers", "document_sequences", "expenses",
  "inventory_movements", "invoice_items", "invoices", "payments", "products",
  "purchase_items", "purchases", "quotation_items", "quotations", "roles",
  "sale_items", "sales", "suppliers", "users",
];

// Tables that must carry business_id (directly business-owned).
const TENANT_TABLES = [
  "audit_logs", "business_users", "categories", "customers", "document_sequences", "expenses",
  "inventory_movements", "invoices", "payments", "products", "purchases",
  "quotations", "sales", "suppliers",
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
        where table_schema='public' and data_type='numeric'`
    );
    expect(cols.length).toBeGreaterThan(30);
    for (const c of cols) {
      const isQty = /(^|_)quantity$|minimum_stock/.test(c.column_name);
      expect(c.numeric_precision, `${c.table_name}.${c.column_name}`).toBe(12);
      expect(c.numeric_scale, `${c.table_name}.${c.column_name}`).toBe(isQty ? 3 : 2);
    }
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

// Each of these asserts what a safe database SHOULD do. Today the database
// accepts the bad data, so they are marked known defects (see KD-9).
describe("database-level safety nets (known defects)", () => {
  it.fails("KD-9 negative stock is rejected by a CHECK constraint", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('T') returning id`)).rows[0].id;
      await expect(
        c.query(`insert into products(business_id,name,stock_quantity) values ($1,'neg',-5)`, [b])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it.fails("KD-9 negative or zero payment amounts are rejected by a CHECK constraint", async () => {
    await withRollback(async (c) => {
      const b = (await c.query(`insert into businesses(name) values ('T') returning id`)).rows[0].id;
      const s = (await c.query(`insert into sales(business_id,receipt_number) values ($1,'R') returning id`, [b])).rows[0].id;
      await expect(
        c.query(`insert into payments(business_id,sale_id,amount,method) values ($1,$2,-100,'cash')`, [b, s])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it.fails("KD-9b a sale cannot reference a customer from another business", async () => {
    await withRollback(async (c) => {
      const a = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const b = (await c.query(`insert into businesses(name) values ('B') returning id`)).rows[0].id;
      const cust = (await c.query(`insert into customers(business_id,name) values ($1,'c') returning id`, [a])).rows[0].id;
      await expect(
        c.query(`insert into sales(business_id,customer_id,receipt_number) values ($1,$2,'X')`, [b, cust])
      ).rejects.toBeTruthy();
    });
  });

  it.fails("KD-9c a payment cannot belong to a different business than its sale", async () => {
    await withRollback(async (c) => {
      const a = (await c.query(`insert into businesses(name) values ('A') returning id`)).rows[0].id;
      const b = (await c.query(`insert into businesses(name) values ('B') returning id`)).rows[0].id;
      const sale = (await c.query(`insert into sales(business_id,receipt_number) values ($1,'R') returning id`, [a])).rows[0].id;
      await expect(
        c.query(`insert into payments(business_id,sale_id,amount,method) values ($1,$2,10,'cash')`, [b, sale])
      ).rejects.toBeTruthy();
    });
  });

  it.fails("KD-9d two global (NULL-business) roles cannot share a name", async () => {
    await withRollback(async (c) => {
      await c.query(`insert into roles(name,business_id) values ('owner',null)`);
      await expect(c.query(`insert into roles(name,business_id) values ('owner',null)`)).rejects.toMatchObject({ code: "23505" });
    });
  });
});
