import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import prisma from "./lib/prisma.js";
import { requestLog } from "./middleware/request-log.js";
import { loadConfig } from "./lib/config.js";
import platformRoutes from "./platform/platform.routes.js";
import { loginLimiter, registerLimiter } from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

import authRoutes from "./auth/auth.routes.js";
import businessRoutes from "./business/business.routes.js";
import businessContextRoutes from "./business/business-context.routes.js";
import productRoutes from "./products/product.routes.js";
import categoryRoutes from "./categories/category.routes.js";
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
import importRoutes from "./imports/import.routes.js";
import dashboardRoutes from "./dashboard/dashboard.routes.js";
import invoiceRoutes from "./invoices/invoice.routes.js";
import roleRoutes from "./roles/role.routes.js";
import employeeRoutes from "./employees/employee.routes.js";

dotenv.config();

const config = loadConfig();
const app = express();
const PORT = config.port;

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
if (config.isProduction) app.use(requestLog);
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
app.use("/api/auth/change-password", loginLimiter(config)); // stops guessing the current password
app.use("/api/auth/forgot-password", loginLimiter(config)); // stops mail-bombing an address
app.use("/api/auth/reset-password", loginLimiter(config)); // stops guessing reset tokens
app.use("/api/platform/login", loginLimiter(config)); // password + authenticator code guessing
app.use("/api/platform", platformRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/business-context", businessContextRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
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
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/import", importRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/employees", employeeRoutes);

// Liveness: the process is up. Readiness: it can also reach its database.
app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "POS backend is running" });
});

app.get("/api/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, message: "Ready" });
  } catch {
    res.status(503).json({ success: false, message: "Database is not reachable" });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  // Refuse to serve traffic without a working database: a supervisor restarts us until it is back.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("Cannot reach PostgreSQL through DATABASE_URL:", (error as Error).message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`POS backend running on port ${PORT} (${config.nodeEnv})`);
  });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing in-flight requests, then exiting`);
    // Give running requests (and their database transactions) time to finish.
    const force = setTimeout(() => {
      console.error("Shutdown took too long, exiting");
      process.exit(1);
    }, 15_000);
    force.unref();
    server.close(async () => {
      try {
        await prisma.$disconnect();
      } finally {
        process.exit(0);
      }
    });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception, exiting:", error);
  process.exit(1);
});

void start();
