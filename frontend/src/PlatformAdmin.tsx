import PasswordInput from "./PasswordInput";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, SESSION_MARKER } from "./api/client";
import { money } from "./money";
import PlatformQuotes from "./PlatformQuotes";

type Biz = {
  approvalStatus: "approved" | "pending" | "rejected";
  id: string; name: string; businessType: string; isActive: boolean; createdAt: string; ownerName: string | null; ownerEmail: string | null;
  package: "retail" | "hotel"; modules: string[];
  users: number; products: number; salesCount: number; salesTotal: string; sales30dCount: number; sales30dTotal: string; lastSaleAt: string | null;
};
type Invite = { id: string; package: "retail" | "hotel" | null; email: string; businessName: string | null; note: string | null; autoApprove: boolean; status: "active" | "used" | "expired" | "cancelled" | "locked"; createdAt: string; expiresAt: string; usedAt: string | null };
type Overview = { totals: { businesses: number; pending: number; suspended: number; activeLast30Days: number; users: number }; businesses: Biz[] };
type Audit = { id: string; action: string; businessId: string | null; reason: string; adminName: string; createdAt: string };
type Dialog = { kind: "suspend" | "reactivate" | "reset" | "approve" | "reject"; biz: Biz } | null;
const PKG_LABEL = { retail: "Retail", hotel: "Hotel & restaurant" } as const;
const PKG_DEFAULT: Record<string, string[]> = { retail: ["purchasing", "documents"], hotel: ["tables", "rooms", "purchasing", "documents"] };
const MODULE_LABEL: Record<string, string> = { tables: "Tables & orders", rooms: "Rooms & stays", purchasing: "Suppliers & purchases", documents: "Quotations & invoices" };
type Created = { email: string; link: string; pin: string; expiresAt: string };

const KEY = "platform_token";
/** "today", "3 days ago", "2 months ago": how long since a business registered. */
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : `${Math.floor(months / 12)} year${months >= 24 ? "s" : ""} ago`;
};
const kes = (v: string | number) => money(v);
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
  const [tab, setTab] = useState<"businesses" | "invites" | "quotes" | "audit">("businesses");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inv, setInv] = useState({ email: "", businessName: "", note: "", autoApprove: true, package: "retail" });
  const [plan, setPlan] = useState<{ biz: Biz; package: "retail" | "hotel"; modules: string[] } | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [search, setSearch] = useState("");
  const [pkgFilter, setPkgFilter] = useState<"all" | "retail" | "hotel">("all");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [form, setForm] = useState({ email: "", password: "", code: "" });

  const load = useCallback(async (t: string) => {
    try {
      const [o, a, me, iv] = await Promise.all([
        apiRequest<Overview>("/platform/overview", { token: t }),
        apiRequest<Audit[]>("/platform/audit", { token: t }),
        apiRequest<{ name: string }>("/platform/me", { token: t }),
        apiRequest<Invite[]>("/platform/invites", { token: t }),
      ]);
      setInvites(iv.data ?? []);
      setData(o.data ?? null); setAudit(a.data ?? []); setAdmin(me.data?.name ?? ""); setError("");
    } catch (e) { setError(msg(e)); }
  }, []);
  useEffect(() => { if (token) void load(token); }, [token, load]);

  async function signIn(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setError("");
    try {
      await apiRequest("/platform/login", { method: "POST", body: form });
      sessionStorage.setItem(KEY, SESSION_MARKER); setToken(SESSION_MARKER); setForm({ email: "", password: "", code: "" });
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function signOut() { try { await apiRequest("/platform/logout", { method: "POST" }); } catch { /* the cookie expires on its own */ } try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } setToken(""); setData(null); window.location.hash = ""; window.location.reload(); }

  async function createInvite(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setError("");
    try {
      const r = await apiRequest<{ email: string; token: string; pin: string; expiresAt: string }>("/platform/invites", { method: "POST", token, body: inv });
      if (r.data) setCreated({ email: r.data.email, link: `${window.location.origin}/#join=${r.data.token}`, pin: r.data.pin, expiresAt: r.data.expiresAt });
      setInv({ email: "", businessName: "", note: "", autoApprove: true, package: "retail" }); await load(token);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function savePlan(ev: React.FormEvent) {
    ev.preventDefault(); if (!plan) return; setBusy(true); setError("");
    try {
      const b = plan.biz;
      const order = Object.keys(MODULE_LABEL);
      if (plan.package !== b.package) await apiRequest(`/platform/businesses/${b.id}/package`, { method: "POST", token, body: { package: plan.package, reason } });
      const current = plan.package !== b.package ? PKG_DEFAULT[plan.package]! : b.modules;
      const wanted = order.filter((m) => plan.modules.includes(m));
      if (wanted.join() !== order.filter((m) => current.includes(m)).join()) await apiRequest(`/platform/businesses/${b.id}/modules`, { method: "POST", token, body: { modules: wanted, reason } });
      setPlan(null); setReason(""); await load(token);
    } catch (e) { setError(msg(e)); await load(token); } finally { setBusy(false); }
  }
  async function revoke(ev: React.FormEvent) {
    ev.preventDefault(); if (!revoking) return; setBusy(true); setError("");
    try { await apiRequest(`/platform/invites/${revoking.id}/revoke`, { method: "POST", token, body: { reason } }); setRevoking(null); setReason(""); await load(token); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };

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
            <PasswordInput style={input} placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
            <input style={input} inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="6-digit authenticator code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} autoComplete="one-time-code" required />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <button style={primary} disabled={busy}>{busy ? "Please wait..." : "Sign in"}</button>
          </form>
        </div>
      </main>
    );
  }

  const rows = (data?.businesses ?? []).filter((b) => (pkgFilter === "all" || b.package === pkgFilter) && `${b.name} ${b.ownerName} ${b.ownerEmail}`.toLowerCase().includes(search.toLowerCase()));
  const all = data?.businesses ?? [];
  const perPackage = { retail: all.filter((b) => b.package === "retail").length, hotel: all.filter((b) => b.package === "hotel").length };
  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div><p style={{ margin: 0, fontSize: 11, letterSpacing: 1.2, color: "#6b7a70", fontWeight: 700 }}>NEXAPOS PLATFORM</p><h1 style={{ margin: "4px 0", fontSize: 24 }}>Businesses</h1></div>
        <div style={{ fontSize: 13 }}>Signed in as <strong>{admin}</strong> <button style={small} onClick={signOut}>Sign out</button></div>
      </header>
      {error && <p style={{ color: "#b3412f" }}>{error}</p>}
      {result && <pre style={{ ...card, background: "#fff7e0", whiteSpace: "pre-wrap", margin: "12px 0" }}>{result} <button style={small} onClick={() => setResult("")}>Dismiss</button></pre>}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "16px 0" }}>
        {[["Businesses", data?.totals.businesses], ["Waiting for approval", data?.totals.pending], ["Active in last 30 days", data?.totals.activeLast30Days], ["Suspended", data?.totals.suspended], ["Users", data?.totals.users], ["Retail package", perPackage.retail], ["Hotel package", perPackage.hotel]].map(([l, v]) => (
          <div key={String(l)} style={card}><div style={{ fontSize: 12, color: "#6b7a70" }}>{l}</div><div style={{ fontSize: 26, fontWeight: 700 }}>{v ?? "–"}</div></div>
        ))}
      </section>
      <nav style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["businesses", "invites", "quotes", "audit"] as const).map((t) => <button key={t} style={{ ...small, ...(tab === t ? { background: "#176b4d", color: "#fff" } : {}) }} onClick={() => setTab(t)}>{t === "businesses" ? "Businesses" : t === "invites" ? "Invitations" : t === "quotes" ? "Quotations" : "Admin activity"}</button>)}
        {tab === "businesses" && <select aria-label="Filter by package" style={{ ...input, width: "auto", marginLeft: "auto" }} value={pkgFilter} onChange={(e) => setPkgFilter(e.target.value as "all" | "retail" | "hotel")}><option value="all">All packages</option><option value="retail">Retail only</option><option value="hotel">Hotel only</option></select>}
        {tab === "businesses" && <input style={{ ...input, maxWidth: 280 }} placeholder="Search name or owner" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </nav>

      {tab === "businesses" ? (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Business", "Owner", "Usage", "Sales", "Package", "Status", "Actions"].map((h) => <th key={h} style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid #e8eee9", verticalAlign: "top" }}>
                  <td style={{ padding: "10px 12px" }}><strong>{b.name}</strong><br /><small style={{ color: "#6b7a70" }}>{b.businessType} &middot; registered {day(b.createdAt)}<br />{ago(b.createdAt)}</small></td>
                  <td style={{ padding: "10px 12px" }}>{b.ownerName}<br /><small style={{ color: "#6b7a70", wordBreak: "break-all" }}>{b.ownerEmail}</small></td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{b.users} {b.users === 1 ? "user" : "users"}<br /><small style={{ color: "#6b7a70" }}>{b.products} products<br />{b.salesCount} sales</small></td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}><strong>{kes(b.salesTotal)}</strong><br /><small style={{ color: "#6b7a70" }}>Last 30 days: {kes(b.sales30dTotal)} ({b.sales30dCount})<br />Last sale: {day(b.lastSaleAt)}</small></td>
                  <td style={{ padding: "10px 12px" }}><strong>{PKG_LABEL[b.package]}</strong><br /><small style={{ color: "#6b7a70" }}>{b.modules.length ? b.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ") : "No extra modules"}</small></td>
                  <td style={{ padding: "10px 12px" }}>{(() => { const st = !b.isActive ? ["Suspended", "#fde8e4", "#b3412f"] : b.approvalStatus === "pending" ? ["Awaiting approval", "#fff3d6", "#8a5a00"] : b.approvalStatus === "rejected" ? ["Rejected", "#fde8e4", "#b3412f"] : ["Active", "#e3f4e9", "#176b4d"]; return <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: st[1], color: st[2], whiteSpace: "nowrap" }}>{st[0]}</span>; })()}</td>
                  <td style={{ padding: "10px 12px", minWidth: 190 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {b.approvalStatus !== "approved" && <button style={{ ...small, background: "#176b4d", color: "#fff", borderColor: "#176b4d", fontWeight: 700 }} onClick={() => { setDialog({ kind: "approve", biz: b }); setReason(""); setError(""); }}>Approve</button>}
                      {b.approvalStatus !== "rejected" && <button style={small} onClick={() => { setDialog({ kind: "reject", biz: b }); setReason(""); setError(""); }}>Reject</button>}
                      <button style={small} onClick={() => { setDialog({ kind: b.isActive ? "suspend" : "reactivate", biz: b }); setReason(""); setError(""); }}>{b.isActive ? "Suspend" : "Reactivate"}</button>
                      <button style={small} onClick={() => { setPlan({ biz: b, package: b.package, modules: b.modules }); setReason(""); setError(""); }}>Package</button>
                      <button style={small} onClick={() => { setDialog({ kind: "reset", biz: b }); setReason(""); setError(""); }}>Reset owner</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>No businesses found.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : tab === "quotes" ? (
        <PlatformQuotes token={token} />
      ) : tab === "invites" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form onSubmit={createInvite} style={{ ...card, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Invite a client</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>Creates a single-use link (valid 7 days) that only works for this email address, plus a 6-digit PIN. Send the link and the PIN by different channels, for example the link by email and the PIN by phone.</p>
            <input style={input} type="email" placeholder="Client's email address" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} required />
            <input style={input} placeholder="Business name (optional, they can change it)" value={inv.businessName} onChange={(e) => setInv({ ...inv, businessName: e.target.value })} maxLength={255} />
            <input style={input} placeholder="Note for yourself (optional)" value={inv.note} onChange={(e) => setInv({ ...inv, note: e.target.value })} maxLength={500} />
            <label style={{ fontSize: 13 }}>Package <select style={{ ...input, width: "auto" }} value={inv.package} onChange={(e) => setInv({ ...inv, package: e.target.value })}><option value="retail">Retail shop</option><option value="hotel">Hotel & restaurant</option></select></label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={inv.autoApprove} onChange={(e) => setInv({ ...inv, autoApprove: e.target.checked })} /> Approve the business automatically when they sign up (untick to review it first)</label>
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <div><button style={primary} disabled={busy}>{busy ? "Please wait..." : "Create invitation"}</button></div>
          </form>
          <div style={{ ...card, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Client email", "Business", "Package", "Created", "Expires", "Status", ""].map((h) => <th key={h} style={{ padding: "10px 12px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} style={{ borderTop: "1px solid #e8eee9" }}>
                    <td style={{ padding: "10px 12px" }}>{i.email}{i.note && <><br /><small style={{ color: "#6b7a70" }}>{i.note}</small></>}</td>
                    <td style={{ padding: "10px 12px" }}>{i.businessName || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{i.package ? PKG_LABEL[i.package] : "By business type"}</td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{day(i.createdAt)}</td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{day(i.expiresAt)}</td>
                    <td style={{ padding: "10px 12px" }}>{{ active: "Waiting for the client", used: `Used ${day(i.usedAt)}`, expired: "Expired", cancelled: "Cancelled", locked: "Locked (wrong PINs)" }[i.status]}</td>
                    <td style={{ padding: "10px 12px" }}>{i.status === "active" || i.status === "locked" ? <button style={small} onClick={() => { setRevoking(i); setReason(""); setError(""); }}>Cancel</button> : null}</td>
                  </tr>
                ))}
                {invites.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>No invitations yet.</td></tr>}
              </tbody>
            </table>
          </div>
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
            <h2 style={{ margin: 0, fontSize: 18 }}>{dialog.kind === "suspend" ? "Suspend" : dialog.kind === "reactivate" ? "Reactivate" : dialog.kind === "approve" ? "Approve" : dialog.kind === "reject" ? "Reject" : "Reset owner access for"} {dialog.biz.name}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>
              {dialog.kind === "suspend" && "Its users are blocked straight away and see a suspended message. No data is deleted."}
              {dialog.kind === "reactivate" && "Its users can sign in and work again."}
              {dialog.kind === "approve" && "Its users can start using the system straight away."}
              {dialog.kind === "reject" && "Its users are blocked and told the business was not approved. No data is deleted; you can approve it later."}
              {dialog.kind === "reset" && `Owner: ${dialog.biz.ownerEmail}. If e-mail is set up a reset link is sent; otherwise a one-time temporary password is shown to you.`}
            </p>
            <textarea style={{ ...input, minHeight: 70 }} placeholder="Reason (required, recorded in the admin activity log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={3} autoFocus />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" style={small} onClick={() => setDialog(null)}>Cancel</button><button style={primary} disabled={busy}>{busy ? "Please wait..." : "Confirm"}</button></div>
          </form>
        </div>
      )}
      {plan && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <form onSubmit={savePlan} style={{ ...card, width: "100%", maxWidth: 460, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Package for {plan.biz.name}</h2>
            <label style={{ fontSize: 13 }}>Package <select style={{ ...input, width: "auto" }} value={plan.package} onChange={(e) => { const p = e.target.value as "retail" | "hotel"; setPlan({ ...plan, package: p, modules: p === plan.biz.package ? plan.biz.modules : PKG_DEFAULT[p]! }); }}><option value="retail">Retail shop</option><option value="hotel">Hotel & restaurant</option></select></label>
            <fieldset style={{ border: "1px solid #dfe7e1", borderRadius: 8 }}><legend style={{ fontSize: 12, color: "#6b7a70" }}>Modules switched on</legend>
              {Object.entries(MODULE_LABEL).map(([m, label]) => <label key={m} style={{ display: "block", fontSize: 13, padding: "3px 0" }}><input type="checkbox" checked={plan.modules.includes(m)} onChange={(e) => setPlan({ ...plan, modules: e.target.checked ? [...plan.modules, m] : plan.modules.filter((x) => x !== m) })} /> {label}</label>)}
            </fieldset>
            <p style={{ margin: 0, fontSize: 12, color: "#52625a" }}>Changing the package resets the modules to that package's defaults, which you can then adjust. Switching a module off hides it and blocks its pages; no data is deleted and it returns when switched back on. Staff roles are not changed.</p>
            <textarea style={{ ...input, minHeight: 70 }} placeholder="Reason (required, recorded in the admin activity log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={3} />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" style={small} onClick={() => setPlan(null)}>Cancel</button><button style={primary} disabled={busy}>{busy ? "Please wait..." : "Save"}</button></div>
          </form>
        </div>
      )}
      {created && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <div style={{ ...card, width: "100%", maxWidth: 520, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Invitation for {created.email}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#8a5a00" }}>Shown only once. Copy both now. It expires on {day(created.expiresAt)}.</p>
            <label style={{ fontSize: 12, color: "#6b7a70" }}>Link (send by email or message)</label>
            <div style={{ display: "flex", gap: 6 }}><input style={input} readOnly value={created.link} onFocus={(e) => e.target.select()} /><button type="button" style={small} onClick={() => copy(created.link)}>Copy</button></div>
            <label style={{ fontSize: 12, color: "#6b7a70" }}>PIN (give it separately, for example by phone)</label>
            <div style={{ display: "flex", gap: 6 }}><input style={{ ...input, fontSize: 22, letterSpacing: 4, fontWeight: 700 }} readOnly value={created.pin} /><button type="button" style={small} onClick={() => copy(created.pin)}>Copy</button></div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={primary} onClick={() => setCreated(null)}>I have copied them</button></div>
          </div>
        </div>
      )}
      {revoking && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <form onSubmit={revoke} style={{ ...card, width: "100%", maxWidth: 440, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Cancel the invitation for {revoking.email}</h2>
            <textarea style={{ ...input, minHeight: 70 }} placeholder="Reason (required, recorded in the admin activity log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={3} autoFocus />
            {error && <p style={{ margin: 0, color: "#b3412f", fontSize: 13 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" style={small} onClick={() => setRevoking(null)}>Back</button><button style={primary} disabled={busy}>Cancel invitation</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
