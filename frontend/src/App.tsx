import { useMemo, useState } from "react";
import "./App.css";

const navigation = [
  { name: "Dashboard", icon: "◫" },
  { name: "Point of Sale", icon: "▣" },
  { name: "Products", icon: "▦" },
  { name: "Inventory", icon: "▤" },
  { name: "Customers", icon: "♙" },
  { name: "Suppliers", icon: "⇄" },
  { name: "Purchases", icon: "↓" },
  { name: "Sales", icon: "↗" },
  { name: "Expenses", icon: "◉" },
  { name: "Reports", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];

const transactions = [
  { id: "INV-1048", customer: "Grace Wanjiku", date: "Today, 10:24 AM", method: "M-Pesa", amount: 12500, status: "Completed" },
  { id: "INV-1047", customer: "David Kamau", date: "Today, 09:52 AM", method: "Cash", amount: 8400, status: "Completed" },
  { id: "INV-1046", customer: "Mary Njeri", date: "Today, 09:15 AM", method: "Card", amount: 15750, status: "Pending" },
  { id: "INV-1045", customer: "Peter Mwangi", date: "Today, 08:41 AM", method: "M-Pesa", amount: 6200, status: "Completed" },
  { id: "INV-1044", customer: "Ann Wambui", date: "Yesterday", method: "Cash", amount: 9800, status: "Completed" },
];

const inventory = [
  { name: "Premium Timber", category: "Building materials", stock: 4, unit: "pieces" },
  { name: "Wood Screws", category: "Hardware", stock: 8, unit: "boxes" },
  { name: "Interior Paint", category: "Paint & finishes", stock: 3, unit: "cans" },
  { name: "Plywood Sheets", category: "Building materials", stock: 6, unit: "sheets" },
];

const chartData = [
  { day: "Mon", value: 42 },
  { day: "Tue", value: 67 },
  { day: "Wed", value: 53 },
  { day: "Thu", value: 82 },
  { day: "Fri", value: 61 },
  { day: "Sat", value: 94 },
  { day: "Sun", value: 72 },
];

const money = (amount: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("This week");
  const [notice, setNotice] = useState("");

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) =>
        `${transaction.id} ${transaction.customer} ${transaction.method}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [search]
  );

  function selectPage(name: string) {
    setActivePage(name);
    if (name !== "Dashboard") {
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
            <strong>Sample Business</strong>
            <small>Retail workspace</small>
          </span>
          <span className="chevron">⌄</span>
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
            <div className="help-icon">✦</div>
            <strong>Need a hand?</strong>
            <p>Your business tools, all in one place.</p>
            <button onClick={() => setNotice("Help centre selected.")}>Visit help centre ↗</button>
          </div>
          <div className="profile">
            <div className="profile-avatar">SW</div>
            <div className="profile-info">
              <strong>Store Admin</strong>
              <small>Administrator</small>
            </div>
            <button className="profile-menu" onClick={() => setNotice("Account settings selected.")}>•••</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span><span className="crumb-separator">/</span><strong>{activePage}</strong>
          </div>
          <div className="topbar-actions">
            <div className="system-status"><span></span> Demo mode</div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You have 4 sample low-stock alerts.")}>♧<i></i></button>
            <div className="topbar-avatar">SW</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">SUNDAY, OCTOBER 11, 2026</div>
              <h1>{activePage === "Dashboard" ? "Good morning, Stephen" : activePage}</h1>
              <p className="subtitle">
                {activePage === "Dashboard"
                  ? "Here's what's happening with your business today."
                  : `Manage your ${activePage.toLowerCase()} from one place.`}
              </p>
            </div>
            <div className="welcome-actions">
              <button className="button-secondary" onClick={() => setNotice("Report export will be connected to live business data.")}>↓ <span>Export report</span></button>
              <button className="button-primary" onClick={() => selectPage("Point of Sale")}>＋ <span>New sale</span></button>
            </div>
          </section>

          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
            </div>
          )}

          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-top"><span>Total revenue</span><span className="metric-icon green">↗</span></div>
              <div className="metric-value">KES 248,650</div>
              <div className="metric-foot"><span className="trend positive">↑ 12.8%</span><span>vs. last week</span></div>
              <div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Total orders</span><span className="metric-icon blue">▣</span></div>
              <div className="metric-value">184</div>
              <div className="metric-foot"><span className="trend positive">↑ 8.2%</span><span>vs. last week</span></div>
              <div className="metric-line blue-line"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Products in stock</span><span className="metric-icon purple">▦</span></div>
              <div className="metric-value">1,284</div>
              <div className="metric-foot"><span className="trend negative">4 low stock</span><span>items need attention</span></div>
              <div className="stock-progress"><i /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Outstanding payments</span><span className="metric-icon orange">◷</span></div>
              <div className="metric-value">KES 32,400</div>
              <div className="metric-foot"><span className="neutral-tag">12 invoices</span><span>awaiting payment</span></div>
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
                <div><span className="muted-label">TOTAL SALES</span><strong>KES 248,650</strong></div>
                <div className="chart-legend"><span></span> Revenue</div>
              </div>
              <div className="chart">
                <div className="y-labels"><span>100k</span><span>75k</span><span>50k</span><span>25k</span><span>0</span></div>
                <div className="chart-plot">
                  <div className="chart-grid-lines"><i /><i /><i /><i /><i /></div>
                  <div className="bars">
                    {chartData.map((item) => (
                      <div className="bar-column" key={item.day}>
                        <div className="bar-track"><div className={`bar ${item.day === "Sat" ? "highlight" : ""}`} style={{ height: `${period === "This month" ? Math.min(100, item.value + 5) : period === "This year" ? Math.max(20, item.value - 8) : item.value}%` }} /></div>
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
                <span className="alert-count">4</span>
              </div>
              <div className="stock-list">
                {inventory.map((item) => (
                  <div className="stock-item" key={item.name}>
                    <div className="product-symbol">▦</div>
                    <div className="stock-product"><strong>{item.name}</strong><small>{item.category}</small></div>
                    <div className="stock-quantity"><strong>{item.stock}</strong><small>{item.unit} left</small></div>
                  </div>
                ))}
              </div>
              <button className="text-link" onClick={() => selectPage("Inventory")}>View all inventory <span>→</span></button>
            </article>
          </section>

          <section className="panel transactions-panel">
            <div className="panel-heading transaction-heading">
              <div><h2>Recent transactions</h2><p>A quick look at your latest sales</p></div>
              <div className="transaction-actions">
                <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions..." /></label>
                <button className="button-secondary view-all" onClick={() => selectPage("Sales")}>View all <span>→</span></button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>PAYMENT METHOD</th><th>AMOUNT</th><th>STATUS</th></tr></thead>
                <tbody>
                  {filteredTransactions.map((item) => (
                    <tr key={item.id}>
                      <td><strong className="invoice-id">{item.id}</strong></td>
                      <td><div className="customer-cell"><span className="customer-avatar">{item.customer.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{item.customer}</div></td>
                      <td className="date-cell">{item.date}</td>
                      <td><span className="payment-method">{item.method}</span></td>
                      <td><strong>{money(item.amount)}</strong></td>
                      <td><span className={`status ${item.status.toLowerCase()}`}><i />{item.status}</span></td>
                    </tr>
                  ))}
                  {filteredTransactions.length === 0 && <tr><td colSpan={6} className="empty-row">No transactions match your search.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing {filteredTransactions.length} of {transactions.length} sample transactions</span><span className="demo-note">Demo data · Not connected to database</span></div>
          </section>

          <footer className="footer"><span>© 2026 nexaPOS</span><span>Built for growing businesses <b>●</b></span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
