import { useState } from "react";
import { apiRequest } from "./api/client";
import { BUSINESS_TYPE_OPTIONS } from "./businessTypes";
import { storePermissions } from "./permissions";

type Biz = { id: string; name: string; role: string };
type Selected = { businessId: string; businessName: string; role: string; permissions: string[] };

/** Sidebar business card: shows the current business, lets the user switch, and lets them add another one. */
export default function BusinessSwitcher() {
  const token = sessionStorage.getItem("pos_token") || "";
  const currentId = sessionStorage.getItem("pos_business_id") || "";
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Biz[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("retail");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    setMessage("");
    if (next) {
      try {
        const r = await apiRequest<Biz[]>("/businesses", { token });
        setList(r.data ?? []);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not load your businesses.");
      }
    }
  }

  async function switchTo(id: string) {
    if (id === currentId) return setOpen(false);
    setBusy(true);
    setMessage("");
    try {
      const r = await apiRequest<Selected>("/business-context/select", { method: "POST", token, body: { businessId: id } });
      const d = r.data!;
      sessionStorage.setItem("pos_business_id", d.businessId);
      sessionStorage.setItem("pos_business_name", d.businessName);
      sessionStorage.setItem("pos_business_role", d.role);
      storePermissions(d.permissions);
      window.location.reload(); // every screen reloads its data for the new business
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not switch business.");
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await apiRequest<{ id: string }>("/businesses", { method: "POST", token, body: { name, businessType: type } });
      await switchTo(r.data!.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not create the business.");
      setBusy(false);
    }
  }

  return (
    <div className="biz-switcher">
      <button type="button" className="business-switch" onClick={toggle} aria-expanded={open}>
        <span className="business-avatar">{(sessionStorage.getItem("pos_business_name") || "B").charAt(0).toUpperCase()}</span>
        <span className="business-info">
          <strong>{sessionStorage.getItem("pos_business_name") || "Your Business"}</strong>
          <small>Switch or add business</small>
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="biz-menu">
          {(list ?? []).map((b) => (
            <button key={b.id} type="button" className={`biz-item ${b.id === currentId ? "current" : ""}`} onClick={() => switchTo(b.id)} disabled={busy}>
              <span>{b.name}</span><small>{b.id === currentId ? "current" : b.role}</small>
            </button>
          ))}
          {!adding ? (
            <button type="button" className="biz-add" onClick={() => setAdding(true)}>+ Add another business</button>
          ) : (
            <form className="biz-form" onSubmit={create}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" maxLength={255} required autoFocus />
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {BUSINESS_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="submit" disabled={busy}>{busy ? "Creating..." : "Create and open"}</button>
              <small>A separate business: its own products, stock, customers and reports.</small>
            </form>
          )}
          {message && <p className="biz-error">{message}</p>}
        </div>
      )}
    </div>
  );
}
