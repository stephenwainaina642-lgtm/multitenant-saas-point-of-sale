// Read-only: runs the super-admin businesses list against your database and shows the real error if it fails.
//   $env:DATABASE_URL = Read-Host "Paste DATABASE_URL"
//   npx tsx scripts/check-overview.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { overview } from "../src/platform/platform.service.js";

try {
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'businesses' and column_name in ('package', 'modules')`;
  console.log("Columns on businesses:", cols.map((c) => c.column_name).sort().join(", ") || "NONE of package/modules (the migration is not in THIS database)");
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`select table_name from information_schema.tables where table_name in ('employee_invites', 'platform_quotes')`;
  console.log("New tables present:", tables.map((t) => t.table_name).sort().join(", ") || "none");
  const o = await overview();
  console.log(`Overview OK: ${o.totals.businesses} businesses, ${o.totals.users} users.`);
  for (const b of o.businesses.slice(0, 10)) console.log(` - ${b.name}: ${b.package}, modules [${(b.modules ?? []).join(", ")}]`);
} catch (e) {
  console.error("Overview FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
