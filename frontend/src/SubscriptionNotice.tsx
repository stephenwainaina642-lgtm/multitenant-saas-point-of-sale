import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "./api/client";
import { isBusinessOwner } from "./permissions";
import { money } from "./money";
import { printReceipt } from "./receipt";

type Sub = {
  planName: string; status: string; restricted: boolean; reason: string | null; billingCycle: string; agreedPrice: number; currentPeriodEnd: string | null; graceEndsAt: string | null;
  daysLeft: number | null; maxBranches: number | null; maxEmployees: number | null;
};
type Pay = { id: string; businessName: string; planName: string | null; amount: number; method: string; reference: string | null; status: string; paidAt: string; periodFrom: string | null; periodTo: string | null; receiptNo: string | null };
type Summary = { legacy: true } | { legacy: false; subscription: Sub; usage: { employees: number; branches: number }; payments: Pay[] };

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "no end date");
const LABEL: Record<string, string> = { trial: "Free trial", pending_payment: "Waiting for first payment", active: "Active", grace: "Grace period", suspended: "Suspended", cancelled: "Cancelled", expired: "Expired", past_due: "Past due" };
const limit = (v: number | null) => (v == null ? "No limit" : String(v));

function useSummary(): Summary | null {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    if (!isBusinessOwner()) return;
    let live = true;
    let tries = 0;
    // Right after sign-in the page may not have stored which business is open yet, so wait for it instead of asking too early.
    const ask = () => {
      let businessId = "";
      let token = "";
      try { businessId = sessionStorage.getItem("pos_business_id") ?? ""; token = sessionStorage.getItem("pos_token") ?? ""; } catch { /* storage blocked */ }
      if (!businessId && tries++ < 20) { timer = window.setTimeout(ask, 250); return; }
      if (!businessId) return;
      apiRequest<Summary>("/billing", { token, businessId }).then((r) => { if (live && r.data) setS(r.data); }).catch((e) => { if (!(e instanceof ApiError)) return; });
    };
    let timer = window.setTimeout(ask, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  return s;
}

/** A line across the top for the owner when the subscription needs attention. Nothing shows for a healthy or unlimited business. */
export function SubscriptionBanner() {
  const s = useSummary();
  const [hidden, setHidden] = useState(false);
  if (!s || s.legacy || hidden) return null;
  const sub = s.subscription;
  const soon = !sub.restricted && sub.daysLeft != null && sub.daysLeft <= 7 && sub.status !== "cancelled";
  let text = "";
  let urgent = false;
  if (sub.restricted) { text = `${sub.reason ?? "Your subscription needs attention."} You can still view and export your data.`; urgent = true; }
  else if (sub.status === "grace") { text = `Your subscription ended on ${day(sub.currentPeriodEnd)}. Everything works until ${day(sub.graceEndsAt)}, then changes will stop. Please renew.`; urgent = true; }
  else if (sub.status === "cancelled") text = `Your subscription is cancelled and ends on ${day(sub.currentPeriodEnd)}.`;
  else if (soon) text = sub.status === "trial" ? `Your free trial ends on ${day(sub.currentPeriodEnd)}.` : `Your subscription renews on ${day(sub.currentPeriodEnd)}. Please arrange payment to avoid interruption.`;
  if (!text) return null;
  return (
    <div role="status" style={{ padding: "10px 14px", margin: "0 0 12px", borderRadius: 10, fontSize: 14, background: urgent ? "#fde8e4" : "#fff3d6", color: urgent ? "#8d2e1f" : "#7a5200", display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
      <span>{text} Contact nexaPOS to renew.</span>
      {!urgent && <button type="button" onClick={() => setHidden(true)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}>Dismiss</button>}
    </div>
  );
}

/** Settings > Subscription: the plan, renewal date, what has been used, and receipts. Read-only: the nexaPOS team changes plans and records payments. */
export function SubscriptionPanel() {
  const s = useSummary();
  if (!isBusinessOwner() || !s) return null;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe7e1", borderRadius: 12, padding: 16, display: "grid", gap: 8, maxWidth: 720, margin: "16px 0" };
  if (s.legacy) return <section className="settings-workspace" style={card}><h3 style={{ margin: 0 }}>Subscription</h3><p style={{ margin: 0, fontSize: 14 }}>Your business has no subscription limits at the moment.</p></section>;
  const { subscription: sub, usage, payments } = s;
  return (
    <section className="settings-workspace" style={card} aria-label="Subscription">
      <h3 style={{ margin: 0 }}>Subscription</h3>
      <div style={{ fontSize: 15 }}><strong>{sub.planName}</strong> · {LABEL[sub.status] ?? sub.status}</div>
      <div style={{ fontSize: 14 }}>{money(sub.agreedPrice)} {sub.billingCycle === "one_time" ? "one-time licence" : sub.billingCycle === "annual" ? "per year" : "per month"} · {sub.currentPeriodEnd ? <>paid until <strong>{day(sub.currentPeriodEnd)}</strong></> : sub.status === "pending_payment" ? <strong>not paid yet</strong> : <strong>no renewal date</strong>}{sub.daysLeft != null && sub.daysLeft >= 0 ? ` (${sub.daysLeft} days left)` : ""}</div>
      <div style={{ fontSize: 14, color: "#52625a" }}>Staff: {usage.employees} of {limit(sub.maxEmployees)} · Branches: {usage.branches} of {limit(sub.maxBranches)}</div>
      <div style={{ fontSize: 13, color: "#52625a" }}>To renew or change your plan, pay nexaPOS and send the payment reference. Your subscription is extended once the payment is confirmed.</div>
      {payments.length > 0 && (
        <div>
          <strong style={{ fontSize: 13 }}>Receipts</strong>
          {payments.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid #e8eee9", fontSize: 13 }}>
              <span>{day(p.paidAt)} · {money(p.amount)} · {p.receiptNo}{p.status === "refunded" ? " · refunded" : ""}</span>
              <button type="button" onClick={() => printReceipt(p)} style={{ border: "1px solid #cfd9d2", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Print</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
