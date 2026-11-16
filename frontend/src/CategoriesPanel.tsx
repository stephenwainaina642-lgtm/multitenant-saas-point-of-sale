import { useState } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";

export type Category = { id: string; name: string; description: string | null; productCount: number };

export type Starter = { businessType: string; label: string; units: string[]; categories: { name: string; exists: boolean }[] };

type Props = { categories: Category[]; starter: Starter | null; onChanged: () => void };

export default function CategoriesPanel({ categories, starter, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";
  const manage = can("products.manage");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError("Enter a category name."); return; }
    void run(async () => {
      await apiRequest("/categories", { method: "POST", token, businessId, body: { name: name.trim() } });
      setName("");
    });
  };

  const rename = (id: string) => {
    if (!editName.trim()) { setError("Enter a category name."); return; }
    void run(async () => {
      await apiRequest(`/categories/${id}`, { method: "PUT", token, businessId, body: { name: editName.trim() } });
      setEditingId(null);
    });
  };

  const remove = (category: Category) => {
    if (!window.confirm(`Delete the category "${category.name}"?`)) return;
    void run(() => apiRequest(`/categories/${category.id}`, { method: "DELETE", token, businessId }));
  };

  const missing = starter?.categories.filter((c) => !c.exists) ?? [];
  const addStarter = () => {
    void run(() => apiRequest("/categories/starter", { method: "POST", token, businessId, body: {} }));
  };

  return (
    <section className="panel" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Categories</h2>
          <p style={{ margin: "4px 0 0", color: "#64746b", fontSize: 13 }}>
            {categories.length} {categories.length === 1 ? "category" : "categories"} used to group products
          </p>
        </div>
        <button className="button-secondary" type="button" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Manage categories"}
        </button>
      </div>

      {open && (
        <>
          {error && <p role="alert" style={{ color: "#a1352a", background: "#fff5f3", padding: 12, borderRadius: 8, margin: 0 }}>{error}</p>}
          {manage && (
            <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
              <input
                aria-label="New category name"
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit" }}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="New category, e.g. Phones"
                maxLength={150}
              />
              <button className="button-primary" type="submit" disabled={busy}>Add category</button>
            </form>
          )}
          {manage && starter && missing.length > 0 && (
            <div style={{ background: "#f3f9f5", border: "1px solid #d5e9dc", borderRadius: 8, padding: 12 }}>
              <strong>Suggested for {starter.label}</strong>
              <p style={{ margin: "4px 0 8px", color: "#4b6156", fontSize: 13 }}>
                {missing.map((c) => c.name).join(", ")}. Only these missing categories are added; your existing categories and products are not changed.
              </p>
              <button className="button-secondary" type="button" disabled={busy} onClick={addStarter}>
                Add {missing.length} starter {missing.length === 1 ? "category" : "categories"}
              </button>
            </div>
          )}
          {categories.length === 0 ? (
            <p style={{ color: "#64746b", margin: 0 }}>No categories yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {categories.map((category) => (
                <li key={category.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid #eef3f0" }}>
                  {editingId === category.id ? (
                    <>
                      <input
                        aria-label={`Rename ${category.name}`}
                        style={{ flex: 1, padding: "8px 10px", border: "1px solid #dfe7e2", borderRadius: 8, font: "inherit" }}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        maxLength={150}
                      />
                      <button className="button-primary" type="button" disabled={busy} onClick={() => rename(category.id)}>Save</button>
                      <button className="button-secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <strong style={{ flex: 1 }}>{category.name}</strong>
                      <span style={{ color: "#77847d", fontSize: 13 }}>
                        {category.productCount} {category.productCount === 1 ? "product" : "products"}
                      </span>
                      {manage && (
                        <>
                          <button className="button-secondary" type="button" onClick={() => { setEditingId(category.id); setEditName(category.name); setError(""); }}>Rename</button>
                          <button className="button-secondary" type="button" disabled={busy} onClick={() => remove(category)}>Delete</button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
