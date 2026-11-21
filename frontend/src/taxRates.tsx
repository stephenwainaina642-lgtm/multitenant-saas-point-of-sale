import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import { notify } from "./toast";

export type TaxRate = { code: string; name: string; rate: string; builtIn: boolean; productCount: number };

const session = () => ({ token: sessionStorage.getItem("pos_token") ?? "", businessId: sessionStorage.getItem("pos_business_id") ?? "" });

/** The tax classes a product can use: built-in ones first, then the business's own rates. */
export function useTaxRates() {
  const [rates, setRates] = useState<TaxRate[]>([
    { code: "standard", name: "Standard rate", rate: "16.00", builtIn: true, productCount: 0 },
    { code: "zero_rated", name: "Zero rated", rate: "0.00", builtIn: true, productCount: 0 },
    { code: "exempt", name: "Exempt", rate: "0.00", builtIn: true, productCount: 0 },
  ]);
  const reload = useCallback(async () => {
    try {
      const r = await apiRequest<TaxRate[]>("/tax-rates", session());
      if (r.data) setRates(r.data);
    } catch { /* the built-in three stay available */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { rates, reload };
}

export const rateLabel = (r: TaxRate) => `${r.name}${r.builtIn && r.code !== "standard" ? "" : ` (${Number(r.rate)}%)`}`;

export function TaxClassOptions({ rates }: { rates: TaxRate[] }) {
  return <>{rates.map((r) => <option key={r.code} value={r.code}>{rateLabel(r)}</option>)}</>;
}

/** Settings panel: add, rename, change or remove the business's own VAT rates. */
export function TaxRatesPanel() {
  const { rates, reload } = useTaxRates();
  const mayEdit = can("settings.manage");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, ok?: string) {
    setBusy(true);
    try {
      await apiRequest(path, { ...session(), method, ...(body !== undefined && { body }) });
      if (ok) notify.success(ok);
      await reload();
      return true;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally { setBusy(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(rate);
    if (!name.trim()) return notify.error("Enter a name for the rate, for example Fuel.");
    if (rate.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return notify.error("Enter a rate from 0 to 100.");
    if (await call("/tax-rates", "POST", { name: name.trim(), rate: n }, "Rate added")) { setName(""); setRate(""); }
  }

  function change(r: TaxRate) {
    const next = window.prompt(`New rate for ${r.name} (%). It applies to future sales only; recorded sales keep the rate they were charged.`, String(Number(r.rate)));
    if (next === null) return;
    const n = Number(next);
    if (next.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return notify.error("Enter a rate from 0 to 100.");
    void call(`/tax-rates/${r.code}`, "PUT", { rate: n }, "Rate updated");
  }

  return (
    <div className="settings-section tax-rates-panel">
      <h3>Tax rates</h3>
      <p className="inventory-muted">
        Each product uses one of these. The standard rate is set above; add your own for goods taxed differently (for example fuel at 8%).
        Every sale records the rate it was charged at.
      </p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>NAME</th><th>RATE</th><th>PRODUCTS</th>{mayEdit && <th />}</tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.code}>
                <td>{r.name}{r.builtIn && <span className="inventory-muted"> (built in)</span>}</td>
                <td>{Number(r.rate)}%</td>
                <td>{r.productCount}</td>
                {mayEdit && (
                  <td>
                    {!r.builtIn && (
                      <>
                        <button type="button" className="pos-secondary-button" disabled={busy} onClick={() => change(r)}>Change rate</button>{" "}
                        <button type="button" className="pos-secondary-button" disabled={busy || r.productCount > 0}
                          title={r.productCount > 0 ? "Move its products to another class first" : "Remove this rate"}
                          onClick={() => { if (window.confirm(`Remove the rate "${r.name}"?`)) void call(`/tax-rates/${r.code}`, "DELETE", undefined, "Rate removed"); }}>Remove</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mayEdit && (
        <form onSubmit={add} className="tax-rate-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Fuel" maxLength={60} aria-label="Rate name" />
          <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Rate %" inputMode="decimal" maxLength={6} aria-label="Rate percent" />
          <button type="submit" className="pos-primary-button" disabled={busy}>Add rate</button>
        </form>
      )}
    </div>
  );
}
