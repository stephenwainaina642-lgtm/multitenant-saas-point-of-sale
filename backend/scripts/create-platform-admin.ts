// Creates (or re-enrolls 2FA for) a platform super admin. Run on your own computer against the database:
//   npx tsx scripts/create-platform-admin.ts            -> create a new admin
//   npx tsx scripts/create-platform-admin.ts reset-2fa  -> new authenticator secret for an existing admin
// Needs DATABASE_URL and JWT_SECRET (the same JWT_SECRET the live API uses, because it protects the 2FA secret).
import "dotenv/config";
import readline from "node:readline";
import { createPlatformAdmin, reenrollTotp } from "../src/platform/platform.service.js";
import prisma from "../src/lib/prisma.js";

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
  if (mode === "reset-2fa") {
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
