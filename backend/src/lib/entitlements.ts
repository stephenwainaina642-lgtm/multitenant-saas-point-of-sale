import prisma from "./prisma.js";
import { AppError } from "./errors.js";

type Db = Pick<typeof prisma, "platformSubscription" | "businessUser" | "branch" | "employeeInvite">;

/**
 * Plan limits, enforced on the server. A business without a subscription (legacy) has no limits.
 * Limits only stop NEW additions: lowering a limit never removes anyone who is already there.
 */
export async function assertWithinLimit(businessId: bigint, what: "employees" | "branches", db: Db = prisma): Promise<void> {
  const sub = await db.platformSubscription.findUnique({ where: { businessId }, select: { maxEmployees: true, maxBranches: true, planName: true } });
  if (!sub) return;
  if (what === "employees") {
    if (sub.maxEmployees == null) return;
    const [members, pending] = await Promise.all([
      db.businessUser.count({ where: { businessId, isActive: true } }),
      db.employeeInvite.count({ where: { businessId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (members + pending >= sub.maxEmployees) {
      throw new AppError(403, `Your ${sub.planName} plan allows ${sub.maxEmployees} people on staff (including the owner and pending sign-in links). Ask nexaPOS to raise the limit to add more.`);
    }
    return;
  }
  if (sub.maxBranches == null) return;
  const branches = await db.branch.count({ where: { businessId, isActive: true } });
  if (branches >= sub.maxBranches) {
    throw new AppError(403, `Your ${sub.planName} plan allows ${sub.maxBranches} branch${sub.maxBranches === 1 ? "" : "es"}. Ask nexaPOS to raise the limit to add more.`);
  }
}
