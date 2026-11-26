import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { money } from "./money";

type Profile = {
  employee: { id: string; name: string; email: string; phone: string | null; role: { name: string }; isOwner: boolean; isActive: boolean; createdAt: string };
  stats: { salesCount: number; revenue: number; collected: number; outstanding: number; last30Days: { salesCount: number; revenue: number }; lastSaleAt: string | null };
  recentSales: { id: string; receiptNumber: string; saleDate: string; customerName: string | null; total: number; paymentStatus: string }[];
};

const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "No sales yet");

/** Opens at `#employees/<id>`; the address can be bookmarked or shared with another manager. */
export default function EmployeeProfile({ memberId, onBack }: { memberId: string; onBack: () => void }) {
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setData(null); setError("");
    apiRequest<Profile>(`/employees/${encodeURIComponent(memberId)}/profile`, { token, businessId })
      .then((r) => { if (live) setData(r.data ?? null); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load this profile."); });
    return () => { live = false; };
  }, [memberId, token, businessId]);

  const e = data?.employee;
  return (
    <section className="customer-panel">
      <button type="button" className="pos-secondary-button" onClick={onBack}>← All employees</button>
      {error && <p className="customer-notice" role="alert">{error}</p>}
      {!data && !error && <p className="inventory-muted">Loading…</p>}
      {data && e && (
        <>
          <h2 style={{ marginBottom: 2 }}>{e.name}{e.isOwner && " (owner)"}</h2>
          <p className="inventory-muted" style={{ marginTop: 0 }}>
            {e.role.name} · {e.isActive ? "Active" : "Deactivated"} · joined {new Date(e.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
          </p>
          <div className="customer-summary">
            <div><span className="customer-summary-label">Email</span><strong>{e.email}</strong></div>
            <div><span className="customer-summary-label">Phone</span><strong>{e.phone || "—"}</strong></div>
            <div><span className="customer-summary-label">Last sale</span><strong>{when(data.stats.lastSaleAt)}</strong></div>
          </div>
          <div className="customer-summary">
            <div><span className="customer-summary-label">Sales (all time)</span><strong>{data.stats.salesCount}</strong></div>
            <div><span className="customer-summary-label">Revenue</span><strong>{money(data.stats.revenue)}</strong></div>
            <div><span className="customer-summary-label">Collected</span><strong>{money(data.stats.collected)}</strong></div>
            <div><span className="customer-summary-label">Still owed</span><strong>{money(data.stats.outstanding)}</strong></div>
            <div><span className="customer-summary-label">Last 30 days</span><strong>{data.stats.last30Days.salesCount} · {money(data.stats.last30Days.revenue)}</strong></div>
          </div>
          <h3>Recent sales</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Total</th><th>Payment</th></tr></thead>
              <tbody>
                {data.recentSales.length === 0 && <tr><td colSpan={5}>No sales recorded by this person yet.</td></tr>}
                {data.recentSales.map((s) => (
                  <tr key={s.id}><td>{s.receiptNumber}</td><td>{when(s.saleDate)}</td><td>{s.customerName || "Walk-in"}</td><td>{money(s.total)}</td><td>{s.paymentStatus}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
