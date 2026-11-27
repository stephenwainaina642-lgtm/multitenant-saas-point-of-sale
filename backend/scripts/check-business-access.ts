// Read-only: for one business, shows who the owner is and which permissions each member really has on the server.
// Nothing is changed. Emails are partly hidden so the output is safe to paste.
//   $env:DATABASE_URL = Read-Host "Paste DATABASE_URL"
//   npx tsx scripts/check-business-access.ts "chicken hotel"
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { ALL_PERMISSIONS, resolvePermissions } from "../src/auth/permissions.js";

const hide = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
};

try {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    console.log(`Database: user ${decodeURIComponent(u.username)} @ ${u.hostname}:${u.port || "5432"}${u.pathname}`);
  } catch { console.log("Database: DATABASE_URL could not be read"); }

  const wanted = (process.argv[2] ?? "").trim();
  if (!wanted) { console.error('Give the business name, e.g.  npx tsx scripts/check-business-access.ts "chicken hotel"'); process.exit(1); }

  const businesses = await prisma.business.findMany({ where: { name: { contains: wanted, mode: "insensitive" } }, take: 5 });
  if (!businesses.length) console.log(`No business found with a name containing "${wanted}".`);

  for (const b of businesses) {
    console.log(`\nBusiness: ${b.name} (${b.packageName}, active: ${b.isActive}, approval: ${b.approvalStatus})`);
    const members = await prisma.businessUser.findMany({ where: { businessId: b.id }, include: { user: true, role: true }, orderBy: { id: "asc" } });
    const owner = members.find((m) => m.userId === b.ownerUserId);
    console.log(`Registered owner: ${b.ownerUserId === null ? "NONE SET" : owner ? `${owner.user.name} <${hide(owner.user.email)}>` : "set, but not a member of this business"}`);
    for (const m of members) {
      const isOwner = b.ownerUserId === m.userId;
      const held = resolvePermissions(m.role.name, m.role.permissions, isOwner);
      const missing = ALL_PERMISSIONS.filter((p) => !held.has(p));
      console.log(
        ` - ${m.user.name} <${hide(m.user.email)}> role "${m.role.name}"${isOwner ? " [REGISTERED OWNER]" : ""}${m.isActive ? "" : " [INACTIVE]"}: ` +
          (missing.length === 0 ? "all permissions" : `missing ${missing.length}: ${missing.join(", ")}`)
      );
    }
  }
} catch (e) {
  console.error("Check FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
