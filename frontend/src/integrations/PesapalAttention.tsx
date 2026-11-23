import { AlertTriangle, RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { notify } from "../toast";
import { money } from "../money";
import { formatWhen } from "./IntegrationStatus";
import { session } from "./types";

type Item = {
  id: string; amount: string; phone: string; confirmationCode: string | null; message: string | null; paidAt: string | null; createdAt: string; requestedBy: string | null;
  dismissedAt: string | null; dismissedNote: string | null; dismissedBy: string | null;
};
type Data = { unlinked: Item[]; review: Item[]; reversed: Item[]; dismissed: Item[] };

/**
 * List of Pesapal money that needs a person. Nothing here is guessed: "confirmed" means Pesapal confirmed it,
 * "could not confirm" means we truly do not know. Hidden entirely when there is nothing to show (or no permission).
 */
export default function PesapalAttention() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<Item | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await apiRequest<Data>("/integrations/pesapal/attention", session());
      setData(r.data ?? null);
    } catch {
      setData(null); // no permission or offline: show nothing rather than something wrong
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function dismiss() {
    if (!closing) return;
    setSaving(true);
    try {
      await apiRequest(`/integrations/pesapal/payment-requests/${closing.id}/dismiss`, { ...session(), method: "POST", body: { note } });
      notify.success("Dismissed. You can restore it below.");
      setClosing(null); setNote("");
      await load();
    } catch (e) { notify.error(e instanceof Error ? e.message : "Could not dismiss"); }
    finally { setSaving(false); }
  }
  async function restore(i: Item) {
    try {
      await apiRequest(`/integrations/pesapal/payment-requests/${i.id}/restore`, { ...session(), method: "POST" });
      notify.success("Restored to the list");
      await load();
    } catch (e) { notify.error(e instanceof Error ? e.message : "Could not restore"); }
  }

  if (!data || (data.unlinked.length === 0 && data.review.length === 0 && data.reversed.length === 0 && data.dismissed.length === 0)) return null;

  const row = (i: Item, when: string | null) => (
    <tr key={i.id}>
      <td>{formatWhen(when)}</td>
      <td className="num">{money(Number(i.amount))}</td>
      <td>{i.confirmationCode ?? "—"}</td>
      <td>{i.phone ?? "—"}</td>
      <td>{i.requestedBy ?? "—"}</td>
      <td><button type="button" className="int-btn int-btn-small" onClick={() => { setClosing(i); setNote(""); }}>Dismiss</button></td>
    </tr>
  );

  return (
    <div className="int-attn" aria-label="Pesapal payments needing attention">
      <div className="int-attn-head">
        <h4><AlertTriangle size={16} aria-hidden /> Pesapal payments needing attention</h4>
        <button type="button" className="int-btn" onClick={() => void load()} disabled={busy}><RefreshCw size={14} className={busy ? "int-spin" : ""} /> Refresh</button>
      </div>

      {data.unlinked.length > 0 && (
        <section>
          <h5>Paid, but no sale was completed ({data.unlinked.length})</h5>
          <p>Pesapal confirmed these. Nothing was sold with them. Refund the customer in your Pesapal dashboard, or ring the sale up again and have the customer pay again, then dismiss these with a note saying what you did.</p>
          <div className="int-attn-scroll"><table><thead><tr><th>Paid</th><th className="num">Amount</th><th>Code</th><th>Phone</th><th>Asked by</th><th></th></tr></thead>
            <tbody>{data.unlinked.map((i) => row(i, i.paidAt))}</tbody></table></div>
        </section>
      )}

      {data.review.length > 0 && (
        <section>
          <h5>Could not confirm ({data.review.length}, last 30 days)</h5>
          <p>We could not tell whether the payment page was created or paid. Check your Pesapal dashboard or ask the customer before trying again.</p>
          <div className="int-attn-scroll"><table><thead><tr><th>Asked</th><th className="num">Amount</th><th>Code</th><th>Phone</th><th>Asked by</th><th></th></tr></thead>
            <tbody>{data.review.map((i) => row(i, i.createdAt))}</tbody></table></div>
        </section>
      )}

      {data.reversed.length > 0 && (
        <section>
          <h5>Reversed by Pesapal ({data.reversed.length}, last 30 days)</h5>
          <p>Pesapal reported these payments as reversed (money returned to the customer). If a sale used one, check that sale: it may now be unpaid.</p>
          <div className="int-attn-scroll"><table><thead><tr><th>Asked</th><th className="num">Amount</th><th>Code</th><th>Phone</th><th>Asked by</th><th></th></tr></thead>
            <tbody>{data.reversed.map((i) => row(i, i.createdAt))}</tbody></table></div>
        </section>
      )}

      {data.dismissed.length > 0 && (
        <section>
          <button type="button" className="stk-link" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide" : "Show"} dismissed ({data.dismissed.length})
          </button>
          {showDismissed && (
            <div className="int-attn-scroll"><table><thead><tr><th>Dismissed</th><th className="num">Amount</th><th>Code</th><th>By</th><th>Reason</th><th></th></tr></thead>
              <tbody>{data.dismissed.map((i) => (
                <tr key={i.id}>
                  <td>{formatWhen(i.dismissedAt)}</td><td className="num">{money(Number(i.amount))}</td><td>{i.confirmationCode ?? "—"}</td>
                  <td>{i.dismissedBy ?? "—"}</td><td className="int-attn-note">{i.dismissedNote}</td>
                  <td><button type="button" className="int-btn int-btn-small" onClick={() => void restore(i)}><Undo2 size={13} /> Restore</button></td>
                </tr>
              ))}</tbody></table></div>
          )}
        </section>
      )}

      {closing && (
        <div className="int-modal" role="dialog" aria-modal="true" aria-label="Dismiss payment">
          <div className="int-modal-box int-modal-small">
            <h3>Dismiss this payment?</h3>
            <p>{money(Number(closing.amount))}{closing.confirmationCode ? ` · ${closing.confirmationCode}` : ""}. It leaves this list but is never deleted. Write what you did about it.</p>
            <label className="int-field">
              <span>Reason (at least 5 characters)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="e.g. Refunded the customer in Pesapal, ref ..." />
            </label>
            <div className="int-form-actions">
              <button type="button" className="int-btn" onClick={() => setClosing(null)} disabled={saving}>Cancel</button>
              <button type="button" className="int-btn int-btn-primary" onClick={() => void dismiss()} disabled={saving || note.trim().length < 5}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
