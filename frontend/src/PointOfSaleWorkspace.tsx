import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mpesaCodeError, normalizeMpesaCode } from "./mpesa";
import { apiRequest } from "./api/client";
import { can } from "./permissions";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  sellingPrice: number | string;
  stockQuantity: number | string;
  unitOfMeasure: string;
  categoryId?: string | null;
  categoryName?: string | null;
  isActive: boolean;
};

type CartItem = {
  product: Product;
  quantity: number;
};

type CreatedSale = {
  id: string;
  receiptNumber: string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  paymentStatus: string;
};

const money = (value: number) =>
  `KSh ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;

type PosCustomer = { id: string; name: string; phone: string | null; creditLimit?: string; balance?: string };

export default function PointOfSaleWorkspace() {
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [customerBusy, setCustomerBusy] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
 const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [amountPaid, setAmountPaid] = useState("0");
  const [amountPaidManuallyEdited, setAmountPaidManuallyEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [mpesaCode, setMpesaCode] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // VAT is worked out by the server, so the cashier sees exactly what will be recorded.
  const [vat, setVat] = useState<{ registered: boolean; rate: string; inclusive: boolean } | null>(null);
  const [vatPreview, setVatPreview] = useState<{ tax: number; total: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const saleKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<CreatedSale | null>(null);

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadProducts = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your login or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<Product[]>("/products", {
        token,
        businessId,
      });
      setProducts((response.data ?? []).filter((product) => product.isActive));
      setSelectedProductId((current) =>
        current || (response.data ?? []).find((product) => product.isActive)?.id || ""
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) =>
          sum + Number(item.product.sellingPrice) * item.quantity,
        0
      ),
    [cart]
  );

  const loadCustomers = useCallback(async () => {
    if (!token || !businessId || !can("customers.view")) return;
    try {
      const response = await apiRequest<PosCustomer[]>("/customers", { token, businessId });
      setCustomers(response.data ?? []);
    } catch {
      /* the till still works for walk-in customers */
    }
  }, [token, businessId]);
  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  async function addCustomer() {
    const name = newCustomer.name.trim();
    if (!name) { setError("Enter the customer's name."); return; }
    setCustomerBusy(true);
    setError("");
    try {
      const response = await apiRequest<PosCustomer>("/customers", {
        method: "POST", token, businessId,
        body: { name, ...(newCustomer.phone.trim() && { phone: newCustomer.phone.trim() }) },
      });
      await loadCustomers();
      if (response.data) setCustomerId(response.data.id);
      setNewCustomer({ name: "", phone: "" });
      setAddingCustomer(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the customer.");
    } finally {
      setCustomerBusy(false);
    }
  }

  const discountValue = Number(discount);
  const vatOn = vat?.registered === true;
  const taxValue = vatOn ? (vatPreview?.tax ?? 0) : Number(tax);
  const total = vatOn ? (vatPreview?.total ?? subtotal - discountValue) : subtotal - discountValue + taxValue;

  useEffect(() => {
    const token = sessionStorage.getItem("pos_token");
    const businessId = sessionStorage.getItem("pos_business_id");
    if (!token || !businessId) return;
    apiRequest<{ vatRegistered: boolean; vatRate: string; pricesIncludeVat?: boolean }>("/businesses/current", { token, businessId })
      .then((r) => { if (r.data) setVat({ registered: r.data.vatRegistered, rate: r.data.vatRate, inclusive: r.data.vatRegistered && r.data.pricesIncludeVat === true }); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!vatOn) return;
    if (cart.length === 0) { setVatPreview(null); return; }
    const token = sessionStorage.getItem("pos_token") || "";
    const businessId = sessionStorage.getItem("pos_business_id") || "";
    let active = true;
    setPreviewing(true);
    const timer = setTimeout(() => {
      apiRequest<{ tax: string; total: string }>("/sales/preview", {
        method: "POST", token, businessId,
        body: {
          discount: Number.isFinite(discountValue) && discountValue >= 0 ? discountValue : 0,
          items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, unitPrice: Number(item.product.sellingPrice) })),
        },
      })
        .then((r) => { if (active && r.data) setVatPreview({ tax: Number(r.data.tax), total: Number(r.data.total) }); })
        .catch((err) => { if (active) { setVatPreview(null); setError(err instanceof Error ? err.message : "Could not work out VAT."); } })
        .finally(() => { if (active) setPreviewing(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [vatOn, cart, discountValue]);

  useEffect(() => {
    if (!amountPaidManuallyEdited) {
      setAmountPaid(total > 0 ? total.toFixed(2) : "0");
    }
  }, [total, amountPaidManuallyEdited]);

  /** A barcode scanner types the code and presses Enter: add that exact product to the cart. */
  function scanCode(raw: string) {
    const code = raw.trim().toLowerCase();
    if (!code) return;
    const product =
      products.find((item) => (item.barcode ?? "").toLowerCase() === code) ??
      products.find((item) => (item.sku ?? "").toLowerCase() === code);
    if (!product) {
      setReceipt(null);
      setMessage("");
      setError(`No active product has the barcode or SKU "${raw.trim()}".`);
      return;
    }
    setProductSearch("");
    addProduct(product.id);
  }

  function addProduct(productId: string = selectedProductId) {
    setError("");
    setMessage("");
    setReceipt(null);

    const product = products.find((item) => item.id === productId);
    if (!product) {
      setError("Select a product first.");
      return;
    }

    const stock = Number(product.stockQuantity);
    if (stock <= 0) {
      setError(`${product.name} is out of stock.`);
      return;
    }

    const existing = cart.find((item) => item.product.id === product.id);
    if (existing && existing.quantity + 1 > stock) {
      setError(`Only ${stock} ${product.unitOfMeasure} of ${product.name} are available.`);
      return;
    }

    setCart((current) => {
      const found = current.find((item) => item.product.id === product.id);
      if (found) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, value: string) {
    if (value.trim() === "") return;

    const quantity = Number(value);
    const item = cart.find((entry) => entry.product.id === productId);

    if (!item || !Number.isFinite(quantity) || quantity < 1) return;

    if (!Number.isInteger(quantity)) {
      setError("Quantity must be a whole number for this product.");
      return;
    }

    if (quantity > Number(item.product.stockQuantity)) {
      setError(`Only ${Number(item.product.stockQuantity)} ${item.product.unitOfMeasure} of ${item.product.name} are available.`);
      return;
    }

    setCart((current) =>
      current.map((entry) =>
        entry.product.id === productId
          ? { ...entry, quantity }
          : entry
      )
    );
    setError("");
  }

  function removeProduct(productId: string) {
    setCart((current) =>
      current.filter((item) => item.product.id !== productId)
    );
  }

  async function completeSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setReceipt(null);

    if (!token || !businessId) {
      setError("Your login or selected business is missing. Please sign in again.");
      return;
    }

    if (cart.length === 0) {
      setError("Add at least one product to the cart.");
      return;
    }

    if (
      !Number.isFinite(discountValue) ||
      discountValue < 0 ||
      !Number.isFinite(taxValue) ||
      taxValue < 0 ||
      !Number.isFinite(total) ||
      total < 0
    ) {
      setError("Check the discount and tax amounts. The sale total cannot be negative.");
      return;
    }

    const paid = Number(amountPaid);
    if (
      amountPaid.trim() === "" ||
      !Number.isFinite(paid) ||
      paid < 0 ||
      paid > total
    ) {
      setError("Amount paid must be between zero and the sale total.");
      return;
    }

    if (paid < total && !customerId) {
      setError("This sale is not fully paid. Choose the customer who owes the balance (or add them) before completing it.");
      return;
    }

    if (paid > 0 && !paymentMethod.trim()) {
      setError("Select a payment method.");
      return;
    }

    if (paid > 0 && paymentMethod === "mpesa") {
      const problem = mpesaCodeError(mpesaCode);
      if (problem) {
        setError(problem);
        return;
      }
    }

    for (const item of cart) {
      if (
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > Number(item.product.stockQuantity)
      ) {
        setError(`Check the quantity for ${item.product.name}. Available stock may have changed.`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        discount: discountValue,
        tax: vatOn ? 0 : taxValue,
        amountPaid: paid,
        paymentMethod,
        ...(customerId && { customerId }),
        ...(paid > 0 && paymentMethod === "mpesa" && { paymentReference: normalizeMpesaCode(mpesaCode) }),
        notes: notes.trim(),
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: Number(item.product.sellingPrice),
        })),
      };
      // The same sale re-sent after a dropped connection or a double click carries the same key,
      // so the server records it once. Any change to the sale gets a fresh key.
      const fingerprint = JSON.stringify(payload);
      if (saleKeyRef.current?.fingerprint !== fingerprint) {
        saleKeyRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      const response = await apiRequest<CreatedSale>("/sales", {
        method: "POST",
        token,
        businessId,
        idempotencyKey: saleKeyRef.current.key,
        body: payload,
      });

      if (!response.data) {
        throw new Error("The server did not return sale details. Check Sales before retrying.");
      }

      saleKeyRef.current = null;
      setReceipt(response.data);
      setMessage("Sale completed successfully.");
      setCart([]);
      setDiscount("0");
      setTax("0");
      setNotes("");
      setMpesaCode("");
      setCustomerId("");
      setAmountPaidManuallyEdited(false);
      await Promise.all([loadProducts(), loadCustomers()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the sale.");
    } finally {
      setSaving(false);
    }
  }

  const posCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const product of products) {
      if (product.categoryId && product.categoryName) seen.set(product.categoryId, product.categoryName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  return (
    <section className="pos-workspace">
      <div className="pos-workspace-heading">
        <div>
          <h2>Point of Sale</h2>
          <p className="inventory-muted">
            Create a sale using products and prices from your selected business.
          </p>
        </div>
        <button type="button" className="pos-secondary-button" onClick={() => void loadProducts()} disabled={loading || saving}>
          Refresh products
        </button>
      </div>

      {error && <div className="pos-alert pos-alert-error" role="alert">{error}</div>}
      {message && <div className="pos-alert pos-alert-success" role="status">{message}</div>}

      {receipt && (
        <div className="pos-receipt-summary">
          <h3>Sale recorded</h3>
          <p>Receipt: <strong>{receipt.receiptNumber}</strong></p>
          <p>Total: <strong>{money(Number(receipt.total))}</strong></p>
          <p>Paid: {money(Number(receipt.amountPaid))} | Balance: {money(Number(receipt.balanceDue))}</p>
          <p>Payment status: {receipt.paymentStatus}</p>
          <p className="inventory-muted">Save the receipt number for your records. You can find the sale in the Sales section.</p>
        </div>
      )}

      <div className="pos-checkout-grid">
        <section className="pos-checkout-panel">
          <h3>Add products</h3>
          {loading ? (
            <p className="inventory-muted">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="inventory-muted">No active products found. Add a product in Products first.</p>
          ) : (
            <div className="pos-add-product">
              {posCategories.length > 0 && (
                <label className="inventory-field">
                  Category
                  <select
                    value={categoryFilter}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCategoryFilter(next);
                      const first = products.find((product) => next === "" || product.categoryId === next);
                      setSelectedProductId(first?.id ?? "");
                    }}
                  >
                    <option value="">All categories</option>
                    {posCategories.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="inventory-field">
                Product
                <input
                  type="search"
                  placeholder="Search name or SKU, or scan a barcode and press Enter..."
                  value={productSearch}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      scanCode(productSearch);
                    }
                  }}
                  onChange={(event) => {
                    const query = event.target.value.toLowerCase().trim();
                    setProductSearch(event.target.value);
                    const match = products.find((product) =>
                      product.name.toLowerCase().includes(query) ||
                      (product.sku ?? "").toLowerCase().includes(query)
                    );
                    setSelectedProductId(match?.id ?? "");
                  }}
                />
                <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                  {products
                    .filter((product) => {
                      if (categoryFilter && product.categoryId !== categoryFilter) return false;
                      const query = productSearch.toLowerCase().trim();
                      return product.name.toLowerCase().includes(query) ||
                        (product.sku ?? "").toLowerCase().includes(query);
                    })
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}  -  {money(Number(product.sellingPrice))}  -  stock: {Number(product.stockQuantity)} {product.unitOfMeasure}
                      </option>
                    ))}
                </select>
              </label>
              <button type="button" className="pos-primary-button" onClick={() => addProduct()} disabled={saving || !selectedProductId}>
                Add to cart
              </button>
            </div>
          )}

          <h3 className="pos-cart-heading">Cart ({cart.length} {cart.length === 1 ? "product" : "products"})</h3>
          {cart.length === 0 ? (
            <p className="inventory-muted">Your cart is empty. Add a product to begin.</p>
          ) : (
            <div className="pos-cart-list">
              {cart.map((item) => (
                <div className="pos-cart-item" key={item.product.id}>
                  <div className="pos-cart-item-info">
                    <strong>{item.product.name}</strong>
                    <span>{money(Number(item.product.sellingPrice))} per {item.product.unitOfMeasure}</span>
                    <span>Available: {Number(item.product.stockQuantity)} {item.product.unitOfMeasure}</span>
                  </div>
                  <label className="pos-quantity-field">
                    Qty
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max={Number(item.product.stockQuantity)}
                      value={item.quantity}
                      onChange={(event) => changeQuantity(item.product.id, event.target.value)}
                    />
                  </label>
                  <strong>{money(Number(item.product.sellingPrice) * item.quantity)}</strong>
                  <button type="button" className="pos-remove-button" onClick={() => removeProduct(item.product.id)} aria-label={`Remove ${item.product.name}`} disabled={saving}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <form className="pos-checkout-panel pos-payment-panel" onSubmit={completeSale}>
          <h3>Payment and totals</h3>
          <div className="pos-total-row"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>

          <label className="inventory-field">
            Discount (KSh)
            <input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
          </label>

          {vatOn ? (
            <div className="pos-total-row"><span>{vat?.inclusive ? `VAT included (${Number(vat?.rate)}%)` : `VAT (${Number(vat?.rate)}%)`}</span><strong>{money(taxValue)}</strong></div>
          ) : (
            <label className="inventory-field">
              Tax (KSh)
              <input type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(event.target.value)} />
            </label>
          )}

          <div className="pos-total-row pos-grand-total"><span>Total</span><strong>{money(total)}</strong></div>

          <div className="inventory-field">
            <span>Customer {Number(amountPaid) < total ? "(required: the balance will be owed)" : "(optional)"}</span>
            {can("customers.view") ? (
              <>
                <input
                  type="search"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Search customer by name or phone..."
                  aria-label="Search customers"
                />
                <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} aria-label="Customer">
                  <option value="">Walk-in customer (no account)</option>
                  {customers
                    .filter((c) => c.id === customerId || `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(customerSearch.trim().toLowerCase()))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.phone ? ` · ${c.phone}` : ""}{Number(c.balance) > 0 ? ` · owes ${money(Number(c.balance))}` : ""}
                      </option>
                    ))}
                </select>
                {can("customers.manage") && !addingCustomer && (
                  <button type="button" className="pos-secondary-button" onClick={() => setAddingCustomer(true)}>+ New customer</button>
                )}
                {addingCustomer && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <input value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} placeholder="Customer name" maxLength={255} />
                    <input value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} placeholder="Phone (optional)" maxLength={50} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="pos-primary-button" disabled={customerBusy} onClick={addCustomer}>{customerBusy ? "Saving..." : "Save customer"}</button>
                      <button type="button" className="pos-secondary-button" onClick={() => setAddingCustomer(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <small className="inventory-muted">You do not have permission to choose customers.</small>
            )}
            {customerId && Number(amountPaid) < total && (
              <small className="inventory-muted">{money(total - Number(amountPaid))} will be recorded as owed by this customer.</small>
            )}
          </div>

          <label className="inventory-field">
            Amount paid (KSh)
            <input type="number" min="0" step="0.01" max={Math.max(0, total)} value={amountPaid} onChange={(event) => { setAmountPaidManuallyEdited(true); setAmountPaid(event.target.value); }} required />
          </label>

          <label className="inventory-field">
            Payment method
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </label>

          {paymentMethod === "mpesa" && Number(amountPaid) > 0 && (
            <label className="inventory-field">
              M-Pesa transaction code
              <input
                value={mpesaCode}
                onChange={(event) => setMpesaCode(event.target.value.toUpperCase())}
                maxLength={14}
                placeholder="e.g. QGH7XK2LMN"
                autoComplete="off"
              />
            </label>
          )}

          <label className="inventory-field">
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Sale notes..." />
          </label>

          <button className="pos-primary-button pos-complete-button" type="submit" disabled={saving || loading || previewing || cart.length === 0}>
            {saving ? "Processing sale..." : "Complete sale"}
          </button>
          <p className="inventory-muted pos-payment-note">
            Completing a sale saves it to the selected business and deducts stock. Only submit when you intend to record a real sale.
          </p>
        </form>
      </div>
    </section>
  );
}
