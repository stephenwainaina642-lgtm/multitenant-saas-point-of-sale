import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  stockQuantity: number | string;
  minimumStock: number | string;
  unitOfMeasure: string;
};

type Movement = {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  unitOfMeasure: string;
  type: string;
  quantity: number | string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
};

const numberValue = (value: number | string) => Number(value) || 0;
const quantityText = (value: number | string) =>
  numberValue(value).toLocaleString("en-KE", { maximumFractionDigits: 3 });

export default function InventoryWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<"IN" | "OUT" | "ADJUSTMENT">("IN");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadData = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setError("");
    try {
      const [productResponse, movementResponse] = await Promise.all([
        apiRequest<Product[]>("/products", { token, businessId }),
        apiRequest<Movement[]>("/inventory", { token, businessId }),
      ]);

      const nextProducts = productResponse.data ?? [];
      setProducts(nextProducts);
      setMovements(movementResponse.data ?? []);

      setProductId((current) =>
        nextProducts.some((product) => product.id === current)
          ? current
          : nextProducts[0]?.id ?? ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedProduct = products.find((product) => product.id === productId);

  const lowStockProducts = useMemo(
    () => products.filter((product) => {
      const stock = numberValue(product.stockQuantity);
      const minimum = numberValue(product.minimumStock);
      return stock <= 0 || (minimum > 0 && stock <= minimum);
    }),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.sku ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [products, search]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const parsedQuantity = Number(quantity);
    if (!productId) {
      setError("Create or select a product before recording a stock movement.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      setError("Enter a valid quantity of zero or more.");
      return;
    }
    if (type !== "ADJUSTMENT" && parsedQuantity <= 0) {
      setError("Stock received and stock out quantities must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      await apiRequest("/inventory", {
        method: "POST",
        token,
        businessId,
        body: {
          productId,
          type,
          quantity: parsedQuantity,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      });

      setMessage(
        type === "IN"
          ? "Stock received successfully."
          : type === "OUT"
            ? "Stock out recorded successfully."
            : "Physical stock count saved successfully."
      );
      setQuantity("");
      setReference("");
      setNotes("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save stock movement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inventory-workspace">
      <style>{`
        .inventory-workspace { display: grid; gap: 22px; padding-bottom: 24px; }
        .inventory-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .inventory-stat, .inventory-panel { background: var(--panel, #fff); border: 1px solid var(--border, #e6e9ef); border-radius: 14px; padding: 20px; min-width: 0; }
        .inventory-stat span { display:block; color: var(--muted, #697386); font-size: 13px; margin-bottom: 10px; }
        .inventory-stat strong { font-size: 26px; }
        .inventory-panel h2 { margin: 0 0 5px; font-size: 17px; }
        .inventory-muted { color: var(--muted, #697386); font-size: 13px; margin: 0 0 18px; }
        .inventory-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .inventory-field { display: grid; gap: 7px; font-size: 13px; font-weight: 600; }
        .inventory-field input, .inventory-field select, .inventory-field textarea, .inventory-search { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border, #dfe3eb); background: var(--input-bg, #fff); color: inherit; border-radius: 8px; padding: 11px 12px; font: inherit; font-weight: 400; }
        .inventory-field textarea { resize: vertical; min-height: 76px; }
        .inventory-wide { grid-column: 1 / -1; }
        .inventory-submit { border: 0; border-radius: 8px; background: var(--primary, #176b53); color: white; padding: 12px 16px; font-weight: 600; cursor: pointer; }
        .inventory-submit:disabled { opacity: .6; cursor: wait; }
        .inventory-alert { border-radius: 8px; padding: 11px 13px; font-size: 13px; }
        .inventory-error { background: #fff0f0; color: #a12626; }
        .inventory-success { background: #eaf8f0; color: #176b43; }
        .inventory-table-wrap { overflow-x: auto; }
        .inventory-table { border-collapse: collapse; width: 100%; font-size: 13px; }
        .inventory-table th, .inventory-table td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border, #e9ecf2); white-space: nowrap; }
        .inventory-table th { color: var(--muted, #697386); font-size: 11px; letter-spacing: .04em; }
        .inventory-pill { display: inline-block; border-radius: 20px; padding: 4px 8px; font-size: 11px; font-weight: 700; background: #eaf8f0; color: #176b43; }
        .inventory-pill.low { background: #fff0e5; color: #a54d08; }
        .inventory-search { max-width: 300px; margin: 14px 0; }
        .inventory-empty { color: var(--muted, #697386); padding: 20px 0; font-size: 13px; }
        @media (max-width: 700px) { .inventory-summary { grid-template-columns: 1fr; } .inventory-form { grid-template-columns: 1fr; } .inventory-wide { grid-column: auto; } .inventory-stat strong { font-size: 22px; } }
      `}</style>

      {error && <div className="inventory-alert inventory-error">{error}</div>}
      {message && <div className="inventory-alert inventory-success">{message}</div>}

      <section className="inventory-summary">
        <div className="inventory-stat">
          <span>Active products</span>
          <strong>{loading ? "—" : products.length}</strong>
        </div>
        <div className="inventory-stat">
          <span>Low stock / out of stock</span>
          <strong>{loading ? "—" : lowStockProducts.length}</strong>
        </div>
        <div className="inventory-stat">
          <span>Recorded movements</span>
          <strong>{loading ? "—" : movements.length}</strong>
        </div>
      </section>

      <section className="inventory-panel">
        <h2>Record a stock movement</h2>
        <p className="inventory-muted">
          Receive stock, record stock leaving, or reconcile stock against a physical count.
        </p>

        <form className="inventory-form" onSubmit={handleSubmit}>
          <label className="inventory-field">
            Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
              {products.length === 0 && <option value="">No active products available</option>}
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} — current: {quantityText(product.stockQuantity)} {product.unitOfMeasure}
                </option>
              ))}
            </select>
          </label>

          <label className="inventory-field">
            Movement type
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as "IN" | "OUT" | "ADJUSTMENT");
                setQuantity("");
              }}
            >
              <option value="IN">Stock received (IN)</option>
              <option value="OUT">Stock out (OUT)</option>
              <option value="ADJUSTMENT">Physical stock count</option>
            </select>
          </label>

          <label className="inventory-field">
            {type === "ADJUSTMENT" ? "Actual counted quantity" : "Quantity"}
            <input
              type="number"
              min={type === "ADJUSTMENT" ? "0" : "0.001"}
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder={type === "ADJUSTMENT" ? "Enter total physically counted" : "Enter quantity"}
              required
            />
            {type === "ADJUSTMENT" && selectedProduct && (
              <>
                <span className="inventory-muted">
                  Current system quantity: {quantityText(selectedProduct.stockQuantity)} {selectedProduct.unitOfMeasure}
                </span>
                <span className="inventory-muted">
                  Enter the total quantity physically counted. The system will automatically calculate the difference and update stock.
                </span>
              </>
            )}
          </label>

          <label className="inventory-field">
            Reference (optional)
            <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} placeholder="e.g. GRN-001 or COUNT-001" />
          </label>

          <label className="inventory-field inventory-wide">
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason for movement, supplier delivery, damaged items..." />
          </label>

          <div className="inventory-wide">
            <button className="inventory-submit" type="submit" disabled={saving || loading || products.length === 0}>
              {saving ? "Saving..." : type === "IN" ? "+ Record stock received" : type === "OUT" ? "- Record stock out" : "Save physical count"}
            </button>
          </div>
        </form>
      </section>

      <section className="inventory-panel">
        <h2>Current stock</h2>
        <p className="inventory-muted">Live quantities from your selected business.</p>
        <input className="inventory-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product or SKU..." />
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr><th>PRODUCT</th><th>SKU</th><th>IN STOCK</th><th>MINIMUM</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const stock = numberValue(product.stockQuantity);
                const minimum = numberValue(product.minimumStock);
                const low = stock <= 0 || (minimum > 0 && stock <= minimum);
                return (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong></td>
                    <td>{product.sku || "—"}</td>
                    <td>{quantityText(product.stockQuantity)} {product.unitOfMeasure}</td>
                    <td>{quantityText(product.minimumStock)} {product.unitOfMeasure}</td>
                    <td><span className={`inventory-pill${low ? " low" : ""}`}>{stock <= 0 ? "Out of stock" : low ? "Low stock" : "In stock"}</span></td>
                  </tr>
                );
              })}
              {!loading && filteredProducts.length === 0 && (
                <tr><td colSpan={5} className="inventory-empty">No matching active products found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="inventory-panel">
        <h2>Movement history</h2>
        <p className="inventory-muted">The most recent inventory movements appear first.</p>
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr><th>DATE</th><th>PRODUCT</th><th>TYPE</th><th>CHANGE</th><th>REFERENCE</th><th>NOTES</th></tr>
            </thead>
            <tbody>
              {movements.map((movement) => {
                const amount = numberValue(movement.quantity);
  const displayedAmount =
    movement.type === "OUT" ? -Math.abs(amount) : amount;
                return (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleString("en-KE")}</td>
                    <td>{movement.productName}</td>
                    <td>{movement.type}</td>
                    <td>
  {displayedAmount > 0 ? "+" : ""}
  {quantityText(displayedAmount)} {movement.unitOfMeasure}
</td>
                    <td>{movement.reference || "—"}</td>
                    <td>{movement.notes || "—"}</td>
                  </tr>
                );
              })}
              {!loading && movements.length === 0 && (
                <tr><td colSpan={6} className="inventory-empty">No stock movements have been recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
