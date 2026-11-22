import { useCallback, useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { ApiError, apiRequest } from "./api/client";
import { can } from "./permissions";
import { notify } from "./toast";
import EtimsSettings from "./integrations/EtimsSettings";
import IntegrationCard from "./integrations/IntegrationCard";
import MpesaAttention from "./integrations/MpesaAttention";
import MpesaSettings from "./integrations/MpesaSettings";
import PesapalSettings from "./integrations/PesapalSettings";
import { session, type Integration, type IntegrationList } from "./integrations/types";
import "./integrations/integrations.css";

type SaveBody = { environment: string; config: Record<string, string>; secrets: Record<string, string> };
type TestResult = { ok: boolean; message: string; integration: Integration };

/** Payments & tax integrations. Every status, button and message here comes from the real API. */
export default function IntegrationsWorkspace() {
  const mayManage = can("integrations.manage");
  const [data, setData] = useState<IntegrationList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Integration | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Record<string, "test" | "toggle" | null>>({});
  const [confirmOff, setConfirmOff] = useState<Integration | null>(null);

  const replace = useCallback((next: Integration) => {
    setData((d) => (d ? { ...d, integrations: d.integrations.map((i) => (i.provider === next.provider ? next : i)) } : d));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiRequest<IntegrationList>("/integrations", session());
      if (r.data) setData(r.data);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load integrations");
    }
  }, []);
  useEffect(() => { if (mayManage) void load(); }, [load, mayManage]);

  if (!mayManage) return null;

  const run = async (item: Integration, kind: "test" | "toggle", fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [item.provider]: kind }));
    try { await fn(); } catch (e) { notify.error(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy((b) => ({ ...b, [item.provider]: null })); }
  };

  const test = (item: Integration) => run(item, "test", async () => {
    const r = await apiRequest<TestResult>(`/integrations/${item.provider}/test`, { ...session(), method: "POST", idempotencyKey: crypto.randomUUID() });
    if (r.data) {
      replace(r.data.integration);
      r.data.ok ? notify.success(r.data.message) : notify.error(r.data.message);
    }
  });

  const toggle = (item: Integration) => run(item, "toggle", async () => {
    const r = await apiRequest<Integration>(`/integrations/${item.provider}/${item.isEnabled ? "disable" : "enable"}`, {
      ...session(), method: "POST", ...(item.isEnabled && { body: { confirm: true } }),
    });
    if (r.data) { replace(r.data); notify.success(`${item.label} ${r.data.isEnabled ? "enabled" : "disabled"}`); }
  });

  const save = async (item: Integration, body: unknown) => {
    setSaving(true);
    try {
      const r = await apiRequest<Integration>(`/integrations/${item.provider}`, { ...session(), method: "PUT", body });
      if (r.data) {
        replace(r.data);
        setEditing(null);
        notify.success(item.isEnabled && !r.data.isEnabled ? "Saved. The integration was switched off: test it again to re-enable." : "Settings saved");
      }
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally { setSaving(false); }
  };

  const form = (item: Integration) => {
    const p = { item, saving, onSave: (b: SaveBody) => void save(item, b), onCancel: () => setEditing(null) };
    return item.provider === "mpesa" ? <MpesaSettings {...p} /> : <PesapalSettings {...p} />;
  };

  return (
    <section className="settings-section int-workspace" aria-labelledby="int-title">
      <div className="settings-section-heading">
        <h3 id="int-title"><KeyRound size={16} aria-hidden /> Payments &amp; tax integrations</h3>
        <p>Connect your own merchant accounts. Credentials are encrypted, never shown again after saving, and each business keeps its own.</p>
      </div>

      {loadError && <p className="int-bad" role="alert">{loadError} <button type="button" className="int-link" onClick={() => void load()}>Try again</button></p>}
      {data && !data.encryptionReady && (
        <p className="int-warn" role="alert">Saving credentials is switched off: the server's encryption key is not set. Ask your platform administrator to set INTEGRATIONS_ENCRYPTION_KEY.</p>
      )}
      {!data && !loadError && <p className="int-muted">Loading integrations…</p>}

      <div className="int-grid">
        {data?.integrations.map((item) => (
          <IntegrationCard
            key={item.provider}
            item={item}
            busy={busy[item.provider] ?? null}
            canManage={mayManage}
            onConfigure={() => setEditing(item)}
            onTest={() => void test(item)}
            onToggle={() => (item.isEnabled ? setConfirmOff(item) : void toggle(item))}
          >
            {item.provider === "etims" && <EtimsSettings reason={item.unavailableReason} />}
          </IntegrationCard>
        ))}
      </div>

      <MpesaAttention />

      {editing && (
        <div className="int-modal" role="dialog" aria-modal="true" aria-label={`Configure ${editing.label}`} onClick={(e) => { if (e.target === e.currentTarget && !saving) setEditing(null); }}>
          <div className="int-modal-box">
            <div className="int-modal-head">
              <h3>Configure {editing.label}</h3>
              <button type="button" className="int-eye" aria-label="Close" onClick={() => !saving && setEditing(null)}><X size={18} /></button>
            </div>
            {form(editing)}
          </div>
        </div>
      )}

      {confirmOff && (
        <div className="int-modal" role="alertdialog" aria-modal="true" aria-label="Confirm disable">
          <div className="int-modal-box int-modal-small">
            <h3>Disable {confirmOff.label}?</h3>
            <p>Customers will no longer be able to pay this way. Your saved credentials stay, and you can enable it again without re-entering them.</p>
            <div className="int-form-actions">
              <button type="button" className="int-btn" onClick={() => setConfirmOff(null)}>Keep enabled</button>
              <button type="button" className="int-btn int-btn-danger" onClick={() => { const i = confirmOff; setConfirmOff(null); void toggle(i); }}>Disable</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
