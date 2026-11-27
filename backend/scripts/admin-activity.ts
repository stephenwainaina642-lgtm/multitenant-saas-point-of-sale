// Read-only: shows what the super admin(s) did recently, newest first. Changes nothing.
//   $env:DATABASE_URL = Read-Host "Paste DATABASE_URL"
//   npx tsx scripts/admin-activity.ts          -> last 50 actions
//   npx tsx scripts/admin-activity.ts 200      -> last 200 actions
// Note: this records actions (suspend, package changes, quotes, invitations, access resets), not sign-ins.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const take = Math.min(Math.max(Number(process.argv[2]) || 50, 1), 1000);
const rows = await prisma.platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take, include: { admin: { select: { name: true, email: true } } } });
const names = new Map((await prisma.business.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.businessId).filter((x): x is bigint => x !== null))] } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
const fmt = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "medium" });
if (rows.length === 0) console.log("No super-admin actions recorded yet.");
for (const r of rows) {
  console.log(`${fmt.format(r.createdAt)}  ${r.admin.email}  ${r.action}${r.businessId ? `  [${names.get(r.businessId) ?? r.businessId}]` : ""}  - ${r.reason}`);
}
await prisma.$disconnect();
