import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadTestConfig } from "./env.js";

let pool: pg.Pool | undefined;

export function testPool(): pg.Pool {
  if (!pool) {
    const cfg = loadTestConfig();
    pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 5 });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await testPool().query<T>(sql, params);
  return result.rows;
}

/** Remove all rows from every table and restart ids. Test database only. */
export async function resetData() {
  const cfg = loadTestConfig(); // re-runs the guard
  void cfg;
  const tables = await query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`
  );
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await query(`truncate table ${list} restart identity cascade`);
}

/** Run statements inside a transaction that is always rolled back. */
export async function withRollback<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await testPool().connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Apply every prisma/migrations/<dir>/migration.sql in order. */
export async function applyMigrations(client: pg.Client | pg.PoolClient) {
  const dir = path.resolve(process.cwd(), "prisma/migrations");
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    const file = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    await client.query(fs.readFileSync(file, "utf8"));
  }
  return names;
}
