import ShiftsWorkspace from "./ShiftsWorkspace";
import BusinessSwitcher from "./BusinessSwitcher";
import BranchSwitcher from "./BranchSwitcher";
import BranchesWorkspace from "./BranchesWorkspace";
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
import InvoicesWorkspace from "./InvoicesWorkspace";
import QuotationsWorkspace from "./QuotationsWorkspace";
import ReportsWorkspace from "./ReportsWorkspace";
import MpesaStatementWorkspace from "./MpesaStatementWorkspace";
import HotelWorkspace from "./HotelWorkspace";
import RoomsWorkspace from "./RoomsWorkspace";
import BusinessSettingsWorkspace from "./BusinessSettingsWorkspace";
import IntegrationsWorkspace from "./IntegrationsWorkspace";
import ChangePasswordPanel from "./ChangePasswordPanel";
import OfflineSigninPanel from "./OfflineSigninPanel";
import { forgetOfflineUser, removeEntry, syncOfflineSignin } from "./offlineSigninStore";
import EmployeesWorkspace from "./EmployeesWorkspace";
import { ApiError, apiRequest } from "./api/client";
import { notify } from "./toast";
import { AlertTriangle, Bell, Radio, UtensilsCrossed, BedDouble, BarChart3, Banknote, Boxes, Clock, FileSpreadsheet, FileText, LayoutDashboard, Package, Receipt, Settings, ShoppingBag, ShoppingCart, Store, Truck, UserCog, Users, Wallet, ClipboardList } from "lucide-react";
import { can, storePermissions } from "./permissions";
import { hasModule, storeModules } from "./modules";
import SyncBadge from "./SyncBadge";
import OfflineBanner from "./OfflineBanner";
import { clearOfflineCache } from "./offlineCache";
import { flushOutbox, unsyncedCount } from "./salesOutbox";
import { money } from "./money";

/** The permission a member needs to see each screen (the server enforces the same rules). */
const navigationPermissions: Record<string, string[]> = {
  "Point of Sale": ["sales.create"],
  Products: ["products.view"],
  Inventory: ["inventory.view", "inventory.adjust"],
  Customers: ["customers.view"],
  Employees: ["employees.manage"],
  Suppliers: ["suppliers.view"],
  Purchases: ["purchases.view"],
  Sales: ["sales.view_all", "sales.view_own"],
  Quotations: ["quotations.view"],
  Invoices: ["invoices.view"],
  Expenses: ["expenses.view"],
  Reports: ["reports.view"],
  "M-PESA Statement": ["payments.view"],
  "Tables & Orders": ["sales.create"],
  Rooms: ["hotel.stays"],
  Shifts: ["shifts.use", "shifts.view_all"],
  Branches: ["branches.manage", "branches.all", "stock.transfer"],
};

/** Pages that belong to an optional module (package feature); hidden when the business does not have it. */
const navigationModules: Record<string, string> = {
  "Tables & Orders": "tables",
  Rooms: "rooms",
  Suppliers: "purchasing",
  Purchases: "purchasing",
  Quotations: "documents",
  Invoices: "documents",
};

const navigation = [
  { name: "Dashboard", icon: <LayoutDashboard size={18} strokeWidth={1.9} /> },
  { name: "Point of Sale", icon: <ShoppingCart size={18} strokeWidth={1.9} /> },
  { name: "Products", icon: <Package size={18} strokeWidth={1.9} /> },
  { name: "Tables & Orders", icon: <UtensilsCrossed size={18} strokeWidth={1.9} /> },
  { name: "Rooms", icon: <BedDouble size={18} strokeWidth={1.9} /> },
  { name: "Inventory", icon: <Boxes size={18} strokeWidth={1.9} /> },
  { name: "Customers", icon: <Users size={18} strokeWidth={1.9} /> },
  { name: "Employees", icon: <UserCog size={18} strokeWidth={1.9} /> },
  { name: "Suppliers", icon: <Truck size={18} strokeWidth={1.9} /> },
  { name: "Purchases", icon: <ClipboardList size={18} strokeWidth={1.9} /> },
  { name: "Sales", icon: <Receipt size={18} strokeWidth={1.9} /> },
  { name: "Quotations", icon: <FileText size={18} strokeWidth={1.9} /> },
  { name: "Invoices", icon: <FileSpreadsheet size={18} strokeWidth={1.9} /> },
  { name: "Expenses", icon: <Wallet size={18} strokeWidth={1.9} /> },
  { name: "Shifts", icon: <Clock size={18} strokeWidth={1.9} /> },
  { name: "Branches", icon: <Store size={18} strokeWidth={1.9} /> },
  { name: "M-PESA Statement", icon: <Radio size={18} strokeWidth={1.9} /> },
  { name: "Reports", icon: <BarChart3 size={18} strokeWidth={1.9} /> },
  { name: "Settings", icon: <Settings size={18} strokeWidth={1.9} /> },
];

type DashboardData = {
  permissions?: string[];
  modules?: string[];
  timeZone: string;
  sales: { today: { count: number; revenue: number }; thisMonth: { count: number; revenue: number }; allTime: { count: number; revenue: number } } | null;
  receivables: { outstanding: number; unpaidSales: number } | null;
  payables: { outstanding: number; unpaidPurchases: number } | null;
  stock: {
    productCount: number; units: number; value: number; lowStockCount: number;
    lowStock: { id: string; name: string; sku: string | null; unitOfMeasure: string; stockQuantity: number; minimumStock: number }[];
  } | null;
  charts: Record<"week" | "month" | "year", { label: string; total: number }[]> | null;
  performance: { id: string; name: string; email: string; salesCount: number; revenue: number; collected: number; outstanding: number }[] | null;
  recentSales: { id: string; receiptNumber: string; customerName: string | null; saleDate: string; total: number; paymentStatus: string; status: string }[] | null;
};


function App() {
  // A link like /#employees/12 opens that employee's profile directly.
  // Sales left on this device (closed tab, lost connection) are sent as soon as the app is open again.
  useEffect(() => { void flushOutbox(); }, []);

  const [activePage, setActivePage] = useState(() => (/^#employees\/\d+$/.test(window.location.hash) ? "Employees" : "Dashboard"));
  const [menuOpen, setMenuOpen] = useState(false); // phone/tablet: the sidebar is a slide-in drawer
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



  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  // The server computes every figure (exact money, in the business's own time zone).
  const chartData = useMemo(() => {
    const key = period === "This year" ? "year" : period === "This month" ? "month" : "week";
    const series = dashboard?.charts?.[key] ?? [];
    const maximum = Math.max(...series.map((item) => item.total), 0);
    return series.map((item) => ({
      day: item.label,
      total: item.total,
      value: maximum > 0 ? (item.total / maximum) * 100 : 0,
    }));
  }, [dashboard, period]);

  const chartMaximum = Math.max(...chartData.map((item) => item.total), 1);
  const chartAxisLabels = [1, 0.75, 0.5, 0.25, 0].map((fraction) =>
    new Intl.NumberFormat("en-KE", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(chartMaximum * fraction)
  );
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
        const response = await apiRequest<DashboardData>("/dashboard", { token, businessId });

        if (!cancelled) {
          storePermissions(response.data?.permissions);
          storeModules(response.data?.modules);
          syncOfflineSignin(); // keep this PC's PIN sign-in in step with the role the server just reported
          setDashboard(response.data ?? null);
          setDashboardError("");
        }
      } catch (error) {
        // The owner closed this person's access to the business: a PIN for it must not stay on this PC.
        if (error instanceof ApiError && error.status === 403 && /access to this business|suspended|not approved|waiting for approval/i.test(error.message)) {
          const who = sessionStorage.getItem("pos_user_id");
          if (who && businessId) removeEntry(who, businessId);
        }
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

  const recentSales = useMemo(() => dashboard?.recentSales ?? [], [dashboard]);
  const filteredTransactions = useMemo(
    () =>
      recentSales.filter((sale) =>
        `${sale.receiptNumber} ${sale.customerName || "Walk-in customer"} ${sale.paymentStatus}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [recentSales, search]
  );

  const totalRevenue = dashboard?.sales?.allTime.revenue ?? 0;
  const totalOrders = dashboard?.sales?.allTime.count ?? 0;
  const totalOutstanding = dashboard?.receivables?.outstanding ?? 0;
  const unpaidSales = dashboard?.receivables?.unpaidSales ?? 0;
  const salespersonPerformance = useMemo(() => dashboard?.performance ?? [], [dashboard]);
  const stockUnits = dashboard?.stock?.units ?? 0;
  const lowStockProducts = dashboard?.stock?.lowStock ?? [];
  const lowStockCount = dashboard?.stock?.lowStockCount ?? 0;
  const businessTimeZone = dashboard?.timeZone ?? "Africa/Nairobi";

  async function signOut() {
    // Sales still on this device would be lost (or sent under someone else's name) if the session ended now.
    if (unsyncedCount() > 0) {
      notify.error("Some sales haven't been sent to the server yet. Wait for them to sync (or discard them) before signing out.");
      return;
    }
    try {
      await apiRequest("/auth/logout", { method: "POST" }); // clears the session cookie
    } catch {
      /* offline: the cookie still expires on its own */
    }
    clearOfflineCache();
    forgetOfflineUser(sessionStorage.getItem("pos_user_id")); // signing out turns offline PIN sign-in off on this PC
    try {
      sessionStorage.clear();
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("menu-locked");
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("menu-locked"); };
  }, [menuOpen]);

  function selectPage(name: string) {
    setMenuOpen(false);
    setActivePage(name);
    setNotice("");
  }

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} id="main-menu" aria-label="Main menu">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="brand-name">nexa<span>POS</span></div>
            <div className="brand-caption">BUSINESS MANAGEMENT</div>
          </div>
        </div>

        <div className="workspace-label">Workspace</div>
        <BusinessSwitcher />
        <BranchSwitcher />

        <div className="nav-label">Main menu</div>
        <nav className="navigation">
          {navigation.filter((item) => (!navigationModules[item.name] || hasModule(navigationModules[item.name]!)) && (!navigationPermissions[item.name] || can(...navigationPermissions[item.name]!))).map((item) => (
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
          <div className="profile">
            <div className="profile-avatar">{userInitials}</div>
            <div className="profile-info">
              <strong>{currentUserName}</strong>
              <small>{`${currentBusinessRole} · ${currentBusinessName}`}</small>
            </div>
            <button className="profile-menu" onClick={signOut} title="Sign out" aria-label="Sign out">Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <OfflineBanner />
        <header className="topbar">
          <button type="button" className="menu-button" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="main-menu" onClick={() => setMenuOpen((o) => !o)}>
            <span /><span /><span />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span><span className="crumb-separator">/</span><strong>{activePage}</strong>
          </div>
          <div className="topbar-actions">
            <SyncBadge />
            <button type="button" className="topbar-signout" onClick={signOut}>Sign out</button>
            <div className="system-status"><span style={dashboardError ? { background: "#d9534f" } : undefined}></span> {dashboardError ? "Connection problem" : "Connected"}</div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => (lowStockCount > 0 ? notify.info(`${lowStockCount} product${lowStockCount === 1 ? "" : "s"} need restocking.`) : notify.success("Nothing needs restocking."))}><Bell size={17} /></button>
            <div className="topbar-avatar">{userInitials}</div>
          </div>
        </header>

        <div className="page-content">
          <section className={`welcome-row ${activePage === "Dashboard" ? "" : "welcome-row-compact"}`}>
            <div>
              <div className="eyebrow">{new Date().toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
              <h1>{activePage === "Dashboard" ? `Welcome, ${currentUserName}` : activePage}</h1>
              {activePage === "Dashboard" && <p className="subtitle">Here's what's happening with your business today.</p>}
            </div>
                        {activePage === "Dashboard" && (
              <div className="welcome-actions">
                {can("reports.view") && (
                  <button className="button-secondary" onClick={() => selectPage("Reports")}><span>Reports</span></button>
                )}
                {can("sales.create") && (
                  <button className="button-primary" onClick={() => selectPage("Point of Sale")}><span>New sale</span></button>
                )}
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
          ) : activePage === "Quotations" ? (
            <QuotationsWorkspace />
          ) : activePage === "Invoices" ? (
            <InvoicesWorkspace />
          ) : activePage === "Expenses" ? (
            <ExpensesWorkspace />
          ) : activePage === "Shifts" ? (
            <ShiftsWorkspace />
          ) : activePage === "Tables & Orders" ? (
            <HotelWorkspace />
          ) : activePage === "Rooms" ? (
            <RoomsWorkspace />
          ) : activePage === "Branches" ? (
            <BranchesWorkspace />
          ) : activePage === "M-PESA Statement" ? (
            <div className="settings-workspace"><MpesaStatementWorkspace /></div>
          ) : activePage === "Reports" ? (
            <ReportsWorkspace />
          ) : activePage === "Settings" ? (
            <>
              <BusinessSettingsWorkspace />
              <div className="settings-workspace"><IntegrationsWorkspace /></div>
              <ChangePasswordPanel />
              <OfflineSigninPanel />
            </>
          ) : (
            <>
          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-top"><span>Total revenue</span><span className="metric-icon green"><Banknote size={17} /></span></div>
              <div className="metric-value">{money(totalRevenue)}</div>
              <div className="metric-foot"><span className="neutral-tag">Today {money(dashboard?.sales?.today.revenue ?? 0)}</span><span>{dashboard?.sales?.today.count ?? 0} sales</span></div>
              <div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Total orders</span><span className="metric-icon blue"><ShoppingBag size={17} /></span></div>
              <div className="metric-value">{totalOrders.toLocaleString("en-KE")}</div>
              <div className="metric-foot"><span className="neutral-tag">This month {dashboard?.sales?.thisMonth.count ?? 0}</span><span>completed sales</span></div>
              <div className="metric-line blue-line"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Products in stock</span><span className="metric-icon purple"><Package size={17} /></span></div>
              <div className="metric-value">{stockUnits.toLocaleString("en-KE")}</div>
              <div className="metric-foot"><span className="trend negative">{lowStockCount} low stock</span><span>items need attention</span></div>
              <div className="stock-progress"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Outstanding payments</span><span className="metric-icon orange"><AlertTriangle size={17} /></span></div>
              <div className="metric-value">{money(totalOutstanding)}</div>
              <div className="metric-foot"><span className="neutral-tag">{unpaidSales} unpaid sales</span><span>awaiting payment</span></div>
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
                <span className="alert-count">{lowStockCount}</span>
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
                    <strong>{item.stockQuantity.toLocaleString("en-KE")}</strong>
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
                    <th>Salesperson</th>
                    <th>Sales</th>
                    <th>Revenue</th>
                    <th>Collected</th>
                    <th>Outstanding</th>
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
                <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Payment</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredTransactions.map((item) => (
                    <tr key={item.id}>
                      <td><strong className="invoice-id">{item.receiptNumber}</strong></td>
                      <td><div className="customer-cell"><span className="customer-avatar">{(item.customerName || "Walk-in").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{item.customerName || "Walk-in customer"}</div></td>
                      <td className="date-cell">{new Date(item.saleDate).toLocaleString("en-KE", { timeZone: businessTimeZone })}</td>
                      <td><span className="payment-method">{item.paymentStatus}</span></td>
                      <td><strong>{money(item.total)}</strong></td>
                      <td><span className={`status ${(item.status || "recorded").toLowerCase()}`}><i />{item.status}</span></td>
                    </tr>
                  ))}
                  {filteredTransactions.length === 0 && <tr><td colSpan={6} className="empty-row">No transactions match your search.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing {filteredTransactions.length} of the latest {recentSales.length} sales</span><span className="demo-note">Live business data</span></div>
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
