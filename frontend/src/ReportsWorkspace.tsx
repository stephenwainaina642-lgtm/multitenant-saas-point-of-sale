import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Sale = {
  id: string;
  receiptNumber: string;
  customerName: string | null;
  saleDate: string;
  createdAt: string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  paymentStatus: string;
  status: string;
};

type Purchase = {
  id: string;
  supplierName: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  status: string;
};

type Expense = {
  id: string;
  category: string;
  description: string | null;
  amount: number | string;
  expenseDate: string;
  paymentMethod: string | null;
  reference: string | null;
};

type ReportsData = {
  period: {
    startDate: string;
    endDateExclusive: string;
    grouping: "daily" | "monthly";
  };
  summary: {
    totalSales: number;
    salesTax: number;
    netSales: number;
    totalPayments: number;
    costOfGoodsSold: number;
    grossProfit: number;
    totalExpenses: number;
    netProfit: number;
    totalPurchases: number;
    purchasePayments: number;
    outstandingSales: number;
    outstandingPurchases: number;
    salesCount: number;
    purchaseCount: number;
    paymentCount: number;
    expenseCount: number;
  };
  trends: {
    date: string;
    revenue: number;
    expenses: number;
  }[];
  bestSellingProducts: {
    productId: string;
    productName: string;
    sku: string | null;
    quantitySold: number;
    grossSales: number;
    costOfGoodsSold: number;
    grossProfit: number;
  }[];
  paymentMethods: {
    method: string;
    amount: number;
    transactions: number;
  }[];
  purchaseBreakdown: {
    supplierId: string;
    supplierName: string;
    purchaseValue: number;
    amountPaid: number;
  }[];
  expenseBreakdown: {
    category: string;
    amount: number;
    transactions: number;
  }[];
};

const localDate = (date: Date) => {
  const adjusted = new Date(date);
  adjusted.setMinutes(adjusted.getMinutes() - adjusted.getTimezoneOffset());
  return adjusted.toISOString().slice(0, 10);
};

const money = (value: number) =>
  value.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const amount = (value: number | string) => Number(value) || 0;

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-KE", { dateStyle: "medium" });
};

const csvValue = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

const sectionStyle = {
  display: "grid",
  gap: 14,
} as const;

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
} as const;

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <span className="supplier-summary-label">{label}</span>
      <strong style={{ display: "block", fontSize: 22, marginTop: 6 }}>
        {value}
      </strong>
      {detail && (
        <small style={{ display: "block", marginTop: 4 }}>{detail}</small>
      )}
    </div>
  );
}

export default function ReportsWorkspace() {
  const now = new Date();

  const [startDate, setStartDate] = useState(
    localDate(new Date(now.getFullYear(), now.getMonth(), 1))
  );
  const [endDate, setEndDate] = useState(localDate(now));

  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [analytics, setAnalytics] = useState<ReportsData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const businessName =
    sessionStorage.getItem("pos_business_name") || "Business";

  const loadReports = useCallback(async () => {
    const token = sessionStorage.getItem("pos_token");
    const businessId = sessionStorage.getItem("pos_business_id");

    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      setError("Please select a valid reporting date range.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const reportPath =
        `/reports?startDate=${encodeURIComponent(startDate)}` +
        `&endDate=${encodeURIComponent(endDate)}`;

      const [
        reportsResponse,
        salesResponse,
        purchasesResponse,
        expensesResponse,
      ] = await Promise.all([
        apiRequest<ReportsData>(reportPath, { token, businessId }),
        apiRequest<Sale[]>("/sales", { token, businessId }),
        apiRequest<Purchase[]>("/purchases", { token, businessId }),
        apiRequest<Expense[]>("/expenses", { token, businessId }),
      ]);

      if (!reportsResponse.data) {
        throw new Error("The Reports API returned no analytics data.");
      }

      setAnalytics(reportsResponse.data);
      setSales(salesResponse.data ?? []);
      setPurchases(purchasesResponse.data ?? []);
      setExpenses(expensesResponse.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load business reports."
      );
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const inRange = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;

    const key = localDate(date);
    return key >= startDate && key <= endDate;
  };

  const reportSales = useMemo(
    () => sales.filter((sale) => inRange(sale.saleDate || sale.createdAt)),
    [sales, startDate, endDate]
  );

  const reportPurchases = useMemo(
    () => purchases.filter((purchase) => inRange(purchase.purchaseDate)),
    [purchases, startDate, endDate]
  );

  const reportExpenses = useMemo(
    () => expenses.filter((expense) => inRange(expense.expenseDate)),
    [expenses, startDate, endDate]
  );

  const summary = analytics?.summary;

  const totals = useMemo(() => {
    const salesRevenue = summary?.totalSales ?? 0;
    const salesCollected = summary?.totalPayments ?? 0;
    const salesOutstanding = summary?.outstandingSales ?? 0;
    const purchaseValue = summary?.totalPurchases ?? 0;
    const purchasePaid = summary?.purchasePayments ?? 0;
    const purchaseOutstanding = summary?.outstandingPurchases ?? 0;
    const expenseTotal = summary?.totalExpenses ?? 0;

    return {
      salesRevenue,
      salesCollected,
      salesOutstanding,
      purchaseValue,
      purchasePaid,
      purchaseOutstanding,
      expenseTotal,
      cashMovement: salesCollected - purchasePaid - expenseTotal,
    };
  }, [summary]);

  const trendMaximum = Math.max(
    1,
    ...(analytics?.trends.flatMap((item) => [
      item.revenue,
      item.expenses,
    ]) ?? [])
  );

  const paymentMaximum = Math.max(
    1,
    ...(analytics?.paymentMethods.map((item) => item.amount) ?? [])
  );

  const productMaximum = Math.max(
    1,
    ...(analytics?.bestSellingProducts.map((item) => item.quantitySold) ?? [])
  );

  function setPeriod(period: string) {
    const end = new Date();
    let start = new Date(end);

    if (period === "today") {
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    } else if (period === "week") {
      start.setDate(end.getDate() - 6);
    } else if (period === "month") {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (period === "year") {
      start = new Date(end.getFullYear(), 0, 1);
    }

    setStartDate(localDate(start));
    setEndDate(localDate(end));
  }

  function exportCsv() {
    const reportSummary = summary;

    const rows: (string | number)[][] = [
      ["NEXAPOS BUSINESS REPORT"],
      [businessName],
      ["Reporting period", startDate, endDate],
      [],
      ["FINANCIAL SUMMARY"],
      ["Total sales", reportSummary?.totalSales ?? 0],
      ["Sales tax", reportSummary?.salesTax ?? 0],
      ["Net sales", reportSummary?.netSales ?? 0],
      ["Payments collected", reportSummary?.totalPayments ?? 0],
      ["Cost of goods sold", reportSummary?.costOfGoodsSold ?? 0],
      ["Gross profit", reportSummary?.grossProfit ?? 0],
      ["Operating expenses", reportSummary?.totalExpenses ?? 0],
      ["Estimated net profit", reportSummary?.netProfit ?? 0],
      ["Customer outstanding", reportSummary?.outstandingSales ?? 0],
      ["Purchase value", reportSummary?.totalPurchases ?? 0],
      ["Supplier outstanding", reportSummary?.outstandingPurchases ?? 0],
      ["Net cash movement", totals.cashMovement],
      [],
      ["SALES"],
      ["Receipt", "Customer", "Date", "Total", "Collected", "Outstanding", "Status"],
      ...reportSales.map((item) => [
        item.receiptNumber,
        item.customerName || "Walk-in customer",
        item.saleDate,
        amount(item.total),
        amount(item.amountPaid),
        amount(item.balanceDue),
        item.status,
      ]),
      [],
      ["PURCHASES"],
      ["Supplier", "Invoice", "Date", "Total", "Paid", "Outstanding", "Status"],
      ...reportPurchases.map((item) => [
        item.supplierName,
        item.invoiceNumber || "",
        item.purchaseDate,
        amount(item.total),
        amount(item.amountPaid),
        amount(item.balanceDue),
        item.status,
      ]),
      [],
      ["EXPENSES"],
      ["Category", "Description", "Date", "Payment method", "Reference", "Amount"],
      ...reportExpenses.map((item) => [
        item.category,
        item.description || "",
        item.expenseDate,
        item.paymentMethod || "",
        item.reference || "",
        amount(item.amount),
      ]),
      [],
      ["BEST-SELLING PRODUCTS"],
      ["Product", "SKU", "Quantity sold", "Sales", "Cost", "Gross profit"],
      ...(analytics?.bestSellingProducts.map((item) => [
        item.productName,
        item.sku || "",
        item.quantitySold,
        item.grossSales,
        item.costOfGoodsSold,
        item.grossProfit,
      ]) ?? []),
      [],
      ["PAYMENT METHODS"],
      ["Method", "Amount", "Transactions"],
      ...(analytics?.paymentMethods.map((item) => [
        item.method,
        item.amount,
        item.transactions,
      ]) ?? []),
      [],
      ["PURCHASE BREAKDOWN"],
      ["Supplier", "Purchase value", "Amount paid"],
      ...(analytics?.purchaseBreakdown.map((item) => [
        item.supplierName,
        item.purchaseValue,
        item.amountPaid,
      ]) ?? []),
      [],
      ["EXPENSE BREAKDOWN"],
      ["Category", "Amount", "Transactions"],
      ...(analytics?.expenseBreakdown.map((item) => [
        item.category,
        item.amount,
        item.transactions,
      ]) ?? []),
    ];

    const csv = rows.map((row) => row.map(csvValue).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `nexaPOS-report-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const summaryCards = [
    { label: "Sales revenue", value: money(totals.salesRevenue) },
    { label: "Payments collected", value: money(totals.salesCollected) },
    { label: "Customer outstanding", value: money(totals.salesOutstanding) },
    { label: "Purchase value", value: money(totals.purchaseValue) },
    { label: "Supplier outstanding", value: money(totals.purchaseOutstanding) },
    { label: "Operating expenses", value: money(totals.expenseTotal) },
  ];

  return (
    <section
      className="suppliers-workspace reports-workspace"
      style={{ display: "grid", gap: 20 }}
    >
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Business reports</h2>
            <p>Financial and operational activity for {businessName}</p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadReports()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh reports"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <button className="button-secondary" type="button" onClick={() => setPeriod("today")}>Today</button>
          <button className="button-secondary" type="button" onClick={() => setPeriod("week")}>Last 7 days</button>
          <button className="button-secondary" type="button" onClick={() => setPeriod("month")}>This month</button>
          <button className="button-secondary" type="button" onClick={() => setPeriod("year")}>This year</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 14 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600 }}>
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600 }}>
            End date
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button-secondary"
            onClick={exportCsv}
            disabled={loading || !analytics}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => window.print()}
            disabled={loading}
          >
            Print / Save PDF
          </button>
        </div>

        {error && (
          <p role="alert" className="supplier-notice supplier-error">{error}</p>
        )}

        {startDate > endDate && (
          <p role="alert" className="supplier-notice supplier-error">
            The start date must be on or before the end date.
          </p>
        )}
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Performance summary"
          description={`${startDate} to ${endDate}`}
        />

        <div className="supplier-summary">
          {summaryCards.map((card) => (
            <div key={card.label}>
              <span className="supplier-summary-label">{card.label}</span>
              <strong>{loading ? "—" : card.value}</strong>
            </div>
          ))}
        </div>

        <div style={{ ...metricGridStyle, marginTop: 22 }}>
          <Metric
            label="Net cash movement"
            value={loading ? "—" : money(totals.cashMovement)}
            detail="Collections less purchase payments and recorded expenses. Not accounting profit."
          />
          <Metric
            label="Sales transactions"
            value={loading ? "—" : String(summary?.salesCount ?? 0)}
          />
          <Metric
            label="Purchase transactions"
            value={loading ? "—" : String(summary?.purchaseCount ?? 0)}
          />
          <Metric
            label="Expense records"
            value={loading ? "—" : String(summary?.expenseCount ?? 0)}
          />
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Profit and loss"
          description="Estimated trading performance for the selected period"
        />

        <div className="supplier-summary">
          <div>
            <span className="supplier-summary-label">Net sales excluding sales tax</span>
            <strong>{loading ? "—" : money(summary?.netSales ?? 0)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Cost of goods sold</span>
            <strong>{loading ? "—" : money(summary?.costOfGoodsSold ?? 0)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Gross profit</span>
            <strong>{loading ? "—" : money(summary?.grossProfit ?? 0)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Operating expenses</span>
            <strong>{loading ? "—" : money(summary?.totalExpenses ?? 0)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Estimated net profit</span>
            <strong>{loading ? "—" : money(summary?.netProfit ?? 0)}</strong>
          </div>
        </div>
        <small>
          This is an operational estimate based on recorded sales, historical
          item costs and expenses. It is not a substitute for formal accounts
          or tax reporting.
        </small>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Revenue and expenses trend"
          description={
            analytics?.period.grouping === "monthly"
              ? "Monthly net sales and recorded expenses"
              : "Daily net sales and recorded expenses"
          }
        />

        {loading ? (
          <p>Loading trend data...</p>
        ) : analytics?.trends.length ? (
          <div style={sectionStyle}>
            {analytics.trends.map((item) => (
              <div key={item.date} style={{ display: "grid", gap: 7 }}>
                <strong style={{ fontSize: 13 }}>{dateLabel(item.date)}</strong>
                <div style={{ display: "grid", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 76, fontSize: 12 }}>Revenue</span>
                    <div style={{ flex: 1, background: "var(--border-color, #e5e7eb)", borderRadius: 5, overflow: "hidden", height: 10 }}>
                      <div style={{ width: `${Math.max(0, (item.revenue / trendMaximum) * 100)}%`, height: "100%", background: "#23866b", borderRadius: 5 }} />
                    </div>
                    <strong style={{ minWidth: 125, textAlign: "right", fontSize: 12 }}>{money(item.revenue)}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 76, fontSize: 12 }}>Expenses</span>
                    <div style={{ flex: 1, background: "var(--border-color, #e5e7eb)", borderRadius: 5, overflow: "hidden", height: 10 }}>
                      <div style={{ width: `${Math.max(0, (item.expenses / trendMaximum) * 100)}%`, height: "100%", background: "#c28b42", borderRadius: 5 }} />
                    </div>
                    <strong style={{ minWidth: 125, textAlign: "right", fontSize: 12 }}>{money(item.expenses)}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-row">No trend data for this reporting period.</p>
        )}
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Best-selling products"
          description="Top products ranked by quantity sold"
        />

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>SKU</th>
                <th>QUANTITY SOLD</th>
                <th>SALES</th>
                <th>COST</th>
                <th>GROSS PROFIT</th>
              </tr>
            </thead>
            <tbody>
              {analytics?.bestSellingProducts.map((item) => (
                <tr key={item.productId}>
                  <td><strong>{item.productName}</strong></td>
                  <td>{item.sku || "—"}</td>
                  <td>
                    <div style={{ display: "grid", gap: 5 }}>
                      <span>{item.quantitySold.toLocaleString("en-KE")}</span>
                      <div style={{ height: 5, background: "var(--border-color, #e5e7eb)", borderRadius: 5, overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(0, (item.quantitySold / productMaximum) * 100)}%`, height: "100%", background: "#23866b" }} />
                      </div>
                    </div>
                  </td>
                  <td>{money(item.grossSales)}</td>
                  <td>{money(item.costOfGoodsSold)}</td>
                  <td><strong>{money(item.grossProfit)}</strong></td>
                </tr>
              ))}
              {!loading && !analytics?.bestSellingProducts.length && (
                <tr><td colSpan={6} className="empty-row">No product sales in this period.</td></tr>
              )}
              {loading && <tr><td colSpan={6}>Loading product performance...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Payment method analysis"
          description="Actual payment transactions recorded during the selected period"
        />

        {loading ? (
          <p>Loading payment analysis...</p>
        ) : analytics?.paymentMethods.length ? (
          <div style={sectionStyle}>
            {analytics.paymentMethods.map((item) => (
              <div key={item.method} style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong style={{ textTransform: "capitalize" }}>{item.method}</strong>
                  <strong>{money(item.amount)}</strong>
                </div>
                <div style={{ height: 9, background: "var(--border-color, #e5e7eb)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(0, (item.amount / paymentMaximum) * 100)}%`, height: "100%", background: "#23866b", borderRadius: 6 }} />
                </div>
                <small>{item.transactions} transaction(s)</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-row">No payment transactions in this period.</p>
        )}
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Purchase breakdown"
          description="Purchase value and payments grouped by supplier"
        />

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>SUPPLIER</th><th>PURCHASE VALUE</th><th>AMOUNT PAID</th><th>OUTSTANDING</th></tr>
            </thead>
            <tbody>
              {analytics?.purchaseBreakdown.map((item) => (
                <tr key={item.supplierId}>
                  <td><strong>{item.supplierName}</strong></td>
                  <td>{money(item.purchaseValue)}</td>
                  <td>{money(item.amountPaid)}</td>
                  <td>{money(item.purchaseValue - item.amountPaid)}</td>
                </tr>
              ))}
              {!loading && !analytics?.purchaseBreakdown.length && (
                <tr><td colSpan={4} className="empty-row">No supplier purchases in this period.</td></tr>
              )}
              {loading && <tr><td colSpan={4}>Loading purchase breakdown...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <SectionHeading
          title="Expense breakdown"
          description="Recorded operating expenses grouped by category"
        />

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>CATEGORY</th><th>TRANSACTIONS</th><th>AMOUNT</th></tr>
            </thead>
            <tbody>
              {analytics?.expenseBreakdown.map((item) => (
                <tr key={item.category}>
                  <td><strong>{item.category}</strong></td>
                  <td>{item.transactions}</td>
                  <td>{money(item.amount)}</td>
                </tr>
              ))}
              {!loading && !analytics?.expenseBreakdown.length && (
                <tr><td colSpan={3} className="empty-row">No expense records in this period.</td></tr>
              )}
              {loading && <tr><td colSpan={3}>Loading expense breakdown...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Sales report</h2>
            <p>Sales recorded during the selected period</p>
          </div>
          <strong>{money(totals.salesRevenue)}</strong>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>RECEIPT</th><th>CUSTOMER</th><th>DATE</th><th>COLLECTED</th><th>OUTSTANDING</th><th>TOTAL</th></tr>
            </thead>
            <tbody>
              {reportSales.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.receiptNumber}</strong></td>
                  <td>{item.customerName || "Walk-in customer"}</td>
                  <td>{dateLabel(item.saleDate || item.createdAt)}</td>
                  <td>{money(amount(item.amountPaid))}</td>
                  <td>{money(amount(item.balanceDue))}</td>
                  <td><strong>{money(amount(item.total))}</strong></td>
                </tr>
              ))}
              {!loading && reportSales.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No sales in this reporting period.</td></tr>
              )}
              {loading && <tr><td colSpan={6}>Loading sales report...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Purchases report</h2>
            <p>Supplier purchases and payment obligations</p>
          </div>
          <strong>{money(totals.purchaseValue)}</strong>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>SUPPLIER</th><th>INVOICE</th><th>DATE</th><th>PAID</th><th>OUTSTANDING</th><th>TOTAL</th></tr>
            </thead>
            <tbody>
              {reportPurchases.map((item) => (
                <tr key={item.id}>
                  <td>{item.supplierName}</td>
                  <td>{item.invoiceNumber || "—"}</td>
                  <td>{dateLabel(item.purchaseDate)}</td>
                  <td>{money(amount(item.amountPaid))}</td>
                  <td>{money(amount(item.balanceDue))}</td>
                  <td><strong>{money(amount(item.total))}</strong></td>
                </tr>
              ))}
              {!loading && reportPurchases.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No purchases in this reporting period.</td></tr>
              )}
              {loading && <tr><td colSpan={6}>Loading purchases report...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Expenses report</h2>
            <p>Recorded operating expenses</p>
          </div>
          <strong>{money(totals.expenseTotal)}</strong>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>CATEGORY</th><th>DESCRIPTION</th><th>DATE</th><th>PAYMENT METHOD</th><th>REFERENCE</th><th>AMOUNT</th></tr>
            </thead>
            <tbody>
              {reportExpenses.map((item) => (
                <tr key={item.id}>
                  <td>{item.category}</td>
                  <td>{item.description || "—"}</td>
                  <td>{dateLabel(item.expenseDate)}</td>
                  <td>{item.paymentMethod || "—"}</td>
                  <td>{item.reference || "—"}</td>
                  <td><strong>{money(amount(item.amount))}</strong></td>
                </tr>
              ))}
              {!loading && reportExpenses.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No expenses in this reporting period.</td></tr>
              )}
              {loading && <tr><td colSpan={6}>Loading expenses report...</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

