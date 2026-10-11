import prisma from "../lib/prisma.js";

type ExpenseData = {
  category: string;
  description?: string;
  amount: number;
  expenseDate?: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
};

export async function getBusinessExpenses(
  businessId: string
) {
  const expenses = await prisma.expense.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    orderBy: {
      expenseDate: "desc",
    },
  });

  return expenses.map((expense) => ({
    id: expense.id.toString(),
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    expenseDate: expense.expenseDate,
    paymentMethod: expense.paymentMethod,
    reference: expense.reference,
    notes: expense.notes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  }));
}

export async function getBusinessExpenseById(
  businessId: string,
  expenseId: string
) {
  const expense = await prisma.expense.findFirst({
    where: {
      id: BigInt(expenseId),
      businessId: BigInt(businessId),
    },
  });

  if (!expense) {
    throw new Error("Expense not found");
  }

  return {
    id: expense.id.toString(),
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    expenseDate: expense.expenseDate,
    paymentMethod: expense.paymentMethod,
    reference: expense.reference,
    notes: expense.notes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

export async function createBusinessExpense(
  businessId: string,
  data: ExpenseData
) {
  const category = data.category?.trim();
  const amount = Number(data.amount);

  if (!category) {
    throw new Error("Expense category is required");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Expense amount must be greater than zero");
  }

  let expenseDate: Date | undefined;

  if (data.expenseDate) {
    expenseDate = new Date(data.expenseDate);

    if (Number.isNaN(expenseDate.getTime())) {
      throw new Error("Invalid expense date");
    }
  }

  const expense = await prisma.expense.create({
    data: {
      businessId: BigInt(businessId),
      category,
      description: data.description?.trim() || null,
      amount,
      ...(expenseDate && {
        expenseDate,
      }),
      paymentMethod: data.paymentMethod?.trim().toLowerCase() || null,
      reference: data.reference?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  });

  return {
    id: expense.id.toString(),
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    expenseDate: expense.expenseDate,
    paymentMethod: expense.paymentMethod,
    reference: expense.reference,
    notes: expense.notes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}
