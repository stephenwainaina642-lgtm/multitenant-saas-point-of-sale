// Creates (or re-enrolls 2FA for) a platform super admin. Run on your own computer against the database:
//   npx tsx scripts/create-platform-admin.ts            -> create a new admin
//   npx tsx scripts/create-platform-admin.ts reset-2fa  -> new authenticator secret for an existing admin
//   npx tsx scripts/create-platform-admin.ts reset-password -> new password for an existing admin
//   npx tsx scripts/create-platform-admin.ts check          -> read-only: says which sign-in part fails (email, password, key, code)
// Needs DATABASE_URL and JWT_SECRET (the same JWT_SECRET the live API uses, because it protects the 2FA secret).
import "dotenv/config";
import readline from "node:readline";
import { createPlatformAdmin, reenrollTotp, resetAdminPassword } from "../src/platform/platform.service.js";
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma.js";
import { decryptSecret, verifyTotp } from "../src/platform/totp.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));
function askHidden(q: string) {
  return new Promise<string>((resolve) => {
    const out = process.stdout as NodeJS.WriteStream;
    const write = out.write.bind(out);
    out.write = ((chunk: unknown, ...rest: unknown[]) => (String(chunk).includes(q) ? write(chunk as string, ...(rest as [])) : true)) as typeof out.write;
    rl.question(q, (a) => { out.write = write; out.write("\n"); resolve(a); });
  });
}

try {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set (put it in backend/.env or the environment)");
  const mode = process.argv[2];
  let result;
  if (mode === "reset-password") {
    const email = await ask("Admin e-mail: ");
    const p1 = await askHidden("New password (12+ characters, typing is hidden): ");
    const p2 = await askHidden("Type it again: ");
    if (p1 !== p2) throw new Error("The two passwords do not match");
    await resetAdminPassword(email, p1);
    console.log("\nPassword changed. Your authenticator app is unchanged. Sign in at <your site>/#platform.");
    process.exit(0);
  } else if (mode === "check") {
    const email = await ask("Admin e-mail: ");
    const password = await askHidden("Password (hidden): ");
    const code = (await ask("Current 6-digit code from your authenticator app: ")).trim();
    const admin = await prisma.platformAdmin.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
    console.log("");
    console.log(admin ? "1. E-mail: found." : "1. E-mail: NOT FOUND. No admin has that e-mail (check spelling).");
    if (admin) {
      console.log(admin.isActive ? "2. Account: active." : "2. Account: DISABLED.");
      console.log((await bcrypt.compare(password, admin.passwordHash)) ? "3. Password: correct." : "3. Password: WRONG. Run reset-password.");
      let secret: string | null = null;
      try { secret = decryptSecret(admin.totpSecretEnc); console.log("4. Authenticator key: opens with the JWT_SECRET in this window."); }
      catch { console.log("4. Authenticator key: CANNOT be opened with the JWT_SECRET in this window. It was set with a different JWT_SECRET. Run reset-2fa in this window."); }
      if (secret) {
        const step = verifyTotp(secret, code, Number(admin.totpLastStep));
        console.log(step !== null ? "5. Code: valid right now." : "5. Code: NOT valid (wrong entry in the app, already used, or phone clock off). Wait for the next code.");
        if (step !== null) console.log("\nEverything is correct on this computer. If the website still refuses you, the JWT_SECRET in Render is different from the one in this window: set Render's JWT_SECRET to exactly this value, wait for Live, then run reset-2fa here and sign in.");
      }
    }
    process.exit(0);
  } else if (mode === "reset-2fa") {
    result = await reenrollTotp(await ask("Admin e-mail: "));
  } else {
    const name = await ask("Name: ");
    const email = await ask("E-mail: ");
    const password = await askHidden("Password (12+ characters, typing is hidden): ");
    result = await createPlatformAdmin(name, email, password);
  }
  console.log("\nAdd this to your authenticator app (Google Authenticator, Microsoft Authenticator, Authy):");
  console.log("  Account type: time-based. Choose 'Enter a setup key' and paste the key below.");
  console.log(`  Setup key: ${result.secret}`);
  console.log(`  (or open this link on a device with an authenticator: ${result.uri})`);
  console.log("\nThe key is shown only now. Sign in at <your site>/#platform with e-mail, password and the 6-digit code.");
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rl.close();
  await prisma.$disconnect();
}
