import { AlertTriangle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { money } from "../money";
import { formatWhen } from "./IntegrationStatus";
import { session } from "./types";

type Item = { id: string; amount: string; phone: string; mpesaReceipt: string | null; message: string | null; paidAt: string | null; createdAt: string; requestedBy: string | null };
type Data = { unlinked: Item[]; review: Item[] };

/**
 * Read-only list of M-PESA money that needs a person. Nothing here is guessed: "confirmed" means Safaricom confirmed it,
 * "could not confirm" means we truly do not know. Hidden entirely when there is nothing to show (or no permission).
 */
export default function MpesaAttention() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await apiRequest<Data>("/integrations/mpesa/attention", session());
      setData(r.data ?? null);
    } catch {
      setData(null); // no permission or offline: show nothing rather than something wrong
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!data || (data.unlinked.length === 0 && data.review.length === 0)) return null;

  const row = (i: Item, when: string | null) => (
    <tr key={i.id}>
      <td>{formatWhen(when)}</td>
      <td className="num">{money(Number(i.amount))}</td>
      <td>{i.mpesaReceipt ?? "—"}</td>
      <td>{i.phone}</td>
      <td>{i.requestedBy ?? "—"}</td>
    </tr>
  );

  return (
    <div className="int-attn" aria-label="M-PESA payments needing attention">
      <div className="int-attn-head">
        <h4><AlertTriangle size={16} aria-hidden /> M-PESA payments needing attention</h4>
        <button type="button" className="int-btn" onClick={() => void load()} disabled={busy}><RefreshCw size={14} className={busy ? "int-spin" : ""} /> Refresh</button>
      </div>

      {data.unlinked.length > 0 && (
        <section>
          <h5>Paid, but no sale was completed ({data.unlinked.length})</h5>
          <p>Safaricom confirmed these. Ring the sale up on a till with <strong>M-Pesa</strong> and type the receipt code below as the code, for exactly the amount shown, and it will be settled here automatically. Otherwise refund the customer outside nexaPOS.</p>
          <div className="int-attn-scroll"><table><thead><tr><th>Paid</th><th className="num">Amount</th><th>Receipt</th><th>Phone</th><th>Asked by</th></tr></thead>
            <tbody>{data.unlinked.map((i) => row(i, i.paidAt))}</tbody></table></div>
        </section>
      )}

      {data.review.length > 0 && (
        <section>
          <h5>Could not confirm ({data.review.length}, last 30 days)</h5>
          <p>We could not tell whether the customer was asked or paid. Check the M-PESA statement or ask the customer before trying again.</p>
          <div className="int-attn-scroll"><table><thead><tr><th>Asked</th><th className="num">Amount</th><th>Receipt</th><th>Phone</th><th>Asked by</th></tr></thead>
            <tbody>{data.review.map((i) => row(i, i.createdAt))}</tbody></table></div>
        </section>
      )}
    </div>
  );
}
