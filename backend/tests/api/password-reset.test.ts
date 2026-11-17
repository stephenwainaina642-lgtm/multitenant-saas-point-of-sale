import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { get, post } from "../support/http.js";
import { PASSWORD, registerTenant } from "../support/seed.js";

const cfg = loadTestConfig();
const NEW = "Fresh-Pass-2026!";

type Mail = { to: string; body: string };
const decodeQp = (s: string) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

describe("forgot / reset password by email", () => {
  const mails: Mail[] = [];
  let smtp: SMTPServer;
  let mailServer: RunningServer;
  let noMailServer: RunningServer;
  let base: string;
  let noMailBase: string;

  const call = async (b: string, path: string, body: unknown, method = "POST") => {
    const res = await fetch(`${b}${path}`, { method, headers: { "content-type": "application/json" }, ...(method === "POST" && { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const forgot = (email: string) => call(base, "/auth/forgot-password", { email });
  const reset = (token: string, newPassword = NEW) => call(base, "/auth/reset-password", { token, newPassword });
  const tokenFrom = (m: Mail) => /#reset-password=([0-9a-f]{64})/.exec(m.body)![1]!;
  const settle = () => new Promise((r) => setTimeout(r, 700)); // mail is sent after the HTTP reply
  const login = (email: string, password: string) => call(base, "/auth/login", { email, password });

  beforeAll(async () => {
    await resetData();
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      onRcptTo: (a, _s, cb) => { (smtp as any)._last = a.address; cb(); },
      onData(stream, session, cb) {
        let data = "";
        stream.on("data", (c) => (data += c));
        stream.on("end", () => { mails.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), body: decodeQp(data) }); cb(); });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    const smtpPort = (smtp.server.address() as AddressInfo).port;
    const p1 = cfg.apiPort + 5, p2 = cfg.apiPort + 6;
    mailServer = startServer(p1, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), MAIL_FROM: "nexaPOS <no-reply@nexa.test>", APP_URL: "http://app.nexa.test" });
    noMailServer = startServer(p2);
    base = `http://127.0.0.1:${p1}/api`;
    noMailBase = `http://127.0.0.1:${p2}/api`;
    await Promise.all([waitForHealth(`${base}/health`, 40_000, mailServer), waitForHealth(`${noMailBase}/health`, 40_000, noMailServer)]);
  }, 90_000);

  afterAll(async () => { await mailServer?.stop(); await noMailServer?.stop(); await new Promise((r) => smtp?.close(() => r(null))); });

  it("says plainly when e-mail is not set up, instead of pretending", async () => {
    expect((await call(noMailBase, "/auth/capabilities", null, "GET")).body.data.passwordResetEmail).toBe(false);
    const r = await call(noMailBase, "/auth/forgot-password", { email: "anyone@example.com" });
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/not set up/i);
    expect((await call(base, "/auth/capabilities", null, "GET")).body.data.passwordResetEmail).toBe(true);
  });

  it("sends one link to a real account, nothing for an unknown one, and answers both the same way", async () => {
    const t = await registerTenant("Reset Shop");
    const email = (await query(`select email from users order by id desc limit 1`))[0]!.email as string;
    mails.length = 0;
    const unknown = await forgot("nobody-here@example.com");
    const known = await forgot(email.toUpperCase()); // any capitalisation
    expect([unknown.status, known.status]).toEqual([200, 200]);
    expect(known.body.message).toBe(unknown.body.message);
    await settle();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(email);
    expect(mails[0]!.body).toMatch(/http:\/\/app\.nexa\.test\/#reset-password=[0-9a-f]{64}/);
    expect(mails[0]!.body).toMatch(/30 minutes/);
    expect(t.token).toBeTruthy();
    // only a hash is stored
    const token = tokenFrom(mails[0]!);
    const rows = await query(`select token_hash from password_reset_tokens`);
    expect(rows.every((r: any) => r.token_hash !== token && r.token_hash.length === 64)).toBe(true);
  });

  it("resets once: new password works, old does not, other sessions are signed out, link is single-use", async () => {
    const t = await registerTenant("Reset Shop 2");
    const email = (await query(`select email from users order by id desc limit 1`))[0]!.email as string;
    mails.length = 0;
    await forgot(email);
    await forgot(email); // a second, newer link; resetting with one must kill the other
    await settle();
    expect(mails).toHaveLength(2);
    const [first, second] = [tokenFrom(mails[0]!), tokenFrom(mails[1]!)];
    await new Promise((r) => setTimeout(r, 1100)); // JWT issue time has one-second resolution

    expect((await reset(first, "short")).status).toBe(400); // weak password does not consume the link
    const ok = await reset(first);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await reset(first)).status).toBe(400);   // already used
    expect((await reset(second)).status).toBe(400);  // the other outstanding link is dead too

    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, NEW)).status).toBe(200);
    expect((await get("/businesses/current", t)).status).toBe(401); // the old session is gone
  });

  it("refuses unknown, malformed and expired links with one message, and a bad password length", async () => {
    const t = await registerTenant("Reset Shop 3");
    expect(t.token).toBeTruthy();
    const email = (await query(`select email from users order by id desc limit 1`))[0]!.email as string;
    mails.length = 0;
    await forgot(email);
    await settle();
    const token = tokenFrom(mails[0]!);
    const messages = new Set<string>();
    for (const bad of ["", "abc", "z".repeat(64), "0".repeat(64)]) {
      const r = await reset(bad);
      expect(r.status, bad).toBe(400);
      messages.add(r.body.message);
    }
    await query(`update password_reset_tokens set expires_at = now() - interval '1 minute' where token_hash is not null`);
    const expired = await reset(token);
    expect(expired.status).toBe(400);
    messages.add(expired.body.message);
    expect(messages.size).toBe(1);
    expect((await reset(token, "x".repeat(73))).status).toBe(400); // longer than bcrypt reads
  });

  it("limits how many links one account can request per hour, and ignores deactivated accounts", async () => {
    await registerTenant("Reset Shop 4");
    const email = (await query(`select email from users order by id desc limit 1`))[0]!.email as string;
    mails.length = 0;
    for (let i = 0; i < 5; i++) await forgot(email);
    await settle();
    expect(mails).toHaveLength(3);

    await registerTenant("Reset Shop 5");
    const off = (await query(`select id, email from users order by id desc limit 1`))[0]!;
    await query(`update users set is_active = false where id = $1`, [off.id]);
    mails.length = 0;
    expect((await forgot(off.email)).status).toBe(200);
    await settle();
    expect(mails).toHaveLength(0);
  });

  it("only one of several simultaneous uses of the same link succeeds", async () => {
    await registerTenant("Reset Shop 6");
    const email = (await query(`select email from users order by id desc limit 1`))[0]!.email as string;
    mails.length = 0;
    await forgot(email);
    await settle();
    const token = tokenFrom(mails[0]!);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => reset(token, `Parallel-Pass-${i}-xyz`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });
});
