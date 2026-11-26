import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import { notify } from "./toast";

type Shortfall = {
  id: string; product: string; sku: string | null; unit: string | null; quantityShort: string | number;
  receiptNumber: string | null; soldOfflineAt: string | null; recordedAt: string;
  resolvedAt: string | null; resolvedNote: string | null;
};

/**
 * When a till sold offline and another till had already sold the same stock, the sale is still recorded
 * (the customer was served) but stock cannot go below zero. Each such difference is listed here for a manager
 * to look into (recount, correct a delivery that was never entered) and mark as reviewed.
 * Marking one reviewed only writes a note; it never changes stock or the sale.
 */
export default function OfflineShortfallsPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Shortfall[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const load = useCallback(async () => {
    try {
      const r = await apiRequest<Shortfall[]>("/inventory/offline-shortfalls", { token, businessId });
      setRows(r.data ?? []);
    } catch { /* offline or no access: nothing to show */ }
  }, [token, businessId]);
  useEffect(() => { void load(); }, [load]);

  const open = rows.filter((r) => !r.resolvedAt);
  const done = rows.filter((r) => r.resolvedAt);
  if (open.length === 0 && !(showDone && done.length)) {
    return done.length ? (
      <section className="inventory-panel"><h2>Offline sales to review</h2>
        <p className="inventory-muted">Nothing needs review. <button type="button" className="pos-secondary-button" onClick={() => setShowDone(true)}>Show {done.length} reviewed</button></p></section>
    ) : null;
  }

  async function resolve(id: string) {
    if (note.trim().length < 5) { notify.error("Write a short note (at least 5 characters) saying what you found."); return; }
    setBusy(true);
    try {
      await apiRequest(`/inventory/offline-shortfalls/${id}/resolve`, { method: "POST", token, businessId, body: { note: note.trim() } });
      notify.success("Marked as reviewed.");
      setResolving(null); setNote("");
      await load(); onChanged?.();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Could not save.");
    } finally { setBusy(false); }
  }

  const list = showDone ? rows : open;
  return (
    <section className="inventory-panel">
      <h2>Offline sales to review ({open.length})</h2>
      <p className="inventory-muted">
        These sales were rung up with no internet after the stock had already been sold elsewhere. The sale is recorded and stock is held at zero;
        recount the shelf and correct stock if needed, then mark each one reviewed.
        <button type="button" className="pos-secondary-button" style={{ marginLeft: 8 }} onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide reviewed" : "Show reviewed"}</button>
      </p>
      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead><tr><th>Product</th><th>Short by</th><th>Receipt</th><th>SOLD (OFFLINE)</th><th></th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.product}{r.sku ? ` (${r.sku})` : ""}</td>
                <td>{Number(r.quantityShort).toLocaleString("en-KE", { maximumFractionDigits: 3 })} {r.unit ?? ""}</td>
                <td>{r.receiptNumber ?? "—"}</td>
                <td>{new Date(r.soldOfflineAt ?? r.recordedAt).toLocaleString("en-KE")}</td>
                <td>
                  {r.resolvedAt ? <span className="inventory-muted">Reviewed: {r.resolvedNote}</span>
                    : !can("inventory.adjust") ? null
                    : resolving === r.id ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <input className="inventory-search" style={{ minWidth: 180 }} value={note} maxLength={300} placeholder="What did you find?" onChange={(e) => setNote(e.target.value)} />
                        <button type="button" className="pos-secondary-button" disabled={busy} onClick={() => void resolve(r.id)}>Save</button>
                        <button type="button" className="pos-secondary-button" onClick={() => { setResolving(null); setNote(""); }}>Cancel</button>
                      </span>
                    ) : <button type="button" className="pos-secondary-button" onClick={() => { setResolving(r.id); setNote(""); }}>Mark reviewed</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
