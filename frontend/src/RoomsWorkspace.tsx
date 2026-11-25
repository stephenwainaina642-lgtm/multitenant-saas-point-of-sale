import { useCallback, useEffect, useState } from "react";
import { BedDouble, LogOut, Printer, X } from "lucide-react";
import { apiRequest } from "./api/client";
import { notify } from "./toast";
import { money } from "./money";
import { mpesaCodeError, normalizeMpesaCode } from "./mpesa";
import Letterhead from "./Letterhead";
import "./hotel.css";

type Row = { id: string; roomName: string; status: string; guestName: string; guestPhone: string | null; creditLimit: string; checkedInAt: string; checkedOutAt: string | null; owed: string };
type Folio = {
  id: string; roomName: string; status: string; creditLimit: string; notes: string | null; checkedInAt: string; checkedOutAt: string | null;
  guest: { id: string; name: string; phone: string | null; email: string | null };
  deposit: { amount: string; method: string | null; reference: string | null; applied: string; refunded: string; available: string; refundMethod: string | null; refundReference: string | null };
  charges: { id: string; receiptNumber: string; saleDate: string; notes: string | null; total: string; paid: string; balanceDue: string }[];
  totals: { charged: string; paid: string; owed: string; creditHeadroom: string | null; dueAtCheckout: string; depositToRefund: string };
  alreadyCheckedOut?: boolean;
};
type Customer = { id: string; name: string; phone: string | null };
type Part = { method: string; amount: string; reference: string };

const tok = () => sessionStorage.getItem("pos_token") ?? "";
const biz = () => sessionStorage.getItem("pos_business_id") ?? "";
async function call<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown) {
  const r = await apiRequest<T>(`/hotel${path}`, { method, token: tok(), businessId: biz(), ...(body !== undefined && { body }) });
  return r.data as T;
}
const fail = (e: unknown) => notify.error(e instanceof Error ? e.message : "Something went wrong.");
const when = (d: string) => new Date(d).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const METHODS = [["cash", "Cash"], ["mpesa", "M-PESA"], ["card", "Card"]] as const;
const blank = { roomName: "", customerId: "", guestName: "", phone: "", email: "", creditLimit: "", notes: "", depositAmount: "", depositMethod: "cash", depositReference: "" };

/**
 * Rooms and guest accounts. A guest is checked in to a room; table bills can be charged to the room (Tables & Orders),
 * and everything owed is paid at check-out, which will not finish until the account is settled in full.
 */
export default function RoomsWorkspace() {
  const [showOut, setShowOut] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState(blank);
  const [parts, setParts] = useState<Part[]>([{ method: "cash", amount: "", reference: "" }]);
  const [refund, setRefund] = useState({ method: "cash", reference: "" });
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSlip, setShowSlip] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await call<Row[]>(`/stays?status=${showOut ? "checked_out" : "in_house"}`)); } catch (e) { fail(e); }
  }, [showOut]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiRequest<Customer[]>("/customers", { token: tok(), businessId: biz() }).then((r) => setCustomers(r.data as Customer[])).catch(() => setCustomers([]));
  }, []);

  async function open(id: string) {
    try {
      const f = await call<Folio>(`/stays/${id}`);
      setFolio(f); setLimit(Number(f.creditLimit) > 0 ? f.creditLimit : "");
      setParts([{ method: "cash", amount: Number(f.totals.dueAtCheckout) > 0 ? f.totals.dueAtCheckout : "", reference: "" }]);
      setRefund({ method: "cash", reference: "" });
    } catch (e) { fail(e); }
  }
  async function run<T>(fn: () => Promise<T>, then: (r: T) => void) {
    if (busy) return;
    setBusy(true);
    try { then(await fn()); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  function checkIn() {
    const dep = Number(form.depositAmount);
    if (!form.roomName.trim()) { notify.error("Enter the room."); return; }
    if (!form.customerId && !form.guestName.trim()) { notify.error("Enter the guest's name or pick an existing customer."); return; }
    if (dep > 0 && form.depositMethod === "mpesa") { const p = mpesaCodeError(form.depositReference); if (p) { notify.error(p); return; } }
    void run(() => call<Folio>("/stays", "POST", {
      roomName: form.roomName,
      ...(form.customerId ? { customerId: form.customerId } : { guestName: form.guestName, phone: form.phone, email: form.email }),
      ...(form.creditLimit && { creditLimit: Number(form.creditLimit) }),
      ...(form.notes && { notes: form.notes }),
      ...(dep > 0 && { deposit: { amount: dep, method: form.depositMethod, ...(form.depositMethod === "mpesa" ? { reference: normalizeMpesaCode(form.depositReference) } : form.depositReference ? { reference: form.depositReference } : {}) } }),
    }), (f) => { notify.success(`Room ${f.roomName} checked in.`); setForm(blank); void load(); setFolio(f); setLimit(f.creditLimit); });
  }

  function saveLimit() {
    if (!folio) return;
    void run(() => call<Folio>(`/stays/${folio.id}`, "PUT", { creditLimit: Number(limit || 0) }), (f) => { setFolio(f); notify.success("Credit limit saved."); void load(); });
  }

  function checkOut() {
    if (!folio) return;
    const due = Number(folio.totals.dueAtCheckout);
    const body = {
      payments: due > 0 ? parts.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), ...(p.reference && { reference: p.method === "mpesa" ? normalizeMpesaCode(p.reference) : p.reference }) })) : [],
      ...(Number(folio.totals.depositToRefund) > 0 && { refundMethod: refund.method, refundReference: refund.reference }),
    };
    const sum = body.payments.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    if (sum !== Math.round(due * 100)) { notify.error(`Payments must add up to exactly ${money(due)} before check-out.`); return; }
    for (const p of parts) if (Number(p.amount) > 0 && p.method === "mpesa") { const e = mpesaCodeError(p.reference); if (e) { notify.error(e); return; } }
    if (!window.confirm(`Check out Room ${folio.roomName}? This closes the stay.`)) return;
    void run(() => call<Folio>(`/stays/${folio.id}/checkout`, "POST", body), (f) => { setFolio(f); notify.success(`Room ${f.roomName} checked out.`); void load(); setShowSlip(true); });
  }

  const inHouse = folio?.status === "in_house";
  const setPart = (i: number, patch: Partial<Part>) => setParts((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="hotel">
      <section className="inventory-panel">
        <div className="hotel-row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}><BedDouble size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{showOut ? "Checked-out stays" : "Guests in house"}</h2>
          <button type="button" className="pos-secondary-button" onClick={() => setShowOut((v) => !v)}>{showOut ? "Show guests in house" : "Show checked-out stays"}</button>
        </div>
        <p className="inventory-muted">Table bills can be charged to a room from Tables &amp; Orders. What a guest owes is paid at check-out.</p>
        {rows.length === 0 ? <p className="inventory-muted">{showOut ? "No checked-out stays yet." : "No guests checked in."}</p> : (
          <div className="hotel-tables">
            {rows.map((r) => (
              <button key={r.id} type="button" className={`hotel-table ${r.status === "in_house" ? "busy" : ""} ${folio?.id === r.id ? "active" : ""}`} onClick={() => void open(r.id)}>
                <strong>Room {r.roomName}</strong>
                <span>{r.guestName}</span>
                <span>{r.status === "in_house" ? `Owes ${money(r.owed)}` : `Out ${r.checkedOutAt ? when(r.checkedOutAt) : ""}`}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {!showOut && (
        <section className="inventory-panel">
          <h2 style={{ marginTop: 0 }}>Check in a guest</h2>
          <div className="hotel-row">
            <label className="inventory-field">Room<input value={form.roomName} maxLength={40} onChange={(e) => setForm({ ...form, roomName: e.target.value })} /></label>
            <label className="inventory-field">Existing customer
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">New guest</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
              </select>
            </label>
            {!form.customerId && <>
              <label className="inventory-field">Guest name<input value={form.guestName} maxLength={255} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></label>
              <label className="inventory-field">Phone<input value={form.phone} maxLength={50} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="inventory-field">Email<input value={form.email} maxLength={255} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            </>}
          </div>
          <div className="hotel-row">
            <label className="inventory-field">Room credit limit (KSh, blank = none)<input inputMode="decimal" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
            <label className="inventory-field">Deposit taken (KSh)<input inputMode="decimal" value={form.depositAmount} onChange={(e) => setForm({ ...form, depositAmount: e.target.value })} /></label>
            {Number(form.depositAmount) > 0 && <>
              <label className="inventory-field">Deposit paid by
                <select value={form.depositMethod} onChange={(e) => setForm({ ...form, depositMethod: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              {form.depositMethod === "mpesa" && <label className="inventory-field">M-PESA code<input maxLength={12} value={form.depositReference} onChange={(e) => setForm({ ...form, depositReference: e.target.value })} /></label>}
            </>}
            <label className="inventory-field">Notes<input value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <button type="button" className="pos-primary-button" disabled={busy} onClick={checkIn}>Check in</button>
        </section>
      )}

      {folio && (
        <section className="inventory-panel">
          <div className="hotel-row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Room {folio.roomName} · {folio.guest.name}</h2>
            <div className="hotel-row">
              <button type="button" className="pos-secondary-button" onClick={() => setShowSlip(true)}><Printer size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Print folio</button>
              <button type="button" className="pos-secondary-button" onClick={() => setFolio(null)}>Close</button>
            </div>
          </div>
          <p className="inventory-muted">Checked in {when(folio.checkedInAt)}{folio.checkedOutAt ? ` · checked out ${when(folio.checkedOutAt)}` : ""}{folio.guest.phone ? ` · ${folio.guest.phone}` : ""}</p>
          {folio.charges.length === 0 ? <p className="inventory-muted">Nothing charged to this room yet.</p> : (
            <ul className="hotel-lines">
              {folio.charges.map((c) => (
                <li key={c.id}>
                  <div><strong>{c.receiptNumber}</strong><div className="inventory-muted" style={{ margin: 0 }}>{when(c.saleDate)}{c.notes ? ` · ${c.notes}` : ""}</div></div>
                  <div className="hotel-line-right"><span>{money(c.total)}</span>{Number(c.balanceDue) > 0 ? <strong>owes {money(c.balanceDue)}</strong> : <span>paid</span>}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="hotel-total"><span>Charged</span><strong>{money(folio.totals.charged)}</strong></div>
          <div className="hotel-total"><span>Still owed</span><strong>{money(folio.totals.owed)}</strong></div>
          {Number(folio.deposit.amount) > 0 && <div className="hotel-total"><span>Deposit ({folio.deposit.method}){inHouse ? " available" : ` · used ${money(folio.deposit.applied)}, refunded ${money(folio.deposit.refunded)}`}</span><strong>{inHouse ? money(folio.deposit.available) : money(folio.deposit.amount)}</strong></div>}

          {inHouse && (
            <>
              <div className="hotel-row">
                <label className="inventory-field">Room credit limit (KSh, blank = none)<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
                <button type="button" className="pos-secondary-button" disabled={busy} onClick={saveLimit}>Save limit</button>
                {folio.totals.creditHeadroom !== null && <span className="inventory-muted">Room left: {money(folio.totals.creditHeadroom)}</span>}
              </div>
              <h3>Check out</h3>
              {Number(folio.totals.dueAtCheckout) > 0 ? (
                <div className="hotel-bill">
                  <p className="inventory-muted">The guest pays <strong>{money(folio.totals.dueAtCheckout)}</strong>{Number(folio.deposit.available) > 0 ? " after the deposit is used" : ""}. Split it across methods if needed; the parts must add up exactly.</p>
                  {parts.map((p, i) => (
                    <div className="hotel-row" key={i}>
                      <select value={p.method} onChange={(e) => setPart(i, { method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <input inputMode="decimal" placeholder="Amount" value={p.amount} onChange={(e) => setPart(i, { amount: e.target.value })} />
                      {p.method === "mpesa" && <input placeholder="M-PESA code" maxLength={12} value={p.reference} onChange={(e) => setPart(i, { reference: e.target.value })} />}
                      {parts.length > 1 && <button type="button" className="pos-secondary-button" onClick={() => setParts((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>}
                    </div>
                  ))}
                  <div><button type="button" className="pos-secondary-button" onClick={() => setParts((x) => [...x, { method: "cash", amount: "", reference: "" }])}>Add another payment</button></div>
                </div>
              ) : <p className="inventory-muted">{Number(folio.totals.owed) > 0 ? "The deposit covers the whole account." : "Nothing is owed."}</p>}
              {Number(folio.totals.depositToRefund) > 0 && (
                <div className="hotel-row">
                  <span>Give back <strong>{money(folio.totals.depositToRefund)}</strong> of the deposit, by</span>
                  <select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <input placeholder="Reference (optional)" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} />
                </div>
              )}
              <button type="button" className="pos-primary-button" disabled={busy} onClick={checkOut}><LogOut size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Settle account &amp; check out</button>
            </>
          )}
        </section>
      )}

      {folio && showSlip && (
        <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Guest folio">
          <div className="sale-detail-dialog" style={{ maxWidth: 560 }}>
            <div className="sale-detail-toolbar no-print">
              <div><h2>Guest folio</h2><p>Print a copy for the guest.</p></div>
              <div className="sale-detail-action-buttons">
                <button type="button" className="sales-view-button" onClick={() => window.print()}><Printer size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Print</button>
                <button type="button" className="sale-detail-close" onClick={() => setShowSlip(false)}><X size={15} style={{ verticalAlign: -2, marginRight: 4 }} />Close</button>
              </div>
            </div>
            <div className="sale-receipt-print-area">
              <header className="sale-receipt-header">
                <Letterhead />
                <h1>GUEST FOLIO</h1>
                <p>Room {folio.roomName} · {folio.guest.name}</p>
                <p>{when(folio.checkedInAt)}{folio.checkedOutAt ? ` to ${when(folio.checkedOutAt)}` : " (in house)"}</p>
              </header>
              <table className="receipt-items-table" style={{ minWidth: 0, width: "100%" }}>
                <thead><tr><th>Receipt</th><th>Date</th><th>Total</th><th>Owing</th></tr></thead>
                <tbody>
                  {folio.charges.map((c) => <tr key={c.id}><td>{c.receiptNumber}</td><td>{new Date(c.saleDate).toLocaleDateString("en-KE")}</td><td>{money(c.total)}</td><td>{money(c.balanceDue)}</td></tr>)}
                </tbody>
              </table>
              <p><strong>Total charged: {money(folio.totals.charged)}</strong></p>
              {Number(folio.deposit.amount) > 0 && <p>Deposit: {money(folio.deposit.amount)} · used {money(folio.deposit.applied)}{Number(folio.deposit.refunded) > 0 ? ` · refunded ${money(folio.deposit.refunded)}` : ""}</p>}
              <p><strong>{folio.status === "checked_out" ? "Account settled in full." : `Balance owing: ${money(folio.totals.owed)}`}</strong></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
