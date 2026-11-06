import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Supplier = {
  id: string;
  name: string;
  isActive: boolean;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  costPrice: number | string;
  stockQuantity: number | string;
  unitOfMeasure: string;
  isActive: boolean;
};

type PurchaseItem = {
  id: string;
  productId: string;
  productName?: string;
  sku?: string | null;
  unitOfMeasure?: string;
  quantity: number | string;
  unitCost: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
};

type Purchase = {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  status: string;
  notes: string | null;
  items: PurchaseItem[];
};

type PurchaseLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  discount: string;
  tax: string;
};

const emptyLine: PurchaseLine = {
  productId: "",
  quantity: "1",
  unitCost: "0",
  discount: "0",
  tax: "0",
};

const emptyForm = {
  supplierId: "",
  invoiceNumber: "",
  discount: "0",
  tax: "0",
  amountPaid: "0",
  notes: "",
};

const money = (value: number | string) =>
  Number(value || 0).toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function PurchasesWorkspace() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState<PurchaseLine[]>([{ ...emptyLine }]);

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadData = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [purchaseResponse, supplierResponse, productResponse] =
        await Promise.all([
          apiRequest<Purchase[]>("/purchases", { token, businessId }),
          apiRequest<Supplier[]>("/suppliers", { token, businessId }),
          apiRequest<Product[]>("/products", { token, businessId }),
        ]);

      setPurchases(purchaseResponse.data ?? []);
      setSuppliers((supplierResponse.data ?? []).filter((item) => item.isActive));
      setProducts((productResponse.data ?? []).filter((item) => item.isActive));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load purchase information.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + numberValue(line.quantity) * numberValue(line.unitCost),
        0
      ),
    [lines]
  );

  const itemDiscounts = useMemo(
    () => lines.reduce((sum, line) => sum + numberValue(line.discount), 0),
    [lines]
  );

  const itemTaxes = useMemo(
    () => lines.reduce((sum, line) => sum + numberValue(line.tax), 0),
    [lines]
  );

  const purchaseTotal = Math.max(
    0,
    subtotal - itemDiscounts - numberValue(form.discount) +
      itemTaxes + numberValue(form.tax)
  );

  const balanceDue = Math.max(0, purchaseTotal - numberValue(form.amountPaid));

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return purchases;

    return purchases.filter((purchase) =>
      [
        purchase.supplierName,
        purchase.invoiceNumber,
        purchase.status,
        purchase.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [purchases, search]);

  const totalPurchases = purchases.reduce(
    (sum, purchase) => sum + Number(purchase.total || 0),
    0
  );

  const totalOutstanding = purchases.reduce(
    (sum, purchase) => sum + Number(purchase.balanceDue || 0),
    0
  );

  function updateForm(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLine(index: number, field: keyof PurchaseLine, value: string) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line
      )
    );
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((item) => item.id === productId);

    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              productId,
              unitCost: product ? String(product.costPrice ?? 0) : "0",
            }
          : line
      )
    );
  }

  function addLine() {
    setLines((current) => [...current, { ...emptyLine }]);
  }

  function removeLine(index: number) {
    setLines((current) =>
      current.length === 1
        ? current
        : current.filter((_, lineIndex) => lineIndex !== index)
    );
  }

  function resetForm() {
    setForm(emptyForm);
    setLines([{ ...emptyLine }]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!form.supplierId) {
      setError("Select a supplier before recording this purchase.");
      return;
    }

    if (lines.some((line) => !line.productId)) {
      setError("Select a product for every purchase line.");
      return;
    }

    if (
      lines.some(
        (line) =>
          numberValue(line.quantity) <= 0 ||
          numberValue(line.unitCost) < 0 ||
          numberValue(line.discount) < 0 ||
          numberValue(line.tax) < 0
      )
    ) {
      setError("Check the quantities, unit costs, discounts and taxes. Values must be valid and non-negative.");
      return;
    }

    if (
      numberValue(form.discount) < 0 ||
      numberValue(form.tax) < 0 ||
      numberValue(form.amountPaid) < 0
    ) {
      setError("Purchase discount, tax and amount paid cannot be negative.");
      return;
    }

    if (numberValue(form.amountPaid) > purchaseTotal) {
      setError("Amount paid cannot exceed the purchase total.");
      return;
    }

    const body = {
      supplierId: form.supplierId,
      invoiceNumber: form.invoiceNumber.trim(),
      discount: numberValue(form.discount),
      tax: numberValue(form.tax),
      amountPaid: numberValue(form.amountPaid),
      notes: form.notes.trim(),
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: numberValue(line.quantity),
        unitCost: numberValue(line.unitCost),
        discount: numberValue(line.discount),
        tax: numberValue(line.tax),
      })),
    };

    setSaving(true);

    try {
      await apiRequest<Purchase>("/purchases", {
        method: "POST",
        token,
        businessId,
        body,
      });

      setMessage("Purchase recorded successfully. Inventory stock has been updated.");
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record purchase.");
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    border: "1px solid #dfe7e2",
    borderRadius: 8,
    font: "inherit",
    background: "#fff",
    color: "#24372e",
    minWidth: 0,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "#344b40",
  };

  return (
    <section className="suppliers-workspace" style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Purchase overview</h2>
            <p>Track supplier purchases, stock receipts and outstanding balances</p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadData()}
            disabled={loading || saving}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="supplier-summary">
          <div>
            <span className="supplier-summary-label">Recorded purchases</span>
            <strong>{purchases.length.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Purchase value</span>
            <strong>{money(totalPurchases)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Outstanding balance</span>
            <strong>{money(totalOutstanding)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Active suppliers</span>
            <strong>{suppliers.length.toLocaleString("en-KE")}</strong>
          </div>
        </div>

        {error && (
          <p role="alert" className="supplier-notice supplier-error">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="supplier-notice supplier-success">
            {message}
          </p>
        )}

        <label style={labelStyle} htmlFor="purchase-search">
          Search purchase history
        </label>
        <input
          id="purchase-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search supplier, invoice number or purchase reference"
        />

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>REFERENCE</th>
                <th>SUPPLIER</th>
                <th>DATE</th>
                <th>INVOICE</th>
                <th>TOTAL</th>
                <th>PAID</th>
                <th>BALANCE</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filteredPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td><strong>PO-{purchase.id}</strong></td>
                    <td>{purchase.supplierName}</td>
                    <td>
                      {purchase.purchaseDate
                        ? new Date(purchase.purchaseDate).toLocaleDateString("en-KE")
                        : "—"}
                    </td>
                    <td>{purchase.invoiceNumber || "—"}</td>
                    <td><strong>{money(purchase.total)}</strong></td>
                    <td>{money(purchase.amountPaid)}</td>
                    <td>{money(purchase.balanceDue)}</td>
                    <td>{purchase.status}</td>
                  </tr>
                ))}

              {!loading && filteredPurchases.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    {purchases.length === 0
                      ? "No purchases have been recorded for this business yet."
                      : "No purchases match your search."}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={8}>Loading purchases from PostgreSQL...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel supplier-form-panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Record a purchase</h2>
            <p>Register goods received from a supplier and update inventory</p>
          </div>
        </div>

        {suppliers.length === 0 && (
          <p className="supplier-notice supplier-error">
            Register an active supplier before recording a purchase.
          </p>
        )}

        {products.length === 0 && (
          <p className="supplier-notice supplier-error">
            Add active products to your catalogue before recording a purchase.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 18 }}>
          <div className="supplier-form-grid">
            <label style={labelStyle}>
              Supplier *
              <select
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.supplierId}
                onChange={(event) => updateForm("supplierId", event.target.value)}
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Supplier invoice number
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.invoiceNumber}
                onChange={(event) => updateForm("invoiceNumber", event.target.value)}
                maxLength={100}
                placeholder="Enter supplier invoice reference"
              />
            </label>
          </div>

          <div>
            <div className="panel-heading" style={{ marginBottom: 12 }}>
              <div>
                <h2>Purchase items</h2>
                <p>Add each product received from this supplier</p>
              </div>
              <button
                type="button"
                className="button-secondary"
                onClick={addLine}
                disabled={products.length === 0}
              >
                Add item
              </button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {lines.map((line, index) => {
                const product = products.find((item) => item.id === line.productId);
                const lineTotal =
                  numberValue(line.quantity) * numberValue(line.unitCost) -
                  numberValue(line.discount) +
                  numberValue(line.tax);

                return (
                  <div
                    key={index}
                    style={{
                      border: "1px solid #e4ebe6",
                      borderRadius: 10,
                      padding: 16,
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div className="supplier-form-grid">
                      <label style={labelStyle}>
                        Product *
                        <select
                          style={{ ...fieldStyle, marginTop: 6 }}
                          value={line.productId}
                          onChange={(event) => selectProduct(index, event.target.value)}
                          required
                        >
                          <option value="">Select product</option>
                          {products.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}{item.sku ? ` — ${item.sku}` : ""}
                            </option>
                          ))}
                        </select>
                        {product && (
                          <span className="supplier-secondary-text">
                            Current stock: {Number(product.stockQuantity).toLocaleString("en-KE")} {product.unitOfMeasure}
                          </span>
                        )}
                      </label>

                      <label style={labelStyle}>
                        Quantity *
                        <input
                          style={{ ...fieldStyle, marginTop: 6 }}
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.quantity}
                          onChange={(event) => updateLine(index, "quantity", event.target.value)}
                          required
                        />
                      </label>

                      <label style={labelStyle}>
                        Unit cost (KES) *
                        <input
                          style={{ ...fieldStyle, marginTop: 6 }}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) => updateLine(index, "unitCost", event.target.value)}
                          required
                        />
                      </label>

                      <label style={labelStyle}>
                        Item discount (KES)
                        <input
                          style={{ ...fieldStyle, marginTop: 6 }}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.discount}
                          onChange={(event) => updateLine(index, "discount", event.target.value)}
                        />
                      </label>

                      <label style={labelStyle}>
                        Item tax (KES)
                        <input
                          style={{ ...fieldStyle, marginTop: 6 }}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.tax}
                          onChange={(event) => updateLine(index, "tax", event.target.value)}
                        />
                      </label>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <strong style={{ color: "#24372e" }}>
                        Line total: {money(lineTotal)}
                      </strong>
                      <button
                        type="button"
                        className="button-secondary supplier-deactivate"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                      >
                        Remove item
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="supplier-form-grid">
            <label style={labelStyle}>
              Purchase discount (KES)
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="number"
                min="0"
                step="0.01"
                value={form.discount}
                onChange={(event) => updateForm("discount", event.target.value)}
              />
            </label>

            <label style={labelStyle}>
              Purchase tax (KES)
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="number"
                min="0"
                step="0.01"
                value={form.tax}
                onChange={(event) => updateForm("tax", event.target.value)}
              />
            </label>

            <label style={labelStyle}>
              Amount paid (KES)
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="number"
                min="0"
                step="0.01"
                max={purchaseTotal}
                value={form.amountPaid}
                onChange={(event) => updateForm("amountPaid", event.target.value)}
              />
            </label>

            <label style={labelStyle}>
              Notes
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
                placeholder="Optional purchase notes"
              />
            </label>
          </div>

          <div
            style={{
              background: "#f6f9f7",
              border: "1px solid #e2eae4",
              borderRadius: 10,
              padding: 18,
              display: "grid",
              gap: 10,
              maxWidth: 460,
              marginLeft: "auto",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>Total discounts</span>
              <strong>{money(itemDiscounts + numberValue(form.discount))}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>Total tax</span>
              <strong>{money(itemTaxes + numberValue(form.tax))}</strong>
            </div>
            <div style={{ borderTop: "1px solid #dfe7e2", paddingTop: 10, display: "flex", justifyContent: "space-between", gap: 16 }}>
              <strong>Purchase total</strong>
              <strong>{money(purchaseTotal)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>Amount paid</span>
              <strong>{money(form.amountPaid)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <strong>Balance due</strong>
              <strong>{money(balanceDue)}</strong>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="button-primary"
              type="submit"
              disabled={saving || loading || suppliers.length === 0 || products.length === 0}
            >
              {saving ? "Recording purchase..." : "Record purchase"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={resetForm}
              disabled={saving}
            >
              Clear form
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
