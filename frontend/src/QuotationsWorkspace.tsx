import { can } from "./permissions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";
import { useNotify } from "./useNotify";
import { money } from "./money";
import PrintDocument from "./PrintDocument";

type Item = { id: string; productId: string; productName: string; quantity: string | number; unitPrice: string | number; discount: string | number; tax: string | number; total: string | number };
type Quotation = {
  id: string; quotationNumber: string; customerName: string | null;
  customer: { name: string; phone: string | null; address: string | null } | null;
  quotationDate: string; expiryDate: string | null; subtotal: string | number; discount: string | number; tax: string | number;
  total: string | number; pricesIncludeVat?: boolean; status: string; notes: string | null; convertedReceiptNumber: string | null; items: Item[];
};
type Product = { id: string; name: string; sellingPrice: string | number; stockQuantity?: string | number };
type Customer = { id: string; name: string };
type Line = { productId: string; quantity: string; discount: string };

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE") : "—");
const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit", marginTop: 6 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#344b40" };
const emptyLine: Line = { productId: "", quantity: "1", discount: "0" };

export default function QuotationsWorkspace() {
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useNotify(error, message);
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Quotation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [q, p, c] = await Promise.all([
        apiRequest<Quotation[]>("/quotations", { token, businessId }),
        apiRequest<Product[]>("/products", { token, businessId }).catch(() => ({ data: [] as Product[] })),
        apiRequest<Customer[]>("/customers", { token, businessId }).catch(() => ({ data: [] as Customer[] })),
      ]);
      setQuotes(q.data ?? []); setProducts(p.data ?? []); setCustomers(c.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load quotations."); }
    finally { setLoading(false); }
  }, [token, businessId]);
  useEffect(() => { void load(); }, [load]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const estimate = lines.reduce((t, l) => {
    const p = productById.get(l.productId);
    return p ? t + Number(p.sellingPrice) * Number(l.quantity || 0) - Number(l.discount || 0) : t;
  }, 0);

  // The server prices the quotation exactly as it will be saved (VAT, inclusive or exclusive); the simple sum is the fallback.
  const [priced, setPriced] = useState<{ total: number; tax: number; inclusive: boolean } | null>(null);
  useEffect(() => {
    const items = lines
      .filter((l) => l.productId && Number(l.quantity) > 0 && productById.get(l.productId))
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitPrice: Number(productById.get(l.productId)!.sellingPrice), discount: Number(l.discount || 0) }));
    if (items.length === 0) { setPriced(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      apiRequest<{ total: string; tax: string; pricesIncludeVat: boolean }>("/sales/preview", { method: "POST", token, businessId, body: { items } })
        .then((r) => { if (active && r.data) setPriced({ total: Number(r.data.total), tax: Number(r.data.tax), inclusive: r.data.pricesIncludeVat }); })
        .catch(() => { if (active) setPriced(null); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [lines, productById, token, businessId]);

  function setLine(i: number, patch: Partial<Line>) { setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const items = lines.filter((l) => l.productId).map((l) => ({
        productId: l.productId, quantity: l.quantity, unitPrice: productById.get(l.productId)!.sellingPrice, discount: l.discount || "0",
      }));
      const body: Record<string, unknown> = { items };
      if (customerId) body.customerId = customerId;
      if (expiryDate) body.expiryDate = expiryDate;
      if (notes.trim()) body.notes = notes.trim();
      const res = await apiRequest<Quotation>("/quotations", { method: "POST", token, businessId, body });
      setMessage(`Quotation ${res.data?.quotationNumber ?? ""} created.`);
      setShowForm(false); setLines([{ ...emptyLine }]); setCustomerId(""); setExpiryDate(""); setNotes("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the quotation."); }
    finally { setSaving(false); }
  }

  async function setStatus(q: Quotation, status: string) {
    setError(""); setMessage("");
    try {
      await apiRequest(`/quotations/${q.id}/status`, { method: "POST", token, businessId, body: { status } });
      setMessage(`${q.quotationNumber} marked ${status}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not change the status."); }
  }

  async function convert(q: Quotation) {
    const paid = window.prompt(`Convert ${q.quotationNumber} (${money(q.total)}) to a sale.\nAmount paid now (0 for credit; credit needs a customer):`, "0");
    if (paid === null) return;
    let method: string | null = null;
    let reference: string | null = null;
    if (Number(paid) > 0) {
      method = window.prompt("Payment method (cash, mpesa, bank, card)", "cash"); if (method === null) return;
      if (method.trim().toLowerCase() === "mpesa") {
        reference = window.prompt("M-Pesa transaction code (10 letters/digits, e.g. QGH7XK2LMN)", ""); if (reference === null) return;
      }
    }
    setError(""); setMessage("");
    try {
      const res = await apiRequest<{ sale: { receiptNumber: string } }>(`/quotations/${q.id}/convert`, {
        method: "POST", token, businessId, body: { amountPaid: Number(paid), ...(method && { paymentMethod: method.trim() }), ...(reference && { paymentReference: reference.trim() }) },
      });
      setMessage(`${q.quotationNumber} converted to sale ${res.data?.sale.receiptNumber ?? ""}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not convert the quotation."); }
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div><h2>Quotations</h2><p>Quote, get acceptance, then turn it into a sale in one click</p></div>
          {can("quotations.manage") && <button type="button" className="button-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close form" : "New quotation"}</button>}
        </div>

        {showForm && (
          <form onSubmit={create} style={{ display: "grid", gap: 12, margin: "16px 0" }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={labelStyle}>Customer (optional)
                <select style={fieldStyle} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">No customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label style={labelStyle}>Valid until (optional)<input style={fieldStyle} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></label>
              <label style={labelStyle}>Notes (optional)<input style={fieldStyle} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}>
                <label style={labelStyle}>Product
                  <select style={fieldStyle} value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                    <option value="">Select a product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.sellingPrice)}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Quantity<input style={fieldStyle} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></label>
                <label style={labelStyle}>Discount (KSh)<input style={fieldStyle} inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></label>
                <button type="button" className="button-secondary" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
            <div className="customer-actions">
              <button type="button" className="button-secondary" onClick={() => setLines([...lines, { ...emptyLine }])}>Add line</button>
              <strong>Estimated total {money(priced?.total ?? estimate)}</strong>
              <button type="submit" className="button-primary" disabled={saving || !lines.some((l) => l.productId)}>{saving ? "Creating…" : "Create quotation"}</button>
            </div>
          </form>
        )}

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead><tr><th>Quotation</th><th>Customer</th><th>Date</th><th>Valid until</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7}>Loading…</td></tr>}
              {!loading && quotes.length === 0 && <tr><td colSpan={7}>No quotations yet.</td></tr>}
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td><strong>{q.quotationNumber}</strong></td>
                  <td>{q.customerName ?? "—"}</td><td>{day(q.quotationDate)}</td><td>{day(q.expiryDate)}</td>
                  <td>{money(q.total)}</td>
                  <td>{q.status}{q.convertedReceiptNumber ? ` (${q.convertedReceiptNumber})` : ""}</td>
                  <td><div className="customer-actions">
                    <button type="button" className="button-secondary" onClick={() => setSelected(q)}>View / print</button>
                    {can("quotations.manage") && q.status === "draft" && <button type="button" className="button-secondary" onClick={() => void setStatus(q, "sent")}>Mark sent</button>}
                    {can("quotations.manage") && (q.status === "draft" || q.status === "sent") && <>
                      <button type="button" className="button-secondary" onClick={() => void setStatus(q, "accepted")}>Accepted</button>
                      <button type="button" className="button-secondary" onClick={() => void setStatus(q, "rejected")}>Rejected</button>
                    </>}
                    {can("quotations.manage") && q.status === "accepted" && <button type="button" className="button-primary" onClick={() => void convert(q)}>Convert to sale</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {selected && (
        <article className="panel" style={{ padding: 24 }}>
          <PrintDocument
            title="QUOTATION"
            number={selected.quotationNumber}
            partyLabel="Prepared for"
            party={{ name: selected.customer?.name ?? "Customer", lines: [selected.customer?.phone].filter((v): v is string => Boolean(v)) }}
            meta={[
              { label: "Date", value: day(selected.quotationDate) },
              ...(selected.expiryDate ? [{ label: "Valid until", value: day(selected.expiryDate) }] : []),
            ]}
            rows={selected.items.map((it) => ({ name: it.productName, qty: it.quantity, unitPrice: it.unitPrice, discount: it.discount, total: it.total }))}
            totals={[
              { label: "Subtotal", value: Number(selected.subtotal) },
              { label: "Discount", value: Number(selected.discount) },
              { label: selected.pricesIncludeVat ? "VAT (included in total)" : "Tax", value: Number(selected.tax) },
              { label: "Total", value: Number(selected.total), strong: true, emphasis: true },
            ]}
            notes={selected.notes}
            footer="Prices are the shop's prices on the quotation date and may change."
          />
          <div className="customer-actions no-print">
            <button type="button" className="button-primary" onClick={() => window.print()}>Print</button>
            <button type="button" className="button-secondary" onClick={() => setSelected(null)}>Close</button>
          </div>
        </article>
      )}
    </section>
  );
}
