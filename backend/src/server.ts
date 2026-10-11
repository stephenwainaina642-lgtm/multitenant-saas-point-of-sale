import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testDatabaseConnection } from "./db.js";

import authRoutes from "./auth/auth.routes.js";
import businessRoutes from "./business/business.routes.js";
import businessContextRoutes from "./business/business-context.routes.js";
import productRoutes from "./products/product.routes.js";
import inventoryRoutes from "./inventory/inventory.routes.js";
import customerRoutes from "./customers/customer.routes.js";
import supplierRoutes from "./suppliers/supplier.routes.js";
import purchaseRoutes from "./purchases/purchase.routes.js";
import saleRoutes from "./sales/sale.routes.js";
import paymentRoutes from "./payments/payment.routes.js";
import expenseRoutes from "./expenses/expense.routes.js";
import quotationRoutes from "./quotations/quotation.routes.js";
import auditRoutes from "./audit/audit.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/business-context", businessContextRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/audit-logs", auditRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "POS backend is running",
  });
});

app.listen(PORT, async () => {
  console.log(`POS backend running on http://localhost:${PORT}`);

  try {
    await testDatabaseConnection();
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
  }
});
