import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { money } from "./money";
import { printReceipt } from "./receipt";

/** Super Admin: plans, one business's subscription, and manually recorded payments. All prices, limits and states come from the server. */

export type PlanRow = {
  id: string; code: string; name: string; description: string | null; currency: string;
  monthlyPrice: number | null; annualPrice: number | null; oneTimePrice: number | null; installationFee: number; trainingFee: number; discountPercent: number;
  trialDays: number; graceDays: number | null; maxBranches: number | null; maxEmployees: number | null; modules: string[]; isActive: boolean; archived: boolean; subscribers: number;
};
export type SubSummary = {
  businessId: string; businessName: string; planName: string; status: string; storedStatus: string; restricted: boolean; reason: string | null; billingCycle: string; agreedPrice: number;
  currentPeriodEnd: string | null; graceEndsAt: string | null; daysLeft: number | null; graceDays: number; maxBranches: number | null; maxEmployees: number | null;
};
type Pay = {
  id: string; businessId?: string | null; businessName: string; planName: string | null; amount: number; expectedAmount: number | null; method: string; reference: string | null; status: string;
  periods: number; paidAt: string; periodFrom: string | null; periodTo: string | null; receiptNo: string | null; note: string | null; decisionReason: string | null; createdAt: string; billingCycle: string | null;
};
type Detail = {
  business: { id: string; name: string; modules: string[] };
  subscription: (Omit<SubSummary, "businessId" | "businessName"> & { notes: string | null }) | null;
  legacy: boolean; usage: { employees: number; branches: number }; payments: Pay[];
  history: { at: string; event: string; from: string | null; to: string | null; details: Record<string, unknown> | null }[];
};

const MODULES: Record<string, string> = { tables: "Tables & orders", rooms: "Rooms & stays", purchasing: "Suppliers & purchases", documents: "Quotations & invoices" };
const STATUS_LABEL: Record<string, string> = { trial: "Free trial", pending_payment: "Waiting for first payment", active: "Active", past_due: "Past due", grace: "Grace period", suspended: "Suspended", cancelled: "Cancelled", expired: "Expired" };
const STATUS_COLOR: Record<string, [string, string]> = {
  trial: ["#e5eefb", "#1d4f91"], pending_payment: ["#fff3d6", "#8a5a00"], active: ["#e3f4e9", "#176b4d"], past_due: ["#fff3d6", "#8a5a00"], grace: ["#fff3d6", "#8a5a00"],
  suspended: ["#fde8e4", "#b3412f"], cancelled: ["#eee", "#555"], expired: ["#fde8e4", "#b3412f"],
};
const EVENT_LABEL: Record<string, string> = {
  started_trial: "Trial started", started_pending: "Plan assigned, waiting for payment", started_complimentary: "Complimentary plan granted", plan_changed: "Plan changed", suspend: "Suspended", reactivate: "Reactivated", cancel: "Cancelled",
  extend: "Extended", terms_changed: "Terms changed", payment_recorded: "Payment recorded", payment_approved: "Payment approved", payment_rejected: "Payment rejected", payment_refunded: "Payment marked refunded",
};
const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe7e1", borderRadius: 12, padding: 16 };
const input: React.CSSProperties = { padding: "9px 11px", border: "1px solid #cfd9d2", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
const primary: React.CSSProperties = { padding: "9px 14px", border: 0, borderRadius: 8, background: "#176b4d", color: "#fff", fontWeight: 700, cursor: "pointer" };
const small: React.CSSProperties = { padding: "5px 9px", border: "1px solid #cfd9d2", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 };
const danger: React.CSSProperties = { ...small, color: "#b3412f", borderColor: "#e9b8ae" };
const lab: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "#52625a" };
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "no end date");
const stamp = (v: string) => new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const limit = (v: number | null) => (v == null ? "No limit" : String(v));

export function StatusBadge({ status }: { status: string }) {
  const [bg, fg] = STATUS_COLOR[status] ?? ["#eee", "#555"];
  return <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: bg, color: fg, whiteSpace: "nowrap" }}>{STATUS_LABEL[status] ?? status}</span>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "start center", padding: 16, overflowY: "auto", zIndex: 50 }}>
      <div style={{ ...card, width: "100%", maxWidth: wide ? 820 : 520, marginTop: 24, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2><button style={small} onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** Asks for the reason every platform action needs, then runs it. */
function ReasonDialog({ title, help, confirm, danger: isDanger, onClose, onRun }: { title: string; help?: string; confirm: string; danger?: boolean; onClose: () => void; onRun: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      {help && <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>{help}</p>}
      <label style={lab}>Reason (kept in the activity log)<textarea style={{ ...input, minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
      {err && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={isDanger ? { ...primary, background: "#b3412f" } : primary} disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); setErr(""); try { await onRun(reason.trim()); } catch (e) { setErr(msg(e)); setBusy(false); } }}>{busy ? "Working…" : confirm}</button>
        <button style={small} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ plans

type PlanForm = { name: string; description: string; monthlyPrice: string; annualPrice: string; oneTimePrice: string; installationFee: string; trainingFee: string; discountPercent: string; trialDays: string; graceDays: string; maxBranches: string; maxEmployees: string; modules: string[] };
const blank: PlanForm = { name: "", description: "", monthlyPrice: "", annualPrice: "", oneTimePrice: "", installationFee: "0", trainingFee: "0", discountPercent: "0", trialDays: "0", graceDays: "", maxBranches: "", maxEmployees: "", modules: ["purchasing", "documents"] };
const toForm = (p: PlanRow): PlanForm => ({
  name: p.name, description: p.description ?? "", monthlyPrice: p.monthlyPrice == null ? "" : String(p.monthlyPrice), annualPrice: p.annualPrice == null ? "" : String(p.annualPrice), oneTimePrice: p.oneTimePrice == null ? "" : String(p.oneTimePrice),
  installationFee: String(p.installationFee), trainingFee: String(p.trainingFee), discountPercent: String(p.discountPercent), trialDays: String(p.trialDays), graceDays: p.graceDays == null ? "" : String(p.graceDays),
  maxBranches: p.maxBranches == null ? "" : String(p.maxBranches), maxEmployees: p.maxEmployees == null ? "" : String(p.maxEmployees), modules: p.modules,
});
const orNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function PlansTab({ token }: { token: string }) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: PlanForm } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(async () => { try { setPlans((await apiRequest<PlanRow[]>("/platform/plans", { token })).data ?? []); setError(""); } catch (e) { setError(msg(e)); } }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function save(ev: React.FormEvent) {
    ev.preventDefault(); if (!editing) return; setBusy(true); setError("");
    const f = editing.form;
    const body = { name: f.name, description: f.description, monthlyPrice: orNull(f.monthlyPrice), annualPrice: orNull(f.annualPrice), oneTimePrice: orNull(f.oneTimePrice), installationFee: Number(f.installationFee || 0), trainingFee: Number(f.trainingFee || 0), discountPercent: Number(f.discountPercent || 0), trialDays: Number(f.trialDays || 0), graceDays: orNull(f.graceDays), maxBranches: orNull(f.maxBranches), maxEmployees: orNull(f.maxEmployees), modules: f.modules };
    try {
      await apiRequest(editing.id ? `/platform/plans/${editing.id}` : "/platform/plans", { method: editing.id ? "PUT" : "POST", token, body });
      setEditing(null); await load();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function act(p: PlanRow, what: "archive" | "unarchive" | "delete") {
    if (what === "delete" && !window.confirm(`Delete the plan "${p.name}" for good? Nobody has used it.`)) return;
    setError("");
    try { await apiRequest(what === "delete" ? `/platform/plans/${p.id}` : `/platform/plans/${p.id}/${what}`, { method: what === "delete" ? "DELETE" : "POST", token }); await load(); } catch (e) { setError(msg(e)); }
  }
  const f = editing?.form;
  const set = (k: keyof PlanForm, v: string) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  const shown = plans.filter((p) => showArchived || !p.archived);
  const price = (v: number | null) => (v == null ? "–" : money(v));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={primary} onClick={() => setEditing({ id: null, form: blank })}>New plan</button>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <small style={{ color: "#6b7a70" }}>Plans are copied onto a customer when assigned. Editing a plan never changes customers already on it.</small>
      </div>
      {error && <p style={{ color: "#b3412f", margin: 0 }}>{error}</p>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Plan", "Prices", "Fees", "Limits", "Features", "Customers", "Actions"].map((h) => <th key={h} style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #e8eee9", verticalAlign: "top", opacity: p.archived ? 0.6 : 1 }}>
                <td style={{ padding: "10px 12px" }}><strong>{p.name}</strong> {p.archived && <small>(archived)</small>}<br /><small style={{ color: "#6b7a70" }}>{p.description}</small></td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>Monthly {price(p.monthlyPrice)}<br />Annual {price(p.annualPrice)}<br />One-time {price(p.oneTimePrice)}{p.discountPercent > 0 && <><br /><small>{p.discountPercent}% discount</small></>}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>Install {price(p.installationFee)}<br />Training {price(p.trainingFee)}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>Branches: {limit(p.maxBranches)}<br />Staff: {limit(p.maxEmployees)}<br />Trial: {p.trialDays} days<br />Grace: {p.graceDays == null ? "7 (default)" : p.graceDays} days</td>
                <td style={{ padding: "10px 12px" }}><small>{p.modules.length ? p.modules.map((m) => MODULES[m] ?? m).join(", ") : "Core features only"}</small></td>
                <td style={{ padding: "10px 12px" }}>{p.subscribers}</td>
                <td style={{ padding: "10px 12px" }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button style={small} onClick={() => setEditing({ id: p.id, form: toForm(p) })}>Edit</button>
                  <button style={small} onClick={() => act(p, p.archived ? "unarchive" : "archive")}>{p.archived ? "Restore" : "Archive"}</button>
                  {p.subscribers === 0 && <button style={danger} onClick={() => act(p, "delete")}>Delete</button>}
                </div></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>No plans yet. Create your first plan, then assign it to a business.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && f && (
        <Modal title={editing.id ? "Edit plan" : "New plan"} onClose={() => setEditing(null)} wide>
          <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
            <label style={lab}>Plan name<input style={input} value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} /></label>
            <label style={lab}>Description<input style={input} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} /></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <label style={lab}>Monthly price (KES)<input style={input} inputMode="decimal" value={f.monthlyPrice} onChange={(e) => set("monthlyPrice", e.target.value)} placeholder="not offered" /></label>
              <label style={lab}>Annual price (KES)<input style={input} inputMode="decimal" value={f.annualPrice} onChange={(e) => set("annualPrice", e.target.value)} placeholder="not offered" /></label>
              <label style={lab}>One-time licence (KES)<input style={input} inputMode="decimal" value={f.oneTimePrice} onChange={(e) => set("oneTimePrice", e.target.value)} placeholder="not offered" /></label>
              <label style={lab}>Installation fee<input style={input} inputMode="decimal" value={f.installationFee} onChange={(e) => set("installationFee", e.target.value)} /></label>
              <label style={lab}>Training fee<input style={input} inputMode="decimal" value={f.trainingFee} onChange={(e) => set("trainingFee", e.target.value)} /></label>
              <label style={lab}>Discount (%)<input style={input} inputMode="decimal" value={f.discountPercent} onChange={(e) => set("discountPercent", e.target.value)} /></label>
              <label style={lab}>Trial (days)<input style={input} inputMode="numeric" value={f.trialDays} onChange={(e) => set("trialDays", e.target.value)} /></label>
              <label style={lab}>Grace after expiry (days)<input style={input} inputMode="numeric" value={f.graceDays} onChange={(e) => set("graceDays", e.target.value)} placeholder="7 (default)" /></label>
              <label style={lab}>Branch limit<input style={input} inputMode="numeric" value={f.maxBranches} onChange={(e) => set("maxBranches", e.target.value)} placeholder="no limit" /></label>
              <label style={lab}>Staff limit (incl. owner)<input style={input} inputMode="numeric" value={f.maxEmployees} onChange={(e) => set("maxEmployees", e.target.value)} placeholder="no limit" /></label>
            </div>
            <fieldset style={{ border: "1px solid #dfe7e1", borderRadius: 8 }}><legend style={{ fontSize: 12, color: "#52625a" }}>Features included (sales, products, stock, customers, expenses and reports are always included)</legend>
              {Object.entries(MODULES).map(([m, l]) => <label key={m} style={{ display: "inline-flex", gap: 6, marginRight: 14, fontSize: 13 }}><input type="checkbox" checked={f.modules.includes(m)} onChange={(e) => setEditing((s) => (s ? { ...s, form: { ...s.form, modules: e.target.checked ? [...s.form.modules, m] : s.form.modules.filter((x) => x !== m) } } : s))} />{l}</label>)}
            </fieldset>
            {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}
            <div style={{ display: "flex", gap: 8 }}><button style={primary} disabled={busy}>{busy ? "Saving…" : "Save plan"}</button><button type="button" style={small} onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ payments (all businesses)

export function PaymentsTab({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Pay[]>([]);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<{ pay: Pay; kind: "approve" | "reject" | "refund" } | null>(null);
  const load = useCallback(async () => { try { setRows((await apiRequest<Pay[]>(`/platform/payments${status ? `?status=${status}` : ""}`, { token })).data ?? []); setError(""); } catch (e) { setError(msg(e)); } }, [token, status]);
  useEffect(() => { void load(); }, [load]);
  const copy = { approve: ["Approve this payment", "Adds the paid time to the subscription, switches it on and issues a receipt number. Do this only when you have seen the money.", "Approve payment"], reject: ["Reject this payment", "Nothing is added to the subscription. The reference can be recorded again.", "Reject payment"], refund: ["Mark as refunded", "Records that the money was given back. It does not take paid time away: use Suspend or Cancel on the business if access should end.", "Mark refunded"] } as const;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select aria-label="Payment status" style={{ ...input, width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="refunded">Refunded</option><option value="">All</option>
        </select>
        <small style={{ color: "#6b7a70" }}>Record a payment from a business's Subscription screen. Money only counts once it is approved.</small>
      </div>
      {error && <p style={{ color: "#b3412f", margin: 0 }}>{error}</p>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Received", "Business", "Amount", "Method", "Status", "Receipt", "Actions"].map((h) => <th key={h} style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #e8eee9", verticalAlign: "top" }}>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{date(p.paidAt)}</td>
                <td style={{ padding: "10px 12px" }}><strong>{p.businessName}</strong><br /><small style={{ color: "#6b7a70" }}>{p.planName}</small></td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}><strong>{money(p.amount)}</strong>{p.expectedAmount != null && Math.abs(p.expectedAmount - p.amount) > 0.005 && <><br /><small style={{ color: "#8a5a00" }}>Expected {money(p.expectedAmount)}</small></>}</td>
                <td style={{ padding: "10px 12px" }}>{p.method.toUpperCase()}<br /><small style={{ color: "#6b7a70", wordBreak: "break-all" }}>{p.reference}</small></td>
                <td style={{ padding: "10px 12px" }}>{p.status}{p.decisionReason && <><br /><small style={{ color: "#6b7a70" }}>{p.decisionReason}</small></>}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{p.receiptNo ?? "–"}</td>
                <td style={{ padding: "10px 12px" }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.status === "pending" && <button style={{ ...small, background: "#176b4d", color: "#fff", borderColor: "#176b4d", fontWeight: 700 }} onClick={() => setAsk({ pay: p, kind: "approve" })}>Approve</button>}
                  {p.status === "pending" && <button style={small} onClick={() => setAsk({ pay: p, kind: "reject" })}>Reject</button>}
                  {p.status === "approved" && <button style={small} onClick={() => printReceipt(p)}>Receipt</button>}
                  {p.status === "approved" && <button style={danger} onClick={() => setAsk({ pay: p, kind: "refund" })}>Mark refunded</button>}
                </div></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>{status === "pending" ? "Nothing is waiting for approval." : "No payments found."}</td></tr>}
          </tbody>
        </table>
      </div>
      {ask && <ReasonDialog title={copy[ask.kind][0]} help={copy[ask.kind][1]} confirm={copy[ask.kind][2]} danger={ask.kind !== "approve"} onClose={() => setAsk(null)}
        onRun={async (reason) => { await apiRequest(`/platform/payments/${ask.pay.id}/${ask.kind}`, { method: "POST", token, body: { reason } }); setAsk(null); await load(); onChanged?.(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ one business's subscription

type Mode = null | "assign" | "terms" | "pay" | "suspend" | "reactivate" | "cancel" | "extend";

export function SubscriptionPanel({ token, businessId, businessName, onClose, onChanged }: { token: string; businessId: string; businessName: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ pay: Pay; kind: "approve" | "reject" } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const base = `/platform/businesses/${businessId}`;

  const load = useCallback(async () => {
    try {
      const [dd, pp] = await Promise.all([apiRequest<Detail>(`${base}/subscription`, { token }), apiRequest<PlanRow[]>("/platform/plans", { token })]);
      setD(dd.data ?? null); setPlans((pp.data ?? []).filter((p) => !p.archived && p.isActive)); setError("");
    } catch (e) { setError(msg(e)); }
  }, [base, token]);
  useEffect(() => { void load(); }, [load]);
  const open = (m: Mode, init: Record<string, string> = {}) => { setMode(m); setF(init); setError(""); };
  const done = async () => { setMode(null); setF({}); await load(); onChanged(); };

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "assign") {
        const body: Record<string, unknown> = { planId: f.planId, billingCycle: f.billingCycle || "monthly", reason: f.reason };
        if (!d?.subscription) body.mode = f.start || "trial";
        if (f.agreedPrice) body.agreedPrice = Number(f.agreedPrice);
        if (f.maxBranches) body.maxBranches = Number(f.maxBranches);
        if (f.maxEmployees) body.maxEmployees = Number(f.maxEmployees);
        if (f.graceDays) body.graceDays = Number(f.graceDays);
        if (f.trialDays) body.trialDays = Number(f.trialDays);
        if (f.until) body.until = new Date(`${f.until}T23:59:59`).toISOString();
        await apiRequest(`${base}/subscription`, { method: "POST", token, body });
      } else if (mode === "terms") {
        await apiRequest(`${base}/subscription`, { method: "PUT", token, body: { agreedPrice: Number(f.agreedPrice), graceDays: Number(f.graceDays), maxBranches: f.maxBranches === "" ? null : Number(f.maxBranches), maxEmployees: f.maxEmployees === "" ? null : Number(f.maxEmployees), reason: f.reason } });
      } else if (mode === "pay") {
        const r = await apiRequest<Pay>(`${base}/payments`, { method: "POST", token, body: { amount: Number(f.amount), method: f.method || "cash", reference: f.reference, periods: Number(f.periods || 1), paidAt: f.paidAt ? new Date(`${f.paidAt}T12:00:00`).toISOString() : undefined, note: f.note } });
        if (f.approveNow === "1" && r.data) await apiRequest(`/platform/payments/${r.data.id}/approve`, { method: "POST", token, body: { reason: f.reason || "Verified when recorded" } });
      } else if (mode === "extend") {
        await apiRequest(`${base}/subscription/extend`, { method: "POST", token, body: { days: Number(f.days), reason: f.reason } });
      } else if (mode) {
        await apiRequest(`${base}/subscription/${mode}`, { method: "POST", token, body: { reason: f.reason } });
      }
      await done();
    } catch (e) { setError(msg(e)); await load(); } finally { setBusy(false); }
  }

  const s = d?.subscription ?? null;
  const reasonField = <label style={lab}>Reason (kept in the activity log)<input style={input} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} required minLength={3} maxLength={500} /></label>;
  const usage = (used: number, lim: number | null) => <span style={{ color: lim != null && used > lim ? "#b3412f" : undefined }}>{used} of {limit(lim)}</span>;
  const chosen = plans.find((p) => p.id === f.planId);

  return (
    <Modal title={`Subscription: ${businessName}`} onClose={onClose} wide>
      {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
      {!d ? <p>Loading…</p> : (
        <>
          {!s ? (
            <div style={{ ...card, background: "#f4f8f5" }}>
              <strong>No subscription: this business works with no limits.</strong>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#52625a" }}>It was set up before plans existed, or has not been given one. Nothing is restricted. Assign a plan to start billing it.</p>
            </div>
          ) : (
            <div style={{ ...card, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong style={{ fontSize: 16 }}>{s.planName}</strong><StatusBadge status={s.status} />{s.status !== s.storedStatus && <small style={{ color: "#6b7a70" }}>(set as {STATUS_LABEL[s.storedStatus] ?? s.storedStatus}; dates moved it on)</small>}</div>
              <div style={{ fontSize: 13 }}>{money(s.agreedPrice)} {s.billingCycle === "one_time" ? "one-time licence" : s.billingCycle === "annual" ? "per year" : "per month"} · {s.currentPeriodEnd ? <>paid until <strong>{date(s.currentPeriodEnd)}</strong></> : s.storedStatus === "pending_payment" ? <strong>not paid yet</strong> : <strong>no renewal date</strong>}{s.daysLeft != null && ` (${s.daysLeft >= 0 ? `${s.daysLeft} days left` : `${-s.daysLeft} days ago`})`}</div>
              {s.status === "grace" && <div style={{ fontSize: 13, color: "#8a5a00" }}>In grace until {date(s.graceEndsAt)}. Everything still works; changes stop after that.</div>}
              {s.reason && <div style={{ fontSize: 13, color: "#b3412f" }}>{s.reason}</div>}
              <div style={{ fontSize: 13, color: "#52625a" }}>Staff {usage(d.usage.employees, s.maxEmployees)} · Branches {usage(d.usage.branches, s.maxBranches)} · Grace {s.graceDays} days</div>
            </div>
          )}

          {!mode && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={primary} onClick={() => open("assign", { billingCycle: "monthly", start: "trial", planId: plans[0]?.id ?? "" })}>{s ? "Change plan" : "Assign a plan"}</button>
              {s && <button style={small} onClick={() => open("pay", { method: "cash", periods: "1", amount: String(s.agreedPrice) })}>Record a payment</button>}
              {s && <button style={small} onClick={() => open("terms", { agreedPrice: String(s.agreedPrice), graceDays: String(s.graceDays), maxBranches: s.maxBranches == null ? "" : String(s.maxBranches), maxEmployees: s.maxEmployees == null ? "" : String(s.maxEmployees) })}>Edit terms</button>}
              {s && <button style={small} onClick={() => open("extend", { days: "7" })}>Extend</button>}
              {s && s.storedStatus !== "suspended" && <button style={small} onClick={() => open("suspend")}>Suspend</button>}
              {s && ["suspended", "cancelled", "expired"].includes(s.storedStatus) && <button style={small} onClick={() => open("reactivate")}>Reactivate</button>}
              {s && s.storedStatus !== "cancelled" && <button style={danger} onClick={() => open("cancel")}>Cancel</button>}
            </div>
          )}

          {mode && (
            <form onSubmit={submit} style={{ ...card, display: "grid", gap: 10, background: "#fbfdfb" }}>
              {mode === "assign" && (<>
                <strong>{s ? "Change plan" : "Assign a plan"}</strong>
                {s && <small style={{ color: "#52625a" }}>The paid period and status stay as they are. Only the plan, price and limits change. People already added are never removed.</small>}
                <label style={lab}>Plan<select style={input} value={f.planId ?? ""} onChange={(e) => setF((x) => ({ ...x, planId: e.target.value, agreedPrice: "", maxBranches: undefined as unknown as string, maxEmployees: undefined as unknown as string }))} required>{plans.length === 0 && <option value="">No active plans. Create one first.</option>}{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                  <label style={lab}>Billing<select style={input} value={f.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="one_time">One-time licence</option></select></label>
                  {!s && <label style={lab}>Starts as<select style={input} value={f.start} onChange={(e) => set("start", e.target.value)}><option value="trial">Free trial</option><option value="pending">Waiting for first payment</option><option value="complimentary">Complimentary (free)</option></select></label>}
                  {f.start !== "complimentary" && <label style={lab}>Agreed price (KES)<input style={input} inputMode="decimal" value={f.agreedPrice ?? ""} onChange={(e) => set("agreedPrice", e.target.value)} placeholder={chosen ? `plan price${chosen.discountPercent ? ` less ${chosen.discountPercent}%` : ""}` : ""} /></label>}
                  {!s && f.start === "trial" && <label style={lab}>Trial days<input style={input} inputMode="numeric" value={f.trialDays ?? ""} onChange={(e) => set("trialDays", e.target.value)} placeholder={chosen ? String(chosen.trialDays) : ""} /></label>}
                  {!s && f.start === "complimentary" && <label style={lab}>Free until (optional)<input style={input} type="date" value={f.until ?? ""} onChange={(e) => set("until", e.target.value)} /></label>}
                  <label style={lab}>Staff limit<input style={input} inputMode="numeric" value={f.maxEmployees ?? ""} onChange={(e) => set("maxEmployees", e.target.value)} placeholder={chosen ? limit(chosen.maxEmployees) : ""} /></label>
                  <label style={lab}>Branch limit<input style={input} inputMode="numeric" value={f.maxBranches ?? ""} onChange={(e) => set("maxBranches", e.target.value)} placeholder={chosen ? limit(chosen.maxBranches) : ""} /></label>
                  <label style={lab}>Grace days<input style={input} inputMode="numeric" value={f.graceDays ?? ""} onChange={(e) => set("graceDays", e.target.value)} placeholder={chosen?.graceDays == null ? "7" : String(chosen.graceDays)} /></label>
                </div>
                <small style={{ color: "#6b7a70" }}>Leave a limit blank to use the plan's (use Edit terms afterwards to remove a limit). The plan's features replace this business's current modules.</small>
                {reasonField}
              </>)}
              {mode === "terms" && (<>
                <strong>Edit this customer's terms</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <label style={lab}>Agreed price (KES)<input style={input} inputMode="decimal" value={f.agreedPrice ?? ""} onChange={(e) => set("agreedPrice", e.target.value)} required /></label>
                  <label style={lab}>Grace days<input style={input} inputMode="numeric" value={f.graceDays ?? ""} onChange={(e) => set("graceDays", e.target.value)} required /></label>
                  <label style={lab}>Staff limit<input style={input} inputMode="numeric" value={f.maxEmployees ?? ""} onChange={(e) => set("maxEmployees", e.target.value)} placeholder="no limit" /></label>
                  <label style={lab}>Branch limit<input style={input} inputMode="numeric" value={f.maxBranches ?? ""} onChange={(e) => set("maxBranches", e.target.value)} placeholder="no limit" /></label>
                </div>
                {reasonField}
              </>)}
              {mode === "pay" && (<>
                <strong>Record a payment</strong>
                <small style={{ color: "#52625a" }}>For money received outside the app: cash, bank transfer or an M-Pesa paybill statement. It adds no paid time until it is approved.</small>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <label style={lab}>Amount (KES)<input style={input} inputMode="decimal" value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} required /></label>
                  <label style={lab}>Method<select style={input} value={f.method} onChange={(e) => set("method", e.target.value)}><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="other">Other</option></select></label>
                  <label style={lab}>Reference {f.method !== "cash" && "(required)"}<input style={input} value={f.reference ?? ""} onChange={(e) => set("reference", e.target.value)} placeholder="e.g. M-Pesa code" required={f.method !== "cash"} /></label>
                  {s && s.billingCycle !== "one_time" && <label style={lab}>{s.billingCycle === "annual" ? "Years" : "Months"} paid for<input style={input} inputMode="numeric" value={f.periods ?? "1"} onChange={(e) => set("periods", e.target.value)} /></label>}
                  <label style={lab}>Date received<input style={input} type="date" value={f.paidAt ?? ""} onChange={(e) => set("paidAt", e.target.value)} /></label>
                </div>
                <label style={lab}>Note<input style={input} value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} maxLength={1000} /></label>
                <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.approveNow === "1"} onChange={(e) => set("approveNow", e.target.checked ? "1" : "0")} /> I have seen the money: approve it now and issue a receipt</label>
                {f.approveNow === "1" && reasonField}
              </>)}
              {mode === "extend" && (<><strong>Give extra days</strong><label style={lab}>Days<input style={input} inputMode="numeric" value={f.days ?? ""} onChange={(e) => set("days", e.target.value)} required /></label>{reasonField}</>)}
              {(mode === "suspend" || mode === "reactivate" || mode === "cancel") && (<>
                <strong>{mode === "suspend" ? "Suspend this subscription" : mode === "reactivate" ? "Reactivate this subscription" : "Cancel this subscription"}</strong>
                <small style={{ color: "#52625a" }}>{mode === "suspend" ? "Changes are blocked until you reactivate it. The business can still read and export its data. Nothing is deleted." : mode === "reactivate" ? "If the paid period has ended, extend it or record a payment first." : "It keeps working until the paid period ends, then changes are blocked. Nothing is deleted."}</small>
                {reasonField}
              </>)}
              <div style={{ display: "flex", gap: 8 }}><button style={primary} disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" style={small} onClick={() => setMode(null)}>Cancel</button></div>
            </form>
          )}

          <section>
            <h3 style={{ margin: "4px 0 6px", fontSize: 14 }}>Payments</h3>
            {d.payments.length === 0 ? <small style={{ color: "#6b7a70" }}>No payments recorded.</small> : d.payments.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid #e8eee9", fontSize: 13 }}>
                <span>{date(p.paidAt)} · <strong>{money(p.amount)}</strong> · {p.method.toUpperCase()}{p.reference ? ` ${p.reference}` : ""} · {p.status}{p.receiptNo ? ` · ${p.receiptNo}` : ""}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  {p.status === "pending" && <button style={{ ...small, background: "#176b4d", color: "#fff", borderColor: "#176b4d" }} onClick={() => setAsk({ pay: p, kind: "approve" })}>Approve</button>}
                  {p.status === "pending" && <button style={small} onClick={() => setAsk({ pay: p, kind: "reject" })}>Reject</button>}
                  {p.status === "approved" && <button style={small} onClick={() => printReceipt(p)}>Receipt</button>}
                </span>
              </div>
            ))}
          </section>
          <section>
            <h3 style={{ margin: "4px 0 6px", fontSize: 14 }}>History</h3>
            {d.history.length === 0 ? <small style={{ color: "#6b7a70" }}>Nothing yet.</small> : d.history.map((h, i) => (
              <div key={i} style={{ padding: "5px 0", borderTop: "1px solid #e8eee9", fontSize: 12.5 }}>
                <strong>{EVENT_LABEL[h.event] ?? h.event}</strong> <span style={{ color: "#6b7a70" }}>{stamp(h.at)}{h.from && h.to && h.from !== h.to ? ` · ${STATUS_LABEL[h.from] ?? h.from} → ${STATUS_LABEL[h.to] ?? h.to}` : ""}</span>
                {typeof h.details?.reason === "string" && <div style={{ color: "#52625a" }}>{h.details.reason}</div>}
              </div>
            ))}
          </section>
        </>
      )}
      {ask && <ReasonDialog title={ask.kind === "approve" ? "Approve this payment" : "Reject this payment"} help={ask.kind === "approve" ? "Adds the paid time, switches the subscription on and issues a receipt number. Only when you have seen the money." : "Nothing is added to the subscription."} confirm={ask.kind === "approve" ? "Approve payment" : "Reject payment"} danger={ask.kind === "reject"} onClose={() => setAsk(null)}
        onRun={async (reason) => { await apiRequest(`/platform/payments/${ask.pay.id}/${ask.kind}`, { method: "POST", token, body: { reason } }); setAsk(null); await load(); onChanged(); }} />}
    </Modal>
  );
}
