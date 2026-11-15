import { useState } from "react";
import { ApiError, apiRequest } from "./api/client";

type Kind = "products" | "customers";
type RowError = { row: number; field: string; message: string };
type Result = { dryRun: boolean; total: number; valid: number; created: number; errors: RowError[] };

const COLUMNS: Record<Kind, { key: string; label: string; aliases: string[] }[]> = {
  products: [
    { key: "name", label: "Name", aliases: ["name", "product", "productname", "item"] },
    { key: "sku", label: "SKU", aliases: ["sku", "code", "itemcode"] },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc"] },
    { key: "costPrice", label: "Cost price", aliases: ["costprice", "cost", "buyingprice"] },
    { key: "sellingPrice", label: "Selling price", aliases: ["sellingprice", "price", "saleprice", "retailprice"] },
    { key: "stockQuantity", label: "Opening stock", aliases: ["stockquantity", "stock", "quantity", "openingstock", "qty"] },
    { key: "minimumStock", label: "Minimum stock", aliases: ["minimumstock", "minstock", "reorderlevel"] },
    { key: "unitOfMeasure", label: "Unit", aliases: ["unitofmeasure", "unit", "uom"] },
    { key: "description", label: "Description", aliases: ["description", "notes"] },
  ],
  customers: [
    { key: "name", label: "Name", aliases: ["name", "customer", "customername"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "tel", "phonenumber"] },
    { key: "email", label: "Email", aliases: ["email", "emailaddress"] },
    { key: "address", label: "Address", aliases: ["address", "location"] },
    { key: "taxNumber", label: "Tax number", aliases: ["taxnumber", "kra", "krapin", "pin"] },
    { key: "creditLimit", label: "Credit limit", aliases: ["creditlimit", "limit"] },
    { key: "notes", label: "Notes", aliases: ["notes", "comments"] },
  ],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minimal RFC 4180 parser: quoted fields, embedded commas/newlines, doubled quotes, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

type Props = { kind: Kind; onImported: () => void };

export default function ImportPanel({ kind, onImported }: Props) {
  const columns = COLUMNS[kind];
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [unknownColumns, setUnknownColumns] = useState<string[]>([]);

  const token = () => sessionStorage.getItem("pos_token") || "";
  const businessId = () => sessionStorage.getItem("pos_business_id") || "";

  function reset() {
    setRows(null); setResult(null); setMessage(""); setFileName(""); setUnknownColumns([]);
  }

  async function call(payload: Record<string, string>[], dryRun: boolean): Promise<Result | null> {
    try {
      const r = await apiRequest<Result>(`/import/${kind}`, { method: "POST", token: token(), businessId: businessId(), body: { rows: payload, dryRun } });
      return r.data ?? null;
    } catch (err) {
      if (err instanceof ApiError && err.data) { setMessage(err.message); return err.data as Result; }
      setMessage(err instanceof Error ? err.message : "The import failed.");
      return null;
    }
  }

  async function choose(file: File | undefined) {
    reset();
    if (!file) return;
    setFileName(file.name);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setMessage("The file needs a header row and at least one data row."); return; }
    const header = grid[0]!.map(norm);
    const index = new Map<string, number>();
    for (const c of columns) {
      const i = header.findIndex((h) => c.aliases.includes(h));
      if (i >= 0) index.set(c.key, i);
    }
    if (!index.has("name")) { setMessage('No "Name" column found. Check the first row of your file.'); return; }
    if (kind === "products" && !index.has("sellingPrice")) { setMessage('No "Selling price" column found. Check the first row of your file.'); return; }
    const known = new Set(Array.from(index.values()));
    setUnknownColumns(grid[0]!.filter((_, i) => !known.has(i) && grid[0]![i]!.trim() !== ""));
    const data = grid.slice(1).map((cells) => {
      const o: Record<string, string> = {};
      index.forEach((i, key) => { o[key] = (cells[i] ?? "").trim(); });
      return o;
    });
    setRows(data);
    setBusy(true);
    setResult(await call(data, true));
    setBusy(false);
  }

  async function confirm() {
    if (!rows) return;
    setBusy(true);
    const r = await call(rows, false);
    setBusy(false);
    if (r && r.created > 0) {
      setMessage(`${r.created} ${kind} imported.`);
      setRows(null); setResult(null); setFileName("");
      onImported();
    } else if (r) setResult(r);
  }

  function template() {
    const csv = columns.map((c) => c.label).join(",") + "\r\n";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${kind}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const ok = result && result.errors.length === 0 && result.valid > 0;

  return (
    <article className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Import {kind} from a spreadsheet</h2>
          <p style={{ margin: 0, color: "#59665d" }}>Save your sheet as CSV. Nothing is added unless every row is valid.</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => { setOpen(!open); reset(); }}>{open ? "Close" : "Import CSV"}</button>
      </div>

      {open && (
        <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            Columns: {columns.map((c) => c.label).join(", ")}.{" "}
            {kind === "products" ? "Name and Selling price are required. " : "Only Name is required. "}
            Up to 500 rows per file.{" "}
            <button type="button" className="button-secondary" onClick={template}>Download template</button>
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void choose(e.target.files?.[0])} aria-label="Choose CSV file" />
          {unknownColumns.length > 0 && <p style={{ margin: 0, color: "#8a6d00" }}>Ignored columns: {unknownColumns.join(", ")}</p>}
          {message && <p role="status" style={{ margin: 0, color: result && result.errors.length ? "#b42318" : "#067647" }}>{message}</p>}
          {busy && <p style={{ margin: 0 }}>Checking...</p>}

          {result && result.errors.length > 0 && (
            <div>
              <strong>{result.errors.length} problem(s) in {fileName}. Fix them in your sheet and choose the file again.</strong>
              <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
                <table style={{ width: "100%" }}>
                  <thead><tr><th>ROW</th><th>FIELD</th><th>PROBLEM</th></tr></thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}><td>{e.row + 1}</td><td>{e.field}</td><td>{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small>Row numbers match your spreadsheet (row 1 is the header).</small>
            </div>
          )}

          {ok && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>{result!.valid} {kind} ready to import from {fileName}.</span>
              <button type="button" className="button-primary" disabled={busy} onClick={() => void confirm()}>Import {result!.valid} {kind}</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
