import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Integration } from "./types";

type Props = {
  item: Integration;
  saving: boolean;
  intro?: ReactNode;
  onSave: (body: { environment: string; config: Record<string, string>; secrets: Record<string, string> }) => void;
  onCancel: () => void;
};

/**
 * Form driven by the server's own field list for the provider, so the screen can never offer a field the API
 * does not accept. Saved secrets are never shown: leaving a secret box blank keeps the saved one.
 */
export default function SettingsForm({ item, saving, intro, onSave, onCancel }: Props) {
  const [environment, setEnvironment] = useState(item.environment);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const c: Record<string, string> = {};
    for (const f of item.fields) if (f.kind === "config") c[f.name] = item.config[f.name] ?? (f.options?.[0]?.value && f.required ? "" : "");
    return c;
  });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const goingLive = environment === "production" && item.environment !== "production";
  const changesCredentials = Object.values(secrets).some((v) => v.trim()) || environment !== item.environment;

  return (
    <form
      className="int-form"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const sent: Record<string, string> = {};
        for (const [k, v] of Object.entries(secrets)) if (v.trim()) sent[k] = v.trim();
        onSave({ environment, config, secrets: sent });
      }}
    >
      {intro}
      <label className="int-field">
        <span>Environment</span>
        <select value={environment} onChange={(e) => setEnvironment(e.target.value as Integration["environment"])}>
          <option value="sandbox">Sandbox (test money, safe to experiment)</option>
          <option value="production">Production (real customers and real money)</option>
        </select>
        {goingLive && <small className="int-warn">Production uses your live merchant account. You will need to test the connection again before it can be enabled.</small>}
      </label>

      {item.fields.map((f) => {
        const saved = item.secrets[f.name];
        return (
          <label className="int-field" key={f.name}>
            <span>{f.label}{f.required && <em aria-hidden> *</em>}</span>
            {f.kind === "config" && f.options ? (
              <select value={config[f.name] ?? ""} onChange={(e) => setConfig({ ...config, [f.name]: e.target.value })} required={f.required}>
                <option value="" disabled>Choose…</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.kind === "config" ? (
              <input value={config[f.name] ?? ""} placeholder={f.placeholder ?? ""} onChange={(e) => setConfig({ ...config, [f.name]: e.target.value })} required={f.required} maxLength={254} />
            ) : (
              <span className="int-secret">
                <input
                  type={reveal[f.name] ? "text" : "password"}
                  autoComplete="new-password"
                  spellCheck={false}
                  value={secrets[f.name] ?? ""}
                  placeholder={saved?.set ? `Saved${saved.hint ? ` (ends ${saved.hint})` : ""}. Leave blank to keep` : "Paste here"}
                  required={f.required && !saved?.set}
                  maxLength={500}
                  onChange={(e) => setSecrets({ ...secrets, [f.name]: e.target.value })}
                />
                <button type="button" className="int-eye" aria-label={reveal[f.name] ? "Hide what you typed" : "Show what you typed"} onClick={() => setReveal({ ...reveal, [f.name]: !reveal[f.name] })}>
                  {reveal[f.name] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            )}
            {f.help && <small>{f.help}</small>}
          </label>
        );
      })}

      {changesCredentials && item.isEnabled && <p className="int-warn">Saving new credentials or a new environment switches this integration off until you test it again.</p>}
      <div className="int-form-actions">
        <button type="button" className="int-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="int-btn int-btn-primary" disabled={saving}>
          {saving ? <><Loader2 size={15} className="int-spin" /> Saving…</> : "Save settings"}
        </button>
      </div>
    </form>
  );
}
