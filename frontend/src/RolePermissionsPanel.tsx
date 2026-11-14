import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";

export type Role = { id: string; name: string; description: string | null; permissions: string[] };
type Catalog = { permissions: { key: string; label: string }[] };

const GROUPS: Record<string, string> = {
  products: "Products", inventory: "Inventory", customers: "Customers", suppliers: "Suppliers",
  purchases: "Purchases", sales: "Sales", payments: "Payments", expenses: "Expenses",
  invoices: "Invoices", quotations: "Quotations", reports: "Reports", audit: "Audit log",
  roles: "Roles", employees: "Employees", settings: "Settings",
};

type Props = { onChanged?: () => void };

/** Real role management: roles and their permissions are stored in the database and enforced by the API. */
export default function RolePermissionsPanel({ onChanged }: Props) {
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Catalog["permissions"]>([]);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        apiRequest<Role[]>("/roles", { token, businessId }),
        apiRequest<Catalog>("/roles/permissions", { token, businessId }),
      ]);
      setRoles(r.data ?? []);
      setCatalog(c.data?.permissions ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load roles.");
    }
  }, [token, businessId]);

  useEffect(() => { void load(); }, [load]);

  function start(role: Role | "new") {
    setEditing(role);
    setName(role === "new" ? "" : role.name);
    setSelected(new Set(role === "new" ? [] : role.permissions));
    setNotice(""); setError("");
  }

  function toggle(key: string) {
    setSelected((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { name, permissions: [...selected] };
      if (editing === "new") await apiRequest("/roles", { method: "POST", token, businessId, body });
      else if (editing) await apiRequest(`/roles/${editing.id}`, { method: "PUT", token, businessId, body });
      setNotice("Role saved."); setEditing(null);
      await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the role."); }
    finally { setBusy(false); }
  }

  async function remove(role: Role) {
    if (!window.confirm(`Delete the role "${role.name}"?`)) return;
    setError(""); setNotice("");
    try {
      await apiRequest(`/roles/${role.id}`, { method: "DELETE", token, businessId });
      setNotice("Role deleted."); await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete the role."); }
  }

  const grouped = catalog.reduce<Record<string, { key: string; label: string }[]>>((acc, p) => {
    const g = GROUPS[p.key.split(".")[0]] ?? "Other";
    (acc[g] ??= []).push(p);
    return acc;
  }, {});

  return (
    <article className="panel" style={{ padding: 24 }}>
      <div className="panel-heading">
        <div>
          <h2>Roles and permissions</h2>
          <p>What each role may do is enforced by the server on every request</p>
        </div>
        <button type="button" className="button-primary" onClick={() => start("new")}>New role</button>
      </div>
      {error && <p className="customer-notice" role="alert">{error}</p>}
      {notice && <p className="customer-notice" role="status">{notice}</p>}

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>ROLE</th><th>PERMISSIONS</th><th>ACTIONS</th></tr></thead>
          <tbody>
            {roles.length === 0 && <tr><td colSpan={3}>No custom roles yet. Built-in roles (manager, cashier, salesperson, inventory manager, accountant) are created when you assign them.</td></tr>}
            {roles.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong></td>
                <td>{r.permissions.length > 0 ? `${r.permissions.length} permissions` : "Built-in defaults"}</td>
                <td><div className="customer-actions">
                  <button type="button" className="button-secondary" onClick={() => start(r)}>Edit</button>
                  <button type="button" className="button-secondary" onClick={() => void remove(r)}>Delete</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Role name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
              style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2", borderRadius: 8, marginTop: 6 }} />
          </label>
          {Object.entries(grouped).map(([group, items]) => (
            <fieldset key={group} style={{ border: "1px solid #dfe7e2", borderRadius: 8 }}>
              <legend style={{ fontSize: 12, fontWeight: 700 }}>{group}</legend>
              {items.map((p) => (
                <label key={p.key} style={{ display: "inline-flex", gap: 6, marginRight: 16, fontSize: 13 }}>
                  <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                  {p.label}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="customer-actions">
            <button type="button" className="button-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save role"}</button>
            <button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
