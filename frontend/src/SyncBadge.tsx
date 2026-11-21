import { useState } from "react";
import { CloudOff } from "lucide-react";
import { discardSale, flushOutbox, retrySale, useOutbox } from "./salesOutbox";
import { money } from "./money";


/** Shows sales still on this device and lets the cashier retry or discard the ones the server rejected. */
export default function SyncBadge() {
  const queue = useOutbox();
  const [open, setOpen] = useState(false);
  if (queue.length === 0) return null;
  const failed = queue.filter((q) => q.status === "failed").length;
  const waiting = queue.length - failed;
  return (
    <>
      <button type="button" className={`sync-badge${failed ? " sync-badge-failed" : ""}`} onClick={() => setOpen(true)} title="Sales saved on this device">
        <CloudOff size={15} aria-hidden="true" />
        {waiting > 0 && <span>{waiting} {waiting === 1 ? "sale" : "sales"} waiting to sync</span>}
        {failed > 0 && <span>{waiting > 0 ? " · " : ""}{failed} need{failed === 1 ? "s" : ""} attention</span>}
      </button>
      {open && (
        <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Sales waiting to sync" onClick={() => setOpen(false)}>
          <div className="sale-detail-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Sales on this device</h3>
            <p className="inventory-muted">These are saved safely here and sent to the server automatically. You can't sign out until they are sent.</p>
            <ul className="sync-list">
              {queue.map((q) => (
                <li key={q.key}>
                  <div>
                    <strong>{money(q.receipt.total)}</strong> · {q.receipt.items.length} {q.receipt.items.length === 1 ? "item" : "items"} ·{" "}
                    {new Date(q.createdAt).toLocaleTimeString("en-KE", { timeStyle: "short" })}
                    <div className="inventory-muted">{q.status === "failed" ? `Rejected: ${q.error}` : q.attempts > 0 ? "Waiting for a connection…" : "Sending…"}</div>
                  </div>
                  {q.status === "failed" && (
                    <div className="sync-actions">
                      <button type="button" className="pos-secondary-button" onClick={() => retrySale(q.key)}>Try again</button>
                      <button type="button" className="pos-secondary-button" onClick={() => { if (window.confirm("Discard this sale? It will NOT be recorded.")) discardSale(q.key); }}>Discard</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="sync-actions">
              <button type="button" className="pos-primary-button" onClick={() => void flushOutbox()}>Send now</button>
              <button type="button" className="pos-secondary-button" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
