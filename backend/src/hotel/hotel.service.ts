import { createHash } from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";
import { createBusinessSale, previewBusinessSale } from "../sales/sale.service.js";
import { assertWithinStayLimit, linkSale, stayForCharge, stayInternalId, withStayLock } from "./stays.service.js";

/**
 * Tables and open orders. An order is a running list of what a table has asked for. Nothing is sold, taken from stock or
 * paid until the order is billed; billing hands the lines to the normal sale code, so receipts, VAT, payments and reports
 * are the same as any other sale. Prices are copied onto each line when it is added, so a menu price change never
 * alters a bill that is already open.
 */

const clean = (v: unknown, max: number, label: string, required = false) => {
  const t = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  if (required && !t) throw new AppError(400, `${label} is required`);
  if (t.length > max) throw new AppError(400, `${label} must be at most ${max} characters`);
  return t || null;
};
const posInt = (v: unknown, label: string, max: number) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new AppError(400, `${label} must be a whole number from 1 to ${max}`);
  return n;
};

const dec = (v: { toString(): string }) => v.toString();

// ---------- money helpers (whole cents, never floating-point drift on totals) ----------
type Addon = { name: string; price: string };
const toCents = (v: number | string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);
const addonList = (raw: unknown): Addon[] => (Array.isArray(raw) ? (raw as Addon[]) : []);
const addonCents = (raw: unknown) => addonList(raw).reduce((s, a) => s + toCents(a.price), 0);
/** One unit of a line costs the dish plus its add-ons. */
const unitCents = (i: { unitPrice: { toString(): string }; addons: unknown }) => toCents(dec(i.unitPrice)) + addonCents(i.addons);
const lineCents = (i: { unitPrice: { toString(): string }; addons: unknown; quantity: { toString(): string } }) => Math.round(unitCents(i) * Number(dec(i.quantity)));
const pct = (base: number, rate: { toString(): string }) => Math.round((base * Math.round(Number(dec(rate)) * 100)) / 10000);
type Charges = { serviceCharge: number; cateringLevy: number };
const chargesFor = (baseCents: number, b: { serviceChargeRate: { toString(): string }; cateringLevyRate: { toString(): string } }): Charges =>
  ({ serviceCharge: pct(baseCents, b.serviceChargeRate), cateringLevy: pct(baseCents, b.cateringLevyRate) });

// ---------- tables ----------
export async function listTables(businessId: bigint, branchId: bigint) {
  const tables = await prisma.diningTable.findMany({
    where: { businessId, branchId, isActive: true },
    orderBy: { name: "asc" },
    include: { orders: { where: { status: "open" }, include: { items: { where: { voidedAt: null, saleId: null } } } } },
  });
  return tables.map((t) => {
    const open = t.orders[0];
    const total = open ? open.items.reduce((sum, i) => sum + lineCents(i), 0) / 100 : 0;
    return {
      id: t.publicId, name: t.name, seats: t.seats,
      openOrder: open ? { id: open.publicId, guestName: open.guestName, covers: open.covers, openedAt: open.openedAt, itemCount: open.items.length, runningTotal: total.toFixed(2) } : null,
    };
  });
}

export async function createTable(businessId: bigint, branchId: bigint, body: { name?: unknown; seats?: unknown }) {
  const name = clean(body.name, 60, "Table name", true)!;
  const seats = posInt(body.seats, "Seats", 500);
  try {
    const t = await prisma.diningTable.create({ data: { businessId, branchId, name, seats } });
    return { id: t.publicId, name: t.name, seats: t.seats };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError(409, "This branch already has a table with that name");
    throw e;
  }
}

export async function deleteTable(businessId: bigint, publicIdText: string) {
  const t = await prisma.diningTable.findFirst({ where: { publicId: requirePublicId(publicIdText, "Invalid table"), businessId, isActive: true } });
  if (!t) throw new AppError(404, "Table not found");
  if (await prisma.tableOrder.count({ where: { tableId: t.id, status: "open" } })) throw new AppError(409, "This table has an open order. Bill or cancel it first.");
  // Kept (not deleted): past orders still point at it.
  await prisma.diningTable.update({ where: { id: t.id }, data: { isActive: false, name: `${t.name} (removed ${t.id})`.slice(0, 60), updatedAt: new Date() } });
}

// ---------- orders ----------
async function loadOrder(businessId: bigint, publicIdText: string) {
  const o = await prisma.tableOrder.findFirst({
    where: { publicId: requirePublicId(publicIdText, "Invalid order"), businessId },
    include: { table: true, items: { orderBy: { createdAt: "asc" }, include: { sale: { select: { receiptNumber: true } } } }, sale: { select: { publicId: true, receiptNumber: true } } },
  });
  if (!o) throw new AppError(404, "Order not found");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { serviceChargeRate: true, cateringLevyRate: true } });
  return { ...o, business };
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;
function formatOrder(o: LoadedOrder) {
  // Totals cover what is still to be billed; lines already billed on a part-bill are shown as paid.
  const live = o.items.filter((i) => !i.voidedAt && !i.saleId);
  const base = live.reduce((s, i) => s + lineCents(i), 0);
  const ch = chargesFor(base, o.business);
  return {
    id: o.publicId, status: o.status, tableId: o.table.publicId, tableName: o.table.name,
    guestName: o.guestName, covers: o.covers, notes: o.notes, openedAt: o.openedAt, closedAt: o.closedAt,
    sale: o.sale ? { id: o.sale.publicId, receiptNumber: o.sale.receiptNumber } : null,
    // Food and drink only. The charges are what the bill will add when billed (before VAT, which the server works out then).
    runningTotal: fromCents(base),
    serviceChargeRate: dec(o.business.serviceChargeRate), cateringLevyRate: dec(o.business.cateringLevyRate),
    serviceCharge: fromCents(ch.serviceCharge), cateringLevy: fromCents(ch.cateringLevy),
    estimatedTotal: fromCents(base + ch.serviceCharge + ch.cateringLevy),
    items: o.items.map((i) => ({
      id: i.publicId, name: i.name, unitPrice: dec(i.unitPrice), quantity: dec(i.quantity), addons: addonList(i.addons),
      note: i.note, sentAt: i.sentAt, voidedAt: i.voidedAt, voidReason: i.voidReason, lineTotal: fromCents(lineCents(i)),
      billedReceipt: i.sale?.receiptNumber ?? null,
    })),
  };
}

export const getOrder = async (businessId: bigint, id: string) => formatOrder(await loadOrder(businessId, id));

export async function openOrder(businessId: bigint, branchId: bigint, userId: bigint, tableIdText: string, body: { guestName?: unknown; covers?: unknown; notes?: unknown }) {
  const table = await prisma.diningTable.findFirst({ where: { publicId: requirePublicId(tableIdText, "Invalid table"), businessId, branchId, isActive: true } });
  if (!table) throw new AppError(404, "Table not found");
  try {
    const o = await prisma.tableOrder.create({
      data: { businessId, branchId, tableId: table.id, openedBy: userId, guestName: clean(body.guestName, 100, "Guest name"), covers: posInt(body.covers, "Covers", 500), notes: clean(body.notes, 300, "Notes") },
    });
    return getOrder(businessId, o.publicId);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError(409, "This table already has an open order");
    throw e;
  }
}

async function openOrderOrThrow(businessId: bigint, id: string) {
  const o = await loadOrder(businessId, id);
  if (o.status !== "open") throw new AppError(409, `This order is already ${o.status}`);
  return o;
}

export async function addItem(businessId: bigint, orderIdText: string, body: { productId?: unknown; quantity?: unknown; note?: unknown; addonIds?: unknown }) {
  const order = await openOrderOrThrow(businessId, orderIdText);
  const qty = Number(body.quantity ?? 1);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000 || Math.round(qty * 1000) / 1000 !== qty) throw new AppError(400, "Quantity must be a positive number (up to 3 decimals)");
  const product = await prisma.product.findFirst({ where: { publicId: requirePublicId(String(body.productId ?? ""), "Choose a menu item"), businessId, isActive: true } });
  if (!product) throw new AppError(404, "Menu item not found");
  if (!product.isAvailable) throw new AppError(409, `${product.name} is sold out`);
  const note = clean(body.note, 200, "Note");
  const addons = await resolveAddons(businessId, body.addonIds);
  const addonKey = JSON.stringify(addons);
  // Same item, note and add-ons, not yet sent: add to the existing line instead of repeating it.
  const same = order.items.find((i) => i.productId === product.id && !i.voidedAt && !i.saleId && !i.sentAt && (i.note ?? null) === note && JSON.stringify(addonList(i.addons)) === addonKey);
  if (same) {
    await prisma.tableOrderItem.update({ where: { id: same.id }, data: { quantity: (Number(same.quantity) + qty).toFixed(3) } });
  } else {
    await prisma.tableOrderItem.create({ data: { businessId, orderId: order.id, productId: product.id, name: product.name, unitPrice: product.sellingPrice, quantity: qty.toFixed(3), note, ...(addons.length && { addons }) } });
  }
  await prisma.tableOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
  return getOrder(businessId, orderIdText);
}

/** Change how many of an unsent line. Lines already sent to the kitchen are removed with a reason instead. */
export async function setItemQuantity(businessId: bigint, orderIdText: string, itemIdText: string, body: { quantity?: unknown }) {
  const order = await openOrderOrThrow(businessId, orderIdText);
  const item = order.items.find((i) => i.publicId === requirePublicId(itemIdText, "Invalid item") && !i.voidedAt);
  if (!item) throw new AppError(404, "Item not found on this order");
  if (item.saleId) throw new AppError(409, "This item has already been billed.");
  if (item.sentAt) throw new AppError(409, "This item was already sent to the kitchen. Remove it with a reason and add it again.");
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000 || Math.round(qty * 1000) / 1000 !== qty) throw new AppError(400, "Quantity must be a positive number (up to 3 decimals)");
  await prisma.tableOrderItem.update({ where: { id: item.id }, data: { quantity: qty.toFixed(3) } });
  return getOrder(businessId, orderIdText);
}

export async function removeItem(businessId: bigint, orderIdText: string, itemIdText: string, body: { reason?: unknown }) {
  const order = await openOrderOrThrow(businessId, orderIdText);
  const item = order.items.find((i) => i.publicId === requirePublicId(itemIdText, "Invalid item") && !i.voidedAt);
  if (!item) throw new AppError(404, "Item not found on this order");
  if (item.saleId) throw new AppError(409, "This item has already been billed.");
  if (!item.sentAt) {
    await prisma.tableOrderItem.delete({ where: { id: item.id } }); // never sent to the kitchen: simply take it off
  } else {
    const reason = clean(body.reason, 200, "Reason");
    if (!reason || reason.length < 3) throw new AppError(400, "Give a reason for removing an item already sent to the kitchen");
    await prisma.tableOrderItem.update({ where: { id: item.id }, data: { voidedAt: new Date(), voidReason: reason } });
  }
  return getOrder(businessId, orderIdText);
}

/** Marks every unsent line as sent to the kitchen/bar and returns what was sent (for the kitchen ticket). */
export async function sendToKitchen(businessId: bigint, orderIdText: string) {
  const order = await openOrderOrThrow(businessId, orderIdText);
  const unsent = order.items.filter((i) => !i.sentAt && !i.voidedAt);
  if (unsent.length === 0) throw new AppError(409, "Nothing new to send");
  const now = new Date();
  await prisma.tableOrderItem.updateMany({ where: { id: { in: unsent.map((i) => i.id) }, sentAt: null }, data: { sentAt: now } });
  return { order: await getOrder(businessId, orderIdText), sent: unsent.map((i) => ({ name: i.name, quantity: dec(i.quantity), note: i.note, addons: addonList(i.addons).map((a) => a.name) })), sentAt: now };
}

export async function cancelOrder(businessId: bigint, orderIdText: string, body: { reason?: unknown }) {
  const order = await openOrderOrThrow(businessId, orderIdText);
  if (order.items.some((i) => i.saleId)) throw new AppError(409, "Part of this order has already been billed. Bill the rest instead.");
  const reason = clean(body.reason, 200, "Reason");
  if (order.items.some((i) => i.sentAt && !i.voidedAt) && (!reason || reason.length < 3)) throw new AppError(400, "Give a reason: some items were already sent to the kitchen");
  const done = await prisma.tableOrder.updateMany({ where: { id: order.id, status: "open" }, data: { status: "cancelled", closedAt: new Date(), notes: reason ? `Cancelled: ${reason}`.slice(0, 300) : order.notes, updatedAt: new Date() } });
  if (done.count === 0) throw new AppError(409, "This order is no longer open");
  return getOrder(businessId, orderIdText);
}

type BillBody = {
  /** Bill only these lines (split bill). Omit to bill everything not yet billed. */
  itemIds?: unknown;
  amountPaid?: unknown; paymentMethod?: unknown; paymentReference?: unknown; customerId?: unknown; discount?: unknown; tax?: unknown;
  mpesaPaymentRequestId?: unknown; pesapalPaymentRequestId?: unknown;
  /** Charge the bill to this in-house guest's room account instead of taking payment now. */
  stayId?: unknown;
};

/** One bill at a time per order: two tills billing the same lines can never both succeed. */
function withOrderLock<T>(orderId: bigint, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(${orderId}::bigint)`;
    return fn();
  }, { timeout: 60_000, maxWait: 15_000 });
}

const saleSummary = (s: { publicId: string; receiptNumber: string; subtotal: { toString(): string }; discount: { toString(): string }; tax: { toString(): string }; total: { toString(): string }; amountPaid: { toString(): string }; balanceDue: { toString(): string }; pricesIncludeVat: boolean }) =>
  ({ id: s.publicId, receiptNumber: s.receiptNumber, subtotal: dec(s.subtotal), discount: dec(s.discount), tax: dec(s.tax), total: dec(s.total), amountPaid: dec(s.amountPaid), balanceDue: dec(s.balanceDue), pricesIncludeVat: s.pricesIncludeVat });

/**
 * Bills the order, or a chosen part of it (split bill): creates one ordinary sale from the lines being billed, marks
 * those lines as billed, and closes the order once nothing is left. Each sale carries an idempotency key made from the
 * exact set of lines, so pressing "Bill" twice (or a retry after a dropped connection) never creates a second sale, and
 * a line can only ever be billed once.
 */
export async function billOrder(businessId: bigint, userId: bigint, orderIdText: string, body: BillBody) {
  const first = await loadOrder(businessId, orderIdText);
  const stayText = body.stayId === undefined || body.stayId === null || body.stayId === "" ? null : String(body.stayId);
  if (stayText && body.amountPaid !== undefined && Number(body.amountPaid) > 0) throw new AppError(400, "A bill charged to a room is not paid at the till. Remove the payment amount.");
  if (!stayText) return withOrderLock(first.id, () => billLocked(businessId, userId, orderIdText, body, null));
  // Order lock first, then the room's lock (always in this order, so two tills can never wait on each other).
  const stayId = await stayInternalId(businessId, stayText);
  return withOrderLock(first.id, () => withStayLock(stayId, () => billLocked(businessId, userId, orderIdText, body, stayText)));
}

async function billLocked(businessId: bigint, userId: bigint, orderIdText: string, body: BillBody, stayText: string | null) {
  const order = await loadOrder(businessId, orderIdText); // read again now that we hold the lock
  let chosen: typeof order.items | null = null;
  if (body.itemIds !== undefined) {
    if (!Array.isArray(body.itemIds) || body.itemIds.length === 0 || body.itemIds.length > 200) throw new AppError(400, "Choose the items to bill");
    const ids = new Set(body.itemIds.map((x) => requirePublicId(String(x), "Invalid item")));
    chosen = order.items.filter((i) => ids.has(i.publicId));
    if (chosen.length !== ids.size) throw new AppError(404, "An item was not found on this order");
    if (chosen.some((i) => i.voidedAt)) throw new AppError(409, "An item you chose was removed from the order");
    // The same request again (a retry): everything chosen was billed together on one sale, so answer with that sale.
    const billedOn = new Set(chosen.map((i) => i.saleId?.toString() ?? ""));
    if (billedOn.size === 1 && !billedOn.has("")) {
      const sale = await prisma.sale.findFirstOrThrow({ where: { id: chosen[0]!.saleId!, businessId } });
      return { order: formatOrder(await loadOrder(businessId, orderIdText)), sale: saleSummary(sale), alreadyBilled: true };
    }
    if (chosen.some((i) => i.saleId)) throw new AppError(409, "Some of the items you chose have already been billed");
  } else if (order.status === "billed" && order.sale) {
    const sale = await prisma.sale.findFirstOrThrow({ where: { id: order.saleId!, businessId } });
    return { order: formatOrder(order), sale: saleSummary(sale), alreadyBilled: true };
  }
  if (order.status !== "open") throw new AppError(409, `This order is ${order.status}`);
  const lines = chosen ?? order.items.filter((i) => !i.voidedAt && !i.saleId);
  if (lines.length === 0) throw new AppError(400, "There is nothing on this order to bill");

  // Only now (after the already-billed replies above) is the room checked: a retry after check-out still answers.
  const charge = stayText ? await stayForCharge(businessId, stayText) : null;

  const product = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, publicId: true } });
  const pid = new Map(product.map((p) => [p.id, p.publicId]));
  const items = lines.map((l) => ({ productId: pid.get(l.productId)!, quantity: Number(l.quantity), unitPrice: unitCents(l) / 100 }));
  // Service charge and catering levy (if the business set them) become ordinary lines on the same sale, so VAT, totals,
  // receipts and reports need no special handling. They are worked out on the food and drink being billed.
  const ch = chargesFor(lines.reduce((s, l) => s + lineCents(l), 0), order.business);
  for (const [kind, cents] of [["service", ch.serviceCharge], ["levy", ch.cateringLevy]] as const) {
    if (cents > 0) items.push({ productId: await chargeProductId(businessId, kind), quantity: 1, unitPrice: cents / 100 });
  }
  // The table's own prices (copied when each line was added) are what the guest was quoted. By default the bill is paid
  // in full at the exact total the server works out (VAT, discount included).
  const preview = await previewBusinessSale(businessId, { items, ...(body.discount !== undefined && { discount: body.discount }), ...(body.tax !== undefined && { tax: body.tax }) }, { trustedPrices: true });
  if (charge) assertWithinStayLimit(charge.stay, charge.owed, charge.limit, BigInt(Math.round(Number(preview.total) * 100)));
  const paid = charge ? 0 : body.amountPaid === undefined ? Number(preview.total) : Number(body.amountPaid);
  const method = body.paymentMethod !== undefined ? String(body.paymentMethod) : paid > 0 ? "cash" : undefined;

  const everyLine = order.items.filter((i) => !i.voidedAt);
  const wholeOrder = lines.length === everyLine.length;
  const key = wholeOrder ? `table-order-${order.publicId}` : `table-order-${order.publicId}-${createHash("sha1").update(lines.map((l) => l.publicId).sort().join(",")).digest("hex").slice(0, 20)}`;

  const sale = await createBusinessSale(
    businessId.toString(), userId.toString(),
    {
      amountPaid: paid,
      ...(method !== undefined && { paymentMethod: method }),
      ...(body.paymentReference !== undefined && { paymentReference: String(body.paymentReference) }),
      ...(charge ? { customerId: charge.stay.customer.publicId } : body.customerId ? { customerId: String(body.customerId) } : {}),
      ...(body.discount !== undefined && { discount: Number(body.discount) }),
      ...(body.tax !== undefined && { tax: Number(body.tax) }),
      ...(!charge && body.mpesaPaymentRequestId ? { mpesaPaymentRequestId: String(body.mpesaPaymentRequestId) } : {}),
      ...(!charge && body.pesapalPaymentRequestId ? { pesapalPaymentRequestId: String(body.pesapalPaymentRequestId) } : {}),
      channel: "walk_in",
      notes: `${charge ? `Room ${charge.stay.roomName} · ` : ""}${order.table.name}${order.guestName ? ` · ${order.guestName}` : ""}${wholeOrder ? "" : " (part bill)"}`.slice(0, 200),
      items,
    },
    { branchId: order.branchId, idempotencyKey: key, trustedPrices: true }
  );

  // Mark these lines billed; close the order when nothing is left to bill.
  const sold = await prisma.sale.findFirstOrThrow({ where: { publicId: sale.id, businessId }, select: { id: true } });
  if (charge) await linkSale(charge.stay.id, sold.id);
  await prisma.tableOrderItem.updateMany({ where: { id: { in: lines.map((l) => l.id) }, saleId: null }, data: { saleId: sold.id } });
  const left = await prisma.tableOrderItem.count({ where: { orderId: order.id, voidedAt: null, saleId: null } });
  if (left === 0) {
    await prisma.tableOrder.updateMany({ where: { id: order.id, status: "open" }, data: { status: "billed", saleId: sold.id, closedAt: new Date(), updatedAt: new Date() } });
  } else {
    await prisma.tableOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
  }
  return { order: await getOrder(businessId, orderIdText), sale, alreadyBilled: false, partBill: left > 0 };
}

/** The menu: active items grouped by category, with availability. */
export async function menu(businessId: bigint) {
  const items = await prisma.product.findMany({
    where: { businessId, isActive: true, OR: [{ sku: null }, { sku: { notIn: Object.values(CHARGE_SKU) } }] },
    orderBy: [{ name: "asc" }],
    select: { publicId: true, name: true, description: true, sellingPrice: true, isAvailable: true, tracksStock: true, unitOfMeasure: true, category: { select: { name: true } } },
  });
  return items.map((p) => ({ id: p.publicId, name: p.name, description: p.description, price: p.sellingPrice.toString(), available: p.isAvailable, madeToOrder: !p.tracksStock, unit: p.unitOfMeasure, category: p.category?.name ?? "Other" }));
}

// ---------- service charge & catering levy ----------
const CHARGE_SKU = { service: "SYS-SERVICE-CHARGE", levy: "SYS-CATERING-LEVY" } as const;
const CHARGE_NAME = { service: "Service charge", levy: "Catering levy" } as const;

/** The product the charge line is recorded against (made to order, hidden from the menu). Created the first time it is needed. */
async function chargeProductId(businessId: bigint, kind: keyof typeof CHARGE_SKU): Promise<string> {
  const sku = CHARGE_SKU[kind];
  const found = await prisma.product.findFirst({ where: { businessId, sku } });
  if (found) return found.publicId;
  try {
    return (await prisma.product.create({ data: { businessId, sku, name: CHARGE_NAME[kind], sellingPrice: 0, costPrice: 0, unitOfMeasure: "piece", tracksStock: false, isAvailable: false } })).publicId;
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    return (await prisma.product.findFirstOrThrow({ where: { businessId, sku } })).publicId; // created by a parallel bill
  }
}

const rate = (v: unknown, label: string) => {
  const n = Number(v);
  if (v === "" || v === null || !Number.isFinite(n) || n < 0 || n > 50 || Math.round(n * 100) / 100 !== n) throw new AppError(400, `${label} must be a percentage from 0 to 50, with at most 2 decimals`);
  return n.toFixed(2);
};
export async function getSettings(businessId: bigint) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { serviceChargeRate: true, cateringLevyRate: true } });
  return { serviceChargeRate: Number(dec(b.serviceChargeRate)).toFixed(2), cateringLevyRate: Number(dec(b.cateringLevyRate)).toFixed(2) };
}
export async function updateSettings(businessId: bigint, body: { serviceChargeRate?: unknown; cateringLevyRate?: unknown }) {
  const data: { serviceChargeRate?: string; cateringLevyRate?: string } = {};
  if (body.serviceChargeRate !== undefined) data.serviceChargeRate = rate(body.serviceChargeRate, "Service charge");
  if (body.cateringLevyRate !== undefined) data.cateringLevyRate = rate(body.cateringLevyRate, "Catering levy");
  if (Object.keys(data).length === 0) throw new AppError(400, "Nothing to change");
  await prisma.business.update({ where: { id: businessId }, data });
  return getSettings(businessId);
}

// ---------- add-ons ----------
export async function listAddons(businessId: bigint) {
  const rows = await prisma.menuAddon.findMany({ where: { businessId, isActive: true }, orderBy: { name: "asc" } });
  return rows.map((a) => ({ id: a.publicId, name: a.name, price: dec(a.price) }));
}
export async function createAddon(businessId: bigint, body: { name?: unknown; price?: unknown }) {
  const name = clean(body.name, 80, "Add-on name", true)!;
  const price = body.price === undefined || body.price === "" ? 0 : Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000 || Math.round(price * 100) / 100 !== price) throw new AppError(400, "Price must be zero or more, with at most 2 decimals");
  try {
    const a = await prisma.menuAddon.create({ data: { businessId, name, price: price.toFixed(2) } });
    return { id: a.publicId, name: a.name, price: dec(a.price) };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError(409, "There is already an add-on with that name");
    throw e;
  }
}
export async function deleteAddon(businessId: bigint, publicIdText: string) {
  const a = await prisma.menuAddon.findFirst({ where: { publicId: requirePublicId(publicIdText, "Invalid add-on"), businessId, isActive: true } });
  if (!a) throw new AppError(404, "Add-on not found");
  // Kept (not deleted) and renamed so the name can be reused; open bills already hold their own copy.
  await prisma.menuAddon.update({ where: { id: a.id }, data: { isActive: false, name: `${a.name} (removed ${a.id})`.slice(0, 80) } });
}
async function resolveAddons(businessId: bigint, raw: unknown): Promise<Addon[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) throw new AppError(400, "Choose at most 10 add-ons");
  const ids = [...new Set(raw.map((x) => requirePublicId(String(x), "Invalid add-on")))];
  const rows = await prisma.menuAddon.findMany({ where: { businessId, isActive: true, publicId: { in: ids } }, orderBy: { name: "asc" } });
  if (rows.length !== ids.length) throw new AppError(404, "An add-on was not found");
  return rows.map((a) => ({ name: a.name, price: dec(a.price) }));
}
