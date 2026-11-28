import { money } from "./money";

export type ReceiptData = {
  businessName: string; planName: string | null; amount: number; method: string; reference: string | null; status: string;
  paidAt: string; periodFrom: string | null; periodTo: string | null; receiptNo: string | null;
};
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "no end date");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A payment receipt for a subscription payment. It is a receipt only, never a KRA tax invoice. */
export function printReceipt(p: ReceiptData) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  const rows: [string, string][] = [
    ["Receipt number", p.receiptNo ?? "(not approved yet)"], ["Received from", p.businessName], ["Plan", p.planName ?? ""], ["Payment method", p.method.toUpperCase() + (p.reference ? ` · ${p.reference}` : "")],
    ["Date received", date(p.paidAt)], ["Covers", p.periodFrom || p.periodTo ? `${date(p.periodFrom)} to ${date(p.periodTo)}` : "Licence"], ["Status", p.status],
  ];
  w.document.write(`<!doctype html><title>Receipt ${esc(p.receiptNo)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#17211b}h1{color:#176b4d;margin:0}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:8px 0;border-bottom:1px solid #e3e9e5;font-size:14px}td:first-child{color:#6b7a70;width:40%}.amt{font-size:28px;font-weight:700;margin:8px 0}small{color:#6b7a70}</style>
<h1>nexaPOS</h1><p>Payment receipt</p><div class="amt">${esc(money(p.amount))}</div><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<small>This is a receipt for a nexaPOS subscription payment. It is not a KRA tax invoice.</small><script>window.onload=()=>window.print()</script>`);
  w.document.close();
}
