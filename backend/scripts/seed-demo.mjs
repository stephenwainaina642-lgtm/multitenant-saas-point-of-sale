// Creates a DEMO business through the public API and fills it with sample products, customers and sales.
// Usage:  node scripts/seed-demo.mjs https://your-api.onrender.com/api
// Uses only the normal sign-up and sales endpoints (no direct database access). Sales are dated "now";
// see scripts/spread-demo-dates.sql to spread them over the last 30 days.
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base.startsWith("http")) { console.error("Usage: node scripts/seed-demo.mjs https://<api>/api"); process.exit(1); }

const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const code = () => Array.from({ length: 10 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[rnd(0, 33)]).join("");

async function call(method, path, token, businessId, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...(businessId && { "x-business-id": businessId }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = Date.now().toString(36);
const email = `demo-${stamp}@example.com`;
const password = "Demo-Pass-" + stamp.toUpperCase() + "9";
const reg = await call("POST", "/auth/register", null, null, { name: "Demo Owner", email, password, businessName: "Demo Shop " + stamp, businessType: "retail" });
if (reg.status !== 201) { console.error("Sign-up failed:", reg.status, JSON.stringify(reg.json)); process.exit(1); }
const token = reg.json.data.token, businessId = reg.json.data.businesses[0].id;

const catalog = [
  ["Maize Flour 2kg", 150, 195], ["Sugar 1kg", 140, 180], ["Cooking Oil 1L", 280, 360], ["Rice 2kg", 300, 380],
  ["Milk 500ml", 55, 70], ["Bread 400g", 50, 65], ["Tea Leaves 250g", 110, 150], ["Soap Bar", 60, 90],
  ["Toothpaste", 120, 170], ["Airtime Voucher 100", 94, 100],
];
const products = [];
for (const [i, [name, costPrice, sellingPrice]] of catalog.entries()) {
  const r = await call("POST", "/products", token, businessId, { name, sku: `DEMO-${i + 1}`, costPrice, sellingPrice, stockQuantity: 5000, minimumStock: 20, unitOfMeasure: "pc" });
  if (r.status !== 201) { console.error("Product failed:", name, r.status, JSON.stringify(r.json)); process.exit(1); }
  products.push({ id: r.json.data.id, price: sellingPrice });
}
const customers = [];
for (const n of ["Wanjiku Kamau", "Otieno Odhiambo", "Amina Yusuf", "Kiprop Chebet", "Mwangi Contractors"]) {
  const r = await call("POST", "/customers", token, businessId, { name: n });
  if (r.status === 201) customers.push(r.json.data.id);
}

let made = 0, failed = 0;
for (let i = 0; i < 120; i++) {
  const items = Array.from({ length: rnd(1, 4) }, () => { const p = pick(products); return { productId: p.id, quantity: rnd(1, 5), unitPrice: p.price }; });
  const total = items.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const method = pick(["cash", "cash", "mpesa", "mpesa", "card"]);
  const body = { items, paymentMethod: method, amountPaid: total, ...(method === "mpesa" && { paymentReference: code() }) };
  const r = await call("POST", "/sales", token, businessId, body);
  if (r.status === 201) made++; else { failed++; if (failed < 4) console.error("Sale failed:", r.status, JSON.stringify(r.json)); }
}
console.log(`\nDemo business ready. Sales created: ${made}, failed: ${failed}`);
console.log(`Sign in with:\n  email:    ${email}\n  password: ${password}\n  business: id ${businessId}`);
