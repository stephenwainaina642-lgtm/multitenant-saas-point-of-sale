import { can } from "./permissions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";
import Letterhead from "./Letterhead";
import { useNotify } from "./useNotify";

type InvoiceItem = { id: string; productName: string; quantity: string | number; unitPrice: string | number; discount: string | number; tax: string | number; total: string | number };
type Invoice = {
  id: string; invoiceNumber: string; saleId: string; receiptNumber: string; customerName: string | null;
  customer: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  invoiceDate: string; dueDate: string | null; subtotal: string | number; discount: string | number; tax: string | number;
  total: string | number; pricesIncludeVat?: boolean; amountPaid: string | number; balanceDue: string | number; status: string; notes: string | null; items: InvoiceItem[];
};
type SaleRow = { id: string; receiptNumber: string; customerName: string | null; total: string | number; status: string; saleDate: string };

const money = (v: number | string) => `KSh ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE") : "—");
const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit", marginTop: 6 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#344b40" };

export default function InvoicesWorkspace() {
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useNotify(error, message);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ saleId: "", dueDate: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [inv, s] = await Promise.all([
        apiRequest<Invoice[]>("/invoices", { token, businessId }),
        apiRequest<SaleRow[]>("/sales", { token, businessId }).catch(() => ({ data: [] as SaleRow[] })),
      ]);
      setInvoices(inv.data ?? []);
      setSales(s.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load invoices."); }
    finally { setLoading(false); }
  }, [token, businessId]);
  useEffect(() => { void load(); }, [load]);

  const invoicedSaleIds = useMemo(() => new Set(invoices.map((i) => i.saleId)), [invoices]);
  const available = sales.filter((s) => s.status === "completed" && !invoicedSaleIds.has(s.id));
  const filtered = invoices.filter((i) => [i.invoiceNumber, i.customerName ?? "", i.receiptNumber, i.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const outstanding = invoices.filter((i) => i.status !== "void").reduce((t, i) => t + Number(i.balanceDue), 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const body: Record<string, string> = { saleId: form.saleId };
      if (form.dueDate) body.dueDate = form.dueDate;
      if (form.notes.trim()) body.notes = form.notes.trim();
      const res = await apiRequest<Invoice>("/invoices", { method: "POST", token, businessId, body });
      setMessage(`Invoice ${res.data?.invoiceNumber ?? ""} created.`);
      setForm({ saleId: "", dueDate: "", notes: "" }); setShowForm(false);
      await load();
      if (res.data) setSelected(res.data);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the invoice."); }
    finally { setSaving(false); }
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div><h2>Invoices</h2><p>Invoices always show the sale's current payments and balance</p></div>
          {can("invoices.manage") && <button type="button" className="button-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close form" : "New invoice"}</button>}
        </div>
        <div className="customer-summary">
          <div><span className="customer-summary-label">Invoices</span><strong>{invoices.length}</strong></div>
          <div><span className="customer-summary-label">Outstanding</span><strong>{money(outstanding)}</strong></div>
          <div><span className="customer-summary-label">Sales without an invoice</span><strong>{available.length}</strong></div>
        </div>

        {showForm && (
          <form onSubmit={create} style={{ display: "grid", gap: 12, margin: "16px 0", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label style={labelStyle}>Sale
              <select style={fieldStyle} required value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })}>
                <option value="">Select a sale</option>
                {available.map((s) => <option key={s.id} value={s.id}>{s.receiptNumber} · {s.customerName ?? "Walk-in"} · {money(s.total)}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Due date (optional)<input style={fieldStyle} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
            <label style={labelStyle}>Notes (optional)<input style={fieldStyle} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            <div style={{ alignSelf: "end" }}><button type="submit" className="button-primary" disabled={saving || !form.saleId}>{saving ? "Creating…" : "Create invoice"}</button></div>
          </form>
        )}

        <label htmlFor="invoice-search" style={labelStyle}>Search invoices</label>
        <input id="invoice-search" style={fieldStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, customer, receipt or status" />

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>DUE</th><th>TOTAL</th><th>BALANCE</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={8}>{invoices.length === 0 ? "No invoices yet." : "No invoices match your search."}</td></tr>}
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.invoiceNumber}</strong><div className="customer-secondary-text">{i.receiptNumber}</div></td>
                  <td>{i.customerName ?? "Walk-in"}</td>
                  <td>{day(i.invoiceDate)}</td><td>{day(i.dueDate)}</td>
                  <td>{money(i.total)}</td><td>{money(i.balanceDue)}</td>
                  <td>{i.status}</td>
                  <td><button type="button" className="button-secondary" onClick={() => setSelected(i)}>View / print</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {selected && (
        <article className="panel" style={{ padding: 24 }}>
          <div className="sale-receipt-print-area">
            <Letterhead />
            <h2>Invoice {selected.invoiceNumber}{selected.status === "void" ? " (VOID)" : ""}</h2>
            <p>Date {day(selected.invoiceDate)}{selected.dueDate ? ` · Due ${day(selected.dueDate)}` : ""} · Sale {selected.receiptNumber}</p>
            <p><strong>Bill to:</strong> {selected.customer?.name ?? "Walk-in customer"}{selected.customer?.phone ? ` · ${selected.customer.phone}` : ""}{selected.customer?.address ? ` · ${selected.customer.address}` : ""}</p>
            <table>
              <thead><tr><th>ITEM</th><th>QTY</th><th>PRICE</th><th>DISCOUNT</th><th>TAX</th><th>TOTAL</th></tr></thead>
              <tbody>
                {selected.items.map((it) => (
                  <tr key={it.id}><td>{it.productName}</td><td>{Number(it.quantity)}</td><td>{money(it.unitPrice)}</td><td>{money(it.discount)}</td><td>{money(it.tax)}</td><td>{money(it.total)}</td></tr>
                ))}
              </tbody>
            </table>
            <p>Subtotal {money(selected.subtotal)} · Discount {money(selected.discount)} · {selected.pricesIncludeVat ? "VAT (included in total)" : "Tax"} {money(selected.tax)}</p>
            <p><strong>Total {money(selected.total)}</strong> · Paid {money(selected.amountPaid)} · <strong>Balance due {money(selected.balanceDue)}</strong> · Status: {selected.status}</p>
            {selected.notes && <p>{selected.notes}</p>}
          </div>
          <div className="customer-actions no-print">
            <button type="button" className="button-primary" onClick={() => window.print()}>Print</button>
            <button type="button" className="button-secondary" onClick={() => setSelected(null)}>Close</button>
          </div>
        </article>
      )}
    </section>
  );
}
