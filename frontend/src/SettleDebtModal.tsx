import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api/client";
import Letterhead from "./Letterhead";
import { mpesaCodeError, normalizeMpesaCode } from "./mpesa";
import { money } from "./money";

type Unpaid = {
  customer: { id: string; name: string };
  totalOwed: string;
  sales: { id: string; receiptNumber: string; saleDate: string; total: string; balanceDue: string }[];
};
type Settled = {
  customer: { balance: string };
  amount: string;
  allocations: { saleId: string; receiptNumber: string; paid: string; balanceAfter: string; status: string }[];
};

const auth = () => ({
  token: sessionStorage.getItem("pos_token") ?? "",
  businessId: sessionStorage.getItem("pos_business_id") ?? "",
});

/** Receive a payment from a customer; it clears their oldest unpaid sales first. */
export default function SettleDebtModal({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<Unpaid | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Settled | null>(null);
  const [paidWith, setPaidWith] = useState<{ method: string; reference: string; at: Date } | null>(null);
  const keyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    apiRequest<Unpaid>(`/customers/${encodeURIComponent(customerId)}/unpaid-sales`, auth())
      .then((r) => { if (r.data) { setData(r.data); setAmount(r.data.totalOwed); } })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load unpaid sales."));
  }, [customerId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data) return;
    setError("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > Number(data.totalOwed)) {
      setError(`Amount must be more than zero and at most ${money(data.totalOwed)}.`);
      return;
    }
    if (method === "mpesa") {
      const problem = mpesaCodeError(code);
      if (problem) { setError(problem); return; }
    }
    setBusy(true);
    try {
      const r = await apiRequest<Settled>(`/customers/${encodeURIComponent(customerId)}/payments`, {
        method: "POST",
        ...auth(),
        idempotencyKey: keyRef.current,
        body: { amount: value, method, ...(method === "mpesa" && { reference: normalizeMpesaCode(code) }) },
      });
      if (r.data) {
        setPaidWith({ method, reference: method === "mpesa" ? normalizeMpesaCode(code) : "", at: new Date() });
        setDone(r.data);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Receive payment">
      <div className="sale-detail-dialog" style={{ maxWidth: 560, padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Receive payment{data ? ` from ${data.customer.name}` : ""}</h2>
        {error && <p role="alert" style={{ color: "#a1352a", background: "#fff5f3", padding: 10, borderRadius: 8 }}>{error}</p>}
        {!data && !error && <p>Loading...</p>}

        {done ? (
          <>
            <div className="sale-receipt-print-area">
              <Letterhead />
              <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>PAYMENT RECEIPT</h1>
              <p style={{ margin: "0 0 10px", color: "#59665d", fontSize: 13 }}>
                {(paidWith?.at ?? new Date()).toLocaleString("en-KE")} · Received from {data?.customer.name}
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>{money(done.amount)}</strong> received by {paidWith?.method === "mpesa" ? "M-Pesa" : (paidWith?.method ?? "").replace("_", " ")}
                {paidWith?.reference ? ` (code ${paidWith.reference})` : ""}.
              </p>
            <div className="receipt-items-scroll"><table className="receipt-items-table" style={{ minWidth: 0, width: "100%" }}>
              <thead><tr><th>Receipt</th><th>Paid now</th><th>Still owed</th></tr></thead>
              <tbody>
                {done.allocations.map((a) => (
                  <tr key={a.saleId}><td>{a.receiptNumber}</td><td>{money(a.paid)}</td><td>{Number(a.balanceAfter) === 0 ? "Cleared" : money(a.balanceAfter)}</td></tr>
                ))}
              </tbody>
            </table></div>
              <p style={{ marginTop: 10 }}>Balance still owed: <strong>{money(done.customer.balance)}</strong></p>
              <p style={{ fontSize: 12, color: "#59665d" }}>Thank you.</p>
            </div>
            <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="button-primary" type="button" onClick={() => window.print()}>Print receipt</button>
              <button className="button-secondary" type="button" onClick={onClose}>Close</button>
            </div>
          </>
        ) : data && data.sales.length === 0 ? (
          <><p>This customer owes nothing.</p><button className="button-secondary" type="button" onClick={onClose}>Close</button></>
        ) : data ? (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>Total owed: <strong>{money(data.totalOwed)}</strong>. Payment clears the oldest sales first.</p>
            <div className="table-scroll" style={{ maxHeight: 180 }}>
              <table>
                <thead><tr><th>Receipt</th><th>Date</th><th>Total</th><th>Owed</th></tr></thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.id}><td>{s.receiptNumber}</td><td>{new Date(s.saleDate).toLocaleDateString("en-KE")}</td><td>{money(s.total)}</td><td>{money(s.balanceDue)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label>Amount received (KSh)
              <input type="number" min="0.01" step="0.01" max={data.totalOwed} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ display: "block", width: "100%" }} required />
            </label>
            <label>Payment method
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ display: "block", width: "100%" }}>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            {method === "mpesa" && (
              <label>M-Pesa transaction code
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={14} placeholder="e.g. QGH7XK2LMN" autoComplete="off" style={{ display: "block", width: "100%" }} />
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Record payment"}</button>
              <button className="button-secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="button-secondary" type="button" onClick={onClose}>Close</button>
        )}
      </div>
    </div>
  );
}
