import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";
import RolePermissionsPanel, { type Role } from "./RolePermissionsPanel";

type Employee = {
  id: string; userId: string; name: string; email: string; phone: string | null;
  role: { id: string; name: string }; isOwner: boolean; isActive: boolean; createdAt: string;
};

type SalespersonPerformance = {
  id: string; name: string; email: string; salesCount: number; revenue: number; collected: number; outstanding: number;
};

const BUILT_IN = ["Manager", "Inventory Manager", "Salesperson", "Cashier", "Accountant"];
const emptyForm = { name: "", email: "", phone: "", role: "Cashier", password: "" };
const fieldStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2",
  borderRadius: 8, font: "inherit", background: "#fff", color: "#24372e", marginTop: 6,
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#344b40" };
const money = (n: number) => `KSh ${n.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

export default function EmployeesWorkspace({ salespersonPerformance = [] }: { salespersonPerformance?: SalespersonPerformance[] }) {
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiRequest<Employee[]>("/employees", { token, businessId });
      setEmployees(res.data ?? []);
      try {
        const r = await apiRequest<Role[]>("/roles", { token, businessId });
        setRoles(r.data ?? []);
      } catch { setRoles([]); } // roles.manage is a separate permission
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load employees.");
    } finally { setLoading(false); }
  }, [token, businessId]);

  useEffect(() => { void load(); }, [load]);

  const roleOptions = useMemo(() => {
    const names = new Set(roles.map((r) => r.name));
    const extra = BUILT_IN.filter((b) => !roles.some((r) => r.name.toLowerCase() === b.toLowerCase()));
    return [...names, ...extra].filter((n) => n.toLowerCase() !== "owner");
  }, [roles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? employees.filter((e) => [e.name, e.email, e.phone ?? "", e.role.name].join(" ").toLowerCase().includes(q)) : employees;
  }, [employees, search]);

  const perf = (e: Employee) =>
    salespersonPerformance.find((p) => p.email.trim().toLowerCase() === e.email.toLowerCase()) ?? null;

  async function run(label: string, fn: () => Promise<void>) {
    setError(""); setNotice(""); setSecret(null);
    try { await fn(); setNotice(label); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice(""); setSecret(null);
    try {
      const body: Record<string, string> = { name: form.name, email: form.email, phone: form.phone, roleName: form.role };
      const existing = roles.find((r) => r.name === form.role);
      if (existing) { delete body.roleName; body.roleId = existing.id; }
      if (form.password) body.password = form.password;
      const res = await apiRequest<Employee>("/employees", { method: "POST", token, businessId, body });
      const pw = (res as unknown as { temporaryPassword: string | null }).temporaryPassword;
      if (pw) setSecret({ who: form.email, password: pw });
      setNotice(`${form.name || form.email} was added.`);
      setForm(emptyForm); setShowForm(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add the employee."); }
    finally { setSaving(false); }
  }

  async function changeRole(e: Employee, roleName: string) {
    const existing = roles.find((r) => r.name === roleName);
    const body = existing ? { roleId: existing.id } : { roleName };
    await run(`${e.name} is now ${roleName}.`, async () => { await apiRequest(`/employees/${e.id}`, { method: "PUT", token, businessId, body }); });
  }

  async function resetPassword(e: Employee) {
    if (!window.confirm(`Issue a new temporary password for ${e.name}? Their current password stops working.`)) return;
    setError(""); setNotice(""); setSecret(null);
    try {
      const res = await apiRequest<unknown>(`/employees/${e.id}/reset-password`, { method: "POST", token, businessId, body: {} });
      setSecret({ who: e.email, password: (res as unknown as { temporaryPassword: string }).temporaryPassword });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not reset the password."); }
  }

  const active = employees.filter((e) => e.isActive).length;

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Employees</h2>
            <p>People who can sign in to this business, and what their role allows</p>
          </div>
          <button type="button" className="button-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close form" : "Add employee"}
          </button>
        </div>

        <div className="customer-summary">
          <div><span className="customer-summary-label">Total</span><strong>{employees.length}</strong></div>
          <div><span className="customer-summary-label">Active</span><strong>{active}</strong></div>
          <div><span className="customer-summary-label">Deactivated</span><strong>{employees.length - active}</strong></div>
        </div>

        {error && <p className="customer-notice" role="alert">{error}</p>}
        {notice && <p className="customer-notice" role="status">{notice}</p>}
        {secret && (
          <p className="customer-notice" role="status">
            Temporary password for <strong>{secret.who}</strong>: <code>{secret.password}</code> — shown once. Share it privately; there is no email invitation yet.
          </p>
        )}

        {showForm && (
          <form onSubmit={add} style={{ display: "grid", gap: 12, margin: "16px 0", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={labelStyle}>Full name<input style={fieldStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={labelStyle}>Email<input style={fieldStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
            <label style={labelStyle}>Phone<input style={fieldStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={labelStyle}>Role
              <select style={fieldStyle} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roleOptions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Password (optional)
              <input style={fieldStyle} type="text" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to generate one" />
            </label>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className="button-primary" disabled={saving}>{saving ? "Adding…" : "Add employee"}</button>
            </div>
          </form>
        )}

        <label htmlFor="employee-search" style={labelStyle}>Search employees</label>
        <input id="employee-search" style={fieldStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or role" />

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>SALES</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5}>No employees found.</td></tr>}
              {filtered.map((e) => {
                const p = perf(e);
                return (
                  <tr key={e.id}>
                    <td><strong>{e.name}</strong>{e.isOwner && " (owner)"}<div className="customer-secondary-text">{e.email}{e.phone ? ` · ${e.phone}` : ""}</div></td>
                    <td>
                      {e.isOwner ? "Owner" : (
                        <select value={e.role.name} onChange={(ev) => void changeRole(e, ev.target.value)} aria-label={`Role for ${e.name}`}>
                          {[...new Set([e.role.name, ...roleOptions])].map((r) => <option key={r}>{r}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{p ? `${p.salesCount} · ${money(p.revenue)}` : "—"}</td>
                    <td>{e.isActive ? "Active" : "Deactivated"}</td>
                    <td>
                      {!e.isOwner && (
                        <div className="customer-actions">
                          <button type="button" className="button-secondary"
                            onClick={() => void run(e.isActive ? `${e.name} was deactivated.` : `${e.name} was reactivated.`, async () => { await apiRequest(`/employees/${e.id}/${e.isActive ? "deactivate" : "activate"}`, { method: "POST", token, businessId, body: {} }); })}>
                            {e.isActive ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => void resetPassword(e)}>Reset password</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
      <RolePermissionsPanel onChanged={() => void load()} />
    </section>
  );
}
