import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";

type Biz = {
  id: string; name: string; businessType: string; isActive: boolean; createdAt: string; ownerName: string | null; ownerEmail: string | null;
  users: number; products: number; salesCount: number; salesTotal: string; sales30dCount: number; sales30dTotal: string; lastSaleAt: string | null;
};
type Overview = { totals: { businesses: number; suspended: number; activeLast30Days: number; users: number }; businesses: Biz[] };
type Audit = { id: string; action: string; businessId: string | null; reason: string; adminName: string; createdAt: string };
type Dialog = { kind: "suspend" | "reactivate" | "reset"; biz: Biz } | null;

const KEY = "platform_token";
const kes = (v: string) => `KSh ${Number(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "never");
const when = (v: string) => new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe7e1", borderRadius: 12, padding: 16 };
const input: React.CSSProperties = { padding: "10px 12px", border: "1px solid #cfd9d2", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box" };
const primary: React.CSSProperties = { padding: "10px 14px", border: 0, borderRadius: 8, background: "#176b4d", color: "#fff", fontWeight: 700, cursor: "pointer" };
const small: React.CSSProperties = { padding: "5px 9px", border: "1px solid #cfd9d2", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 };

export default function PlatformAdmin() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } });
  const [admin, setAdmin] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tab, setTab] = useState<"businesses" | "audit">("businesses");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [form, setForm] = useState({ email: "", password: "", code: "" });

  const load = useCallback(async (t: string) => {
    try {
      const [o, a, me] = await Promise.all([
        apiRequest<Overview>("/platform/overview", { token: t }),
        apiRequest<Audit[]>("/platform/audit", { token: t }),
        apiRequest<{ name: string }>("/platform/me", { token: t }),
      ]);
      setData(o.data ?? null); setAudit(a.data ?? []); setAdmin(me.data?.name ?? ""); setError("");
    } catch (e) { setError(msg(e)); }
  }, []);
  useEffect(() => { if (token) void load(token); }, [token, load]);

  async function signIn(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setError("");
    try {
      const r = await apiRequest<{ token: string }>("/platform/login", { method: "POST", body: form });
      sessionStorage.setItem(KEY, r.data!.token); setToken(r.data!.token); setForm({ email: "", password: "", code: "" });
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  function signOut() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } setToken(""); setData(null); window.location.hash = ""; window.location.reload(); }

  async function confirm(ev: React.FormEvent) {
    ev.preventDefault(); if (!dialog) return; setBusy(true); setError("");
    const path = dialog.kind === "reset" ? "reset-owner" : dialog.kind;
    try {
      const r = await apiRequest<{ method?: string; ownerEmail?: string; temporaryPassword?: string | null }>(`/platform/businesses/${dialog.biz.id}/${path}`, { method: "POST", token, body: { reason } });
      if (dialog.kind === "reset") {
        setResult(r.data?.temporaryPassword
          ? `Temporary password for ${r.data.ownerEmail}: ${r.data.temporaryPassword}\nShown only once. Give it to the owner; they are signed out everywhere and should change it after signing in.`
          : `A reset link was e-mailed to ${r.data?.ownerEmail}.`);
      } else setResult("");
      setDialog(null); setReason(""); await load(token);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  const wrap: React.CSSProperties = { maxWidth: 1200, margin: "0 auto", padding: "24px 16px", fontFamily: "Inter, system-ui, sans-serif", color: "#1d2b22" };

  if (!token) {
    return (
      <main style={{ ...wrap, maxWidth: 420, paddingTop: 80 }}>
        <div style={card}>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: 1.2, color: "#6b7a70", fontWeight: 700 }}>NEXAPOS PLATFORM</p>
          <h1 style={{ margin: "6px 0 16px", fontSize: 22 }}>Platform sign-in</h1>
          <form onSubmit={signIn} style={{ display: "grid", gap: 10 }}>
            <input style={input} type="email" placeholder="Admin e-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="username" required />
            <input style={input} type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
            <input style={input} inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="6-digit authenticator code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} autoComplete="one-time-code" required />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <button style={primary} disabled={busy}>{busy ? "Please wait..." : "Sign in"}</button>
          </form>
        </div>
      </main>
    );
  }

  const rows = (data?.businesses ?? []).filter((b) => `${b.name} ${b.ownerName} ${b.ownerEmail}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div><p style={{ margin: 0, fontSize: 11, letterSpacing: 1.2, color: "#6b7a70", fontWeight: 700 }}>NEXAPOS PLATFORM</p><h1 style={{ margin: "4px 0", fontSize: 24 }}>Businesses</h1></div>
        <div style={{ fontSize: 13 }}>Signed in as <strong>{admin}</strong> <button style={small} onClick={signOut}>Sign out</button></div>
      </header>
      {error && <p style={{ color: "#b3412f" }}>{error}</p>}
      {result && <pre style={{ ...card, background: "#fff7e0", whiteSpace: "pre-wrap", margin: "12px 0" }}>{result} <button style={small} onClick={() => setResult("")}>Dismiss</button></pre>}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "16px 0" }}>
        {[["Businesses", data?.totals.businesses], ["Active in last 30 days", data?.totals.activeLast30Days], ["Suspended", data?.totals.suspended], ["Users", data?.totals.users]].map(([l, v]) => (
          <div key={String(l)} style={card}><div style={{ fontSize: 12, color: "#6b7a70" }}>{l}</div><div style={{ fontSize: 26, fontWeight: 700 }}>{v ?? "–"}</div></div>
        ))}
      </section>
      <nav style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["businesses", "audit"] as const).map((t) => <button key={t} style={{ ...small, ...(tab === t ? { background: "#176b4d", color: "#fff" } : {}) }} onClick={() => setTab(t)}>{t === "businesses" ? "Businesses" : "Admin activity"}</button>)}
        {tab === "businesses" && <input style={{ ...input, maxWidth: 280, marginLeft: "auto" }} placeholder="Search name or owner" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </nav>

      {tab === "businesses" ? (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Business", "Owner", "Created", "Users", "Products", "Sales", "Sales total", "Last 30 days", "Last sale", "Status", ""].map((h) => <th key={h} style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid #e8eee9" }}>
                  <td style={{ padding: "10px 12px" }}><strong>{b.name}</strong><br /><small style={{ color: "#6b7a70" }}>{b.businessType}</small></td>
                  <td style={{ padding: "10px 12px" }}>{b.ownerName}<br /><small style={{ color: "#6b7a70" }}>{b.ownerEmail}</small></td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{day(b.createdAt)}</td>
                  <td style={{ padding: "10px 12px" }}>{b.users}</td><td style={{ padding: "10px 12px" }}>{b.products}</td><td style={{ padding: "10px 12px" }}>{b.salesCount}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{kes(b.salesTotal)}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{kes(b.sales30dTotal)}<br /><small style={{ color: "#6b7a70" }}>{b.sales30dCount} sales</small></td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{day(b.lastSaleAt)}</td>
                  <td style={{ padding: "10px 12px" }}><span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: b.isActive ? "#e3f4e9" : "#fde8e4", color: b.isActive ? "#176b4d" : "#b3412f" }}>{b.isActive ? "Active" : "Suspended"}</span></td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button style={small} onClick={() => { setDialog({ kind: b.isActive ? "suspend" : "reactivate", biz: b }); setReason(""); setError(""); }}>{b.isActive ? "Suspend" : "Reactivate"}</button>{" "}
                    <button style={small} onClick={() => { setDialog({ kind: "reset", biz: b }); setReason(""); setError(""); }}>Reset owner</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>No businesses found.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["When", "Admin", "Action", "Business id", "Reason"].map((h) => <th key={h} style={{ padding: "10px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id} style={{ borderTop: "1px solid #e8eee9" }}><td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{when(a.createdAt)}</td><td style={{ padding: "10px 12px" }}>{a.adminName}</td><td style={{ padding: "10px 12px" }}>{a.action}</td><td style={{ padding: "10px 12px" }}>{a.businessId}</td><td style={{ padding: "10px 12px" }}>{a.reason}</td></tr>)}
              {audit.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>No admin actions yet.</td></tr>}</tbody>
          </table>
        </div>
      )}
      <p style={{ color: "#6b7a70", fontSize: 12 }}>Counts, dates and sale totals only. Customer details, individual sales and prices are never shown here.</p>

      {dialog && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <form onSubmit={confirm} style={{ ...card, width: "100%", maxWidth: 440, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{dialog.kind === "suspend" ? "Suspend" : dialog.kind === "reactivate" ? "Reactivate" : "Reset owner access for"} {dialog.biz.name}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>
              {dialog.kind === "suspend" && "Its users are blocked straight away and see a suspended message. No data is deleted."}
              {dialog.kind === "reactivate" && "Its users can sign in and work again."}
              {dialog.kind === "reset" && `Owner: ${dialog.biz.ownerEmail}. If e-mail is set up a reset link is sent; otherwise a one-time temporary password is shown to you.`}
            </p>
            <textarea style={{ ...input, minHeight: 70 }} placeholder="Reason (required, recorded in the admin activity log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={3} autoFocus />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" style={small} onClick={() => setDialog(null)}>Cancel</button><button style={primary} disabled={busy}>{busy ? "Please wait..." : "Confirm"}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
