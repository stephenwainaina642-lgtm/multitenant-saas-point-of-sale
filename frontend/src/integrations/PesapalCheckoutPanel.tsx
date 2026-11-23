import { CheckCircle2, Copy, ExternalLink, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiRequest } from "../api/client";
import { money } from "../money";

export type PesapalRequest = {
  id: string;
  status: "pending" | "paid" | "failed" | "reversed" | "expired" | "unconfirmed";
  amount: string;
  message: string | null;
  confirmationCode: string | null;
  checkoutUrl: string | null;
  reversalNoticed: boolean;
};

type Props = {
  token: string;
  businessId: string;
  /** What the sale needs paid through Pesapal now, in shillings. */
  amount: number;
  request: PesapalRequest | null;
  onRequest: (r: PesapalRequest | null) => void;
};

const POLL_MS = 3000;

/**
 * Pesapal hosted checkout. Creating a link only gives the customer a page to pay on: nothing here treats it as money
 * until the server reports "paid" (confirmed with Pesapal itself). Every status shown is what the server said.
 */
export default function PesapalCheckoutPanel({ token, businessId, amount, request, onRequest }: Props) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [qr, setQr] = useState("");
  const attemptKey = useRef<string>(crypto.randomUUID());
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!request || request.status !== "pending") return;
    const timer = setInterval(async () => {
      try {
        const r = await apiRequest<PesapalRequest>(`/integrations/pesapal/payment-requests/${request.id}`, { token, businessId });
        if (r.data && requestRef.current?.id === r.data.id) onRequest(r.data);
      } catch { /* offline for a moment: keep waiting, never guess */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [request?.id, request?.status, token, businessId, onRequest]);

  // The QR is drawn here in the browser from the link; the link is never sent to a third-party QR service.
  useEffect(() => {
    let live = true;
    setQr("");
    if (request?.status === "pending" && request.checkoutUrl) {
      QRCode.toDataURL(request.checkoutUrl, { margin: 1, width: 192 }).then((u) => { if (live) setQr(u); }).catch(() => {});
    }
    return () => { live = false; };
  }, [request?.id, request?.status, request?.checkoutUrl]);

  async function create() {
    setProblem("");
    if (!phone.trim() && !email.trim()) return setProblem("Enter the customer's phone number or email address.");
    if (!Number.isFinite(amount) || amount <= 0) return setProblem("Enter the amount to be paid first.");
    setBusy(true);
    try {
      const r = await apiRequest<PesapalRequest>("/integrations/pesapal/payment-requests", {
        token, businessId, method: "POST", idempotencyKey: attemptKey.current,
        body: { amount: String(amount), ...(phone.trim() && { phone: phone.trim() }), ...(email.trim() && { email: email.trim() }) },
      });
      if (r.data) onRequest(r.data);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not create the payment link");
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { onRequest(null); attemptKey.current = crypto.randomUUID(); setProblem(""); };
  const st = request?.status;

  return (
    <div className="stk-panel">
      {!request && (
        <div className="stk-body">
          <label className="inventory-field">
            Customer's phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder="0712 345 678" maxLength={20} />
          </label>
          <label className="inventory-field">
            or email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="customer@example.com" maxLength={254} />
          </label>
          <button type="button" className="pos-secondary-button" disabled={busy} onClick={() => void create()}>
            {busy ? <><Loader2 size={14} className="stk-spin" /> Creating…</> : `Create ${money(amount)} payment link`}
          </button>
          {problem && <p className="stk-bad" role="alert">{problem}</p>}
        </div>
      )}

      {request && (
        <div className={`stk-status stk-${st}`} role="status" aria-live="polite">
          {st === "pending" && (
            <>
              <p><Loader2 size={15} className="stk-spin" /><span><strong>Waiting for the customer</strong> to pay on the Pesapal page…</span></p>
              {request.checkoutUrl && (
                <div className="psp-share">
                  {qr && <img src={qr} alt="QR code for the customer to scan and pay" width={160} height={160} />}
                  <div className="psp-links">
                    <a className="pos-secondary-button" href={request.checkoutUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open payment page</a>
                    <button type="button" className="pos-secondary-button" onClick={() => void navigator.clipboard?.writeText(request.checkoutUrl!)}><Copy size={14} /> Copy link</button>
                  </div>
                </div>
              )}
              <p className="stk-hint">Not payment yet. Complete sale unlocks only after Pesapal confirms.</p>
              <button type="button" className="stk-link" onClick={() => { if (window.confirm("The customer may still pay this link. Start over anyway?")) reset(); }}>Start over</button>
            </>
          )}
          {st === "paid" && (
            <p><CheckCircle2 size={15} /><span><strong>{money(request.amount)} received</strong>{request.confirmationCode ? ` · ${request.confirmationCode}` : ""}. Confirmed by Pesapal.</span></p>
          )}
          {(st === "failed" || st === "expired" || st === "reversed") && (
            <>
              <p><XCircle size={15} /><span><strong>{st === "expired" ? "Timed out" : st === "reversed" ? "Payment reversed" : "Payment failed"}.</strong> {request.message}</span></p>
              <button type="button" className="pos-secondary-button" onClick={reset}>Try again</button>
            </>
          )}
          {st === "unconfirmed" && (
            <>
              <p><XCircle size={15} /><span><strong>Not confirmed.</strong> {request.message}</span></p>
              <p className="stk-hint">Check with the customer before trying again so they are not charged twice.</p>
              <button type="button" className="stk-link" onClick={reset}>Start over</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
