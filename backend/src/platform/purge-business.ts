import pg from "pg";

/**
 * Erases one business and everything that belongs to it, for good. Used only by the Super Admin, only for a business
 * that was hidden first, and only after the platform owner typed its name.
 *
 * It works from the database's own foreign-key catalogue, so a table added later is covered without editing this file:
 * every table that has a business_id column is emptied for this business, and before any row is deleted, every row in
 * another table that points at it is deleted first. It all runs in ONE transaction: if anything cannot be removed,
 * nothing is removed.
 *
 * Kept on purpose: platform_audit_logs (the record that the erase happened) and user accounts that also belong to
 * another business.
 */
type Fk = { name: string; child: string; childCols: string[]; parent: string; parentCols: string[]; nullable: boolean[] };

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export type PurgeResult = { tables: Record<string, number>; rows: number; usersRemoved: number; usersKept: number };

export async function purgeBusiness(businessId: bigint, databaseUrl = process.env.DATABASE_URL): Promise<PurgeResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const counts: Record<string, number> = {};
  try {
    await client.query("begin");

    const fkRows = (await client.query(`
      select c.conname as name, cl.relname as child, pl.relname as parent,
             (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_cols,
             (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_cols,
             (select array_agg(not a.attnotnull order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as nullable
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_class pl on pl.oid = c.confrelid
      where c.contype = 'f' and n.nspname = 'public'`)).rows;
    const fks: Fk[] = fkRows.map((r) => ({ name: r.name, child: r.child, childCols: r.child_cols, parent: r.parent, parentCols: r.parent_cols, nullable: r.nullable }));
    const childrenOf = (table: string) => fks.filter((f) => f.parent === table);

    /** Delete the rows of `table` matching `where` (uses $1 = business id), children first. */
    async function removeRows(table: string, where: string, path: string[]): Promise<void> {
      for (const fk of childrenOf(table)) {
        if (path.includes(fk.name)) {
          // A loop between tables: let go of the link instead of following it again.
          if (fk.nullable.every(Boolean)) {
            await client.query(`update ${q(fk.child)} set ${fk.childCols.map((c) => `${q(c)} = null`).join(", ")} where (${fk.childCols.map(q).join(", ")}) in (select ${fk.parentCols.map(q).join(", ")} from ${q(table)} where ${where})`, [businessId]);
          }
          continue;
        }
        if (fk.child === table && fk.nullable.every(Boolean)) {
          // A table pointing at itself (a category's parent, a refund's sale): let go first, then one delete takes them all.
          await client.query(`update ${q(table)} set ${fk.childCols.map((c) => `${q(c)} = null`).join(", ")} where ${where}`, [businessId]);
          continue;
        }
        if (fk.child === table) continue; // not nullable: a single DELETE removes the whole set together
        const sub = `(${fk.childCols.map(q).join(", ")}) in (select ${fk.parentCols.map(q).join(", ")} from ${q(table)} where ${where})`;
        await removeRows(fk.child, sub, [...path, fk.name]);
      }
      const res = await client.query(`delete from ${q(table)} where ${where}`, [businessId]);
      counts[table] = (counts[table] ?? 0) + (res.rowCount ?? 0);
    }

    // Who belonged to this business (decided before their memberships go).
    const members = (await client.query<{ user_id: string }>(`select distinct user_id::text from business_users where business_id = $1`, [businessId])).rows.map((r) => r.user_id);
    const ownerRow = (await client.query<{ owner_user_id: string | null }>(`select owner_user_id::text from businesses where id = $1`, [businessId])).rows[0];
    if (ownerRow?.owner_user_id) members.push(ownerRow.owner_user_id);

    const scoped = (await client.query<{ table_name: string }>(`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'business_id' and c.table_name not in ('platform_audit_logs', 'businesses', 'platform_payments', 'platform_subscription_events')
      order by c.table_name`)).rows.map((r) => r.table_name);
    for (const table of scoped) await removeRows(table, "business_id = $1", []);

    await removeRows("businesses", "id = $1", []);

    // Accounts that belonged only to this business go too; one that is also in another business is left alone.
    let usersRemoved = 0;
    let usersKept = 0;
    for (const id of [...new Set(members)]) {
      const other = await client.query(`select 1 from business_users where user_id = $1 limit 1`, [id]);
      const owns = await client.query(`select 1 from businesses where owner_user_id = $1 limit 1`, [id]);
      if (other.rowCount || owns.rowCount) { usersKept++; continue; }
      await client.query("savepoint u");
      try {
        const r = await client.query(`delete from users where id = $1`, [id]);
        usersRemoved += r.rowCount ?? 0;
        await client.query("release savepoint u");
      } catch {
        await client.query("rollback to savepoint u"); // still referenced by something that must stay: keep the account
        usersKept++;
      }
    }

    await client.query("commit");
    const nonEmpty = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    return { tables: nonEmpty, rows: Object.values(nonEmpty).reduce((a, b) => a + b, 0), usersRemoved, usersKept };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
