import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import { useNotify } from "./useNotify";

type Branch = { id: string; name: string; address: string | null; phone: string | null; isMain: boolean; isActive: boolean; current: boolean };
type Product = { id: string; name: string; sku: string | null; stockQuantity: number | string; isActive: boolean };
type StockRow = { branchId: string; productId: string; quantity: number | string };
type Transfer = { id: string; fromBranchName: string; toBranchName: string; createdAt: string; reference: string | null; notes: string | null; items: { productName: string; quantity: string }[] };
type Employee = { userId: string; name: string; role: { name: string }; isActive: boolean; branchId: string | null };

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const num = (v: number | string) => Number(v).toLocaleString("en-KE", { maximumFractionDigits: 3 });
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit", background: "#fff" };
const label: React.CSSProperties = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "#344b40" };
const button: React.CSSProperties = { padding: "10px 16px", border: 0, borderRadius: 8, background: "#176b4d", color: "#fff", font: "inherit", fontWeight: 700, cursor: "pointer" };
const ghost: React.CSSProperties = { ...button, background: "#fff", color: "#24372e", border: "1px solid #dfe7e2" };
const panel: React.CSSProperties = { padding: 20, border: "1px solid #e3ebe5", borderRadius: 12, background: "#fff" };

/** Branches: add them, see stock per branch, move stock between them, and assign staff. */
export default function BranchesWorkspace() {
  const token = sessionStorage.getItem("pos_token") || "";
  const businessId = sessionStorage.getItem("pos_business_id") || "";
  const canManage = can("branches.manage");
  const canTransfer = can("stock.transfer");
  const canSeeAll = can("branches.all");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useNotify(error, notice);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "" });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([{ productId: "", quantity: "" }]);
  const [tNote, setTNote] = useState("");
  const keyRef = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    const opts = { token, businessId };
    try {
      const [b, p, s, t] = await Promise.all([
        apiRequest<Branch[]>("/branches", opts),
        apiRequest<Product[]>("/products", opts),
        apiRequest<StockRow[]>("/branches/stock", opts),
        apiRequest<Transfer[]>("/branches/transfers", opts).catch(() => ({ data: [] as Transfer[] })),
      ]);
      setBranches(b.data ?? []);
      setProducts((p.data ?? []).filter((x) => x.isActive));
      setStock(s.data ?? []);
      setTransfers(t.data ?? []);
      if (canManage) {
        const e = await apiRequest<Employee[]>("/employees", opts).catch(() => ({ data: [] as Employee[] }));
        setStaff((e.data ?? []).filter((x) => x.isActive));
      }
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }, [token, businessId, canManage]);

  useEffect(() => { void load(); }, [load]);

  const active = branches.filter((b) => b.isActive);
  useEffect(() => {
    if (!from && active.length) setFrom((active.find((b) => b.current) ?? active[0]!).id);
  }, [active, from]);

  async function run(done: string, fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(done); await load(); window.dispatchEvent(new Event("branches-changed")); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  const qty = (branchId: string, productId: string) =>
    stock.filter((r) => r.branchId === branchId && r.productId === productId).reduce((t, r) => t + Number(r.quantity), 0);

  function submitTransfer(event: React.FormEvent) {
    event.preventDefault();
    const items = lines.filter((l) => l.productId && Number(l.quantity) > 0).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (!from || !to || from === to) return setError("Choose two different branches.");
    if (items.length === 0) return setError("Add at least one product and quantity.");
    void run("Stock moved.", async () => {
      await apiRequest("/branches/transfers", { method: "POST", token, businessId, idempotencyKey: keyRef.current, body: { fromBranchId: from, toBranchId: to, items, notes: tNote } });
      keyRef.current = crypto.randomUUID();
      setLines([{ productId: "", quantity: "" }]); setTNote("");
    });
  }

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div>
        <p style={{ margin: 0, color: "#59665d" }}>Each branch has its own stock. Products, prices and customers are shared. Choose the branch you are working in from the sidebar.</p>
      </div>

      <article style={panel}>
        <h2 style={{ marginTop: 0 }}>Your branches</h2>
        <div className="table-scroll">
          <table style={{ width: "100%", minWidth: 0 }}>
            <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Status</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong>{b.isMain ? " (main)" : ""}{b.current ? " · you are here" : ""}</td>
                  <td>{b.address ?? ""}</td><td>{b.phone ?? ""}</td>
                  <td>{b.isActive ? "Active" : "Closed"}</td>
                  {canManage && (
                    <td>
                      {!b.isMain && (
                        <button type="button" style={ghost} disabled={busy}
                          onClick={() => run(b.isActive ? `${b.name} closed.` : `${b.name} reopened.`, async () => { await apiRequest(`/branches/${b.id}`, { method: "PUT", token, businessId, body: { isActive: !b.isActive } }); })}>
                          {b.isActive ? "Close branch" : "Reopen"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && (
          <form style={{ display: "grid", gap: 10, marginTop: 16, maxWidth: 520 }}
            onSubmit={(e) => { e.preventDefault(); void run(`${form.name} added.`, async () => { await apiRequest("/branches", { method: "POST", token, businessId, body: form }); setForm({ name: "", address: "", phone: "" }); }); }}>
            <h3 style={{ margin: 0 }}>Add a branch</h3>
            <label><span style={label}>Branch name</span><input style={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></label>
            <label><span style={label}>Address (optional)</span><input style={field} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <label><span style={label}>Phone (optional)</span><input style={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <button style={button} type="submit" disabled={busy}>Add branch</button>
          </form>
        )}
      </article>

      {canTransfer && active.length > 1 && (
        <article style={panel}>
          <h2 style={{ marginTop: 0 }}>Move stock between branches</h2>
          <form onSubmit={submitTransfer} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label><span style={label}>From</span>
                <select style={field} value={from} onChange={(e) => setFrom(e.target.value)} disabled={!canSeeAll}>
                  {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
              <label><span style={label}>To</span>
                <select style={field} value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose branch</option>
                  {active.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
            </div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10, alignItems: "end" }}>
                <label><span style={label}>Product</span>
                  <select style={field} value={l.productId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                    <option value="">Choose product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{from ? ` (${num(qty(from, p.id))} here)` : ""}</option>)}
                  </select></label>
                <label><span style={label}>Quantity</span>
                  <input style={field} type="number" min="0.001" step="any" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></label>
                {lines.length > 1 && <button type="button" style={ghost} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            <div><button type="button" style={ghost} onClick={() => setLines([...lines, { productId: "", quantity: "" }])}>+ Add another product</button></div>
            <label><span style={label}>Note (optional)</span><input style={field} value={tNote} onChange={(e) => setTNote(e.target.value)} maxLength={1000} /></label>
            <button style={button} type="submit" disabled={busy}>{busy ? "Moving..." : "Move stock"}</button>
          </form>
        </article>
      )}

      <article style={panel}>
        <h2 style={{ marginTop: 0 }}>Stock by branch</h2>
        <div className="table-scroll">
          <table style={{ width: "100%", minWidth: 0 }}>
            <thead><tr><th>Product</th>{active.filter((b) => canSeeAll || b.current).map((b) => <th key={b.id}>{b.name}</th>)}{canSeeAll && <th>Total</th>}</tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {active.filter((b) => canSeeAll || b.current).map((b) => <td key={b.id}>{num(qty(b.id, p.id))}</td>)}
                  {canSeeAll && <td><strong>{num(p.stockQuantity)}</strong></td>}
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={9} className="empty-row">No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      {canManage && (
        <article style={panel}>
          <h2 style={{ marginTop: 0 }}>Staff and branches</h2>
          <p style={{ marginTop: 0, color: "#59665d" }}>Staff tied to a branch can only work in that branch. Leave it on "Any branch" for people who move between them.</p>
          <div className="table-scroll">
            <table style={{ width: "100%", minWidth: 0 }}>
              <thead><tr><th>Name</th><th>Role</th><th>Branch</th></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.name}</td><td>{s.role.name}</td>
                    <td>
                      <select style={{ ...field, maxWidth: 240 }} value={s.branchId ?? ""} disabled={busy}
                        onChange={(e) => run(`${s.name} updated.`, async () => { await apiRequest(`/branches/staff/${s.userId}`, { method: "PUT", token, businessId, body: { branchId: e.target.value || null } }); })}>
                        <option value="">Any branch</option>
                        {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <article style={panel}>
        <h2 style={{ marginTop: 0 }}>Recent transfers</h2>
        <div className="table-scroll">
          <table style={{ width: "100%", minWidth: 0 }}>
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Items</th></tr></thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{t.fromBranchName}</td><td>{t.toBranchName}</td>
                  <td>{t.items.map((i) => `${i.productName} × ${num(i.quantity)}`).join(", ")}</td>
                </tr>
              ))}
              {transfers.length === 0 && <tr><td colSpan={4} className="empty-row">No transfers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
