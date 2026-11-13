import { query } from "./db.js";
import { get, post, type Session } from "./http.js";

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export type Tenant = Session & {
  userId: string;
  email: string;
  password: string;
  businessName: string;
};

export const PASSWORD = "Test-Pass-1234";

/** Register a user together with a new business (the app's only signup path). */
export async function registerTenant(
  businessName: string,
  businessType = "retail"
): Promise<Tenant> {
  const email = `owner-${uniq()}@nexa-test.example`;
  const res = await post("/auth/register", undefined, {
    name: `${businessName} Owner`,
    email,
    password: PASSWORD,
    businessName,
    businessType,
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const data = res.body.data;
  return {
    token: data.token,
    businessId: data.businesses[0].id,
    userId: data.user.id,
    email,
    password: PASSWORD,
    businessName,
  };
}

/**
 * Add an employee to a business. There is no employee/invitation endpoint in
 * the backend yet (Employees is frontend-only), so membership is inserted
 * directly. The employee user is created through the register endpoint, which
 * also creates a throwaway business of their own; the employee token is then
 * used against the target business via X-Business-ID.
 */
export async function addEmployee(
  owner: Tenant,
  roleName: string
): Promise<Tenant> {
  const emp = await registerTenant(`${roleName} personal workspace`);
  const [role] = await query<{ id: string }>(
    `insert into roles(name, business_id) values ($1, $2)
     on conflict (business_id, name) do update set name = excluded.name
     returning id`,
    [roleName, owner.businessId]
  );
  await query(
    `insert into business_users(business_id, user_id, role_id) values ($1, $2, $3)`,
    [owner.businessId, emp.userId, role!.id]
  );
  return { ...emp, businessId: owner.businessId, businessName: owner.businessName };
}

export type ProductSeed = {
  name: string;
  sku?: string;
  barcode?: string;
  costPrice: number;
  sellingPrice: number;
  stockQuantity?: number;
  minimumStock?: number;
  unitOfMeasure?: string;
};

export async function createProduct(t: Session, p: ProductSeed) {
  const res = await post("/products", t, p);
  if (res.status !== 201) {
    throw new Error(`createProduct(${p.name}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; stockQuantity: string | number };
}

export async function createCustomer(t: Session, name: string, phone?: string) {
  const res = await post("/customers", t, { name, ...(phone && { phone }) });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string };
}

export async function createSupplier(t: Session, name: string) {
  const res = await post("/suppliers", t, { name });
  if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string };
}

export async function stockOf(productId: string): Promise<number> {
  const [row] = await query<{ stock_quantity: string }>(
    `select stock_quantity from products where id = $1`,
    [productId]
  );
  return Number(row!.stock_quantity);
}

// ---------------------------------------------------------------------------
// Realistic business scenarios (Kenyan retail, KES).
// ---------------------------------------------------------------------------

export async function seedPhoneShop() {
  const t = await registerTenant("Rongai Phone Hub", "electronics");
  const iphone = await createProduct(t, { name: "iPhone 15 128GB", sku: "IPH15-128", barcode: "194253000001", costPrice: 98000, sellingPrice: 112000, stockQuantity: 5, minimumStock: 2 });
  const galaxy = await createProduct(t, { name: "Samsung Galaxy A15", sku: "SGA15", costPrice: 17500, sellingPrice: 21500, stockQuantity: 12, minimumStock: 3 });
  const charger = await createProduct(t, { name: "20W USB-C Charger", sku: "CHG-20W", costPrice: 650, sellingPrice: 1200, stockQuantity: 40, minimumStock: 10 });
  const customer = await createCustomer(t, "Wanjiku Kamau", "0712000111");
  const supplier = await createSupplier(t, "Mobile Wholesale Ltd");
  return { t, iphone, galaxy, charger, customer, supplier };
}

export async function seedPerfumeBusiness() {
  const t = await registerTenant("Oud & Amber Perfumes", "beauty");
  const oud6 = await createProduct(t, { name: "Oud Al Sultan 6ml", sku: "OUD-6", costPrice: 450, sellingPrice: 900, stockQuantity: 100, minimumStock: 20, unitOfMeasure: "bottle" });
  const oud12 = await createProduct(t, { name: "Oud Al Sultan 12ml", sku: "OUD-12", costPrice: 800, sellingPrice: 1600, stockQuantity: 60, minimumStock: 10, unitOfMeasure: "bottle" });
  const amber = await createProduct(t, { name: "Amber Musk 50ml", sku: "AMB-50", costPrice: 2100, sellingPrice: 3800, stockQuantity: 25, minimumStock: 5, unitOfMeasure: "bottle" });
  const customer = await createCustomer(t, "Amina Yusuf", "0722000222");
  const supplier = await createSupplier(t, "Dubai Fragrance Traders");
  return { t, oud6, oud12, amber, customer, supplier };
}

export async function seedHardwareStore() {
  const t = await registerTenant("Kiambu Hardware & Building", "hardware");
  const cement = await createProduct(t, { name: "Cement 50kg", sku: "CEM-50", costPrice: 690, sellingPrice: 780, stockQuantity: 200, minimumStock: 40, unitOfMeasure: "bag" });
  const pipe = await createProduct(t, { name: "GI Pipe 1 inch", sku: "PIPE-1IN", costPrice: 310, sellingPrice: 420, stockQuantity: 150.5, minimumStock: 20, unitOfMeasure: "metre" });
  const paint = await createProduct(t, { name: "Emulsion Paint White", sku: "PNT-W", costPrice: 520, sellingPrice: 760, stockQuantity: 80, minimumStock: 10, unitOfMeasure: "litre" });
  const customer = await createCustomer(t, "Mwangi Contractors", "0733000333");
  const supplier = await createSupplier(t, "Bamburi Distributors");
  return { t, cement, pipe, paint, customer, supplier };
}

export async function seedWholesaler() {
  const t = await registerTenant("Gikomba Wholesale Foods", "wholesale");
  const sugar = await createProduct(t, { name: "Sugar 50kg Sack", sku: "SUG-50", costPrice: 6200, sellingPrice: 6900, stockQuantity: 300, minimumStock: 50, unitOfMeasure: "sack" });
  const rice = await createProduct(t, { name: "Pishori Rice 25kg", sku: "RIC-25", costPrice: 3400, sellingPrice: 3900, stockQuantity: 150, minimumStock: 30, unitOfMeasure: "bag" });
  const customer = await createCustomer(t, "Mama Njeri Mini-Mart", "0744000444");
  const supplier = await createSupplier(t, "Mumias Sugar Agents");
  return { t, sugar, rice, customer, supplier };
}

export const sellBody = (
  items: { productId: string; quantity: number; unitPrice: number; discount?: number; tax?: number }[],
  extra: Record<string, unknown> = {}
) => ({ items, ...extra });

// ---------------------------------------------------------------------------
// Ledger invariants: must hold after ANY sequence of operations.
// ---------------------------------------------------------------------------

export async function ledgerViolations(): Promise<string[]> {
  const problems: string[] = [];

  const negStock = await query(`select id, stock_quantity from products where stock_quantity < 0`);
  for (const r of negStock) problems.push(`product ${r.id} has negative stock ${r.stock_quantity}`);

  const payMismatch = await query(
    `select s.id, s.amount_paid, coalesce(sum(p.amount),0) as paid_rows
       from sales s left join payments p on p.sale_id = s.id
      group by s.id having s.amount_paid <> coalesce(sum(p.amount),0)`
  );
  for (const r of payMismatch) problems.push(`sale ${r.id}: amount_paid ${r.amount_paid} != payments ${r.paid_rows}`);

  const balanceMismatch = await query(
    `select id, total, amount_paid, balance_due from sales where balance_due <> total - amount_paid`
  );
  for (const r of balanceMismatch) problems.push(`sale ${r.id}: balance_due ${r.balance_due} != total-paid`);

  const overpaid = await query(`select id from sales where amount_paid > total`);
  for (const r of overpaid) problems.push(`sale ${r.id} is overpaid`);

  const statusMismatch = await query(
    `select id, payment_status, balance_due, amount_paid from sales
      where (payment_status = 'paid' and balance_due <> 0)
         or (payment_status = 'partial' and (amount_paid = 0 or balance_due = 0))
         or (payment_status = 'unpaid' and amount_paid <> 0)`
  );
  for (const r of statusMismatch) problems.push(`sale ${r.id}: payment_status '${r.payment_status}' inconsistent (paid ${r.amount_paid}, due ${r.balance_due})`);

  return problems;
}

export { get };
