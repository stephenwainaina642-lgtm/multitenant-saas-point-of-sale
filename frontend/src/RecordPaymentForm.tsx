import { useRef, useState } from "react";
import { apiRequest } from "./api/client";
import { mpesaCodeError, normalizeMpesaCode } from "./mpesa";
import { money } from "./money";

type Props = { saleId: string; balanceDue: number; onRecorded: () => void };


/** Records a payment against an unpaid or part-paid sale (for example a customer settling credit). */
export default function RecordPaymentForm({ saleId, balanceDue, onRecorded }: Props) {
  const [amount, setAmount] = useState(String(balanceDue));
  const [method, setMethod] = useState("cash");
  const [code, setCode] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per form: submitting twice (double tap, bad network) records one payment.
  const keyRef = useRef(crypto.randomUUID());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > balanceDue) {
      setError(`Amount must be more than zero and at most the balance due (${money(balanceDue)}).`);
      return;
    }
    if (method === "mpesa") {
      const problem = mpesaCodeError(code);
      if (problem) { setError(problem); return; }
    }
    setBusy(true);
    try {
      await apiRequest("/payments", {
        method: "POST",
        token: sessionStorage.getItem("pos_token") ?? "",
        businessId: sessionStorage.getItem("pos_business_id") ?? "",
        idempotencyKey: keyRef.current,
        body: {
          saleId,
          amount: value,
          method,
          ...(method === "mpesa" ? { reference: normalizeMpesaCode(code) } : reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      keyRef.current = crypto.randomUUID();
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10, marginTop: 14, padding: 14, border: "1px solid #dfe7e2", borderRadius: 8 }}>
      <strong>Record a payment</strong>
      <p style={{ margin: 0, color: "#64746b", fontSize: 13 }}>Balance due: {money(balanceDue)}</p>
      {error && <p role="alert" style={{ margin: 0, color: "#a1352a", background: "#fff5f3", padding: 10, borderRadius: 8 }}>{error}</p>}
      <label>
        Amount (KSh)
        <input type="number" min="0.01" step="0.01" max={balanceDue} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ display: "block", width: "100%" }} required />
      </label>
      <label>
        Payment method
        <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ display: "block", width: "100%" }}>
          <option value="cash">Cash</option>
          <option value="mpesa">M-Pesa</option>
          <option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
      </label>
      {method === "mpesa" ? (
        <label>
          M-Pesa transaction code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={14} placeholder="e.g. QGH7XK2LMN" autoComplete="off" style={{ display: "block", width: "100%" }} />
        </label>
      ) : (
        <label>
          Reference (optional)
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} style={{ display: "block", width: "100%" }} />
        </label>
      )}
      <button className="button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Record payment"}</button>
    </form>
  );
}
