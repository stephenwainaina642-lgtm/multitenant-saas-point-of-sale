import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";
import { money } from "./money";
import "./platform-quotes.css";

type Item = { category: string; description: string; details: string; quantity: string; unitPrice: string; lineTotal?: string };
type Issuer = { companyName: string; address: string; phone: string; email: string; kraPin: string };
type Quote = {
  id: string; number: string; status: "draft" | "sent" | "accepted" | "declined"; expired: boolean; title: string;
  client: { name: string; business: string; email: string; phone: string; address: string; kraPin: string };
  intro: string; validUntil: string; vatRate: string; discount: string; subtotal: string; vatAmount: string; total: string;
  terms: string; paymentDetails: string; internalNotes: string; issuer: Issuer; issuerFrozen: boolean; createdBy: string; sentAt: string | null; items: Item[];
};
type Row = { id: string; number: string; status: Quote["status"]; expired: boolean; title: string; clientName: string; clientBusiness: string; validUntil: string; total: string; createdAt: string };
type Service = { id: string; name: string; category: string; description: string; unit: string; unitPrice: string };
type Settings = { companyName: string; address: string; phone: string; email: string; kraPin: string; paymentDetails: string; defaultTerms: string; defaultValidityDays: number; defaultVatRate: string };
type Form = {
  title: string; clientName: string; clientBusiness: string; clientEmail: string; clientPhone: string; clientAddress: string; clientKraPin: string;
  intro: string; validUntil: string; vatRate: string; discount: string; terms: string; paymentDetails: string; internalNotes: string; items: Item[];
};

const CATS: Record<string, string> = { installation: "Installation", training: "Training", subscription: "Subscription", hardware: "Hardware", support: "Support", other: "Other" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe7e1", borderRadius: 12, padding: 16 };
const input: React.CSSProperties = { padding: "9px 11px", border: "1px solid #cfd9d2", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
const primary: React.CSSProperties = { padding: "9px 14px", border: 0, borderRadius: 8, background: "#176b4d", color: "#fff", fontWeight: 700, cursor: "pointer" };
const small: React.CSSProperties = { padding: "6px 10px", border: "1px solid #cfd9d2", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 };
const danger: React.CSSProperties = { ...small, color: "#9b2c1f", borderColor: "#e3b5ae" };
const lab: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "#52625a" };
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const dayText = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
const todayPlus = (d: number) => { const t = new Date(Date.now() + 3 * 3600_000 + d * 86400_000); return t.toISOString().slice(0, 10); };
const cents = (v: string) => Math.round(Number(v || 0) * 100);
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" };
const statusColor: Record<string, string> = { draft: "#8a6d00", sent: "#1d4f91", accepted: "#0f5132", declined: "#9b2c1f", expired: "#9b2c1f" };

/** The printed quotation. Everything shown comes from the server's copy, so what prints is what was saved. */
export function QuoteDocument({ q }: { q: Quote }) {
  const stamp = q.status === "draft" ? "DRAFT" : q.status === "accepted" ? "ACCEPTED" : q.status === "declined" ? "DECLINED" : q.expired ? "EXPIRED" : "";
  const i = q.issuer;
  const contact = [i.address, [i.phone, i.email].filter(Boolean).join("  ·  "), i.kraPin ? `KRA PIN ${i.kraPin}` : ""].filter(Boolean).join("\n");
  return (
    <div className="pq-doc" id="pq-doc">
      <div className="pq-bar">
        <div><p className="pq-brand">{i.companyName || "Your company name"}</p><p className="pq-brand-sub">{contact}</p></div>
        <div className="pq-title"><h2>QUOTATION</h2><p className="pq-number">{q.number}</p></div>
      </div>
      {stamp && <div className={`pq-stamp ${stamp.toLowerCase()}`}>{stamp}</div>}
      <div className="pq-body">
        <div className="pq-meta">
          <div className="pq-party">
            <span className="pq-label">Prepared for</span>
            <strong>{q.client.business || q.client.name}</strong>
            {q.client.business && <span>Attn: {q.client.name}</span>}
            {q.client.address && <span>{q.client.address}</span>}
            {q.client.phone && <span>{q.client.phone}</span>}
            {q.client.email && <span>{q.client.email}</span>}
            {q.client.kraPin && <span>KRA PIN {q.client.kraPin}</span>}
          </div>
          <dl className="pq-dl">
            <div><dt>Date</dt><dd>{dayText((q.sentAt ?? new Date().toISOString()).slice(0, 10))}</dd></div>
            <div><dt>Valid until</dt><dd>{dayText(q.validUntil)}</dd></div>
            <div><dt>Prepared by</dt><dd>{i.companyName || q.createdBy}</dd></div>
            <div><dt>Currency</dt><dd>Kenya Shillings (KES)</dd></div>
          </dl>
        </div>
        {q.title && <h3 className="pq-project">{q.title}</h3>}
        {q.intro && <p className="pq-intro">{q.intro}</p>}
        <table className="pq-table">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
          <tbody>
            {q.items.map((it, n) => (
              <tr key={n}>
                <td><span className="pq-chip">{CATS[it.category] ?? it.category}</span><span className="pq-d">{it.description}</span>{it.details && <span className="pq-sub">{it.details}</span>}</td>
                <td>{Number(it.quantity)}</td><td>{money(it.unitPrice)}</td><td><strong>{money(it.lineTotal ?? 0)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pq-totals">
          <div><span>Subtotal</span><span>{money(q.subtotal)}</span></div>
          {Number(q.discount) > 0 && <div><span>Discount</span><span>− {money(q.discount)}</span></div>}
          {Number(q.vatRate) > 0 && <div><span>VAT ({Number(q.vatRate)}%)</span><span>{money(q.vatAmount)}</span></div>}
          <div className="pq-grand"><span>Total</span><span>{money(q.total)}</span></div>
        </div>
        {(q.terms || q.paymentDetails) && (
          <div className="pq-cols">
            {q.paymentDetails && <div><h4>How to pay</h4><p>{q.paymentDetails}</p></div>}
            {q.terms && <div><h4>Terms &amp; conditions</h4><p>{q.terms}</p></div>}
          </div>
        )}
        <div className="pq-accept">
          <h4>Acceptance</h4>
          <p style={{ margin: 0 }}>By signing below, {q.client.business || q.client.name} accepts this quotation of <strong>{money(q.total)}</strong>.</p>
          <div className="pq-sign"><div>Name &amp; signature</div><div>Title</div><div>Date</div></div>
        </div>
      </div>
      <div className="pq-foot"><span>{i.companyName}{i.phone ? ` · ${i.phone}` : ""}{i.email ? ` · ${i.email}` : ""}</span><span>{q.number} · valid until {dayText(q.validUntil)}</span></div>
    </div>
  );
}

export default function PlatformQuotes({ token }: { token: string }) {
  const [view, setView] = useState<"list" | "doc" | "edit" | "prices" | "settings">("list");
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sForm, setSForm] = useState<Settings | null>(null);
  const [svc, setSvc] = useState({ name: "", category: "installation", unit: "each", unitPrice: "", description: "" });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(<T,>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown) =>
    apiRequest<T>(`/platform${path}`, { method, token, ...(body !== undefined && { body }) }).then((r) => r.data as T), [token]);

  const loadList = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (filter) qs.set("status", filter); if (search.trim()) qs.set("q", search.trim());
      setRows(await call<Row[]>(`/quotes?${qs.toString()}`));
    } catch (e) { setError(msg(e)); }
  }, [call, filter, search]);
  const loadLookups = useCallback(async () => {
    try { const [s, st] = await Promise.all([call<Service[]>("/quote-services"), call<Settings>("/quote-settings")]); setServices(s); setSettings(st); setSForm(st); } catch (e) { setError(msg(e)); }
  }, [call]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadLookups(); }, [loadLookups]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); setNote(""); try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  const open = (id: string) => run(async () => { setQuote(await call<Quote>(`/quotes/${id}`)); setView("doc"); });

  function newForm(): Form {
    return { title: "", clientName: "", clientBusiness: "", clientEmail: "", clientPhone: "", clientAddress: "", clientKraPin: "", intro: "", validUntil: todayPlus(settings?.defaultValidityDays ?? 14),
      vatRate: settings?.defaultVatRate ?? "0", discount: "", terms: settings?.defaultTerms ?? "", paymentDetails: settings?.paymentDetails ?? "", internalNotes: "",
      items: [{ category: "installation", description: "", details: "", quantity: "1", unitPrice: "" }] };
  }
  function editForm(q: Quote): Form {
    return { title: q.title, clientName: q.client.name, clientBusiness: q.client.business, clientEmail: q.client.email, clientPhone: q.client.phone, clientAddress: q.client.address, clientKraPin: q.client.kraPin,
      intro: q.intro, validUntil: q.validUntil, vatRate: q.vatRate, discount: Number(q.discount) ? q.discount : "", terms: q.terms, paymentDetails: q.paymentDetails, internalNotes: q.internalNotes,
      items: q.items.map((i) => ({ category: i.category, description: i.description, details: i.details, quantity: String(Number(i.quantity)), unitPrice: i.unitPrice })) };
  }
  const payload = (f: Form) => ({ ...f, discount: f.discount === "" ? 0 : f.discount, items: f.items.map(({ category, description, details, quantity, unitPrice }) => ({ category, description, details, quantity, unitPrice: unitPrice === "" ? 0 : unitPrice })) });
  const save = () => form && run(async () => {
    const q = editingId ? await call<Quote>(`/quotes/${editingId}`, "PUT", payload(form)) : await call<Quote>("/quotes", "POST", payload(form));
    setQuote(q); setView("doc"); setEditingId(null); await loadList();
  });
  const act = (action: string, okText: string) => quote && run(async () => { setQuote(await call<Quote>(`/quotes/${quote.id}/${action}`, "POST", {})); setNote(okText); await loadList(); });
  const duplicate = () => quote && run(async () => { setQuote(await call<Quote>(`/quotes/${quote.id}/duplicate`, "POST", {})); setNote("A new draft was created from this quotation."); await loadList(); });
  const remove = () => quote && window.confirm(`Delete draft ${quote.number}? This cannot be undone.`) && run(async () => { await call(`/quotes/${quote.id}`, "DELETE"); setQuote(null); setView("list"); await loadList(); });

  const totals = useMemo(() => {
    if (!form) return { sub: 0, disc: 0, vat: 0, total: 0 };
    const sub = form.items.reduce((s, i) => s + Math.round(cents(i.quantity) * cents(i.unitPrice) / 100), 0);
    const disc = Math.min(cents(form.discount), sub);
    const vat = Math.round(((sub - disc) * Math.round(Number(form.vatRate || 0) * 100)) / 10000);
    return { sub, disc, vat, total: sub - disc + vat };
  }, [form]);
  const setItem = (n: number, patch: Partial<Item>) => setForm((f) => f && { ...f, items: f.items.map((it, i) => (i === n ? { ...it, ...patch } : it)) });

  const shareText = (q: Quote) => `Quotation ${q.number}\n${q.title ? q.title + "\n" : ""}For: ${q.client.business || q.client.name}\nTotal: ${money(q.total)}\nValid until: ${dayText(q.validUntil)}\n\n${q.issuer.companyName}${q.issuer.phone ? " · " + q.issuer.phone : ""}`;
  const mailto = (q: Quote) => `mailto:${encodeURIComponent(q.client.email)}?subject=${encodeURIComponent(`Quotation ${q.number}${q.title ? " – " + q.title : ""}`)}&body=${encodeURIComponent(`Dear ${q.client.name},\n\nPlease find our quotation ${q.number} for ${money(q.total)}, valid until ${dayText(q.validUntil)}. Save the attached PDF from the Print option and attach it to this email.\n\nKind regards,\n${q.issuer.companyName}`)}`;

  // ---------------------------------------------------------------- views
  if (view === "doc" && quote) {
    const q = quote;
    return (
      <div className="pq-overlay">
        <div className="pq-toolbar">
          {error && <span style={{ color: "#ffd2cb", alignSelf: "center" }}>{error}</span>}
          {note && <span style={{ color: "#c8f1d9", alignSelf: "center" }}>{note}</span>}
          <button style={small} onClick={() => { setView("list"); setError(""); setNote(""); }}>← All quotations</button>
          {q.status === "draft" && <button style={small} onClick={() => { setForm(editForm(q)); setEditingId(q.id); setView("edit"); }}>Edit</button>}
          {q.status === "draft" && <button style={primary} disabled={busy} onClick={() => act("send", "Marked as sent. The quotation is now locked and the company details are frozen on it.")}>Mark as sent</button>}
          {q.status === "sent" && <><button style={primary} disabled={busy} onClick={() => act("accept", "Marked as accepted.")}>Client accepted</button><button style={small} disabled={busy} onClick={() => act("decline", "Marked as declined.")}>Client declined</button><button style={small} disabled={busy} onClick={() => act("reopen", "Reopened as a draft.")}>Reopen to edit</button></>}
          <button style={small} onClick={() => window.print()}>Print / Save as PDF</button>
          {q.client.email && <a style={{ ...small, textDecoration: "none", color: "inherit" }} href={mailto(q)}>Email client</a>}
          <button style={small} onClick={() => { void navigator.clipboard?.writeText(shareText(q)); setNote("Summary copied."); }}>Copy summary</button>
          <button style={small} disabled={busy} onClick={duplicate}>Duplicate</button>
          {q.status === "draft" && <button style={danger} onClick={remove}>Delete</button>}
        </div>
        <QuoteDocument q={q} />
        {q.internalNotes && <div className="no-print" style={{ ...card, maxWidth: 794, margin: "12px auto 0" }}><strong style={{ fontSize: 12 }}>Internal note (not printed)</strong><p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{q.internalNotes}</p></div>}
      </div>
    );
  }

  if (view === "edit" && form) {
    const f = form;
    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...f, [k]: e.target.value });
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button style={small} onClick={() => { setView(quote && editingId ? "doc" : "list"); setError(""); }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18 }}>{editingId ? `Edit ${quote?.number ?? "quotation"}` : "New quotation"}</h2>
        </div>
        {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Client</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <label style={lab}>Contact person *<input style={input} value={f.clientName} onChange={set("clientName")} maxLength={150} /></label>
            <label style={lab}>Business / hotel<input style={input} value={f.clientBusiness} onChange={set("clientBusiness")} maxLength={150} /></label>
            <label style={lab}>Email<input style={input} type="email" value={f.clientEmail} onChange={set("clientEmail")} /></label>
            <label style={lab}>Phone<input style={input} value={f.clientPhone} onChange={set("clientPhone")} maxLength={40} /></label>
            <label style={lab}>Address<input style={input} value={f.clientAddress} onChange={set("clientAddress")} maxLength={300} /></label>
            <label style={lab}>Client KRA PIN<input style={input} value={f.clientKraPin} onChange={set("clientKraPin")} maxLength={20} /></label>
          </div>
        </div>
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Proposal</h3>
          <label style={lab}>Title (e.g. "nexaPOS installation and staff training")<input style={input} value={f.title} onChange={set("title")} maxLength={150} /></label>
          <label style={lab}>Introduction<textarea style={{ ...input, minHeight: 60 }} value={f.intro} onChange={set("intro")} maxLength={2000} /></label>
          <div style={{ display: "grid", gap: 8, overflowX: "auto", minWidth: 0 }}>
            {f.items.map((it, n) => (
              <div key={n} style={{ display: "grid", gridTemplateColumns: "130px minmax(200px,1fr) 80px 120px auto", gap: 6, alignItems: "start", minWidth: 620 }}>
                <select style={input} value={it.category} onChange={(e) => setItem(n, { category: e.target.value })} aria-label="Category">{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <div style={{ display: "grid", gap: 4 }}>
                  <input style={input} placeholder="Description" value={it.description} onChange={(e) => setItem(n, { description: e.target.value })} maxLength={200} aria-label="Description" />
                  <input style={{ ...input, fontSize: 12 }} placeholder="Details (optional)" value={it.details} onChange={(e) => setItem(n, { details: e.target.value })} maxLength={1000} aria-label="Details" />
                </div>
                <input style={input} inputMode="decimal" placeholder="Qty" value={it.quantity} onChange={(e) => setItem(n, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Quantity" />
                <input style={input} inputMode="decimal" placeholder="Unit price" value={it.unitPrice} onChange={(e) => setItem(n, { unitPrice: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Unit price" />
                <button type="button" style={danger} onClick={() => setForm({ ...f, items: f.items.filter((_, i) => i !== n) })} aria-label="Remove line">×</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={small} disabled={f.items.length >= 50} onClick={() => setForm({ ...f, items: [...f.items, { category: "other", description: "", details: "", quantity: "1", unitPrice: "" }] })}>+ Add a line</button>
            {services.length > 0 && (
              <select style={{ ...input, width: "auto" }} value="" aria-label="Add from price list" onChange={(e) => { const s = services.find((x) => x.id === e.target.value); if (s) setForm({ ...f, items: [...f.items.filter((i) => i.description || i.unitPrice), { category: s.category, description: s.name, details: s.description, quantity: "1", unitPrice: s.unitPrice }] }); }}>
                <option value="">+ Add from price list…</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.unitPrice)}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <label style={lab}>Discount (KSh)<input style={input} inputMode="decimal" value={f.discount} onChange={(e) => setForm({ ...f, discount: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
            <label style={lab}>VAT %<input style={input} inputMode="decimal" value={f.vatRate} onChange={(e) => setForm({ ...f, vatRate: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
            <label style={lab}>Valid until<input style={input} type="date" value={f.validUntil} onChange={set("validUntil")} /></label>
          </div>
          <div style={{ textAlign: "right", fontSize: 14 }}>
            Subtotal {money(totals.sub / 100)}{totals.disc > 0 && <> · Discount −{money(totals.disc / 100)}</>}{totals.vat > 0 && <> · VAT {money(totals.vat / 100)}</>} · <strong style={{ fontSize: 17 }}>Total {money(totals.total / 100)}</strong>
            <div style={{ fontSize: 11, color: "#6b7a70" }}>Preview only. The server works out the final amounts when you save.</div>
          </div>
        </div>
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Terms and payment</h3>
          <label style={lab}>How to pay<textarea style={{ ...input, minHeight: 70 }} value={f.paymentDetails} onChange={set("paymentDetails")} maxLength={2000} /></label>
          <label style={lab}>Terms &amp; conditions<textarea style={{ ...input, minHeight: 90 }} value={f.terms} onChange={set("terms")} maxLength={4000} /></label>
          <label style={lab}>Internal note (never printed)<textarea style={{ ...input, minHeight: 50 }} value={f.internalNotes} onChange={set("internalNotes")} maxLength={2000} /></label>
        </div>
        <div><button style={primary} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save and preview"}</button></div>
      </div>
    );
  }

  if (view === "prices") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><button style={small} onClick={() => setView("list")}>← Back</button><h2 style={{ margin: 0, fontSize: 18 }}>Price list</h2></div>
        <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>Your standard installations, trainings and other services. Pick them when building a quotation; a quotation keeps its own copy, so changing or removing an item here never alters a quotation you already made.</p>
        {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}
        <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
          <input style={input} placeholder="Name (e.g. On-site installation)" value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} maxLength={150} />
          <select style={input} value={svc.category} onChange={(e) => setSvc({ ...svc, category: e.target.value })}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input style={input} placeholder="Price (KSh)" inputMode="decimal" value={svc.unitPrice} onChange={(e) => setSvc({ ...svc, unitPrice: e.target.value.replace(/[^0-9.]/g, "") })} />
          <input style={input} placeholder="Description (optional)" value={svc.description} onChange={(e) => setSvc({ ...svc, description: e.target.value })} maxLength={1000} />
          <button style={primary} disabled={busy || !svc.name.trim()} onClick={() => void run(async () => { await call("/quote-services", "POST", { ...svc, unitPrice: svc.unitPrice === "" ? 0 : svc.unitPrice }); setSvc({ name: "", category: "installation", unit: "each", unitPrice: "", description: "" }); await loadLookups(); })}>Add</button>
        </div>
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Service", "Type", "Price", ""].map((h) => <th key={h} style={{ padding: "10px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid #e8eee9" }}>
                  <td style={{ padding: "10px 12px" }}>{s.name}{s.description && <><br /><small style={{ color: "#6b7a70" }}>{s.description}</small></>}</td>
                  <td style={{ padding: "10px 12px" }}>{CATS[s.category]}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <input key={s.unitPrice} style={{ ...input, maxWidth: 130 }} inputMode="decimal" defaultValue={s.unitPrice} aria-label={`Price for ${s.name}`}
                      onBlur={(e) => { const v = e.target.value; if (v !== s.unitPrice && v !== "") void run(async () => { await call(`/quote-services/${s.id}`, "PUT", { unitPrice: v }); await loadLookups(); }); }} />
                  </td>
                  <td style={{ padding: "10px 12px" }}><button style={danger} onClick={() => window.confirm(`Remove "${s.name}" from the price list?`) && void run(async () => { await call(`/quote-services/${s.id}`, "DELETE"); await loadLookups(); })}>Remove</button></td>
                </tr>
              ))}
              {services.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "#6b7a70" }}>Nothing yet. Add the services you sell, with your own prices.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (view === "settings" && sForm) {
    const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setSForm({ ...sForm, [k]: e.target.value } as Settings);
    return (
      <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><button style={small} onClick={() => setView("list")}>← Back</button><h2 style={{ margin: 0, fontSize: 18 }}>Quotation settings</h2></div>
        <p style={{ margin: 0, fontSize: 13, color: "#52625a" }}>Your company details appear on every quotation. They are copied onto a quotation when you mark it as sent, so later changes never alter one already issued. Only enter a VAT rate if your company is VAT-registered.</p>
        {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}
        {note && <p style={{ margin: 0, color: "#0f5132" }}>{note}</p>}
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <label style={lab}>Company name *<input style={input} value={sForm.companyName} onChange={set("companyName")} maxLength={150} /></label>
          <label style={lab}>Address<input style={input} value={sForm.address} onChange={set("address")} maxLength={300} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label style={lab}>Phone<input style={input} value={sForm.phone} onChange={set("phone")} maxLength={40} /></label>
            <label style={lab}>Email<input style={input} type="email" value={sForm.email} onChange={set("email")} /></label>
            <label style={lab}>KRA PIN<input style={input} value={sForm.kraPin} onChange={set("kraPin")} maxLength={20} /></label>
          </div>
          <label style={lab}>How clients pay (Paybill / bank details)<textarea style={{ ...input, minHeight: 80 }} value={sForm.paymentDetails} onChange={set("paymentDetails")} maxLength={2000} /></label>
          <label style={lab}>Default terms &amp; conditions<textarea style={{ ...input, minHeight: 110 }} value={sForm.defaultTerms} onChange={set("defaultTerms")} maxLength={4000} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label style={lab}>Quotation valid for (days)<input style={input} inputMode="numeric" value={sForm.defaultValidityDays} onChange={(e) => setSForm({ ...sForm, defaultValidityDays: Number(e.target.value.replace(/\D/g, "")) })} /></label>
            <label style={lab}>Default VAT %<input style={input} inputMode="decimal" value={sForm.defaultVatRate} onChange={(e) => setSForm({ ...sForm, defaultVatRate: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          </div>
          <div><button style={primary} disabled={busy} onClick={() => void run(async () => { const s = await call<Settings>("/quote-settings", "PUT", sForm); setSettings(s); setSForm(s); setNote("Saved."); })}>Save settings</button></div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- list
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button style={primary} onClick={() => { setForm(newForm()); setEditingId(null); setQuote(null); setError(""); setView("edit"); }}>+ New quotation</button>
        <button style={small} onClick={() => { setView("prices"); setError(""); }}>Price list</button>
        <button style={small} onClick={() => { setView("settings"); setError(""); setNote(""); }}>Company settings</button>
        <select style={{ ...input, width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input style={{ ...input, maxWidth: 260, marginLeft: "auto" }} placeholder="Search client or number" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <p style={{ margin: 0, color: "#b3412f" }}>{error}</p>}
      {settings && !settings.companyName.trim() && <p style={{ ...card, margin: 0, background: "#fff7e0", fontSize: 13 }}>Set your company details under <strong>Company settings</strong> before sending a quotation.</p>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", background: "#f4f8f5" }}>{["Number", "Client", "Project", "Total", "Valid until", "Status"].map((h) => <th key={h} style={{ padding: "10px 12px" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #e8eee9", cursor: "pointer" }} onClick={() => void open(r.id)}>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontWeight: 600 }}>{r.number}</td>
                <td style={{ padding: "10px 12px" }}>{r.clientBusiness || r.clientName}{r.clientBusiness && <><br /><small style={{ color: "#6b7a70" }}>{r.clientName}</small></>}</td>
                <td style={{ padding: "10px 12px" }}>{r.title || "—"}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{money(r.total)}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{dayText(r.validUntil)}</td>
                <td style={{ padding: "10px 12px" }}><span style={{ color: statusColor[r.expired ? "expired" : r.status], fontWeight: 700 }}>{r.expired ? "Expired" : STATUS[r.status]}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#6b7a70" }}>No quotations yet. Start with “New quotation”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
