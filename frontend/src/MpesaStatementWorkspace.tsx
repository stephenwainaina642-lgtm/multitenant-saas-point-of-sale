import { Radio, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api/client";
import { money } from "./money";
import { session } from "./integrations/types";
import "./integrations/integrations.css";

type Item = {
  id: string; transId: string; amount: string; transTime: string; receivedAt: string; billRef: string | null;
  phone: string | null; name: string | null; viaTill: "prompt" | "sale" | null; environment: string;
};
type Data = {
  c2b: { registered: boolean; environment: string | null };
  today: { count: number; total: string };
  items: Item[]; hasMore: boolean;
};
const POLL_MS = 5000;

/**
 * Live M-PESA statement: every payment Safaricom tells us about for your shortcode, even ones nobody prompted for.
 * These are reports from Safaricom's notifications (they are not signed and cannot be double-checked), so they are
 * a statement to read, not something that settles a sale. Compare with the Safaricom portal for official records.
 */
export default function MpesaStatementWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [extra, setExtra] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const [err, setErr] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async () => {
    try {
      const r = await apiRequest<Data>(`/integrations/mpesa/statement?limit=50${qRef.current.trim() ? `&q=${encodeURIComponent(qRef.current.trim())}` : ""}`, session());
      const d = r.data;
      if (!d) return;
      setErr("");
      const ids = new Set(d.items.map((i) => i.id));
      if (seen.current) {
        const added = d.items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 6000);
        }
      }
      seen.current = new Set([...(seen.current ?? []), ...ids]);
      setData(d);
      setHasMore(d.hasMore);
      setExtra([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the statement");
    }
  }, []);

  useEffect(() => { void load(); }, [load, q]);
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [live, load]);

  async function more() {
    const last = [...(data?.items ?? []), ...extra].at(-1);
    if (!last) return;
    try {
      const r = await apiRequest<Data>(`/integrations/mpesa/statement?limit=50&before=${last.id}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`, session());
      if (r.data) { setExtra((e) => [...e, ...r.data!.items]); setHasMore(r.data.hasMore); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load more"); }
  }

  const items = [...(data?.items ?? []), ...extra];
  const when = (iso: string) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <section className="int-statement">
      <header className="int-statement-head">
        <div>
          <h2>M-PESA statement</h2>
          <p>Every payment Safaricom reports for your shortcode, as it arrives, even when nobody was prompted.</p>
        </div>
        <div className="int-statement-tools">
          <span className={`int-live ${live && !err ? "on" : ""}`}><Radio size={14} /> {err ? "Reconnecting…" : live ? "Live" : "Paused"}</span>
          <button type="button" className="pos-secondary-button" onClick={() => setLive((v) => !v)}>{live ? "Pause" : "Resume"}</button>
          <button type="button" className="pos-secondary-button" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={14} /></button>
        </div>
      </header>

      {data && !data.c2b.registered && (
        <div className="int-note" role="status">
          Live payments are not switched on yet. An owner can do it in Settings → Integrations → M-PESA → “Live statement”. Until then nothing new will appear here.
        </div>
      )}
      {err && <p className="stk-bad" role="alert">{err}. Showing the last statement we loaded.</p>}

      <div className="int-statement-totals">
        <div><span>Received today</span><strong>{money(Number((data?.today.total ?? "0").replace(/,/g, "")))}</strong></div>
        <div><span>Payments today</span><strong>{data?.today.count ?? 0}</strong></div>
      </div>

      <label className="int-search"><Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt, phone, name or account…" maxLength={40} />
      </label>

      <div className="int-attn-scroll">
        <table>
          <thead><tr><th>Time</th><th>Receipt</th><th className="num">Amount</th><th>From</th><th>Account / ref</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="int-empty">{data ? "No payments yet." : "Loading…"}</td></tr>}
            {items.map((i) => (
              <tr key={i.id} className={fresh.has(i.id) ? "int-new" : ""}>
                <td>{when(i.transTime)}</td>
                <td><code>{i.transId}</code></td>
                <td className="num">{money(Number(i.amount.replace(/,/g, "")))}</td>
                <td>{i.name ?? "—"}{i.phone ? <small> · {i.phone}</small> : null}</td>
                <td>{i.billRef ?? "—"}</td>
                <td>{i.viaTill === "sale" ? <span className="int-pill ok">Till sale</span> : i.viaTill === "prompt" ? <span className="int-pill">Till prompt</span> : null}{i.environment === "sandbox" ? <span className="int-pill warn">Test</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && <button type="button" className="pos-secondary-button" onClick={() => void more()}>Show older</button>}
      <p className="stk-hint">These are Safaricom's notifications, not a bank statement. Rarely a notification can arrive late or not at all, so use your Safaricom portal for official records.</p>
    </section>
  );
}
