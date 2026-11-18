import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import Letterhead from "./Letterhead";

type Live = { totalsByMethod: Record<string, string>; cashReceived: string; cashRefunded: string; cashSupplier: string; expectedCash: string };
type Shift = {
  id: string; status: "open" | "closed"; openedByName: string | null; openedAt: string; openingFloat: string;
  closedAt: string | null; closedByName: string | null; cashReceived: string | null; cashRefunded: string | null; cashSupplier: string | null;
  cashPaidOut: string | null; expectedCash: string | null; countedCash: string | null; variance: string | null;
  totalsByMethod: Record<string, string> | null; closeNote: string | null; managerNote: string | null; live?: Live;
};

const kes = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 });
const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "");
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const cents = (v: string) => Math.round(Number(v || 0) * 100);

const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit", background: "#fff" };
const label: React.CSSProperties = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "#344b40" };
const button: React.CSSProperties = { padding: "10px 16px", border: 0, borderRadius: 8, background: "#176b4d", color: "#fff", font: "inherit", fontWeight: 700, cursor: "pointer" };
const ghost: React.CSSProperties = { ...button, background: "#fff", color: "#24372e", border: "1px solid #dfe7e2" };
const panel: React.CSSProperties = { padding: 20, border: "1px solid #e3ebe5", borderRadius: 12, background: "#fff" };
const varianceColor = (v: string | null) => (Number(v) === 0 ? "#176b4d" : Number(v) < 0 ? "#b3412f" : "#8a5a00");
const varianceText = (v: string | null) => (Number(v) === 0 ? "Balanced" : Number(v) < 0 ? `Short ${kes(Math.abs(Number(v)))}` : `Over ${kes(v)}`);

export default function ShiftsWorkspace() {
  const token = sessionStorage.getItem("pos_token") || "";
  const businessId = sessionStorage.getItem("pos_business_id") || "";
  const canUse = can("shifts.use");
  const canSeeAll = can("shifts.view_all");
  const [current, setCurrent] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [viewing, setViewing] = useState<Shift | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openFloat, setOpenFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [paidOut, setPaidOut] = useState("");
  const [note, setNote] = useState("");
  const [managerNote, setManagerNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([
        canUse ? apiRequest<Shift | null>("/shifts/current", { token, businessId }) : Promise.resolve(null),
        apiRequest<Shift[]>("/shifts", { token, businessId }),
      ]);
      setCurrent(c?.data ?? null); setHistory(h.data ?? []); setError("");
    } catch (e) { setError(msg(e)); }
  }, [token, businessId, canUse]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  const open = () => run(async () => { await apiRequest("/shifts/open", { method: "POST", token, businessId, body: { openingFloat: Number(openFloat || 0) } }); setOpenFloat(""); });
  const close = () => run(async () => {
    const r = await apiRequest<Shift>(`/shifts/${current!.id}/close`, { method: "POST", token, businessId, body: { countedCash: Number(counted), cashPaidOut: Number(paidOut || 0), note } });
    setCounted(""); setPaidOut(""); setNote(""); setViewing(r.data ?? null);
  });
  const saveManagerNote = () => run(async () => {
    const r = await apiRequest<Shift>(`/shifts/${viewing!.id}/note`, { method: "POST", token, businessId, body: { note: managerNote } });
    setViewing(r.data ?? null);
  });

  const live = current?.live;
  const previewExpected = live ? cents(live.expectedCash) - cents(paidOut) : 0;
  const previewVariance = counted === "" ? null : (cents(counted) - previewExpected) / 100;

  return (
    <div className="workspace-content" style={{ display: "grid", gap: 20 }}>
      {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}

      {canUse && !current && (
        <section style={panel} className="no-print">
          <h3 style={{ margin: "0 0 6px" }}>Start your shift</h3>
          <p style={{ margin: "0 0 14px", color: "#6b7a70", fontSize: 13 }}>Count the cash already in the drawer (the float) and enter it. Everything you take from now until you close is tallied automatically.</p>
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div style={{ minWidth: 200 }}><label style={label}>Opening float (KES)</label><input style={field} type="number" min="0" step="0.01" inputMode="decimal" value={openFloat} onChange={(e) => setOpenFloat(e.target.value)} placeholder="0.00" /></div>
            <button style={button} disabled={busy} onClick={open}>Open shift</button>
          </div>
        </section>
      )}

      {current && live && (
        <section style={panel} className="no-print">
          <h3 style={{ margin: "0 0 4px" }}>Your shift is open</h3>
          <p style={{ margin: "0 0 14px", color: "#6b7a70", fontSize: 13 }}>Since {when(current.openedAt)}. Figures update as you sell.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 16 }}>
            {[["Opening float", current.openingFloat], ["Cash received", live.cashReceived], ["Cash refunded", live.cashRefunded], ["Paid to suppliers (cash)", live.cashSupplier], ["Expected in drawer", live.expectedCash]].map(([l, v]) => (
              <div key={l} style={{ padding: 12, border: "1px solid #e3ebe5", borderRadius: 10 }}><div style={{ fontSize: 12, color: "#6b7a70" }}>{l}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{kes(v)}</div></div>
            ))}
          </div>
          {Object.keys(live.totalsByMethod).length > 0 && <p style={{ margin: "0 0 16px", fontSize: 13, color: "#52625a" }}>Taken by method: {Object.entries(live.totalsByMethod).map(([m, v]) => `${m} ${kes(v)}`).join(" · ")}</p>}
          <h4 style={{ margin: "0 0 10px" }}>Close shift</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <div><label style={label}>Cash counted in drawer (KES)</label><input style={field} type="number" min="0" step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
            <div><label style={label}>Other cash taken out (optional)</label><input style={field} type="number" min="0" step="0.01" inputMode="decimal" value={paidOut} onChange={(e) => setPaidOut(e.target.value)} placeholder="e.g. petty cash" /></div>
          </div>
          {previewVariance !== null && <p style={{ margin: "12px 0 0", fontWeight: 700, color: varianceColor(String(previewVariance)) }}>{varianceText(String(previewVariance))} (expected {kes(previewExpected / 100)})</p>}
          <div style={{ marginTop: 12 }}><label style={label}>Note {previewVariance !== null && previewVariance !== 0 ? "(required: explain the difference)" : "(optional)"}</label><textarea style={{ ...field, minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
          <button style={{ ...button, marginTop: 12 }} disabled={busy || counted === ""} onClick={close}>Close shift</button>
        </section>
      )}

      <section style={panel}>
        <h3 className="no-print" style={{ margin: "0 0 12px" }}>{canSeeAll ? "All shifts" : "My shifts"}</h3>
        <div className="no-print" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Opened", "Cashier", "Float", "Expected", "Counted", "Result", "Status", ""].map((h) => <th key={h} style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid #e8eee9" }}>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{when(s.openedAt)}</td><td style={{ padding: "9px 10px" }}>{s.openedByName}</td>
                  <td style={{ padding: "9px 10px" }}>{kes(s.openingFloat)}</td><td style={{ padding: "9px 10px" }}>{s.expectedCash ? kes(s.expectedCash) : "–"}</td><td style={{ padding: "9px 10px" }}>{s.countedCash ? kes(s.countedCash) : "–"}</td>
                  <td style={{ padding: "9px 10px", color: varianceColor(s.variance), fontWeight: 700, whiteSpace: "nowrap" }}>{s.status === "closed" ? varianceText(s.variance) : "–"}</td>
                  <td style={{ padding: "9px 10px" }}>{s.status === "open" ? "Open" : "Closed"}</td>
                  <td style={{ padding: "9px 10px" }}>{s.status === "closed" && <button style={{ ...ghost, padding: "5px 10px", fontSize: 12 }} onClick={() => { setViewing(s); setManagerNote(s.managerNote ?? ""); }}>View</button>}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={8} style={{ padding: 18, textAlign: "center", color: "#6b7a70" }}>No shifts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {viewing && (
        <section style={panel} className="receipt-print-area">
          <Letterhead />
          <h3 style={{ margin: "0 0 4px" }}>Cash-up summary</h3>
          <p style={{ margin: "0 0 12px", color: "#52625a", fontSize: 13 }}>{viewing.openedByName} · {when(viewing.openedAt)} to {when(viewing.closedAt)}{viewing.closedByName && viewing.closedByName !== viewing.openedByName ? ` · closed by ${viewing.closedByName}` : ""}</p>
          <table style={{ width: "100%", maxWidth: 460, borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              {([["Opening float", viewing.openingFloat, "+"], ["Cash received", viewing.cashReceived, "+"], ["Cash refunded", viewing.cashRefunded, "−"], ["Paid to suppliers (cash)", viewing.cashSupplier, "−"], ["Other cash taken out", viewing.cashPaidOut, "−"]] as const).map(([l, v, sign]) => (
                <tr key={l}><td style={{ padding: "4px 0" }}>{sign} {l}</td><td style={{ textAlign: "right" }}>{kes(v)}</td></tr>
              ))}
              <tr style={{ borderTop: "1px solid #cfd9d2", fontWeight: 700 }}><td style={{ padding: "6px 0" }}>Expected cash</td><td style={{ textAlign: "right" }}>{kes(viewing.expectedCash)}</td></tr>
              <tr style={{ fontWeight: 700 }}><td style={{ padding: "4px 0" }}>Counted cash</td><td style={{ textAlign: "right" }}>{kes(viewing.countedCash)}</td></tr>
              <tr style={{ fontWeight: 700, color: varianceColor(viewing.variance) }}><td style={{ padding: "4px 0" }}>Result</td><td style={{ textAlign: "right" }}>{varianceText(viewing.variance)}</td></tr>
            </tbody>
          </table>
          {viewing.totalsByMethod && <p style={{ fontSize: 13 }}>Taken by method: {Object.entries(viewing.totalsByMethod).map(([m, v]) => `${m} ${kes(v)}`).join(" · ") || "nothing"}</p>}
          {viewing.closeNote && <p style={{ fontSize: 13 }}><strong>Cashier note:</strong> {viewing.closeNote}</p>}
          {viewing.managerNote && <p style={{ fontSize: 13 }}><strong>Manager note:</strong> {viewing.managerNote}</p>}
          <p style={{ fontSize: 12, color: "#6b7a70", marginTop: 24 }}>Cashier signature: ____________________ &nbsp;&nbsp; Manager signature: ____________________</p>
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
            <button style={button} onClick={() => window.print()}>Print</button>
            <button style={ghost} onClick={() => setViewing(null)}>Close</button>
            {canSeeAll && <><div style={{ flex: 1, minWidth: 220 }}><label style={label}>Manager note</label><input style={field} value={managerNote} onChange={(e) => setManagerNote(e.target.value)} maxLength={1000} /></div><button style={ghost} disabled={busy} onClick={saveManagerNote}>Save note</button></>}
          </div>
        </section>
      )}
    </div>
  );
}
