import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  costPrice: number | string;
  sellingPrice: number | string;
  stockQuantity: number | string;
  minimumStock: number | string;
  unitOfMeasure: string;
  isActive: boolean;
};

const money = (value: number | string) =>
  `KSh ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)}`;

export default function ProductsWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [description, setDescription] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [minimumStock, setMinimumStock] = useState("0");
  const [unitOfMeasure, setUnitOfMeasure] = useState("piece");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCostPrice, setEditCostPrice] = useState("");
  const [editSellingPrice, setEditSellingPrice] = useState("");
  const [editMinimumStock, setEditMinimumStock] = useState("0");
  const [editUnitOfMeasure, setEditUnitOfMeasure] = useState("piece");

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadProducts = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<Product[]>("/products", {
        token,
        businessId,
      });
      setProducts(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const cost = Number(costPrice);
    const selling = Number(sellingPrice);
    const stock = Number(stockQuantity);

    if (!name.trim()) {
      setError("Enter a product name.");
      return;
    }

    if (
      costPrice.trim() === "" ||
      sellingPrice.trim() === "" ||
      !Number.isFinite(cost) ||
      !Number.isFinite(selling) ||
      cost < 0 ||
      selling < 0
    ) {
      setError("Enter valid, non-negative cost and selling prices.");
      return;
    }

    if (
      stockQuantity.trim() === "" ||
      !Number.isFinite(stock) ||
      stock < 0
    ) {
      setError("Enter a valid, non-negative stock quantity.");
      return;
    }

    const minimum = Number(minimumStock);
    if (minimumStock.trim() === "" || !Number.isFinite(minimum) || minimum < 0) {
      setError("Enter a valid, non-negative minimum stock.");
      return;
    }

    if (!unitOfMeasure.trim() || unitOfMeasure.trim().length > 50) {
      setError("Enter a unit of measure of up to 50 characters.");
      return;
    }

    setSaving(true);

    try {
      const response = await apiRequest<Product>("/products", {
        method: "POST",
        token,
        businessId,
        body: {
          name: name.trim(),
          costPrice: cost,
          sellingPrice: selling,
          stockQuantity: stock,
          minimumStock: minimum,
          unitOfMeasure: unitOfMeasure.trim(),
          sku: sku.trim(),
          barcode: barcode.trim(),
          description: description.trim(),
        },
      });

      setProducts((current) => [
        response.data!,
        ...current.filter((item) => item.id !== response.data!.id),
      ]);
      setName("");
      setSku("");
      setBarcode("");
      setDescription("");
      setCostPrice("");
      setSellingPrice("");
      setStockQuantity("0");
      setMinimumStock("0");
      setUnitOfMeasure("piece");
      setMessage("Product saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(product: Product) {
    const confirmed = window.confirm(
      `Deactivate "${product.name}"? It will no longer appear in the active product list. Historical records will be preserved.`
    );

    if (!confirmed) return;

    setError("");
    setMessage("");
    setSaving(true);

    try {
      await apiRequest<Product>(`/products/${product.id}`, {
        method: "DELETE",
        token,
        businessId,
      });

      setProducts((current) =>
        current.filter((item) => item.id !== product.id)
      );

      if (editingProduct?.id === product.id) {
        setEditingProduct(null);
      }

      setMessage(`"${product.name}" was deactivated successfully.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not deactivate product."
      );
    } finally {
      setSaving(false);
    }
  }
  function startEditing(product: Product) {
    setEditingProduct(product);
    setEditName(product.name);
    setEditSku(product.sku ?? "");
    setEditBarcode(product.barcode ?? "");
    setEditDescription(product.description ?? "");
    setEditCostPrice(String(product.costPrice));
    setEditSellingPrice(String(product.sellingPrice));
    setEditMinimumStock(String(product.minimumStock ?? 0));
    setEditUnitOfMeasure(product.unitOfMeasure || "piece");
    setError("");
    setMessage("");
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;

    setError("");
    setMessage("");

    const cost = Number(editCostPrice);
    const selling = Number(editSellingPrice);
    const minimum = Number(editMinimumStock);

    if (!editName.trim()) {
      setError("Enter a product name.");
      return;
    }

    if (
      editCostPrice.trim() === "" ||
      editSellingPrice.trim() === "" ||
      !Number.isFinite(cost) ||
      !Number.isFinite(selling) ||
      cost < 0 ||
      selling < 0
    ) {
      setError("Enter valid, non-negative cost and selling prices.");
      return;
    }

    if (
      editMinimumStock.trim() === "" ||
      !Number.isFinite(minimum) ||
      minimum < 0
    ) {
      setError("Enter a valid, non-negative minimum stock.");
      return;
    }

    if (!editUnitOfMeasure.trim() || editUnitOfMeasure.trim().length > 50) {
      setError("Enter a unit of measure of up to 50 characters.");
      return;
    }

    setSaving(true);

    try {
      const response = await apiRequest<Product>(
        `/products/${editingProduct.id}`,
        {
          method: "PUT",
          token,
          businessId,
          body: {
            name: editName.trim(),
            sku: editSku.trim(),
            barcode: editBarcode.trim(),
            description: editDescription.trim(),
            costPrice: cost,
            sellingPrice: selling,
            minimumStock: minimum,
            unitOfMeasure: editUnitOfMeasure.trim(),
          },
        }
      );

      if (response.data) {
        setProducts((current) =>
          current.map((item) =>
            item.id === editingProduct.id ? response.data! : item
          )
        );
      }

      setEditingProduct(null);
      setMessage("Product updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update product.");
    } finally {
      setSaving(false);
    }
  }
  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.sku ?? ""} ${product.barcode ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #dfe7e2",
    borderRadius: 8,
    font: "inherit",
    background: "#fff",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "#344b40",
  };

  return (
    <section className="products-workspace" style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Product inventory</h2>
            <p>Products saved to your business database</p>
          </div>
          <button className="button-secondary" onClick={() => void loadProducts()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <p style={{ color: "#64746b", fontSize: 13 }}>
          {products.length} active {products.length === 1 ? "product" : "products"}
        </p>

        <label style={labelStyle} htmlFor="product-search">Search products</label>
        <input
          id="product-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, SKU, or barcode"
        />

        {error && (
          <p role="alert" style={{ color: "#a1352a", background: "#fff5f3", padding: 12, borderRadius: 8 }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" style={{ color: "#176b50", background: "#edf8f1", padding: 12, borderRadius: 8 }}>
            {message}
          </p>
        )}

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>SKU</th>
                <th>COST PRICE</th>
                <th>SELLING PRICE</th>
                <th>STOCK</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    {product.description && (
                      <div style={{ color: "#77847d", fontSize: 12 }}>{product.description}</div>
                    )}
                  </td>
                  <td>{product.sku || "-"}</td>
                  <td>{money(product.costPrice)}</td>
                  <td>{money(product.sellingPrice)}</td>
                  <td>
                    <div>
                      {Number(product.stockQuantity).toLocaleString("en-KE")}{" "}
                      {product.unitOfMeasure || "piece"}
                    </div>
                    {Number(product.stockQuantity) <= Number(product.minimumStock) && (
                      <div style={{ color: "#a1352a", fontSize: 12, fontWeight: 600 }}>
                        Low stock (minimum: {Number(product.minimumStock).toLocaleString("en-KE")})
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => startEditing(product)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ marginLeft: 8 }}
                      onClick={() => void handleDeactivate(product)}
                      disabled={saving}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {products.length === 0
                      ? "No products found for this business yet."
                      : "No products match your search."}
                  </td>
                </tr>
              )}
              {loading && (
                <tr><td colSpan={6}>Loading products from PostgreSQL...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      {editingProduct && (
        <article className="panel" style={{ padding: 24 }}>
          <div className="panel-heading">
            <div>
              <h2>Edit product</h2>
              <p>Update product details for {editingProduct.name}</p>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setEditingProduct(null)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleUpdate} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <label style={labelStyle}>
                Product name *
                <input style={{ ...fieldStyle, marginTop: 6 }} value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={150} />
              </label>
              <label style={labelStyle}>
                SKU
                <input style={{ ...fieldStyle, marginTop: 6 }} value={editSku} onChange={(event) => setEditSku(event.target.value)} />
              </label>
              <label style={labelStyle}>
                Barcode
                <input style={{ ...fieldStyle, marginTop: 6 }} value={editBarcode} onChange={(event) => setEditBarcode(event.target.value)} />
              </label>
              <label style={labelStyle}>
                Cost price (KSh) *
                <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="0.01" value={editCostPrice} onChange={(event) => setEditCostPrice(event.target.value)} required />
              </label>
              <label style={labelStyle}>
                Selling price (KSh) *
                <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="0.01" value={editSellingPrice} onChange={(event) => setEditSellingPrice(event.target.value)} required />
              </label>
              <label style={labelStyle}>
                Unit of measure *
                <input style={{ ...fieldStyle, marginTop: 6 }} value={editUnitOfMeasure} onChange={(event) => setEditUnitOfMeasure(event.target.value)} placeholder="piece, kg, metre, litre..." maxLength={50} required />
              </label>
              <label style={labelStyle}>
                Minimum stock *
                <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="any" value={editMinimumStock} onChange={(event) => setEditMinimumStock(event.target.value)} required />
              </label>
            </div>

            <label style={labelStyle}>
              Description
              <textarea style={{ ...fieldStyle, marginTop: 6, minHeight: 75 }} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>

            <p style={{ color: "#64746b", fontSize: 13 }}>
              Stock quantity is not changed by this form.
            </p>

            <div>
              <button className="button-primary" type="submit" disabled={saving}>
                {saving ? "Updating product..." : "Save changes"}
              </button>
            </div>
          </form>
        </article>
      )}
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Add a product</h2>
            <p>Save a new item to the selected business</p>
          </div>
        </div>

        <form onSubmit={handleCreate} style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
            <label style={labelStyle}>
              Product name *
              <input style={{ ...fieldStyle, marginTop: 6 }} value={name} onChange={(event) => setName(event.target.value)} required maxLength={150} />
            </label>
            <label style={labelStyle}>
              SKU
              <input style={{ ...fieldStyle, marginTop: 6 }} value={sku} onChange={(event) => setSku(event.target.value)} />
            </label>
            <label style={labelStyle}>
              Barcode
              <input style={{ ...fieldStyle, marginTop: 6 }} value={barcode} onChange={(event) => setBarcode(event.target.value)} />
            </label>
            <label style={labelStyle}>
              Cost price (KSh) *
              <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="0.01" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} required />
            </label>
            <label style={labelStyle}>
              Selling price (KSh) *
              <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="0.01" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required />
            </label>
            <label style={labelStyle}>
              Opening stock *
              <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="any" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} required />
            </label>
            <label style={labelStyle}>
              Unit of measure *
              <input style={{ ...fieldStyle, marginTop: 6 }} value={unitOfMeasure} onChange={(event) => setUnitOfMeasure(event.target.value)} placeholder="piece, kg, metre, litre..." maxLength={50} required />
            </label>
            <label style={labelStyle}>
              Minimum stock *
              <input style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="any" value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} required />
            </label>
          </div>

          <label style={labelStyle}>
            Description
            <textarea style={{ ...fieldStyle, marginTop: 6, minHeight: 75 }} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>

          <div>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? "Saving product..." : "Save product"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
