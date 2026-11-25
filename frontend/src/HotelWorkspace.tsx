import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Plus, Send, Trash2, UtensilsCrossed } from "lucide-react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import { notify } from "./toast";
import { money } from "./money";
import { mpesaCodeError, normalizeMpesaCode } from "./mpesa";
import ReceiptModal, { type ReceiptData } from "./ReceiptModal";
import "./hotel.css";

type TableRow = { id: string; name: string; seats: number | null; openOrder: null | { id: string; guestName: string | null; covers: number | null; openedAt: string; itemCount: number; runningTotal: string } };
type MenuItem = { id: string; name: string; description: string | null; price: string; available: boolean; madeToOrder: boolean; unit: string; category: string };
type Addon = { id: string; name: string; price: string };
type OrderItem = { id: string; name: string; addons: { name: string; price: string }[]; unitPrice: string; quantity: string; note: string | null; sentAt: string | null; voidedAt: string | null; voidReason: string | null; lineTotal: string; billedReceipt: string | null };
type Order = { id: string; status: string; tableName: string; guestName: string | null; covers: number | null; openedAt: string; runningTotal: string; serviceChargeRate: string; cateringLevyRate: string; serviceCharge: string; cateringLevy: string; estimatedTotal: string; items: OrderItem[] };
type InHouse = { id: string; roomName: string; guestName: string; guestPhone: string | null; creditLimit: string; owed: string };
type Sale = { id: string; receiptNumber: string; subtotal: string; discount: string; tax: string; total: string; amountPaid: string; balanceDue: string; pricesIncludeVat: boolean };

const tok = () => sessionStorage.getItem("pos_token") ?? "";
const biz = () => sessionStorage.getItem("pos_business_id") ?? "";
async function call<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown) {
  const r = await apiRequest<T>(`/hotel${path}`, { method, token: tok(), businessId: biz(), ...(body !== undefined && { body }) });
  return r.data as T;
}
const fail = (e: unknown) => notify.error(e instanceof Error ? e.message : "Something went wrong.");

/**
 * Tables and open orders for hotels and restaurants. Nothing is sold or taken from stock until the table is billed;
 * billing creates an ordinary sale (same receipt, VAT, payments and reports as the till).
 */
export default function HotelWorkspace() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [newTable, setNewTable] = useState({ name: "", seats: "" });
  const [guest, setGuest] = useState({ name: "", covers: "" });
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState(false);
  const [method, setMethod] = useState("cash");
  const [chosen, setChosen] = useState<string[]>([]); // lines included in this bill (split bill)
  const [code, setCode] = useState("");
  const [guests, setGuests] = useState<InHouse[]>([]); // in-house guests this bill can be charged to
  const [stayId, setStayId] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [picked, setPicked] = useState<string[]>([]); // add-ons for the next dish tapped
  const [lineNote, setLineNote] = useState("");
  const [rates, setRates] = useState({ serviceChargeRate: "0.00", cateringLevyRate: "0.00" });
  const [rateForm, setRateForm] = useState({ service: "", levy: "" });
  const [newAddon, setNewAddon] = useState({ name: "", price: "" });
  const [ticket, setTicket] = useState<{ table: string; at: string; lines: { name: string; quantity: string; note: string | null; addons: string[] }[] } | null>(null);

  const loadTables = useCallback(async () => {
    try { setTables(await call<TableRow[]>("/tables")); } catch (e) { fail(e); } finally { setLoading(false); }
  }, []);
  const loadExtras = useCallback(async () => {
    try {
      setAddons(await call<Addon[]>("/addons"));
      const r = await call<{ serviceChargeRate: string; cateringLevyRate: string }>("/settings");
      setRates(r); setRateForm({ service: r.serviceChargeRate, levy: r.cateringLevyRate });
    } catch (e) { fail(e); }
  }, []);
  useEffect(() => { void loadTables(); void loadExtras(); void call<MenuItem[]>("/menu").then(setMenu).catch(fail); }, [loadTables, loadExtras]);

  const categories = useMemo(() => ["All", ...Array.from(new Set(menu.map((m) => m.category))).sort()], [menu]);
  const shown = menu.filter((m) => (cat === "All" || m.category === cat) && (!search.trim() || m.name.toLowerCase().includes(search.trim().toLowerCase())));
  const table = tables.find((t) => t.id === tableId) ?? null;
  const live = order?.items.filter((i) => !i.voidedAt && !i.billedReceipt) ?? [];
  const unsent = live.filter((i) => !i.sentAt).length;

  async function pick(t: TableRow) {
    setTableId(t.id); setBilling(false); setOrder(null);
    if (t.openOrder) { try { setOrder(await call<Order>(`/orders/${t.openOrder.id}`)); } catch (e) { fail(e); } }
  }
  async function run<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    setBusy(true);
    try { const r = await fn(); then?.(r); await loadTables(); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const addTable = () => run(
    () => call("/tables", "POST", { name: newTable.name, ...(newTable.seats && { seats: Number(newTable.seats) }) }),
    () => { setNewTable({ name: "", seats: "" }); notify.success("Table added."); }
  );
  const removeTable = (t: TableRow) => { if (!window.confirm(`Remove ${t.name}?`)) return; void run(() => call(`/tables/${t.id}`, "DELETE"), () => { if (tableId === t.id) { setTableId(null); setOrder(null); } }); };
  const openOrder = () => table && run(() => call<Order>(`/tables/${table.id}/orders`, "POST", { guestName: guest.name, ...(guest.covers && { covers: Number(guest.covers) }) }), (o) => { setOrder(o); setGuest({ name: "", covers: "" }); });
  const add = (m: MenuItem) => order && run(
    () => call<Order>(`/orders/${order.id}/items`, "POST", { productId: m.id, quantity: 1, ...(picked.length && { addonIds: picked }), ...(lineNote.trim() && { note: lineNote.trim() }) }),
    (o) => { setOrder(o); setPicked([]); setLineNote(""); }
  );
  const more = (i: OrderItem, d: number) => {
    if (!order || i.sentAt) return; // sent lines are removed with a reason instead
    const q = Number(i.quantity) + d;
    if (q < 1) return;
    void run(() => call<Order>(`/orders/${order.id}/items/${i.id}`, "PUT", { quantity: q }), setOrder);
  };
  const saveRates = () => run(
    () => call("/settings", "PUT", { serviceChargeRate: rateForm.service === "" ? 0 : Number(rateForm.service), cateringLevyRate: rateForm.levy === "" ? 0 : Number(rateForm.levy) }),
    () => { notify.success("Charges saved. They apply to bills from now on."); void loadExtras(); }
  );
  const saveAddon = () => run(
    () => call("/addons", "POST", { name: newAddon.name, price: newAddon.price === "" ? 0 : Number(newAddon.price) }),
    () => { setNewAddon({ name: "", price: "" }); void loadExtras(); }
  );
  const dropAddon = (a: Addon) => { if (window.confirm(`Remove the add-on "${a.name}"? Open bills keep it.`)) void run(() => call(`/addons/${a.id}`, "DELETE"), () => { setPicked((p) => p.filter((x) => x !== a.id)); void loadExtras(); }); };
  const remove = (i: OrderItem) => {
    if (!order) return;
    let reason = "";
    if (i.sentAt) { reason = window.prompt(`${i.name} was already sent to the kitchen. Why is it being removed?`) ?? ""; if (reason.trim().length < 3) return; }
    void run(() => call<Order>(`/orders/${order.id}/items/${i.id}`, "DELETE", { reason }), setOrder);
  };
  const send = () => order && run(() => call<{ order: Order; sent: { name: string; quantity: string; note: string | null; addons: string[] }[]; sentAt: string }>(`/orders/${order.id}/send`, "POST", {}), (r) => {
    setOrder(r.order); setTicket({ table: r.order.tableName, at: r.sentAt, lines: r.sent });
  });
  const cancel = () => {
    if (!order) return;
    const sent = live.some((i) => i.sentAt);
    const reason = sent ? window.prompt("Some items were already sent to the kitchen. Why is this order being cancelled?") ?? "" : "";
    if (sent && reason.trim().length < 3) return;
    if (!sent && !window.confirm("Cancel this order?")) return;
    void run(() => call<Order>(`/orders/${order.id}/cancel`, "POST", { reason }), () => { setOrder(null); notify.success("Order cancelled."); });
  };
  const cents = (v: string | number) => Math.round(Number(v) * 100);
  const pctOf = (base: number, rate: string) => Math.round((base * Math.round(Number(rate) * 100)) / 10000);
  const toRoom = method === "room";
  useEffect(() => {
    if (!billing || !can("hotel.charge_room")) return;
    call<InHouse[]>("/stays/charge-targets").then(setGuests).catch(fail);
  }, [billing]);
  function bill() {
    if (!order) return;
    if (toRoom && !stayId) { notify.error("Choose the room to charge."); return; }
    const picked = live.filter((i) => chosen.includes(i.id));
    if (picked.length === 0) { notify.error("Choose at least one item to bill."); return; }
    const all = picked.length === live.length;
    if (method === "mpesa") { const p = mpesaCodeError(code); if (p) { notify.error(p); return; } }
    void run(() => call<{ order: Order; sale: Sale; partBill?: boolean }>(`/orders/${order.id}/bill`, "POST", { ...(!all && { itemIds: picked.map((i) => i.id) }), ...(toRoom ? { stayId } : { paymentMethod: method, ...(method === "mpesa" && { paymentReference: normalizeMpesaCode(code) }) }) }), (r) => {
      const s = r.sale;
      const stay = toRoom ? guests.find((g) => g.id === stayId) : undefined;
      const base = picked.reduce((sum, i) => sum + cents(i.lineTotal), 0);
      const service = pctOf(base, r.order.serviceChargeRate) / 100, levy = pctOf(base, r.order.cateringLevyRate) / 100;
      setReceipt({
        receiptNumber: s.receiptNumber, date: new Date(), customerName: stay ? `${stay.guestName} (Room ${stay.roomName})` : null, servedBy: sessionStorage.getItem("pos_user_name") || null,
        items: [
          ...picked.map((i) => ({
            name: i.addons.length ? `${i.name} (+ ${i.addons.map((a) => a.name).join(", ")})` : i.name,
            quantity: Number(i.quantity), unitPrice: Number(i.lineTotal) / Number(i.quantity), total: Number(i.lineTotal),
          })),
          ...(service > 0 ? [{ name: `Service charge (${Number(r.order.serviceChargeRate)}%)`, quantity: 1, unitPrice: service, total: service }] : []),
          ...(levy > 0 ? [{ name: `Catering levy (${Number(r.order.cateringLevyRate)}%)`, quantity: 1, unitPrice: levy, total: levy }] : []),
        ],
        subtotal: Number(s.subtotal), discount: Number(s.discount), tax: Number(s.tax), pricesIncludeVat: s.pricesIncludeVat, total: Number(s.total),
        amountPaid: Number(s.amountPaid), balanceDue: Number(s.balanceDue), paymentMethod: toRoom ? "charged to room" : method, paymentReference: method === "mpesa" ? normalizeMpesaCode(code) : null,
        notes: `${stay ? `Room ${stay.roomName} · ` : ""}${r.order.tableName}${r.order.guestName ? ` · ${r.order.guestName}` : ""}${r.order.status === "billed" ? "" : " (part bill)"}`,
      });
      setCode(""); setStayId(""); setMethod("cash"); setBilling(false); setChosen([]);
      if (r.order.status === "billed") { setOrder(null); setTableId(null); } else { setOrder(r.order); notify.success("Part bill paid. The rest of the table is still open."); }
    });
  }

  return (
    <div className="hotel">
      <section className="inventory-panel">
        <h2><UtensilsCrossed size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Tables</h2>
        <p className="inventory-muted">Pick a table to take or review its order. Nothing is sold until you bill it.</p>
        <div className="hotel-tables">
          {tables.map((t) => (
            <button type="button" key={t.id} className={`hotel-table${t.openOrder ? " busy" : ""}${tableId === t.id ? " active" : ""}`} onClick={() => void pick(t)}>
              <strong>{t.name}</strong>
              <span>{t.openOrder ? `${t.openOrder.guestName || "Guest"} · ${money(Number(t.openOrder.runningTotal))}` : `Free${t.seats ? ` · ${t.seats} seats` : ""}`}</span>
            </button>
          ))}
          {!loading && tables.length === 0 && <p className="inventory-muted">No tables yet.{can("products.manage") ? " Add your first one below." : " Ask a manager to add tables."}</p>}
        </div>
        {can("products.manage") && (
          <div className="hotel-row" style={{ marginTop: 14 }}>
            <input className="inventory-search" placeholder="New table or room name (e.g. T1, Room 12)" value={newTable.name} maxLength={60} onChange={(e) => setNewTable({ ...newTable, name: e.target.value })} />
            <input className="inventory-search" style={{ maxWidth: 110 }} placeholder="Seats" inputMode="numeric" value={newTable.seats} onChange={(e) => setNewTable({ ...newTable, seats: e.target.value.replace(/\D/g, "") })} />
            <button type="button" className="pos-secondary-button" disabled={busy || !newTable.name.trim()} onClick={() => void addTable()}><Plus size={14} /> Add</button>
            {table && !table.openOrder && <button type="button" className="pos-secondary-button" onClick={() => removeTable(table)}>Remove {table.name}</button>}
          </div>
        )}
      </section>

      {table && !order && (
        <section className="inventory-panel">
          <h2>{table.name}</h2>
          <p className="inventory-muted">This table has no open order.</p>
          <div className="hotel-row">
            <input className="inventory-search" placeholder="Guest name (optional)" maxLength={100} value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
            <input className="inventory-search" style={{ maxWidth: 110 }} placeholder="Guests" inputMode="numeric" value={guest.covers} onChange={(e) => setGuest({ ...guest, covers: e.target.value.replace(/\D/g, "") })} />
            <button type="button" className="pos-primary-button" disabled={busy} onClick={() => void openOrder()}>Open order</button>
          </div>
        </section>
      )}

      {order && (
        <div className="hotel-order">
          <section className="inventory-panel">
            <h2>Menu</h2>
            <div className="hotel-row">
              <input className="inventory-search" placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {addons.length > 0 && (
              <div className="hotel-addons" aria-label="Add-ons for the next item">
                <span className="inventory-muted" style={{ margin: 0 }}>Add-ons for the next item:</span>
                {addons.map((a) => (
                  <button type="button" key={a.id} className={`hotel-cat${picked.includes(a.id) ? " active" : ""}`} onClick={() => setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))}>
                    {a.name}{Number(a.price) > 0 ? ` +${money(Number(a.price))}` : ""}
                  </button>
                ))}
              </div>
            )}
            <div className="hotel-row" style={{ marginTop: 8 }}>
              <input className="inventory-search" placeholder="Note for the kitchen on the next item (e.g. no onions)" maxLength={200} value={lineNote} onChange={(e) => setLineNote(e.target.value)} />
            </div>
            <div className="hotel-cats">
              {categories.map((c) => <button type="button" key={c} className={`hotel-cat${cat === c ? " active" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>
            <div className="hotel-menu">
              {shown.map((m) => (
                <button type="button" key={m.id} className="hotel-item" disabled={!m.available || busy} onClick={() => void add(m)}>
                  <strong>{m.name}</strong>
                  <span>{money(Number(m.price))}{!m.available ? " · Sold out" : ""}</span>
                </button>
              ))}
              {menu.length === 0 && <p className="inventory-muted">No menu items yet. Add meals under Products (tick "Made to order" so they don't need stock).</p>}
            </div>
          </section>

          <section className="inventory-panel">
            <h2>{order.tableName}{order.guestName ? ` · ${order.guestName}` : ""}</h2>
            <p className="inventory-muted">{order.covers ? `${order.covers} guests · ` : ""}opened {new Date(order.openedAt).toLocaleTimeString("en-KE", { timeStyle: "short" })}</p>
            {live.length === 0 && <p className="inventory-muted">Tap menu items to add them.</p>}
            <ul className="hotel-lines">
              {order.items.map((i) => (
                <li key={i.id} className={i.voidedAt ? "void" : ""}>
                  <div>
                    <strong>{Number(i.quantity)} × {i.name}</strong>
                    {i.addons.length > 0 && <div className="inventory-muted" style={{ margin: 0 }}>+ {i.addons.map((a) => a.name).join(", ")}</div>}
                    <div className="inventory-muted" style={{ margin: 0 }}>{i.voidedAt ? `Removed: ${i.voidReason}` : i.billedReceipt ? `Paid · receipt ${i.billedReceipt}` : i.sentAt ? "Sent to kitchen" : "Not sent yet"}{i.note ? ` · ${i.note}` : ""}</div>
                  </div>
                  <div className="hotel-line-right">
                    <span>{money(Number(i.lineTotal))}</span>
                    {!i.voidedAt && !i.billedReceipt && (
                      <>
                        {!i.sentAt && <button type="button" aria-label="One less" className="pos-secondary-button" disabled={busy || Number(i.quantity) <= 1} onClick={() => more(i, -1)}>−</button>}
                        {!i.sentAt && <button type="button" aria-label="One more" className="pos-secondary-button" disabled={busy} onClick={() => more(i, 1)}>+</button>}
                        <button type="button" aria-label={`Remove ${i.name}`} className="pos-secondary-button" disabled={busy} onClick={() => remove(i)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {(Number(order.serviceCharge) > 0 || Number(order.cateringLevy) > 0) && (
              <>
                <div className="hotel-total hotel-sub"><span>Food &amp; drinks</span><span>{money(Number(order.runningTotal))}</span></div>
                {Number(order.serviceCharge) > 0 && <div className="hotel-total hotel-sub"><span>Service charge ({Number(order.serviceChargeRate)}%)</span><span>{money(Number(order.serviceCharge))}</span></div>}
                {Number(order.cateringLevy) > 0 && <div className="hotel-total hotel-sub"><span>Catering levy ({Number(order.cateringLevyRate)}%)</span><span>{money(Number(order.cateringLevy))}</span></div>}
              </>
            )}
            <div className="hotel-total"><span>Total</span><strong>{money(Number(order.estimatedTotal))}</strong></div>
            <p className="inventory-muted">VAT, if the business charges it, is worked out when you bill.</p>

            {!billing ? (
              <div className="hotel-row">
                <button type="button" className="pos-secondary-button" disabled={busy || unsent === 0} onClick={() => void send()}><Send size={14} /> Send to kitchen{unsent ? ` (${unsent})` : ""}</button>
                <button type="button" className="pos-primary-button" disabled={busy || live.length === 0} onClick={() => { setChosen(live.map((i) => i.id)); setBilling(true); }}>Bill</button>
                <button type="button" className="pos-secondary-button" disabled={busy} onClick={cancel}>Cancel order</button>
              </div>
            ) : (
              <div className="hotel-bill">
                <div>
                  <strong>Include in this bill</strong>
                  <p className="inventory-muted" style={{ margin: "2px 0 6px" }}>Tick one guest's items to bill them on their own receipt; the rest of the table stays open.</p>
                  <ul className="hotel-pick">
                    {live.map((i) => (
                      <li key={i.id}>
                        <label>
                          <input type="checkbox" checked={chosen.includes(i.id)} onChange={() => setChosen((c) => (c.includes(i.id) ? c.filter((x) => x !== i.id) : [...c, i.id]))} />
                          {Number(i.quantity)} × {i.name}{i.addons.length ? ` (+ ${i.addons.map((a) => a.name).join(", ")})` : ""}
                        </label>
                        <span>{money(Number(i.lineTotal))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="hotel-row">
                    <button type="button" className="pos-secondary-button" onClick={() => setChosen(live.map((i) => i.id))}>All</button>
                    <button type="button" className="pos-secondary-button" onClick={() => setChosen([])}>None</button>
                    {(() => {
                      const base = live.filter((i) => chosen.includes(i.id)).reduce((sum, i) => sum + cents(i.lineTotal), 0);
                      const est = base + pctOf(base, order.serviceChargeRate) + pctOf(base, order.cateringLevyRate);
                      return <strong style={{ marginLeft: "auto" }}>This bill: {money(est / 100)}</strong>;
                    })()}
                  </div>
                </div>
                <label className="inventory-field">Paid by
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="cash">Cash</option><option value="mpesa">M-PESA (type the code)</option><option value="card">Card</option>{can("hotel.charge_room") && <option value="room">Charge to room</option>}
                  </select>
                </label>
                {toRoom && (
                  <label className="inventory-field">Room
                    <select value={stayId} onChange={(e) => setStayId(e.target.value)}>
                      <option value="">{guests.length ? "Choose a room…" : "No guests checked in"}</option>
                      {guests.map((g) => <option key={g.id} value={g.id}>Room {g.roomName} · {g.guestName}{Number(g.creditLimit) > 0 ? ` · limit ${money(Number(g.creditLimit))}` : ""}</option>)}
                    </select>
                  </label>
                )}
                {method === "mpesa" && <label className="inventory-field">M-PESA code<input value={code} maxLength={12} placeholder="QGH7XK2LMN" onChange={(e) => setCode(e.target.value)} /></label>}
                <p className="inventory-muted">{toRoom ? "Nothing is paid now. The bill is added to the guest's room account and settled at check-out." : "Bills are paid in full here. For part payment or credit, use the Point of Sale screen."}</p>
                <div className="hotel-row">
                  <button type="button" className="pos-primary-button" disabled={busy} onClick={bill}>{toRoom ? "Charge to room & print slip" : "Confirm payment & print receipt"}{chosen.length < live.length ? " (part bill)" : ""}</button>
                  <button type="button" className="pos-secondary-button" disabled={busy} onClick={() => setBilling(false)}>Back</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {can("products.manage") && (
        <section className="inventory-panel">
          <h2>Menu extras and charges</h2>
          <p className="inventory-muted">Add-ons (extra cheese, a fried egg…) can be tapped before an item is added. Service charge and catering levy are added to each bill at the percentages below; leave them at 0 to charge nothing.</p>
          <div className="hotel-row">
            {can("settings.manage") && (
              <>
                <label className="inventory-field" style={{ maxWidth: 190 }}>Service charge %<input inputMode="decimal" value={rateForm.service} onChange={(e) => setRateForm({ ...rateForm, service: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
                <label className="inventory-field" style={{ maxWidth: 190 }}>Catering levy %<input inputMode="decimal" value={rateForm.levy} onChange={(e) => setRateForm({ ...rateForm, levy: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
                <button type="button" className="pos-secondary-button" disabled={busy || (rateForm.service === rates.serviceChargeRate && rateForm.levy === rates.cateringLevyRate)} onClick={() => void saveRates()}>Save charges</button>
              </>
            )}
          </div>
          <div className="hotel-row" style={{ marginTop: 14 }}>
            <input className="inventory-search" placeholder="New add-on (e.g. Extra cheese)" maxLength={80} value={newAddon.name} onChange={(e) => setNewAddon({ ...newAddon, name: e.target.value })} />
            <input className="inventory-search" style={{ maxWidth: 130 }} placeholder="Price" inputMode="decimal" value={newAddon.price} onChange={(e) => setNewAddon({ ...newAddon, price: e.target.value.replace(/[^0-9.]/g, "") })} />
            <button type="button" className="pos-secondary-button" disabled={busy || !newAddon.name.trim()} onClick={() => void saveAddon()}><Plus size={14} /> Add</button>
          </div>
          <div className="hotel-addons" style={{ marginTop: 10 }}>
            {addons.map((a) => <span key={a.id} className="hotel-cat">{a.name} · {money(Number(a.price))} <button type="button" aria-label={`Remove ${a.name}`} onClick={() => dropAddon(a)} style={{ border: 0, background: "none", cursor: "pointer" }}>×</button></span>)}
            {addons.length === 0 && <span className="inventory-muted">No add-ons yet.</span>}
          </div>
        </section>
      )}

      {ticket && (
        <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Kitchen order">
          <div className="sale-detail-dialog" style={{ maxWidth: 380 }}>
            <div className="sale-receipt-print-area">
              <h2 style={{ margin: 0 }}>KITCHEN ORDER</h2>
              <p><strong>{ticket.table}</strong> · {new Date(ticket.at).toLocaleTimeString("en-KE", { timeStyle: "short" })}</p>
              <ul style={{ listStyle: "none", padding: 0, fontSize: 18 }}>
                {ticket.lines.map((l, i) => <li key={i}>{Number(l.quantity)} × {l.name}{l.addons.length ? ` (+ ${l.addons.join(", ")})` : ""}{l.note ? <em> — {l.note}</em> : null}</li>)}
              </ul>
            </div>
            <div className="hotel-row no-print">
              <button type="button" className="pos-primary-button" onClick={() => window.print()}><Printer size={14} /> Print</button>
              <button type="button" className="pos-secondary-button" onClick={() => setTicket(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
