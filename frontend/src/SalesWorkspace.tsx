import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Sale = {
  id: string;
  receiptNumber: string;
  customerName: string | null;
  saleDate: string;
  createdAt: string;
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  paymentStatus: string;
  status: string;
};

type SaleItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  unitOfMeasure: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
};

type SalePayment = {
  id: string;
  amount: number | string;
  method: string;
  reference: string | null;
  paymentDate: string;
  notes: string | null;
};

type SaleDetails = Sale & {
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  items: SaleItem[];
  payments: SalePayment[];
};

const money = (value: number | string) =>
  `KSh ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)}`;

const dateText = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

const paymentMethodText = (value: string) => {
  const method = value.trim().replace(/[_-]+/g, " ");
  return method ? method.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
};

export default function SalesWorkspace() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<SaleDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const token = sessionStorage.getItem("pos_token");
      const businessId = sessionStorage.getItem("pos_business_id");

      if (!token || !businessId) {
        throw new Error("Your session or selected business is missing. Please sign in again.");
      }

      const response = await apiRequest<Sale[]>("/sales", { token, businessId });
      setSales(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sales.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const openSale = useCallback(async (sale: Sale) => {
    setSelectedSale(null);
    setDetailsError("");
    setDetailsLoading(true);

    try {
      const token = sessionStorage.getItem("pos_token");
      const businessId = sessionStorage.getItem("pos_business_id");

      if (!token || !businessId) {
        throw new Error("Your session or selected business is missing. Please sign in again.");
      }

      const response = await apiRequest<SaleDetails>(
        `/sales/${encodeURIComponent(sale.id)}`,
        { token, businessId }
      );

      if (!response.data) {
        throw new Error("The server did not return sale details.");
      }

      setSelectedSale(response.data);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Could not load sale details.");
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sales;

    return sales.filter((sale) =>
      `${sale.receiptNumber} ${sale.customerName || "Walk-in customer"} ${sale.paymentStatus} ${sale.status}`
        .toLowerCase()
        .includes(term)
    );
  }, [sales, search]);

  const totals = useMemo(
    () =>
      sales.reduce(
        (result, sale) => ({
          revenue: result.revenue + (Number(sale.total) || 0),
          collected: result.collected + (Number(sale.amountPaid) || 0),
          outstanding: result.outstanding + (Number(sale.balanceDue) || 0),
        }),
        { revenue: 0, collected: 0, outstanding: 0 }
      ),
    [sales]
  );

  const businessName = sessionStorage.getItem("pos_business_name") || "Business";

  return (
    <section className="sales-workspace">
      <div className="sales-workspace-toolbar">
        <div>
          <h2>Sales</h2>
          <p>Review transactions, payment records, and customer receipts.</p>
        </div>
        <button
          type="button"
          className="sales-refresh-button"
          onClick={() => void loadSales()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh sales"}
        </button>
      </div>

      <div className="sales-summary-grid">
        <article className="sales-summary-card">
          <span>Total sales value</span>
          <strong>{money(totals.revenue)}</strong>
          <small>{sales.length} recorded transactions</small>
        </article>
        <article className="sales-summary-card">
          <span>Amount collected</span>
          <strong>{money(totals.collected)}</strong>
          <small>Payments recorded against sales</small>
        </article>
        <article className="sales-summary-card">
          <span>Outstanding balance</span>
          <strong>{money(totals.outstanding)}</strong>
          <small>Amount still due from customers</small>
        </article>
      </div>

      <section className="panel sales-history-panel">
        <div className="sales-history-heading">
          <div>
            <h2>Sales history</h2>
            <p>Select a receipt to view the full transaction.</p>
          </div>
          <input
            className="sales-history-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search receipt, customer, status..."
            aria-label="Search sales"
          />
        </div>

        {error && (
          <div className="sales-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadSales()}>Try again</button>
          </div>
        )}

        <div className="table-wrap">
          <table className="sales-history-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Payment status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="sales-empty-cell">Loading sales...</td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="sales-empty-cell">
                    {error ? "Sales could not be loaded." : search ? "No sales match your search." : "No sales have been recorded yet."}
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => {
                  const status = (sale.paymentStatus || "unknown").toLowerCase();
                  const statusClass = status === "paid"
                    ? "sales-status-paid"
                    : status === "partial" || status === "partially_paid"
                      ? "sales-status-partial"
                      : status === "unpaid" || status === "pending"
                        ? "sales-status-unpaid"
                        : "sales-status-unknown";

                  return (
                    <tr key={sale.id}>
                      <td>
                        <button
                          type="button"
                          className="sales-receipt-link"
                          onClick={() => void openSale(sale)}
                        >
                          {sale.receiptNumber || `Sale #${sale.id}`}
                        </button>
                      </td>
                      <td>{sale.customerName || "Walk-in customer"}</td>
                      <td>{dateText(sale.saleDate || sale.createdAt)}</td>
                      <td>{money(sale.total)}</td>
                      <td>{money(sale.amountPaid)}</td>
                      <td className="sales-balance-due">{money(sale.balanceDue)}</td>
                      <td>
                        <span className={`sales-status-pill ${statusClass}`}>
                          {paymentMethodText(status)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="sales-view-button"
                          onClick={() => void openSale(sale)}
                        >
                          View receipt
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailsLoading && (
        <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Loading sale details">
          <div className="sale-detail-loading">
            <span className="sale-loading-spinner" />
            <p>Loading receipt and payment details...</p>
          </div>
        </div>
      )}

      {detailsError && !detailsLoading && (
        <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Sale details error">
          <div className="sale-detail-loading">
            <h2>Could not open sale</h2>
            <p>{detailsError}</p>
            <button type="button" className="sales-view-button" onClick={() => setDetailsError("")}>
              Close
            </button>
          </div>
        </div>
      )}

      {selectedSale && !detailsLoading && (
        <div
          className="sale-detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Receipt ${selectedSale.receiptNumber}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSale(null);
          }}
        >
          <section className="sale-detail-modal">
            <div className="sale-detail-actions">
              <div>
                <h2>Sale details</h2>
                <p>Review the transaction or print a customer receipt.</p>
              </div>
              <div className="sale-detail-action-buttons">
                <button type="button" className="sales-view-button" onClick={() => window.print()}>
                  Print receipt
                </button>
                <button
                  type="button"
                  className="sale-detail-close"
                  onClick={() => setSelectedSale(null)}
                  aria-label="Close sale details"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="sale-receipt-print-area">
              <header className="sale-receipt-header">
                <p className="sale-receipt-brand">{businessName}</p>
                <h1>SALES RECEIPT</h1>
                <p className="sale-receipt-number">
                  {selectedSale.receiptNumber || `Sale #${selectedSale.id}`}
                </p>
                <p>{dateText(selectedSale.saleDate || selectedSale.createdAt)}</p>
              </header>

              <div className="sale-receipt-customer">
                <div>
                  <span>Customer</span>
                  <strong>{selectedSale.customerName || "Walk-in customer"}</strong>
                </div>
                {selectedSale.customerPhone && (
                  <div>
                    <span>Phone</span>
                    <strong>{selectedSale.customerPhone}</strong>
                  </div>
                )}
                {selectedSale.customerEmail && (
                  <div>
                    <span>Email</span>
                    <strong>{selectedSale.customerEmail}</strong>
                  </div>
                )}
              </div>

              <h3 className="sale-section-title">Items purchased</h3>
              <div className="table-wrap">
                <table className="sale-items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Discount</th>
                      <th>Tax</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSale.items?.length ? (
                      selectedSale.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.productName}</strong>
                            {item.sku && <small className="sale-item-sku">SKU: {item.sku}</small>}
                          </td>
                          <td>{Number(item.quantity) || 0}{item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""}</td>
                          <td>{money(item.unitPrice)}</td>
                          <td>{money(item.discount)}</td>
                          <td>{money(item.tax)}</td>
                          <td>{money(item.total)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={6}>No item details are available for this sale.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="sale-receipt-totals">
                <div><span>Subtotal</span><strong>{money(selectedSale.subtotal)}</strong></div>
                <div><span>Discount</span><strong>{money(selectedSale.discount)}</strong></div>
                <div><span>Tax</span><strong>{money(selectedSale.tax)}</strong></div>
                <div className="sale-receipt-grand-total"><span>Total</span><strong>{money(selectedSale.total)}</strong></div>
                <div><span>Amount paid</span><strong>{money(selectedSale.amountPaid)}</strong></div>
                <div className="sale-receipt-balance"><span>Balance due</span><strong>{money(selectedSale.balanceDue)}</strong></div>
              </div>

              <div className="sale-payment-section">
                <h3 className="sale-section-title">Payment history</h3>
                {selectedSale.payments?.length ? (
                  <div className="table-wrap">
                    <table className="sale-items-table sale-payments-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSale.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td>{dateText(payment.paymentDate)}</td>
                            <td>{paymentMethodText(payment.method)}</td>
                            <td>{payment.reference || "—"}</td>
                            <td>{money(payment.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="sale-no-payments">
                    No payment transactions are recorded for this sale.
                  </p>
                )}
              </div>

              {selectedSale.notes && (
                <div className="sale-receipt-notes">
                  <strong>Notes:</strong> {selectedSale.notes}
                </div>
              )}

              <footer className="sale-receipt-footer">
                <p>Thank you for your business.</p>
                <small>Keep this receipt for your records.</small>
              </footer>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
