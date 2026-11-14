import { useEffect, useMemo, useState } from "react";
import "./App.css";
import ProductsWorkspace from "./ProductsWorkspace";
import InventoryWorkspace from "./InventoryWorkspace";
import PointOfSaleWorkspace from "./PointOfSaleWorkspace";
import SalesWorkspace from "./SalesWorkspace";
import CustomersWorkspace from "./CustomersWorkspace";
import SuppliersWorkspace from "./SuppliersWorkspace";
import PurchasesWorkspace from "./PurchasesWorkspace";
import ExpensesWorkspace from "./ExpensesWorkspace";
import ReportsWorkspace from "./ReportsWorkspace";
import BusinessSettingsWorkspace from "./BusinessSettingsWorkspace";
import EmployeesWorkspace from "./EmployeesWorkspace";
import { apiRequest } from "./api/client";

const navigation = [
  { name: "Dashboard", icon: "D" },
  { name: "Point of Sale", icon: "P" },
  { name: "Products", icon: "P" },
  { name: "Inventory", icon: "I" },
  { name: "Customers", icon: "C" },
  { name: "Employees", icon: "E" },
  { name: "Suppliers", icon: "S" },
  { name: "Purchases", icon: "B" },
  { name: "Sales", icon: "S" },
  { name: "Expenses", icon: "E" },
  { name: "Reports", icon: "R" },
  { name: "Settings", icon: "G" },
];

type DashboardSale = {
  id: string;
  receiptNumber: string;
  customerName: string | null;
  salespersonId?: string | null;
  salespersonName?: string | null;
  salespersonEmail?: string | null;
  saleDate: string;
  createdAt: string;
  total: number | string;
  amountPaid: number | string;
  balanceDue: number | string;
  paymentStatus: string;
  status: string;
};

type DashboardProduct = {
  id: string;
  name: string;
  sku: string | null;
  stockQuantity: number | string;
  minimumStock: number | string;
  unitOfMeasure: string;
};

const money = (amount: number) =>
  `KSh ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("This week");
  const [notice, setNotice] = useState("");
  const currentUserName = sessionStorage.getItem("pos_user_name") || "User";
  const currentBusinessRole = sessionStorage.getItem("pos_business_role") || "Team member";
  const currentBusinessName = sessionStorage.getItem("pos_business_name") || "Business";
  const userInitials = currentUserName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";



  const [sales, setSales] = useState<DashboardSale[]>([]);

  const chartData = useMemo(() => {
    const now = new Date();
    const buckets: { day: string; start: Date; end: Date; total: number }[] = [];

    if (period === "This year") {
      for (let month = 0; month < 12; month++) {
        buckets.push({
          day: new Date(now.getFullYear(), month, 1).toLocaleDateString("en-KE", { month: "short" }),
          start: new Date(now.getFullYear(), month, 1),
          end: new Date(now.getFullYear(), month + 1, 1),
          total: 0,
        });
      }
    } else if (period === "This month") {
      for (let week = 0; week < 5; week++) {
        const start = new Date(now.getFullYear(), now.getMonth(), 1 + week * 7);
        const end = new Date(now.getFullYear(), now.getMonth(), 1 + (week + 1) * 7);
        buckets.push({
          day: `Week ${week + 1}`,
          start,
          end,
          total: 0,
        });
      }
    } else {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

      for (let day = 0; day < 7; day++) {
        const start = new Date(monday);
        start.setDate(monday.getDate() + day);
        const end = new Date(start);
        end.setDate(start.getDate() + 1);
        buckets.push({
          day: start.toLocaleDateString("en-KE", { weekday: "short" }),
          start,
          end,
          total: 0,
        });
      }
    }

    for (const sale of sales) {
      const saleDate = new Date(sale.saleDate);
      if (Number.isNaN(saleDate.getTime())) continue;

      const bucket = buckets.find(
        (item) => saleDate >= item.start && saleDate < item.end
      );

      if (bucket) bucket.total += Number(sale.total) || 0;
    }

    const maximum = Math.max(...buckets.map((item) => item.total), 0);

    return buckets.map((item) => ({
      day: item.day,
      total: item.total,
      value: maximum > 0 ? (item.total / maximum) * 100 : 0,
    }));
  }, [sales, period]);

  const chartMaximum = Math.max(...chartData.map((item) => item.total), 1);
  const chartAxisLabels = [1, 0.75, 0.5, 0.25, 0].map((fraction) =>
    new Intl.NumberFormat("en-KE", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(chartMaximum * fraction)
  );
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      const token = sessionStorage.getItem("pos_token");
      const businessId = sessionStorage.getItem("pos_business_id");

      if (!token || !businessId) {
        setDashboardError("Please sign in and select a business to view its dashboard.");
        setDashboardLoading(false);
        return;
      }

      try {
        const [salesResponse, productsResponse] = await Promise.all([
          apiRequest<DashboardSale[]>("/sales", { token, businessId }),
          apiRequest<DashboardProduct[]>("/products", { token, businessId }),
        ]);

        if (!cancelled) {
          // Voided sales are history only: they never count as revenue or money owed.
          setSales(Array.isArray(salesResponse.data) ? salesResponse.data.filter((sale) => sale.status !== "voided") : []);
          setProducts(Array.isArray(productsResponse.data) ? productsResponse.data : []);
          setDashboardError("");
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(
            error instanceof Error ? error.message : "Could not load dashboard data."
          );
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTransactions = useMemo(
    () =>
      sales.filter((sale) =>
        `${sale.receiptNumber} ${sale.customerName || "Walk-in customer"} ${sale.paymentStatus}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [sales, search]
  );

  const totalRevenue = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const totalOutstanding = sales.reduce(
    (sum, sale) => sum + (Number(sale.balanceDue) || 0),
    0
  );

  const salespersonPerformance = useMemo(() => {
    const performance = new Map<string, {
      id: string;
      name: string;
      email: string;
      salesCount: number;
      revenue: number;
      collected: number;
      outstanding: number;
    }>();

    for (const sale of sales) {
      const id = sale.salespersonId || "unassigned";
      const name = sale.salespersonName || "Unassigned salesperson";
      const email = sale.salespersonEmail || "";
      const current = performance.get(id) || {
        id,
        name,
        email,
        salesCount: 0,
        revenue: 0,
        collected: 0,
        outstanding: 0,
      };

      current.salesCount += 1;
      current.revenue += Number(sale.total) || 0;
      current.collected += Number(sale.amountPaid) || 0;
      current.outstanding += Number(sale.balanceDue) || 0;
      performance.set(id, current);
    }

    return Array.from(performance.values()).sort(
      (a, b) => b.revenue - a.revenue
    );
  }, [sales]);
  const stockUnits = products.reduce(
    (sum, product) => sum + (Number(product.stockQuantity) || 0),
    0
  );
  const lowStockProducts = products.filter(
    (product) => Number(product.stockQuantity) <= Number(product.minimumStock)
  );

  function selectPage(name: string) {
    setActivePage(name);
    if (name !== "Dashboard" && name !== "Settings") {
      setNotice(`${name} workspace selected. We will connect this section to the backend next.`);
    } else {
      setNotice("");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="brand-name">nexa<span>POS</span></div>
            <div className="brand-caption">BUSINESS MANAGEMENT</div>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button className="business-switch" onClick={() => setNotice("Business switching will be connected to your account.")}>
          <span className="business-avatar">S</span>
          <span className="business-info">
            <strong>{sessionStorage.getItem("pos_business_name") || "Your Business"}</strong>
            <small>Business workspace</small>
          </span>
          <span className="chevron">{'>'}</span>
        </button>

        <div className="nav-label">MAIN MENU</div>
        <nav className="navigation">
          {navigation.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${activePage === item.name ? "active" : ""}`}
              onClick={() => selectPage(item.name)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.name}</span>
              {item.name === "Inventory" && <span className="nav-badge">4</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">i</div>
            <strong>Need a hand?</strong>
            <p>Your business tools, all in one place.</p>
            <button onClick={() => setNotice("Help centre selected.")}>Visit help centre</button>
          </div>
          <div className="profile">
            <div className="profile-avatar">{userInitials}</div>
            <div className="profile-info">
              <strong>{currentUserName}</strong>
              <small>{`${currentBusinessRole} · ${currentBusinessName}`}</small>
            </div>
            <button className="profile-menu" onClick={() => setNotice("Account settings selected.")}>...</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span><span className="crumb-separator">/</span><strong>{activePage}</strong>
          </div>
          <div className="topbar-actions">
            <div className="system-status"><span></span> Connected</div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice(`${lowStockProducts.length} products need restocking.`)}><i></i></button>
            <div className="topbar-avatar">{userInitials}</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">{new Date().toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase()}</div>
              <h1>{activePage === "Dashboard" ? `Welcome, ${currentUserName}` : activePage}</h1>
              <p className="subtitle">
                {activePage === "Dashboard"
                  ? "Here's what's happening with your business today."
                  : `Manage your ${activePage.toLowerCase()} from one place.`}
              </p>
            </div>
                        {activePage !== "Settings" && (
              <div className="welcome-actions">
                <button className="button-secondary" onClick={() => setNotice("Report export will be connected to live business data.")}><span>Export report</span></button>
                <button className="button-primary" onClick={() => selectPage("Point of Sale")}><span>New sale</span></button>
              </div>
            )}
          </section>

          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss">x</button>
            </div>
          )}

          {activePage === "Dashboard" && dashboardLoading && (
            <div className="notice">Loading your business dashboard...</div>
          )}
          {activePage === "Dashboard" && dashboardError && (
            <div className="notice">{dashboardError}</div>
          )}

          {activePage === "Point of Sale" ? (
            <PointOfSaleWorkspace />
          ) : activePage === "Products" ? (
            <ProductsWorkspace />
          ) : activePage === "Inventory" ? (
            <InventoryWorkspace />
          ) : activePage === "Sales" ? (
            <SalesWorkspace />
          ) : activePage === "Customers" ? (
            <CustomersWorkspace />
          ) : activePage === "Employees" ? (
            <EmployeesWorkspace salespersonPerformance={salespersonPerformance} />
          ) : activePage === "Suppliers" ? (
            <SuppliersWorkspace />
          ) : activePage === "Purchases" ? (
            <PurchasesWorkspace />
          ) : activePage === "Expenses" ? (
            <ExpensesWorkspace />
          ) : activePage === "Reports" ? (
            <ReportsWorkspace />
          ) : activePage === "Settings" ? (
            <BusinessSettingsWorkspace />
          ) : (
            <>
          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-top"><span>Total revenue</span><span className="metric-icon green"></span></div>
              <div className="metric-value">{money(totalRevenue)}</div>
              <div className="metric-foot"><span className="neutral-tag">Recorded sales</span><span>current records</span></div>
              <div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Total orders</span><span className="metric-icon blue"></span></div>
              <div className="metric-value">{sales.length}</div>
              <div className="metric-foot"><span className="neutral-tag">Recorded orders</span><span>current records</span></div>
              <div className="metric-line blue-line"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Products in stock</span><span className="metric-icon purple"></span></div>
              <div className="metric-value">{stockUnits.toLocaleString("en-KE")}</div>
              <div className="metric-foot"><span className="trend negative">{lowStockProducts.length} low stock</span><span>items need attention</span></div>
              <div className="stock-progress"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Outstanding payments</span><span className="metric-icon orange"></span></div>
              <div className="metric-value">{money(totalOutstanding)}</div>
              <div className="metric-foot"><span className="neutral-tag">{sales.filter((sale) => Number(sale.balanceDue) > 0 && sale.status !== "CANCELLED").length} invoices</span><span>awaiting payment</span></div>
              <div className="metric-line orange-line"><i /></div>
            </article>
          </section>

          <section className="middle-grid">
            <article className="panel sales-panel">
              <div className="panel-heading">
                <div><h2>Sales overview</h2><p>Monitor your business performance</p></div>
                <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Chart period">
                  <option>This week</option><option>This month</option><option>This year</option>
                </select>
              </div>
              <div className="chart-summary">
                <div><span className="muted-label">SALES OVERVIEW</span><strong>{money(chartData.reduce((sum, item) => sum + item.total, 0))}</strong></div>
                <div className="chart-legend"><span></span> Revenue</div>
              </div>
              <div className="chart">
                <div className="y-labels">{chartAxisLabels.map((label, index) => <span key={index}>{label}</span>)}</div>
                <div className="chart-plot">
                  <div className="chart-grid-lines"><i /><i /><i /><i /><i /></div>
                  <div className="bars">
                    {chartData.map((item) => (
                      <div className="bar-column" key={item.day}>
                        <div className="bar-track"><div className={`bar ${item.value === Math.max(...chartData.map((entry) => entry.value)) && item.value > 0 ? "highlight" : ""}`} style={{ height: `${item.value}%` }} /></div>
                        <span>{item.day}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="panel stock-panel">
              <div className="panel-heading">
                <div><h2>Low stock alerts</h2><p>Products that need restocking</p></div>
                <span className="alert-count">{lowStockProducts.length}</span>
              </div>
              <div className="stock-list">
            {lowStockProducts.length > 0 ? (
              lowStockProducts.map((item) => (
                <div className="stock-item" key={item.id}>
                  <div className="product-symbol">P</div>
                  <div className="stock-product">
                    <strong>{item.name}</strong>
                    <small>{item.sku || "No SKU"}</small>
                  </div>
                  <div className="stock-quantity">
                    <strong>{Number(item.stockQuantity).toLocaleString("en-KE")}</strong>
                    <small>{item.unitOfMeasure} left</small>
                  </div>
                </div>
              ))
            ) : (
              <div className="stock-empty">
                <strong>Inventory is healthy</strong>
                <p>All products are above their minimum stock levels.</p>
              </div>
            )}
          </div>
          <button className="text-link" onClick={() => selectPage("Inventory")}>View all inventory <span>{'>'}</span></button>
            </article>
          </section>

          <section className="panel transactions-panel salesperson-panel">
            <div className="panel-heading">
              <div><h2>Salesperson performance</h2><p>Sales, collections, and outstanding balances by salesperson</p></div>
            </div>
            <div className="table-scroll">
              <table className="salesperson-table">
                <thead>
                  <tr>
                    <th>SALESPERSON</th>
                    <th>SALES</th>
                    <th>REVENUE</th>
                    <th>COLLECTED</th>
                    <th>OUTSTANDING</th>
                  </tr>
                </thead>
                <tbody>
                  {salespersonPerformance.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <div className="customer-cell">
                          <span className="customer-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                          <div><strong>{person.name}</strong>{person.email && <small>{person.email}</small>}</div>
                        </div>
                      </td>
                      <td>{person.salesCount}</td>
                      <td><strong>{money(person.revenue)}</strong></td>
                      <td>{money(person.collected)}</td>
                      <td>{money(person.outstanding)}</td>
                    </tr>
                  ))}
                  {salespersonPerformance.length === 0 && (
                    <tr><td colSpan={5} className="empty-row">No salesperson sales recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel transactions-panel">
            <div className="panel-heading transaction-heading">
              <div><h2>Recent transactions</h2><p>A quick look at your latest sales</p></div>
              <div className="transaction-actions">
                <label className="search-box"><span></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions..." /></label>
                <button className="button-secondary view-all" onClick={() => selectPage("Sales")}>View all <span>&gt;</span></button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>PAYMENT METHOD</th><th>AMOUNT</th><th>STATUS</th></tr></thead>
                <tbody>
                  {filteredTransactions.map((item) => (
                    <tr key={item.id}>
                      <td><strong className="invoice-id">{item.receiptNumber}</strong></td>
                      <td><div className="customer-cell"><span className="customer-avatar">{(item.customerName || "Walk-in").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{item.customerName || "Walk-in customer"}</div></td>
                      <td className="date-cell">{new Date(item.saleDate || item.createdAt).toLocaleString("en-KE")}</td>
                      <td><span className="payment-method">{item.paymentStatus}</span></td>
                      <td><strong>{money(Number(item.total) || 0)}</strong></td>
                      <td><span className={`status ${(item.status || "recorded").toLowerCase()}`}><i />{item.status}</span></td>
                    </tr>
                  ))}
                  {filteredTransactions.length === 0 && <tr><td colSpan={6} className="empty-row">No transactions match your search.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing {filteredTransactions.length} of {sales.length} recorded sales</span><span className="demo-note">Live business data</span></div>
          </section>

            </>
          )}
          <footer className="footer"><span>Copyright 2026 nexaPOS</span><span>Built for growing businesses <b>nexaPOS</b></span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
