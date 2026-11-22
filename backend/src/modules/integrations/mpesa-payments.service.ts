import crypto from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { centsToString, parseMoney } from "../../lib/money.js";
import { recordIntegrationAudit, type IntegrationActor } from "./audit.js";
import { loadMpesa } from "./credentials.js";
import { DarajaAuthError, DarajaNetworkError, stkPush, stkQuery } from "./providers/mpesa/daraja.js";

const MAX_KES = 250_000; // Safaricom's per-transaction ceiling
const EXPIRY_MS = 5 * 60_000;
const RECHECK_MS = Number(process.env.MPESA_RECHECK_MS ?? 8_000); // never hammer Safaricom's query API
type Row = Prisma.MpesaPaymentRequestGetPayload<object>;

export function normalizePhone(raw: unknown): string {
  const d = String(raw ?? "").replace(/[\s\-()]/g, "").replace(/^\+/, "");
  const m = /^(?:254|0)([71]\d{8})$/.exec(d);
  if (!m) throw new AppError(400, "Enter a valid Safaricom number, e.g. 0712345678");
  return `254${m[1]}`;
}
const maskPhone = (p: string) => `254*****${p.slice(-3)}`;

const present = (r: Row) => ({
  id: r.publicId,
  status: r.status,
  amount: centsToString(r.amountCents),
  phone: maskPhone(r.phone),
  accountReference: r.accountReference,
  message: r.resultDesc,
  mpesaReceipt: r.mpesaReceipt,
  environment: r.environment,
  expiresAt: r.expiresAt,
  paidAt: r.paidAt,
  createdAt: r.createdAt,
});

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

function callbackBase(): string {
  const base = (process.env.PUBLIC_API_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(base) && !(process.env.NODE_ENV === "test" && base)) {
    throw new AppError(503, "The server's public HTTPS address is not set (PUBLIC_API_URL or APP_URL), so M-PESA cannot call back.");
  }
  return base;
}

async function event(row: Row, type: string, status: string, payload: object, key?: string) {
  try {
    await prisma.integrationEvent.create({
      data: { businessId: row.businessId, connectionId: row.connectionId, type, status, idempotencyKey: key ?? null, payload },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already recorded
  }
}

/** The only way a request becomes "paid". Safe to call repeatedly: a paid request is never changed again. */
async function markPaid(row: Row, receipt: string | null, via: string): Promise<Row> {
  try {
    const done = await prisma.mpesaPaymentRequest.updateMany({
      where: { id: row.id, status: { not: "paid" } },
      data: {
        status: "paid", paidAt: new Date(), paidAmountCents: row.amountCents, mpesaReceipt: receipt,
        resultCode: 0, resultDesc: "Payment received", updatedAt: new Date(),
      },
    });
    if (done.count === 1) {
      await event(row, "stk_paid", "ok", { via, receipt: !!receipt }, `paid:${row.id}`);
      if (row.createdByUserId) {
        await recordIntegrationAudit({ businessId: row.businessId, userId: row.createdByUserId }, "mpesa", row.connectionId, "payment_confirmed", {
          requestId: row.publicId, amountCents: String(row.amountCents), via,
        });
      }
    }
  } catch (e) {
    // A receipt already used by another request in this business: keep the money confirmed, flag the clash.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await prisma.mpesaPaymentRequest.updateMany({
        where: { id: row.id, status: { not: "paid" } },
        data: { status: "unconfirmed", resultDesc: "This M-PESA receipt was already used for another payment. Check with Safaricom.", updatedAt: new Date() },
      });
    } else throw e;
  }
  return prisma.mpesaPaymentRequest.findUniqueOrThrow({ where: { id: row.id } });
}

const terminalFor = (code: number): "cancelled" | "expired" | "failed" => (code === 1032 ? "cancelled" : code === 1037 ? "expired" : "failed");

async function markNotPaid(row: Row, code: number, message: string): Promise<Row> {
  await prisma.mpesaPaymentRequest.updateMany({
    where: { id: row.id, status: { notIn: ["paid"] } },
    data: { status: terminalFor(code), resultCode: code, resultDesc: message.slice(0, 200), updatedAt: new Date() },
  });
  return prisma.mpesaPaymentRequest.findUniqueOrThrow({ where: { id: row.id } });
}

export type CreateInput = { amount: unknown; phone: unknown; accountReference?: unknown; description?: unknown };

export async function createPaymentRequest(actor: IntegrationActor, input: CreateInput, idempotencyKey: string) {
  const cents = parseMoney(input.amount, "Amount");
  if (cents <= 0n) throw new AppError(400, "Amount must be more than zero");
  if (cents % 100n !== 0n) throw new AppError(400, "M-PESA STK Push takes whole shillings only");
  if (cents > BigInt(MAX_KES) * 100n) throw new AppError(400, `M-PESA allows at most KES ${MAX_KES.toLocaleString("en-KE")} per payment`);
  const phone = normalizePhone(input.phone);
  const ref = String(input.accountReference ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "nexaPOS";
  const description = String(input.description ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60) || "Payment";

  const existing = await prisma.mpesaPaymentRequest.findUnique({ where: { businessId_idempotencyKey: { businessId: actor.businessId, idempotencyKey } } });
  if (existing) {
    if (existing.amountCents !== cents || existing.phone !== phone) throw new AppError(409, "That Idempotency-Key was already used for a different payment");
    return { replayed: true, request: present(existing) };
  }

  const { conn, creds, transactionType, partyB } = await loadMpesa(actor.businessId, true);
  const base = callbackBase();

  const token = crypto.randomBytes(32).toString("base64url");
  let row: Row;
  try {
    row = await prisma.mpesaPaymentRequest.create({
      data: {
        businessId: actor.businessId, connectionId: conn.id, environment: conn.environment, amountCents: cents, phone,
        accountReference: ref, description, callbackTokenHash: sha256(token), idempotencyKey,
        createdByUserId: actor.userId, expiresAt: new Date(Date.now() + EXPIRY_MS),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.mpesaPaymentRequest.findUnique({ where: { businessId_idempotencyKey: { businessId: actor.businessId, idempotencyKey } } });
      if (again) return { replayed: true, request: present(again) };
    }
    throw e;
  }

  // The row exists BEFORE Safaricom is asked, so a fast callback can always find it.
  try {
    const out = await stkPush(creds, {
      amountKes: Number(cents / 100n), phone, partyB, transactionType, accountReference: ref, description,
      callbackUrl: `${base}/api/integrations/callbacks/mpesa/${token}`,
    });
    if (out.kind === "rejected") {
      row = await prisma.mpesaPaymentRequest.update({ where: { id: row.id }, data: { status: "failed", resultDesc: out.message, updatedAt: new Date() } });
      await event(row, "stk_push", "failed", { message: out.message });
    } else {
      row = await prisma.mpesaPaymentRequest.update({
        where: { id: row.id }, data: { checkoutRequestId: out.checkoutRequestId, merchantRequestId: out.merchantRequestId, updatedAt: new Date() },
      });
      await event(row, "stk_push", "accepted", { phone: maskPhone(phone), amountCents: String(cents) });
    }
  } catch (e) {
    if (e instanceof DarajaAuthError) {
      row = await prisma.mpesaPaymentRequest.update({ where: { id: row.id }, data: { status: "failed", resultDesc: "Safaricom rejected the saved M-PESA credentials. Re-test them in Settings.", updatedAt: new Date() } });
    } else if (e instanceof DarajaNetworkError) {
      // The prompt may or may not have reached the phone: do not claim either. The cashier must check before retrying.
      row = await prisma.mpesaPaymentRequest.update({
        where: { id: row.id },
        data: { status: "unconfirmed", resultDesc: "Could not confirm whether the prompt was sent. Check with the customer before trying again.", updatedAt: new Date() },
      });
    } else throw e;
    await event(row, "stk_push", row.status, { message: row.resultDesc });
  }
  await recordIntegrationAudit(actor, "mpesa", conn.id, "payment_requested", { requestId: row.publicId, amountCents: String(cents), status: row.status });
  return { replayed: false, request: present(row) };
}

export async function getPaymentRequest(businessId: bigint, publicId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid payment request id");
  let row = await prisma.mpesaPaymentRequest.findFirst({ where: { businessId, publicId } });
  if (!row) throw new AppError(404, "Payment request not found");

  const open = row.status === "pending" || row.status === "expired" || row.status === "unconfirmed" || row.status === "failed" || row.status === "cancelled";
  const due = !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > RECHECK_MS;
  const recent = Date.now() - row.createdAt.getTime() < 24 * 3600_000;
  if (open && row.checkoutRequestId && due && recent) {
    await prisma.mpesaPaymentRequest.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
    try {
      const { creds } = await loadMpesa(businessId, false);
      const q = await stkQuery(creds, row.checkoutRequestId);
      if (q.kind === "success") {
        const claim = row.callbackClaim as { receipt?: string; amountCents?: string } | null;
        const receipt = claim?.receipt && claim.amountCents === String(row.amountCents) ? claim.receipt : null;
        row = await markPaid(row, receipt, "status_query");
      } else if (q.kind === "failed" && row.status === "pending") {
        row = await markNotPaid(row, q.resultCode, q.message);
      }
    } catch (e) {
      if (!(e instanceof DarajaNetworkError || e instanceof DarajaAuthError || e instanceof AppError)) throw e;
      // Cannot ask right now: report what we know, never guess.
    }
  }
  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await prisma.mpesaPaymentRequest.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "expired", resultDesc: "The customer did not complete the payment in time", updatedAt: new Date() },
    });
    row = await prisma.mpesaPaymentRequest.findUniqueOrThrow({ where: { id: row.id } });
  }
  return present(row);
}

/**
 * Safaricom's callback. Anyone who learns the URL could post to it, so a callback is only a hint: it is matched to
 * the request by its secret token AND checkout id, and "paid" is set only after Safaricom's own status query agrees.
 * Always answers 200 so Safaricom does not keep retrying; unknown tokens get a 404 and nothing is touched.
 */
export async function handleCallback(token: string, body: any): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return false;
  const row = await prisma.mpesaPaymentRequest.findUnique({ where: { callbackTokenHash: sha256(token) } });
  if (!row) return false;

  const cb = body?.Body?.stkCallback;
  const checkoutId = cb?.CheckoutRequestID;
  const code = Number(cb?.ResultCode);
  if (!cb || typeof checkoutId !== "string" || !Number.isInteger(code) || !row.checkoutRequestId || checkoutId !== row.checkoutRequestId) {
    await event(row, "stk_callback", "rejected", { reason: "did not match this request" });
    return true;
  }

  const items: { Name?: string; Value?: unknown }[] = Array.isArray(cb.CallbackMetadata?.Item) ? cb.CallbackMetadata.Item : [];
  const meta = (n: string) => items.find((i) => i?.Name === n)?.Value;
  const receipt = typeof meta("MpesaReceiptNumber") === "string" && /^[A-Z0-9]{10}$/.test(String(meta("MpesaReceiptNumber"))) ? String(meta("MpesaReceiptNumber")) : null;
  const amount = Number(meta("Amount"));
  await event(row, "stk_callback", code === 0 ? "success" : "not_paid", { resultCode: code, resultDesc: String(cb.ResultDesc ?? "").slice(0, 120), receipt: !!receipt }, `cb:${checkoutId}:${code}`);

  if (row.status === "paid") return true;

  if (code !== 0) {
    await markNotPaid(row, code, String(cb.ResultDesc ?? "Payment was not completed"));
    return true;
  }

  if (!receipt || !Number.isFinite(amount) || BigInt(Math.round(amount * 100)) !== row.amountCents) {
    await prisma.mpesaPaymentRequest.update({
      where: { id: row.id },
      data: { status: "unconfirmed", resultDesc: "The payment details did not match this request. Check with Safaricom before accepting it.", updatedAt: new Date() },
    });
    return true;
  }
  await prisma.mpesaPaymentRequest.update({
    where: { id: row.id }, data: { callbackClaim: { receipt, amountCents: String(row.amountCents) } },
  });

  try {
    const { creds } = await loadMpesa(row.businessId, false);
    const q = await stkQuery(creds, row.checkoutRequestId);
    if (q.kind === "success") await markPaid({ ...row, callbackClaim: null }, receipt, "callback+query");
  } catch (e) {
    if (!(e instanceof DarajaNetworkError || e instanceof DarajaAuthError || e instanceof AppError)) throw e;
    // Could not verify right now: stays unpaid; the status check completes it once Safaricom answers.
  }
  return true;
}

/** All a till needs to know: can it offer "send request to phone"? Says nothing about credentials or settings. */
export async function mpesaStatusForTill(businessId: bigint) {
  const c = await prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider: "mpesa" } }, select: { isEnabled: true, environment: true } });
  return { enabled: !!c?.isEnabled, environment: c?.isEnabled ? c.environment : null };
}

/**
 * What needs a person's attention. Read-only.
 *  - unlinked: Safaricom confirmed the money but no sale used it (customer paid, sale never completed).
 *  - review:   "unconfirmed" requests: we could not tell whether the customer paid.
 */
export async function listAttention(businessId: bigint) {
  const [unlinked, review] = await Promise.all([
    prisma.mpesaPaymentRequest.findMany({ where: { businessId, status: "paid", saleId: null }, orderBy: { paidAt: "desc" }, take: 100 }),
    prisma.mpesaPaymentRequest.findMany({ where: { businessId, status: "unconfirmed", createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const ids = [...new Set([...unlinked, ...review].map((r) => r.createdByUserId).filter((x): x is bigint => x !== null))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const row = (r: Row) => ({ ...present(r), paidAt: r.paidAt, requestedBy: r.createdByUserId ? name.get(r.createdByUserId) ?? null : null });
  return { unlinked: unlinked.map(row), review: review.map(row) };
}
