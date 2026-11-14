import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { centsToString, parseMoney } from "../lib/money.js";

const MAX_CENTS = 999_999_999_999n;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpenseData = {
  category?: unknown; description?: unknown; amount?: unknown; expenseDate?: unknown;
  paymentMethod?: unknown; reference?: unknown; notes?: unknown;
};

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppError(400, `${field} must be text`);
  const t = value.trim();
  if (t.length > max) throw new AppError(400, `${field} must be at most ${max} characters`);
  return t || null;
}

/** Validates the supplied fields. `partial` (edit) lets fields be left out. */
function parse(data: ExpenseData, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (data.category !== undefined || !partial) {
    const category = text(data.category, "Category", 100);
    if (!category) throw new AppError(400, "Expense category is required");
    out.category = category;
  }
  if (data.amount !== undefined || !partial) {
    const cents = parseMoney(data.amount, "Expense amount");
    if (cents <= 0n) throw new AppError(400, "Expense amount must be greater than zero");
    if (cents > MAX_CENTS) throw new AppError(400, "Expense amount is out of range");
    out.amount = centsToString(cents);
  }
  if (data.description !== undefined) out.description = text(data.description, "Description", 2000);
  if (data.paymentMethod !== undefined) out.paymentMethod = text(data.paymentMethod, "Payment method", 50)?.toLowerCase() ?? null;
  if (data.reference !== undefined) out.reference = text(data.reference, "Reference", 100);
  if (data.notes !== undefined) out.notes = text(data.notes, "Notes", 2000);
  if (data.expenseDate !== undefined && data.expenseDate !== null && data.expenseDate !== "") {
    if (typeof data.expenseDate !== "string") throw new AppError(400, "Invalid expense date");
    const date = new Date(data.expenseDate);
    if (Number.isNaN(date.getTime())) throw new AppError(400, "Invalid expense date");
    const year = date.getUTCFullYear();
    if (year < 2000) throw new AppError(400, "Expense date is too far in the past");
    if (date.getTime() > Date.now() + DAY_MS) throw new AppError(400, "Expense date cannot be in the future");
    out.expenseDate = date;
  }
  return out;
}

type Row = {
  id: bigint; category: string; description: string | null; amount: { toFixed(d: number): string };
  expenseDate: Date; paymentMethod: string | null; reference: string | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
};

function format(e: Row) {
  return {
    id: e.id.toString(), category: e.category, description: e.description,
    amount: e.amount.toFixed(2), expenseDate: e.expenseDate, paymentMethod: e.paymentMethod,
    reference: e.reference, notes: e.notes, createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

async function findOwn(businessId: string, idText: string) {
  if (!/^[1-9]\d*$/.test(idText)) throw new AppError(404, "Expense not found");
  const row = await prisma.expense.findFirst({ where: { id: BigInt(idText), businessId: BigInt(businessId) } });
  if (!row) throw new AppError(404, "Expense not found");
  return row;
}

export async function getBusinessExpenses(businessId: string) {
  const rows = await prisma.expense.findMany({
    where: { businessId: BigInt(businessId) },
    orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
  });
  return rows.map(format);
}

export async function getBusinessExpenseById(businessId: string, idText: string) {
  return format(await findOwn(businessId, idText));
}

export async function createBusinessExpense(businessId: string, data: ExpenseData, actorUserId?: string) {
  const fields = parse(data, false) as any;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({ data: { ...fields, businessId: BigInt(businessId) } });
    await tx.auditLog.create({
      data: {
        businessId: BigInt(businessId), userId: actorUserId ? BigInt(actorUserId) : null,
        action: "expense.create", entity: "expense", entityId: created.id,
        details: { category: created.category, amount: created.amount.toFixed(2) },
      },
    });
    return created;
  });
  return format(row);
}

export async function updateBusinessExpense(businessId: string, idText: string, data: ExpenseData, actorUserId?: string) {
  const before = await findOwn(businessId, idText);
  const fields = parse(data, true) as any;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({ where: { id: before.id }, data: { ...fields, updatedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        businessId: BigInt(businessId), userId: actorUserId ? BigInt(actorUserId) : null,
        action: "expense.update", entity: "expense", entityId: before.id,
        details: { before: format(before), after: format(updated) },
      },
    });
    return updated;
  });
  return format(row);
}

/** Deleting a money record keeps a full snapshot in the audit log. */
export async function deleteBusinessExpense(businessId: string, idText: string, reason: unknown, actorUserId?: string) {
  const why = text(reason, "Reason", 500);
  if (!why) throw new AppError(400, "A reason is required to delete an expense");
  const before = await findOwn(businessId, idText);
  await prisma.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id: before.id } });
    await tx.auditLog.create({
      data: {
        businessId: BigInt(businessId), userId: actorUserId ? BigInt(actorUserId) : null,
        action: "expense.delete", entity: "expense", entityId: before.id,
        details: { reason: why, snapshot: format(before) },
      },
    });
  });
  return { id: before.id.toString() };
}
