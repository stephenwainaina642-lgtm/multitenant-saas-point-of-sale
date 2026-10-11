import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessExpenses,
  getBusinessExpenseById,
  createBusinessExpense,
} from "./expense.service.js";

export async function getExpensesController(
  req: BusinessRequest,
  res: Response
) {
  try {
    if (!req.businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    const expenses = await getBusinessExpenses(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Expenses retrieved successfully",
      data: expenses,
    });
  } catch (error) {
    console.error("Get expenses error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve expenses",
    });
  }
}

export async function getExpenseByIdController(
  req: BusinessRequest,
  res: Response
) {
  try {
    if (!req.businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        message: "Expense ID is required",
      });
    }

    const expense = await getBusinessExpenseById(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Expense retrieved successfully",
      data: expense,
    });
  } catch (error) {
    console.error("Get expense error:", error);

    if (
      error instanceof Error &&
      error.message === "Expense not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve expense",
    });
  }
}

export async function createExpenseController(
  req: BusinessRequest,
  res: Response
) {
  try {
    if (!req.businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    const {
      category,
      description,
      amount,
      expenseDate,
      paymentMethod,
      reference,
      notes,
    } = req.body;

    const expense = await createBusinessExpense(
      req.businessId.toString(),
      {
        category: category ? String(category) : "",
        amount: Number(amount),

        ...(description !== undefined && {
          description: String(description),
        }),

        ...(expenseDate !== undefined && {
          expenseDate: String(expenseDate),
        }),

        ...(paymentMethod !== undefined && {
          paymentMethod: String(paymentMethod),
        }),

        ...(reference !== undefined && {
          reference: String(reference),
        }),

        ...(notes !== undefined && {
          notes: String(notes),
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Expense created successfully",
      data: expense,
    });
  } catch (error) {
    console.error("Create expense error:", error);

    if (
      error instanceof Error &&
      [
        "Expense category is required",
        "Expense amount must be greater than zero",
        "Invalid expense date",
      ].includes(error.message)
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create expense",
    });
  }
}
