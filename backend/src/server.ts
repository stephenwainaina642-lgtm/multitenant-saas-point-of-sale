import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { testDatabaseConnection } from "./db.js";
import { loadConfig } from "./lib/config.js";
import { loginLimiter, registerLimiter } from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

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
import reportRoutes from "./reports/reports.routes.js";
import invoiceRoutes from "./invoices/invoice.routes.js";
import roleRoutes from "./roles/role.routes.js";

dotenv.config();

const config = loadConfig();
const app = express();
const PORT = config.port;

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (no Origin header) are allowed; browsers must be listed.
      if (!origin || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-Business-ID", "Idempotency-Key"],
  })
);
app.use(express.json({ limit: "200kb" }));

app.use("/api/auth/login", loginLimiter(config));
app.use("/api/auth/register", registerLimiter(config));
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
app.use("/api/reports", reportRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/roles", roleRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "POS backend is running",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`POS backend running on http://localhost:${PORT}`);

  try {
    await testDatabaseConnection();
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
  }
});

