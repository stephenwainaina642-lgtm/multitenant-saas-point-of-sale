import type { ReactNode } from "react";
import Letterhead from "./Letterhead";
import { money } from "./money";

type Row = { name: string; qty: string | number; unitPrice: string | number; discount?: string | number; tax?: string | number; total: string | number };

type Props = {
  title: string;                         // "INVOICE", "QUOTATION"
  number: string;
  badge?: string;                        // "PAID", "VOID", "DRAFT"
  meta: { label: string; value: string }[];
  partyLabel: string;                    // "Bill to", "Prepared for"
  party: { name: string; lines: string[] };
  rows: Row[];
  showTax?: boolean;
  totals: { label: string; value: string | number; strong?: boolean; emphasis?: boolean }[];
  notes?: string | null;
  footer?: ReactNode;
};

/** The printed layout for invoices and quotations: large, high-contrast type that survives a basic printer. */
export default function PrintDocument(p: Props) {
  return (
    <div className="sale-receipt-print-area print-doc">
      <header className="print-doc-head">
        <div className="print-doc-brand"><Letterhead /></div>
        <div className="print-doc-title">
          <h2>{p.title}</h2>
          <p className="print-doc-number">{p.number}</p>
          {p.badge && <span className="print-doc-badge">{p.badge}</span>}
        </div>
      </header>

      <section className="print-doc-info">
        <div>
          <span className="print-doc-label">{p.partyLabel}</span>
          <strong className="print-doc-party">{p.party.name}</strong>
          {p.party.lines.map((l) => <span key={l}>{l}</span>)}
        </div>
        <dl>
          {p.meta.map((m) => (<div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>))}
        </dl>
      </section>

      <table className="print-doc-table">
        <thead>
          <tr>
            <th className="left">Item</th><th>Qty</th><th>Price</th><th>Discount</th>{p.showTax && <th>Tax</th>}<th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i}>
              <td className="left">{r.name}</td><td>{Number(r.qty)}</td><td>{money(r.unitPrice)}</td><td>{money(r.discount ?? 0)}</td>
              {p.showTax && <td>{money(r.tax ?? 0)}</td>}<td className="strong">{money(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="print-doc-totals">
        {p.totals.map((t) => (
          <div key={t.label} className={`${t.strong ? "is-strong " : ""}${t.emphasis ? "is-emphasis" : ""}`}>
            <span>{t.label}</span><strong>{typeof t.value === "number" ? money(t.value) : t.value}</strong>
          </div>
        ))}
      </section>

      {p.notes && <p className="print-doc-notes"><strong>Notes</strong>{p.notes}</p>}
      <footer className="print-doc-footer">{p.footer ?? "Thank you for your business."}</footer>
    </div>
  );
}
