import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiRequest } from "./api/client";
import { notify } from "./toast";
import { money } from "./money";
import { can } from "./permissions";

type Product = { id: string; name: string; isActive: boolean; tracksStock: boolean; costPrice: number | string; sellingPrice: number | string; unitOfMeasure: string };
type Row = { productId: string; name: string; sellingPrice: string; costPerPortion: string; margin: string; marginPercent: number | null; ingredientCount: number };
type Recipe = { productId: string; items: { ingredientId: string; quantity: string }[] };
type Line = { ingredientId: string; quantity: string };

const tok = () => sessionStorage.getItem("pos_token") ?? "";
const biz = () => sessionStorage.getItem("pos_business_id") ?? "";
async function call<T>(path: string, method: "GET" | "PUT" = "GET", body?: unknown) {
  const r = await apiRequest<T>(path, { method, token: tok(), businessId: biz(), ...(body !== undefined && { body }) });
  return r.data as T;
}
const fail = (e: unknown) => notify.error(e instanceof Error ? e.message : "Something went wrong.");
const cents = (n: number) => Math.round(n * 100);

/** Ingredients per dish, cost per portion and margin. Selling a dish takes its ingredients out of stock. */
export default function RecipesPanel() {
  const canEdit = can("products.manage");
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [dishId, setDishId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([call<Product[]>("/products"), call<Row[]>("/hotel/recipes")]);
      setProducts(p.filter((x) => x.isActive));
      setRows(r);
    } catch (e) { fail(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const ingredients = products.filter((p) => p.tracksStock && p.id !== dishId);
  const dish = byId.get(dishId);

  async function pick(id: string) {
    setDishId(id);
    if (!id) { setLines([]); return; }
    try {
      const r = await call<Recipe>(`/hotel/recipes/${id}`);
      setLines(r.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })));
    } catch (e) { fail(e); }
  }

  const lineCost = (l: Line) => (byId.get(l.ingredientId) ? Math.round(cents(Number(byId.get(l.ingredientId)!.costPrice)) * Number(l.quantity || 0)) : 0);
  const cost = lines.reduce((s, l) => s + lineCost(l), 0); // cents, estimate only: the server works it out exactly
  const price = dish ? cents(Number(dish.sellingPrice)) : 0;

  async function save() {
    if (!dishId || busy) return;
    const items = lines.filter((l) => l.ingredientId && Number(l.quantity) > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) }));
    setBusy(true);
    try {
      await call(`/hotel/recipes/${dishId}`, "PUT", { items });
      notify.success(items.length ? "Recipe saved." : "Recipe removed.");
      await load();
      await pick(dishId);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <section className="inventory-panel">
      <h2>Recipes and costing</h2>
      <p className="inventory-muted">List what one portion of a dish uses. Cost per portion follows each ingredient's buying price. When a dish is sold, its ingredients are taken out of stock; if an ingredient has run short the sale still goes through, stock stops at zero and the shortfall is flagged in Inventory for review.</p>

      {rows.length === 0 ? <p className="inventory-muted">No recipes yet.</p> : (
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead><tr><th>Dish</th><th>Price</th><th>Cost / portion</th><th>Margin</th><th>Ingredients</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>{r.name}</td><td>{money(r.sellingPrice)}</td><td>{money(r.costPerPortion)}</td>
                  <td>{money(r.margin)}{r.marginPercent !== null ? ` (${r.marginPercent}%)` : ""}</td><td>{r.ingredientCount}</td>
                  {canEdit && <td><button type="button" className="pos-secondary-button" onClick={() => void pick(r.productId)}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="hotel-bill">
          <h3>{dishId ? "Edit recipe" : "Add or edit a recipe"}</h3>
          <label className="inventory-field">Dish
            <select value={dishId} onChange={(e) => void pick(e.target.value)}>
              <option value="">Choose a dish…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {dishId && (
            <>
              {lines.map((l, i) => {
                const ing = byId.get(l.ingredientId);
                return (
                  <div className="hotel-row" key={i}>
                    <select value={l.ingredientId} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, ingredientId: e.target.value } : y)))}>
                      <option value="">Ingredient…</option>
                      {ingredients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unitOfMeasure})</option>)}
                    </select>
                    <input inputMode="decimal" placeholder={`Quantity${ing ? ` (${ing.unitOfMeasure})` : ""}`} value={l.quantity} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))} />
                    <span className="inventory-muted">{ing ? money(lineCost(l) / 100) : ""}</span>
                    <button type="button" className="pos-secondary-button" aria-label="Remove ingredient" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                  </div>
                );
              })}
              <div><button type="button" className="pos-secondary-button" onClick={() => setLines((x) => [...x, { ingredientId: "", quantity: "" }])}>Add ingredient</button></div>
              <div className="hotel-total"><span>Estimated cost per portion</span><strong>{money(cost / 100)}</strong></div>
              <div className="hotel-total"><span>Selling price</span><strong>{money(price / 100)}</strong></div>
              <div className="hotel-total"><span>Margin</span><strong>{money((price - cost) / 100)}{price > 0 ? ` (${(((price - cost) * 100) / price).toFixed(1)}%)` : ""}</strong></div>
              <div className="hotel-row">
                <button type="button" className="pos-primary-button" disabled={busy} onClick={() => void save()}>Save recipe</button>
                <button type="button" className="pos-secondary-button" onClick={() => void pick("")}>Close</button>
              </div>
              <p className="inventory-muted">Saving with no ingredients removes the recipe. The cost shown here is an estimate; the exact cost is worked out when the dish is sold.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
