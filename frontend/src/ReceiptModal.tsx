import { Printer, X } from "lucide-react";
import Letterhead from "./Letterhead";
import { money } from "./money";

export type ReceiptData = {
  /** null while the sale is still being saved in the background. */
  receiptNumber: string | null;
  date: string | Date;
  customerName: string | null;
  customerPhone?: string | null;
  servedBy: string | null;
  items: { name: string; sku?: string | null; quantity: number; unit?: string; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  pricesIncludeVat?: boolean;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentMethod?: string;
  paymentReference?: string | null;
  notes?: string | null;
};

const methodText = (m?: string) => (m ? m.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");

/** A sales receipt that can be viewed and printed right after a sale. It uses the same print styles as the Sales screen. */
export default function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const when = new Date(receipt.date);
  return (
    <div className="sale-detail-overlay" role="dialog" aria-modal="true" aria-label="Sales receipt">
      <div className="sale-detail-dialog" style={{ maxWidth: 560 }}>
        <div className="sale-detail-toolbar no-print">
          <div><h2>Receipt</h2><p>View it, or print a copy for the customer.</p></div>
          <div className="sale-detail-action-buttons">
            <button type="button" className="sales-view-button" onClick={() => window.print()}><Printer size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Print receipt</button>
            <button type="button" className="sale-detail-close" onClick={onClose}><X size={15} style={{ verticalAlign: -2, marginRight: 4 }} />Close</button>
          </div>
        </div>
        <div className="sale-receipt-print-area">
          <header className="sale-receipt-header">
            <Letterhead />
            <h1>SALES RECEIPT</h1>
            <p className="sale-receipt-number">{receipt.receiptNumber ?? "Saving… number appears when saved"}</p>
            <p>{Number.isNaN(when.getTime()) ? "" : when.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</p>
          </header>
          <div className="sale-receipt-customer">
            <div><span>Customer</span><strong>{receipt.customerName || "Walk-in customer"}</strong></div>
            {receipt.customerPhone && <div><span>Phone</span><strong>{receipt.customerPhone}</strong></div>}
            {receipt.servedBy && <div><span>Served by</span><strong>{receipt.servedBy}</strong></div>}
          </div>
          <h3 className="sale-section-title">Items purchased</h3>
          <div className="receipt-items-scroll">
            <table className="receipt-items-table" style={{ minWidth: 0, width: "100%" }}>
              <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
              <tbody>
                {receipt.items.map((item, i) => (
                  <tr key={i}>
                    <td><strong>{item.name}</strong>{item.sku && <small className="sale-item-sku">SKU: {item.sku}</small>}</td>
                    <td>{item.quantity}{item.unit ? ` ${item.unit}` : ""}</td>
                    <td>{money(item.unitPrice)}</td>
                    <td>{money(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sale-receipt-totals">
            <div><span>Subtotal</span><strong>{money(receipt.subtotal)}</strong></div>
            {receipt.discount > 0 && <div><span>Discount</span><strong>{money(receipt.discount)}</strong></div>}
            {receipt.tax > 0 && <div><span>{receipt.pricesIncludeVat ? "VAT (included in total)" : "Tax"}</span><strong>{money(receipt.tax)}</strong></div>}
            <div className="sale-receipt-grand-total"><span>Total</span><strong>{money(receipt.total)}</strong></div>
            <div><span>Amount paid{receipt.paymentMethod ? ` (${methodText(receipt.paymentMethod)})` : ""}</span><strong>{money(receipt.amountPaid)}</strong></div>
            {receipt.paymentReference && <div><span>Reference</span><strong>{receipt.paymentReference}</strong></div>}
            {receipt.balanceDue > 0 && <div className="sale-receipt-balance"><span>Balance due</span><strong>{money(receipt.balanceDue)}</strong></div>}
          </div>
          {receipt.notes && <div className="sale-receipt-notes"><strong>Notes:</strong> {receipt.notes}</div>}
          <footer className="sale-receipt-footer"><p>Thank you for your business.</p><small>Keep this receipt for your records.</small></footer>
        </div>
      </div>
    </div>
  );
}
