import crypto from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { centsToString, parseMoney } from "../../lib/money.js";
import { recordIntegrationAudit, type IntegrationActor } from "./audit.js";
import { loadPesapal } from "./credentials.js";
import { callbackBase } from "./mpesa-payments.service.js";
import {
  PesapalAuthError, PesapalNetworkError, getTransactionStatus, registerIpn, submitOrder,
} from "./providers/pesapal/client.js";

const MAX_KES = 10_000_000n; // sanity ceiling; Pesapal applies its own limits per merchant
const EXPIRY_MS = 30 * 60_000;
const RECHECK_MS = Number(process.env.PESAPAL_RECHECK_MS ?? 8_000); // never hammer Pesapal's status API
type Row = Prisma.PesapalPaymentRequestGetPayload<object>;

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function normalizeContact(rawPhone: unknown, rawEmail: unknown): { phone: string | null; email: string | null } {
  const p = String(rawPhone ?? "").replace(/[\s\-()]/g, "").replace(/^\+/, "");
  const e = String(rawEmail ?? "").trim();
  let phone: string | null = null;
  if (p) {
    if (!/^\d{9,15}$/.test(p)) throw new AppError(400, "Enter a valid phone number, e.g. 0712345678");
    phone = /^0\d{9}$/.test(p) ? `254${p.slice(1)}` : p;
  }
  let email: string | null = null;
  if (e) {
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AppError(400, "Enter a valid email address");
    email = e;
  }
  if (!phone && !email) throw new AppError(400, "Pesapal needs the customer's phone number or email address");
  return { phone, email };
}
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}*****${p.slice(-3)}` : null);

const present = (r: Row) => ({
  id: r.publicId,
  status: r.status,
  amount: centsToString(r.amountCents),
  currency: r.currency,
  phone: maskPhone(r.customerPhone),
  description: r.description,
  message: r.resultDesc,
  confirmationCode: r.confirmationCode,
  payMethod: r.payMethod,
  // The page the customer pays on. Useless (and hidden) once the order is settled.
  checkoutUrl: r.status === "pending" || r.status === "expired" ? r.redirectUrl : null,
  environment: r.environment,
  expiresAt: r.expiresAt,
  paidAt: r.paidAt,
  reversalNoticed: !!r.reversalNoticedAt,
  createdAt: r.createdAt,
});

async function event(row: Row, type: string, status: string, payload: object, key?: string) {
  try {
    await prisma.integrationEvent.create({
      data: { businessId: row.businessId, connectionId: row.connectionId, type, status, idempotencyKey: key ?? null, payload },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
}

const reload = (row: Row) => prisma.pesapalPaymentRequest.findUniqueOrThrow({ where: { id: row.id } });

/** The only way a request becomes "paid". Safe to call repeatedly: a paid request is never changed again. */
async function markPaid(row: Row, code: string | null, payMethod: string | null, via: string): Promise<Row> {
  try {
    const done = await prisma.pesapalPaymentRequest.updateMany({
      where: { id: row.id, status: { not: "paid" } },
      data: {
        status: "paid", paidAt: new Date(), paidAmountCents: row.amountCents, confirmationCode: code, payMethod,
        resultDesc: "Payment received", updatedAt: new Date(),
      },
    });
    if (done.count === 1) {
      await event(row, "pesapal_paid", "ok", { via, code: !!code }, `paid:${row.id}`);
      if (row.createdByUserId) {
        await recordIntegrationAudit({ businessId: row.businessId, userId: row.createdByUserId }, "pesapal", row.connectionId, "payment_confirmed", {
          requestId: row.publicId, amountCents: String(row.amountCents), via,
        });
      }
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await prisma.pesapalPaymentRequest.updateMany({
        where: { id: row.id, status: { not: "paid" } },
        data: { status: "unconfirmed", resultDesc: "This Pesapal confirmation code was already used for another payment. Check with Pesapal.", updatedAt: new Date() },
      });
    } else throw e;
  }
  return reload(row);
}

/**
 * Asks Pesapal what happened and records ONLY what Pesapal's own status answer proves.
 *  - COMPLETED is accepted only when currency is KES, the merchant reference is ours, and the amount is exactly what we asked.
 *  - A paid request is never downgraded: a later REVERSED is flagged (reversalNoticedAt) for a person to handle.
 */
async function verifyOrder(row: Row, via: string): Promise<Row> {
  if (!row.orderTrackingId) return row;
  await prisma.pesapalPaymentRequest.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
  try {
    const { creds } = await loadPesapal(row.businessId, false);
    const q = await getTransactionStatus(creds, row.orderTrackingId);
    if (q.kind === "completed") {
      const sameAmount = Number.isFinite(q.amount) && BigInt(Math.round(q.amount * 100)) === row.amountCents;
      if (q.currency !== "KES" || q.merchantReference !== row.merchantReference || !sameAmount) {
        if (row.status !== "paid") {
          await prisma.pesapalPaymentRequest.updateMany({
            where: { id: row.id, status: { not: "paid" } },
            data: { status: "unconfirmed", resultDesc: "Pesapal reported a payment that does not match this request. Check with Pesapal before accepting it.", updatedAt: new Date() },
          });
        }
        await event(row, "pesapal_status", "mismatch", { via }, `mm:${row.id}:${row.status}`);
        return reload(row);
      }
      return await markPaid(row, q.confirmationCode, q.payMethod, via);
    }
    if (q.kind === "failed" && (row.status === "pending" || row.status === "expired")) {
      await prisma.pesapalPaymentRequest.updateMany({
        where: { id: row.id, status: { in: ["pending", "expired"] } },
        data: { status: "failed", resultDesc: q.message, updatedAt: new Date() },
      });
    } else if (q.kind === "reversed") {
      if (row.status === "paid") {
        const done = await prisma.pesapalPaymentRequest.updateMany({
          where: { id: row.id, status: "paid", reversalNoticedAt: null },
          data: { reversalNoticedAt: new Date(), updatedAt: new Date() },
        });
        if (done.count === 1) await event(row, "pesapal_reversal", "noticed", { via }, `rev:${row.id}`);
      } else {
        await prisma.pesapalPaymentRequest.updateMany({
          where: { id: row.id, status: { not: "paid" } },
          data: { status: "reversed", resultDesc: q.message, updatedAt: new Date() },
        });
      }
    }
  } catch (e) {
    if (!(e instanceof PesapalNetworkError || e instanceof PesapalAuthError || e instanceof AppError)) throw e;
    // Cannot ask right now: report what we know, never guess.
  }
  return reload(row);
}

/** Registers the address Pesapal will notify. Needed once per set of credentials; the token in it is the credential. */
export async function registerPesapalIpn(actor: IntegrationActor) {
  const { conn, creds, cfg } = await loadPesapal(actor.businessId, false);
  const base = callbackBase();
  const token = crypto.randomBytes(32).toString("base64url");
  const version = conn.settingsVersion;
  let out;
  try {
    out = await registerIpn(creds, `${base}/api/integrations/callbacks/pesapal/${conn.publicId}/${token}`);
  } catch (e) {
    if (e instanceof PesapalAuthError) throw new AppError(409, "Pesapal rejected the saved credentials. Re-test them in Settings.");
    if (e instanceof PesapalNetworkError) throw new AppError(502, "Could not reach Pesapal. Try again shortly.");
    throw e;
  }
  if (!out.ok) throw new AppError(502, `Pesapal did not accept the notification address: ${out.message}`);
  // Only record it if the settings did not change while we were talking to Pesapal.
  const saved = await prisma.integrationConnection.updateMany({
    where: { id: conn.id, settingsVersion: version },
    data: { config: { ...cfg, ipnId: out.ipnId, ipnTokenHash: sha256(token), ipnVersion: String(version) }, updatedAt: new Date() },
  });
  if (saved.count !== 1) throw new AppError(409, "The Pesapal settings changed while registering. Try again.");
  await recordIntegrationAudit(actor, "pesapal", conn.id, "ipn_registered", {});
  return { ipnStatus: "registered" as const };
}

const ipnReady = (conn: { config: unknown; settingsVersion: number }) => {
  const c = (conn.config ?? {}) as Record<string, string>;
  return !!c.ipnId && Number(c.ipnVersion) === conn.settingsVersion;
};

export type CreateInput = { amount: unknown; phone?: unknown; email?: unknown; description?: unknown };

export async function createPesapalRequest(actor: IntegrationActor, input: CreateInput, idempotencyKey: string) {
  const cents = parseMoney(input.amount, "Amount");
  if (cents <= 0n) throw new AppError(400, "Amount must be more than zero");
  if (cents > MAX_KES * 100n) throw new AppError(400, "That amount is too large for one online payment");
  const { phone, email } = normalizeContact(input.phone, input.email);
  const description = String(input.description ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100) || "Payment";

  const existing = await prisma.pesapalPaymentRequest.findUnique({ where: { businessId_idempotencyKey: { businessId: actor.businessId, idempotencyKey } } });
  if (existing) {
    if (existing.amountCents !== cents) throw new AppError(409, "That Idempotency-Key was already used for a different payment");
    return { replayed: true, request: present(existing) };
  }

  const { conn, creds, cfg } = await loadPesapal(actor.businessId, true);
  if (!ipnReady(conn)) throw new AppError(409, "Pesapal notifications are not registered. Register them in Settings → Integrations first.");
  const base = callbackBase();

  const publicId = crypto.randomUUID();
  const merchantReference = `NX${publicId.replace(/-/g, "")}`;
  let row: Row;
  try {
    row = await prisma.pesapalPaymentRequest.create({
      data: {
        publicId, businessId: actor.businessId, connectionId: conn.id, environment: conn.environment, amountCents: cents,
        description, customerPhone: phone, customerEmail: email, merchantReference, idempotencyKey,
        createdByUserId: actor.userId, expiresAt: new Date(Date.now() + EXPIRY_MS),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.pesapalPaymentRequest.findUnique({ where: { businessId_idempotencyKey: { businessId: actor.businessId, idempotencyKey } } });
      if (again) return { replayed: true, request: present(again) };
    }
    throw e;
  }

  try {
    const out = await submitOrder(creds, {
      merchantReference, amountKes: centsToString(cents), description, callbackUrl: `${base}/api/integrations/pesapal/return`,
      ipnId: cfg.ipnId!, phone, email, merchantName: cfg.merchantName!,
    });
    if (out.kind === "rejected") {
      row = await prisma.pesapalPaymentRequest.update({ where: { id: row.id }, data: { status: "failed", resultDesc: out.message, updatedAt: new Date() } });
      await event(row, "pesapal_order", "failed", { message: out.message });
    } else {
      row = await prisma.pesapalPaymentRequest.update({ where: { id: row.id }, data: { orderTrackingId: out.orderTrackingId, redirectUrl: out.redirectUrl, updatedAt: new Date() } });
      await event(row, "pesapal_order", "created", { amountCents: String(cents) });
    }
  } catch (e) {
    if (e instanceof PesapalAuthError) {
      row = await prisma.pesapalPaymentRequest.update({ where: { id: row.id }, data: { status: "failed", resultDesc: "Pesapal rejected the saved credentials. Re-test them in Settings.", updatedAt: new Date() } });
    } else if (e instanceof PesapalNetworkError) {
      // The order may or may not exist at Pesapal and we have no tracking id to ask about: do not claim either.
      row = await prisma.pesapalPaymentRequest.update({ where: { id: row.id }, data: { status: "unconfirmed", resultDesc: "Could not confirm whether the payment page was created. Try again with a new request.", updatedAt: new Date() } });
    } else throw e;
    await event(row, "pesapal_order", row.status, { message: row.resultDesc });
  }
  await recordIntegrationAudit(actor, "pesapal", conn.id, "payment_requested", { requestId: row.publicId, amountCents: String(cents), status: row.status });
  return { replayed: false, request: present(row) };
}

export async function getPesapalRequest(businessId: bigint, publicId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid payment request id");
  let row = await prisma.pesapalPaymentRequest.findFirst({ where: { businessId, publicId } });
  if (!row) throw new AppError(404, "Payment request not found");

  const checkable = row.status !== "paid" || (row.saleId === null && !row.reversalNoticedAt);
  const due = !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > RECHECK_MS;
  const recent = Date.now() - row.createdAt.getTime() < 24 * 3600_000;
  if (checkable && row.orderTrackingId && due && recent) row = await verifyOrder(row, "status_check");

  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await prisma.pesapalPaymentRequest.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "expired", resultDesc: "The customer did not complete the payment in time", updatedAt: new Date() },
    });
    row = await reload(row);
  }
  return present(row);
}

/**
 * Pesapal's notification (IPN). The token in the address is the credential; the parameters are only a hint about WHICH
 * order to re-check. Nothing in them is trusted: the status always comes from Pesapal's own status API.
 * Returns the reply Pesapal expects, or null when the address is not ours (answered 404, nothing touched).
 */
export async function handlePesapalIpn(connectionPublicId: string, token: string, params: Record<string, unknown>) {
  if (!/^[0-9a-f-]{36}$/i.test(connectionPublicId) || typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const conn = await prisma.integrationConnection.findFirst({ where: { publicId: connectionPublicId, provider: "pesapal" } });
  const cfg = (conn?.config ?? {}) as Record<string, string>;
  if (!conn || !cfg.ipnTokenHash || Number(cfg.ipnVersion) !== conn.settingsVersion) return null;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(cfg.ipnTokenHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const str = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : "");
  const orderTrackingId = str(params.OrderTrackingId);
  const merchantRef = str(params.OrderMerchantReference);
  const notificationType = str(params.OrderNotificationType) || "IPNCHANGE";
  if (orderTrackingId) {
    const row = await prisma.pesapalPaymentRequest.findFirst({ where: { connectionId: conn.id, orderTrackingId } });
    if (row) {
      await event(row, "pesapal_ipn", "received", {}, undefined);
      await verifyOrder(row, "ipn");
    }
  }
  return { orderNotificationType: notificationType, orderTrackingId, orderMerchantReference: merchantRef, status: 200 };
}

/** All a till needs to know: can it offer Pesapal? Says nothing about credentials or settings. */
export async function pesapalStatusForTill(businessId: bigint) {
  const c = await prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider: "pesapal" } } });
  const enabled = !!c?.isEnabled && !!c && ipnReady(c);
  return { enabled, environment: enabled ? c!.environment : null };
}

/** What needs a person: paid-but-unused, unconfirmed, and reversed payments; plus what was already dismissed. */
export async function listPesapalAttention(businessId: bigint) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [unlinked, review, reversed, dismissed] = await Promise.all([
    prisma.pesapalPaymentRequest.findMany({ where: { businessId, status: "paid", saleId: null, reversalNoticedAt: null, dismissedAt: null }, orderBy: { paidAt: "desc" }, take: 100 }),
    prisma.pesapalPaymentRequest.findMany({ where: { businessId, status: "unconfirmed", dismissedAt: null, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.pesapalPaymentRequest.findMany({ where: { businessId, OR: [{ reversalNoticedAt: { not: null } }, { status: "reversed" }], dismissedAt: null, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.pesapalPaymentRequest.findMany({ where: { businessId, dismissedAt: { not: null } }, orderBy: { dismissedAt: "desc" }, take: 50 }),
  ]);
  const ids = [...new Set([...unlinked, ...review, ...reversed, ...dismissed].flatMap((r) => [r.createdByUserId, r.dismissedByUserId]).filter((x): x is bigint => x !== null))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const row = (r: Row) => ({
    ...present(r), requestedBy: r.createdByUserId ? name.get(r.createdByUserId) ?? null : null,
    dismissedAt: r.dismissedAt, dismissedNote: r.dismissedNote, dismissedBy: r.dismissedByUserId ? name.get(r.dismissedByUserId) ?? null : null,
  });
  return { unlinked: unlinked.map(row), review: review.map(row), reversed: reversed.map(row), dismissed: dismissed.map(row) };
}

function cleanNote(raw: unknown): string {
  const note = String(raw ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  if (note.length < 5) throw new AppError(400, "Write a reason of at least 5 characters (for example: refunded the customer in Pesapal, ref ...)");
  if (note.length > 300) throw new AppError(400, "The reason can be at most 300 characters");
  return note;
}

/** Closes a payment that needs attention. Never deletes anything or changes its status: who, when and why are kept. */
export async function dismissPesapalRequest(actor: IntegrationActor, publicId: string, rawNote: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid payment request id");
  const note = cleanNote(rawNote);
  const done = await prisma.pesapalPaymentRequest.updateMany({
    where: {
      publicId, businessId: actor.businessId, dismissedAt: null,
      OR: [{ status: "paid", saleId: null }, { status: "unconfirmed" }, { status: "reversed" }, { reversalNoticedAt: { not: null } }],
    },
    data: { dismissedAt: new Date(), dismissedByUserId: actor.userId, dismissedNote: note, updatedAt: new Date() },
  });
  if (done.count !== 1) {
    const r = await prisma.pesapalPaymentRequest.findFirst({ where: { publicId, businessId: actor.businessId } });
    if (!r) throw new AppError(404, "Payment request not found");
    throw new AppError(409, r.dismissedAt ? "That payment is already dismissed" : "Only a confirmed-but-unused, unconfirmed or reversed payment can be dismissed");
  }
  const row = await prisma.pesapalPaymentRequest.findFirstOrThrow({ where: { publicId, businessId: actor.businessId } });
  await recordIntegrationAudit(actor, "pesapal", row.connectionId, "payment_dismissed", { requestId: row.publicId, amountCents: String(row.amountCents), code: row.confirmationCode, note });
  return present(row);
}

export async function restorePesapalRequest(actor: IntegrationActor, publicId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid payment request id");
  const done = await prisma.pesapalPaymentRequest.updateMany({
    where: { publicId, businessId: actor.businessId, dismissedAt: { not: null } },
    data: { dismissedAt: null, dismissedByUserId: null, dismissedNote: null, updatedAt: new Date() },
  });
  if (done.count !== 1) throw new AppError(404, "No dismissed payment with that id");
  const row = await prisma.pesapalPaymentRequest.findFirstOrThrow({ where: { publicId, businessId: actor.businessId } });
  await recordIntegrationAudit(actor, "pesapal", row.connectionId, "payment_restored", { requestId: row.publicId, amountCents: String(row.amountCents) });
  return present(row);
}
