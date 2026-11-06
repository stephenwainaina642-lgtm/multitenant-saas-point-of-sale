import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  sellingPrice: number | string;
  stockQuantity: number | string;
  unitOfMeasure: string;
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

export default function PointOfSaleWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
 const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [amountPaid, setAmountPaid] = useState("0");
  const [amountPaidManuallyEdited, setAmountPaidManuallyEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const discountValue = Number(discount);
  const taxValue = Number(tax);
  const total = subtotal - discountValue + taxValue;

  useEffect(() => {
    if (!amountPaidManuallyEdited) {
      setAmountPaid(total > 0 ? total.toFixed(2) : "0");
    }
  }, [total, amountPaidManuallyEdited]);

  function addProduct() {
    setError("");
    setMessage("");
    setReceipt(null);

    const product = products.find((item) => item.id === selectedProductId);
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

    if (paid > 0 && !paymentMethod.trim()) {
      setError("Select a payment method.");
      return;
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
      const response = await apiRequest<CreatedSale>("/sales", {
        method: "POST",
        token,
        businessId,
        body: {
          discount: discountValue,
          tax: taxValue,
          amountPaid: paid,
          paymentMethod,
          notes: notes.trim(),
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: Number(item.product.sellingPrice),
          })),
        },
      });

      if (!response.data) {
        throw new Error("The server did not return sale details. Check Sales before retrying.");
      }

      setReceipt(response.data);
      setMessage("Sale completed successfully.");
      setCart([]);
      setDiscount("0");
      setTax("0");
      setNotes("");
      setAmountPaidManuallyEdited(false);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the sale.");
    } finally {
      setSaving(false);
    }
  }

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
              <label className="inventory-field">
                Product
                <input
                  type="search"
                  placeholder="Search product name or SKU..."
                  value={productSearch}
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
              <button type="button" className="pos-primary-button" onClick={addProduct} disabled={saving || !selectedProductId}>
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

          <label className="inventory-field">
            Tax (KSh)
            <input type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(event.target.value)} />
          </label>

          <div className="pos-total-row pos-grand-total"><span>Total</span><strong>{money(total)}</strong></div>

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

          <label className="inventory-field">
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Sale notes..." />
          </label>

          <button className="pos-primary-button pos-complete-button" type="submit" disabled={saving || loading || cart.length === 0}>
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
