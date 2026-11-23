import crypto from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { centsToString, parseMoney } from "../../lib/money.js";
import { recordIntegrationAudit, type IntegrationActor } from "./audit.js";
import { loadMpesa } from "./credentials.js";
import { callbackBase } from "./mpesa-payments.service.js";
import { DarajaAuthError, DarajaNetworkError, registerC2bUrls, simulateC2b } from "./providers/mpesa/daraja.js";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
/** Words Safaricom refuses inside a registered address. */
const FORBIDDEN = /mpesa|m-pesa|safaricom|exe|exec|cmd|sql|query/i;

const reply = (ok: boolean) => ({ ResultCode: ok ? 0 : 1, ResultDesc: ok ? "Confirmation received successfully" : "Rejected" });

/** Registered = we hold a notification token for THIS environment and shortcode. */
export const c2bRegistered = (conn: { environment: string; config: unknown }) => {
  const c = (conn.config ?? {}) as Record<string, string>;
  return !!c.c2bTokenHash && c.c2bEnvironment === conn.environment && !!c.c2bShortCode && c.c2bShortCode === c.businessShortcode;
};

/** Registers our notification addresses with Safaricom. The token inside them is the credential. */
export async function registerC2b(actor: IntegrationActor, acknowledgeOneTime: boolean) {
  const { conn, creds } = await loadMpesa(actor.businessId, false);
  if (conn.environment === "production" && acknowledgeOneTime !== true) {
    throw new AppError(400, "In production Safaricom registers these addresses once per shortcode and will not overwrite addresses another system already uses. Confirm you understand before registering.");
  }
  const token = crypto.randomBytes(32).toString("hex"); // hex: can never contain a word Safaricom forbids
  const base = callbackBase();
  const root = `${base}/api/integrations/callbacks/c2b/${conn.publicId}/${token}`;
  const confirmationUrl = `${root}/confirmation`;
  const validationUrl = `${root}/validation`;
  if (FORBIDDEN.test(confirmationUrl)) {
    throw new AppError(409, "Safaricom does not accept addresses containing words like mpesa, safaricom, exec, cmd, sql or query. Change the server's public address (PUBLIC_API_URL) to one without them.");
  }
  let out;
  try {
    out = await registerC2bUrls(creds, confirmationUrl, validationUrl);
  } catch (e) {
    if (e instanceof DarajaAuthError) throw new AppError(409, "Safaricom rejected the saved credentials. Re-test them in Settings.");
    if (e instanceof DarajaNetworkError) throw new AppError(502, "Could not reach Safaricom. Try again shortly.");
    throw e;
  }
  if (!out.ok) throw new AppError(502, `Safaricom did not accept the notification addresses: ${out.message}`);
  const version = conn.settingsVersion;
  const cfg = (conn.config ?? {}) as Record<string, string>;
  const saved = await prisma.integrationConnection.updateMany({
    where: { id: conn.id, settingsVersion: version },
    data: { config: { ...cfg, c2bTokenHash: sha256(token), c2bEnvironment: conn.environment, c2bShortCode: creds.shortcode, c2bRegisteredAt: new Date().toISOString() }, updatedAt: new Date() },
  });
  if (saved.count !== 1) throw new AppError(409, "The M-PESA settings changed while registering. Try again.");
  await recordIntegrationAudit(actor, "mpesa", conn.id, "c2b_registered", { environment: conn.environment, shortcode: creds.shortcode });
  return { registered: true };
}

/** Sandbox only. Asks Safaricom to simulate a customer payment so you can watch it arrive on the statement. */
export async function simulateC2bPayment(actor: IntegrationActor, amount: unknown, billRef: unknown) {
  const { conn, creds, transactionType } = await loadMpesa(actor.businessId, false);
  if (conn.environment !== "sandbox") throw new AppError(409, "Test payments exist only in the Safaricom sandbox");
  if (!c2bRegistered(conn)) throw new AppError(409, "Register the notification addresses first");
  const cents = parseMoney(amount, "Amount");
  if (cents <= 0n || cents % 100n !== 0n || cents > 25_000_000n) throw new AppError(400, "Test amount must be whole shillings, 1 to 250,000");
  const ref = String(billRef ?? "TEST").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 20) || "TEST";
  try {
    const out = await simulateC2b(creds, Number(cents / 100n), ref, transactionType === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline");
    if (!out.ok) throw new AppError(502, `Safaricom did not accept the test payment: ${out.message}`);
  } catch (e) {
    if (e instanceof DarajaAuthError) throw new AppError(409, "Safaricom rejected the saved credentials. Re-test them in Settings.");
    if (e instanceof DarajaNetworkError) throw new AppError(502, "Could not reach Safaricom. Try again shortly.");
    throw e;
  }
  return { sent: true };
}

const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : null);

/** "20260314093015" (Nairobi time) -> Date, or null when it is not a real timestamp. */
export function parseTransTime(raw: unknown): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(raw ?? ""));
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, se)); // the wall-clock reading, checked for real
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d || local.getUTCHours() !== h) return null;
  return new Date(local.getTime() - 3 * 3600_000); // Nairobi is UTC+3 all year
}

async function findByToken(connectionPublicId: string, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(connectionPublicId) || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const conn = await prisma.integrationConnection.findFirst({ where: { publicId: connectionPublicId, provider: "mpesa" } });
  const cfg = (conn?.config ?? {}) as Record<string, string>;
  if (!conn || !cfg.c2bTokenHash || !c2bRegistered(conn)) return null;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(cfg.c2bTokenHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return conn;
}

/** Safaricom's "validation" call (only sent if Safaricom enabled it for the shortcode). We never block a payment. */
export async function handleC2bValidation(connectionPublicId: string, token: string) {
  const conn = await findByToken(connectionPublicId, token);
  return conn ? { ResultCode: "0", ResultDesc: "Accepted" } : null;
}

/**
 * Safaricom's confirmation: "this payment happened". Recorded once per receipt. NOTE: Safaricom does not sign these and
 * there is no query to double-check them, so a row is a REPORT, shown as such, and never settles a sale.
 * Returns null for an address that is not ours (answered 404); otherwise always the acknowledgement Safaricom expects.
 */
export async function handleC2bConfirmation(connectionPublicId: string, token: string, body: any) {
  const conn = await findByToken(connectionPublicId, token);
  if (!conn) return null;
  const cfg = (conn.config ?? {}) as Record<string, string>;
  const reject = async (reason: string) => {
    await prisma.integrationEvent.create({ data: { businessId: conn.businessId, connectionId: conn.id, type: "c2b_confirmation", status: "rejected", payload: { reason } } });
    return reply(true); // acknowledged so Safaricom does not keep retrying junk
  };
  const transId = typeof body?.TransID === "string" ? body.TransID.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{10}$/.test(transId)) return reject("bad receipt number");
  if (String(body?.BusinessShortCode ?? "") !== cfg.businessShortcode) return reject("a different shortcode");
  let cents: bigint;
  try { cents = parseMoney(String(body?.TransAmount ?? ""), "Amount"); } catch { return reject("bad amount"); }
  if (cents <= 0n) return reject("bad amount");
  const when = parseTransTime(body?.TransTime);
  if (!when) return reject("bad time");
  try {
    await prisma.mpesaC2bPayment.create({
      data: {
        businessId: conn.businessId, connectionId: conn.id, environment: conn.environment, transId, transTime: when, amountCents: cents,
        shortCode: cfg.businessShortcode!, transType: clip(body.TransactionType, 40), billRef: clip(body.BillRefNumber, 60),
        invoiceNumber: clip(body.InvoiceNumber, 60), msisdn: clip(body.MSISDN, 30),
        firstName: clip(body.FirstName, 60), middleName: clip(body.MiddleName, 60), lastName: clip(body.LastName, 60),
      },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already recorded: fine
  }
  return reply(true);
}

const nairobiDayStart = (now = new Date()) => {
  const t = new Date(now.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 3 * 3600_000);
};

/** The live statement. Newest first; the screen polls this every few seconds. */
export async function listStatement(businessId: bigint, opts: { limit?: unknown; before?: unknown; q?: unknown }) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const conn = await prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider: "mpesa" } } });
  const where: Prisma.MpesaC2bPaymentWhereInput = { businessId };
  const q = typeof opts.q === "string" ? opts.q.trim().slice(0, 40) : "";
  if (q) where.OR = [{ transId: { contains: q.toUpperCase() } }, { billRef: { contains: q, mode: "insensitive" } }, { msisdn: { contains: q } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }];
  if (typeof opts.before === "string" && /^[0-9a-f-]{36}$/i.test(opts.before)) {
    const ref = await prisma.mpesaC2bPayment.findFirst({ where: { businessId, publicId: opts.before }, select: { id: true } });
    if (ref) where.id = { lt: ref.id };
  }
  const rows = await prisma.mpesaC2bPayment.findMany({ where, orderBy: { id: "desc" }, take: limit + 1 });
  const page = rows.slice(0, limit);
  // Which of these were also paid through a till prompt? (same Safaricom receipt)
  const stk = page.length
    ? await prisma.mpesaPaymentRequest.findMany({ where: { businessId, mpesaReceipt: { in: page.map((r) => r.transId) } }, select: { mpesaReceipt: true, saleId: true } })
    : [];
  const stkBy = new Map(stk.map((s) => [s.mpesaReceipt, s.saleId !== null]));
  const day = await prisma.mpesaC2bPayment.aggregate({ where: { businessId, transTime: { gte: nairobiDayStart() } }, _sum: { amountCents: true }, _count: true });
  const name = (r: (typeof page)[number]) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ") || null;
  return {
    c2b: { registered: !!conn && c2bRegistered(conn), environment: conn?.environment ?? null },
    today: { count: day._count, total: centsToString(day._sum.amountCents ?? 0n) },
    serverTime: new Date().toISOString(),
    items: page.map((r) => ({
      id: r.publicId, transId: r.transId, amount: centsToString(r.amountCents), transTime: r.transTime, receivedAt: r.receivedAt,
      transType: r.transType, billRef: r.billRef, phone: r.msisdn, name: name(r), environment: r.environment,
      viaTill: stkBy.has(r.transId) ? (stkBy.get(r.transId) ? "sale" : "prompt") : null,
    })),
    hasMore: rows.length > limit,
  };
}
