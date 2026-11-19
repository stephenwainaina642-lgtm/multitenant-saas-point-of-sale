import { describe, it, expect } from "vitest";
import pg from "pg";
import { applyMigrations } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";

const BRANCHES = "20261127090000_add_branches";

/**
 * The branches migration runs on a database that already holds real data. It must keep every row,
 * put today's stock in the Main branch, tag old records to it, and leave odd legacy rows alone.
 */
describe("branches migration on a database with existing data", () => {
  it("keeps every row, copies stock into Main, tags old records, and leaves negative legacy stock untouched", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_branches_upgrade_test`;
    expect(name.endsWith("_test")).toBe(true);
    const admin = new pg.Client({ connectionString: cfg.adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    const url = new URL(cfg.databaseUrl);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      await applyMigrations(db, (m) => m < BRANCHES);

      await db.query(`insert into users(name,email,password_hash) values ('U','u@example.test','x')`);
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      // A legacy negative row can only pre-date the CHECK (which is NOT VALID in real databases), so lift it to create one.
      await db.query(`alter table products drop constraint products_stock_quantity_nonneg`);
      await db.query(`insert into products(business_id,name,stock_quantity) values (1,'sugar',12.5),(1,'empty',0),(2,'flour',7),(1,'legacy negative',-5)`);
      await db.query(`alter table products add constraint products_stock_quantity_nonneg check (stock_quantity >= 0) not valid`);
      await db.query(`insert into sales(business_id,receipt_number,total,amount_paid,balance_due) values (1,'R1',100,100,0),(2,'R2',50,50,0)`);
      await db.query(`insert into inventory_movements(business_id,product_id,type,quantity) values (1,1,'IN',12.5)`);
      await db.query(`insert into expenses(business_id,category,amount,expense_date) values (1,'Rent',10,now())`);
      await db.query(
        `insert into register_shifts(business_id,opened_by,opening_float,status,closed_by,closed_at,expected_cash,counted_cash,variance)
         values (1,1,0,'closed',1,now(),100,100,0)`);
      const count = (t: string) => db.query(`select count(*)::int n from ${t}`).then((r) => r.rows[0].n);
      const before = { p: await count("products"), s: await count("sales"), m: await count("inventory_movements"), e: await count("expenses"), r: await count("register_shifts") };

      await applyMigrations(db, (m) => m === BRANCHES);

      expect({ p: await count("products"), s: await count("sales"), m: await count("inventory_movements"), e: await count("expenses"), r: await count("register_shifts") }).toEqual(before);

      const branches = await db.query(`select business_id, name, is_main from branches order by business_id`);
      expect(branches.rows).toEqual([{ business_id: "1", name: "Main", is_main: true }, { business_id: "2", name: "Main", is_main: true }]);

      for (const t of ["sales", "inventory_movements", "expenses", "register_shifts"]) {
        const untagged = await db.query(`select count(*)::int n from ${t} x left join branches b on b.id = x.branch_id and b.business_id = x.business_id and b.is_main where b.id is null`);
        expect(untagged.rows[0].n, t).toBe(0);
      }
      const shift = await db.query(`select status, branch_id from register_shifts`);
      expect(shift.rows[0].status).toBe("closed");

      // Stock: products.stock_quantity is untouched; positive stock is copied to Main.
      const totals = await db.query(`select name, stock_quantity::float s from products order by id`);
      expect(totals.rows.map((r) => r.s)).toEqual([12.5, 0, 7, -5]);
      const held = await db.query(`select p.name, bs.quantity::float q from branch_stock bs join products p on p.id = bs.product_id order by p.id`);
      expect(held.rows).toEqual([{ name: "sugar", q: 12.5 }, { name: "flour", q: 7 }]);

      // The guard is on from now: the total cannot be edited directly, but moves with branch stock.
      await expect(db.query(`update products set stock_quantity = 99 where id = 1`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`update branch_stock set quantity = quantity - 2.5 where product_id = 1`);
      expect((await db.query(`select stock_quantity::float s from products where id = 1`)).rows[0].s).toBe(10);
      // A negative legacy product is repaired by its first real stock movement (total becomes the true sum).
      await db.query(`insert into branch_stock(branch_id,product_id,business_id,quantity) values (1,4,1,3)`);
      expect((await db.query(`select stock_quantity::float s from products where id = 4`)).rows[0].s).toBe(3);

      // New businesses get a Main branch automatically.
      await db.query(`insert into businesses(name) values ('C')`);
      expect((await db.query(`select count(*)::int n from branches where business_id = 3 and is_main`)).rows[0].n).toBe(1);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  });
});
