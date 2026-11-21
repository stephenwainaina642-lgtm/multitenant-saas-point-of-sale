import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { money } from "./money";

type Bucket = { netSales: number; vat?: number };
type Section = {
  sales: {
    count: number; standardRated: Required<Bucket>; zeroRated: Bucket; exempt: Bucket; noVatCharged: Bucket;
    manualTax: number; netSales: number; outputVat: number; totalIncludingVat: number;
  };
  purchases: { count: number; netPurchases: number; inputVat: number };
  vatPayable: number;
};
type VatReport = Section & {
  business: { name: string; taxPin: string | null; vatRegistered: boolean; vatRate: string; pricesIncludeVat: boolean };
  byMonth: ({ month: string } & Section)[];
  notes: string[];
};

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function VatReportPanel({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [report, setReport] = useState<VatReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) return;
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<VatReport>(`/reports/vat?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, { token, businessId })
      .then((r) => { if (active) setReport(r.data ?? null); })
      .catch((e) => { if (active) { setReport(null); setError(e instanceof Error ? e.message : "Could not load the VAT summary."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [startDate, endDate, token, businessId]);

  function exportCsv() {
    if (!report) return;
    const s = report.sales;
    const rows: (string | number)[][] = [
      ["VAT SUMMARY (not a filed return)"],
      [report.business.name],
      ["KRA PIN", report.business.taxPin ?? ""],
      ["Period", startDate, endDate],
      [],
      ["Sales", "Net sales (excl. VAT)", "VAT"],
      ["Standard-rated", s.standardRated.netSales, s.standardRated.vat],
      ["Zero-rated", s.zeroRated.netSales, 0],
      ["Exempt", s.exempt.netSales, 0],
      ["No VAT charged", s.noVatCharged.netSales, 0],
      ["Tax typed in by hand", 0, s.manualTax],
      ["Total sales", s.netSales, s.outputVat],
      [],
      ["Purchases", "Net purchases (excl. VAT)", "Input VAT"],
      ["Received purchases", report.purchases.netPurchases, report.purchases.inputVat],
      [],
      ["Output VAT", s.outputVat],
      ["Input VAT", report.purchases.inputVat],
      ["Output minus input", report.vatPayable],
      [],
      ["Month", "Net sales", "Output VAT", "Input VAT", "Output minus input"],
      ...report.byMonth.map((m) => [m.month, m.sales.netSales, m.sales.outputVat, m.purchases.inputVat, m.vatPayable]),
      [],
      ...report.notes.map((n) => [n]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexaPOS-vat-summary-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const s = report?.sales;
  return (
    <article className="panel" style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>VAT summary</h2>
          <p style={{ margin: "4px 0 0", color: "#64746b", fontSize: 13 }}>
            By sale date, for preparing your VAT return. Not a filed return and not connected to KRA or eTIMS.
          </p>
        </div>
        <button className="button-secondary" type="button" onClick={exportCsv} disabled={!report}>Export VAT CSV</button>
      </div>

      {error && <p role="alert" style={{ color: "#a1352a" }}>{error}</p>}
      {loading && <p>Loading VAT summary...</p>}
      {report && s && (
        <>
          {!report.business.vatRegistered && (
            <p style={{ background: "#fff8e6", padding: 10, borderRadius: 8 }}>
              This business is not set as VAT registered, so sales in this period carry no VAT unless tax was typed in by hand.
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead><tr><th>SALES</th><th>NET (EXCL. VAT)</th><th>VAT</th></tr></thead>
              <tbody>
                <tr><td>Standard-rated ({Number(report.business.vatRate)}%)</td><td>{money(s.standardRated.netSales)}</td><td>{money(s.standardRated.vat)}</td></tr>
                <tr><td>Zero-rated</td><td>{money(s.zeroRated.netSales)}</td><td>{money(0)}</td></tr>
                <tr><td>Exempt</td><td>{money(s.exempt.netSales)}</td><td>{money(0)}</td></tr>
                <tr><td>No VAT charged</td><td>{money(s.noVatCharged.netSales)}</td><td>{money(0)}</td></tr>
                {s.manualTax !== 0 && <tr><td>Tax typed in by hand</td><td>{money(0)}</td><td>{money(s.manualTax)}</td></tr>}
                <tr><td><strong>Total sales ({s.count})</strong></td><td><strong>{money(s.netSales)}</strong></td><td><strong>{money(s.outputVat)}</strong></td></tr>
              </tbody>
            </table>
          </div>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>PURCHASES ({report.purchases.count})</th><th>NET (EXCL. VAT)</th><th>INPUT VAT</th></tr></thead>
              <tbody><tr><td>Received purchases</td><td>{money(report.purchases.netPurchases)}</td><td>{money(report.purchases.inputVat)}</td></tr></tbody>
            </table>
          </div>
          <p style={{ fontSize: 18, margin: "14px 0 4px" }}>
            Output VAT {money(s.outputVat)} − input VAT {money(report.purchases.inputVat)} = <strong>{money(report.vatPayable)}</strong>
          </p>
          {report.byMonth.length > 1 && (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>MONTH</th><th>NET SALES</th><th>OUTPUT VAT</th><th>INPUT VAT</th><th>OUTPUT − INPUT</th></tr></thead>
                <tbody>
                  {report.byMonth.map((m) => (
                    <tr key={m.month}><td>{m.month}</td><td>{money(m.sales.netSales)}</td><td>{money(m.sales.outputVat)}</td><td>{money(m.purchases.inputVat)}</td><td>{money(m.vatPayable)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul style={{ color: "#64746b", fontSize: 13, paddingLeft: 18 }}>
            {report.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </>
      )}
    </article>
  );
}
