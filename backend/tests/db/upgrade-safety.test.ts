import { describe, it, expect } from "vitest";
import pg from "pg";
import { applyMigrations } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";

const NEW_MIGRATIONS = ["20261114120000_add_integrity_constraints"];

/**
 * Upgrade safety: a database that already holds messy "legacy" data (negative
 * stock, a negative payment, a cross-business link, duplicate global roles)
 * must accept the integrity migration without error and without losing a row.
 */
describe("integrity migration on a database with legacy data", () => {
  it("applies cleanly, keeps every existing row, and still guards new writes", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_upgrade_test`;
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
      // 1. Schema as it was before the integrity migration.
      await applyMigrations(db, (m) => !NEW_MIGRATIONS.includes(m));

      // 2. Legacy data that the new rules would forbid.
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      await db.query(`insert into products(business_id,name,stock_quantity) values (1,'negative',-5)`);
      await db.query(`insert into customers(business_id,name) values (1,'cust of A')`);
      await db.query(`insert into sales(business_id,customer_id,receipt_number,total,amount_paid,balance_due) values (2,1,'LEGACY-1',100,40,10)`);
      await db.query(`insert into payments(business_id,sale_id,amount,method) values (2,1,-100,'cash')`);
      await db.query(`insert into roles(name,business_id) values ('owner',null),('owner',null)`);
      const before = await db.query(
        `select (select count(*) from products) p, (select count(*) from sales) s,
                (select count(*) from payments) pay, (select count(*) from roles) r`
      );

      // 3. The migration must succeed.
      await applyMigrations(db, (m) => NEW_MIGRATIONS.includes(m));

      // 4. No row lost or changed.
      const after = await db.query(
        `select (select count(*) from products) p, (select count(*) from sales) s,
                (select count(*) from payments) pay, (select count(*) from roles) r`
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      const stock = await db.query(`select stock_quantity from products where name = 'negative'`);
      expect(Number(stock.rows[0].stock_quantity)).toBe(-5);

      // 5. The roles index is skipped (duplicates exist) rather than failing.
      const idx = await db.query(`select 1 from pg_indexes where indexname = 'roles_global_name_unique'`);
      expect(idx.rowCount).toBe(0);

      // 6. New bad writes are refused.
      await expect(
        db.query(`insert into products(business_id,name,stock_quantity) values (1,'new bad',-1)`)
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query(`insert into sales(business_id,customer_id,receipt_number) values (2,1,'NEW-X')`)
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  });

  it("creates the global-role uniqueness index when the data allows it", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_upgrade2_test`;
    const admin = new pg.Client({ connectionString: cfg.adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    const url = new URL(cfg.databaseUrl);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      await applyMigrations(db);
      await db.query(`insert into roles(name,business_id) values ('owner',null)`);
      await expect(db.query(`insert into roles(name,business_id) values ('OWNER',null)`)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  });
});
