import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { money } from "../money";

export type StkRequest = {
  id: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "expired" | "unconfirmed";
  amount: string;
  phone: string;
  message: string | null;
  mpesaReceipt: string | null;
};
export type StkMode = "phone" | "code";

type Props = {
  token: string;
  businessId: string;
  /** What the sale needs paid by M-PESA now, in shillings. */
  amount: number;
  mode: StkMode;
  request: StkRequest | null;
  onMode: (m: StkMode) => void;
  onRequest: (r: StkRequest | null) => void;
};

const PHONE = /^(?:\+?254|0)[71]\d{8}$/;
const POLL_MS = 3000;

/**
 * "Send request to phone" step. Sending only ASKS the customer to pay: nothing here treats a request as money
 * until the server reports "paid" (confirmed with Safaricom). Every status shown is what the server said.
 */
export default function MpesaStkPanel({ token, businessId, amount, mode, request, onMode, onRequest }: Props) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // One key per attempt: a double tap (or a retry after a dropped connection) can never ask the customer twice.
  const attemptKey = useRef<string>(crypto.randomUUID());
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!request || request.status !== "pending") return;
    const timer = setInterval(async () => {
      try {
        const r = await apiRequest<StkRequest>(`/integrations/mpesa/payment-requests/${request.id}`, { token, businessId });
        if (r.data && requestRef.current?.id === r.data.id) onRequest(r.data);
      } catch { /* offline for a moment: keep waiting, never guess */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [request?.id, request?.status, token, businessId, onRequest]);

  async function send() {
    setProblem("");
    if (!PHONE.test(phone.replace(/[\s-]/g, ""))) return setProblem("Enter a valid Safaricom number, e.g. 0712345678.");
    if (!Number.isFinite(amount) || amount <= 0) return setProblem("Enter the amount to be paid first.");
    if (Math.round(amount * 100) % 100 !== 0) return setProblem("M-PESA requests are for whole shillings. Adjust the amount paid.");
    setBusy(true);
    try {
      const r = await apiRequest<StkRequest>("/integrations/mpesa/payment-requests", {
        token, businessId, method: "POST", idempotencyKey: attemptKey.current,
        body: { amount: String(amount), phone: phone.trim() },
      });
      if (r.data) onRequest(r.data);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { onRequest(null); attemptKey.current = crypto.randomUUID(); setProblem(""); };
  const st = request?.status;

  return (
    <div className="stk-panel">
      <div className="stk-tabs" role="tablist" aria-label="How the customer pays by M-PESA">
        <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "on" : ""} disabled={!!request && st !== "failed" && st !== "cancelled" && st !== "expired"} onClick={() => onMode("phone")}>
          <Smartphone size={14} /> Send request to phone
        </button>
        <button type="button" role="tab" aria-selected={mode === "code"} className={mode === "code" ? "on" : ""} disabled={st === "pending" || st === "paid"} onClick={() => onMode("code")}>
          Enter code manually
        </button>
      </div>

      {mode === "phone" && !request && (
        <div className="stk-body">
          <label className="inventory-field">
            Customer's M-PESA number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder="0712 345 678" maxLength={16} />
          </label>
          <button type="button" className="pos-secondary-button" disabled={busy} onClick={() => void send()}>
            {busy ? <><Loader2 size={14} className="stk-spin" /> Sending…</> : `Send ${money(amount)} request`}
          </button>
          {problem && <p className="stk-bad" role="alert">{problem}</p>}
        </div>
      )}

      {mode === "phone" && request && (
        <div className={`stk-status stk-${st}`} role="status" aria-live="polite">
          {st === "pending" && (
            <>
              <p><Loader2 size={15} className="stk-spin" /><span><strong>Waiting for the customer</strong> to enter their M-PESA PIN on {request.phone}…</span></p>
              <p className="stk-hint">This is not payment yet. Complete sale unlocks only after Safaricom confirms.</p>
              <button type="button" className="stk-link" onClick={() => { if (window.confirm("The customer may still pay this request. Start over anyway?")) reset(); }}>Start over</button>
            </>
          )}
          {st === "paid" && (
            <p><CheckCircle2 size={15} /><span><strong>{money(request.amount)} received</strong>{request.mpesaReceipt ? ` · ${request.mpesaReceipt}` : ""}. Confirmed by Safaricom.</span></p>
          )}
          {(st === "failed" || st === "cancelled" || st === "expired") && (
            <>
              <p><XCircle size={15} /><span><strong>{st === "cancelled" ? "Customer cancelled" : st === "expired" ? "Timed out" : "Request failed"}.</strong> {request.message}</span></p>
              <button type="button" className="pos-secondary-button" onClick={reset}>Try again</button>
            </>
          )}
          {st === "unconfirmed" && (
            <>
              <p><XCircle size={15} /><span><strong>Not confirmed.</strong> {request.message}</span></p>
              <p className="stk-hint">Ask the customer whether they got a prompt or paid before trying again, or enter the code manually.</p>
              <button type="button" className="stk-link" onClick={reset}>Start over</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
