import { Loader2, Settings2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { EnvPill, formatWhen, StatusPill } from "./IntegrationStatus";
import type { Integration } from "./types";

const MARK: Record<Integration["provider"], { text: string; cls: string }> = {
  mpesa: { text: "M-PESA", cls: "int-mark-mpesa" },
  pesapal: { text: "Pesapal", cls: "int-mark-pesapal" },
  etims: { text: "eTIMS", cls: "int-mark-etims" },
};

type Props = {
  item: Integration;
  busy: "test" | "toggle" | null;
  canManage: boolean;
  onConfigure: () => void;
  onTest: () => void;
  onToggle: () => void;
  children?: ReactNode;
};

/** One provider: branding, status, environment, last verification and the actions that are real for its state. */
export default function IntegrationCard({ item, busy, canManage, onConfigure, onTest, onToggle, children }: Props) {
  const m = MARK[item.provider];
  const ready = item.available && item.missing.length === 0 && item.fields.length > 0;
  const test = item.lastTest;
  return (
    <article className={`int-card ${item.isEnabled ? "int-card-on" : ""}`} aria-label={item.label}>
      <header className="int-card-head">
        <span className={`int-mark ${m.cls}`} aria-hidden>{m.text}</span>
        <div>
          <h3>{item.label}</h3>
          <p>{item.tagline}</p>
        </div>
      </header>

      <div className="int-badges">
        <StatusPill status={item.status} />
        {item.available && <EnvPill env={item.environment} />}
      </div>

      {!item.available ? (
        children ?? <p className="int-note"><ShieldCheck size={15} aria-hidden /> {item.unavailableReason}</p>
      ) : (
        <dl className="int-facts">
          <div><dt>Last verified</dt><dd>{test?.status === "ok" ? `${formatWhen(test.at)}${test.current ? "" : " (settings changed since)"}` : "Never"}</dd></div>
          {test && test.status === "failed" && <div><dt>Last test</dt><dd className="int-bad">{test.message}</dd></div>}
          {!ready && item.status !== "not_configured" ? null : !ready && <div><dt>Still needed</dt><dd>{item.missing.length ? item.missing.join(", ") : "Enter your credentials"}</dd></div>}
        </dl>
      )}
      {item.available && children}

      {item.available && canManage && (
        <footer className="int-actions">
          <button type="button" className="int-btn" onClick={onConfigure}><Settings2 size={15} /> Configure</button>
          <button type="button" className="int-btn" disabled={!ready || busy !== null} onClick={onTest}>
            {busy === "test" ? <><Loader2 size={15} className="int-spin" /> Testing…</> : "Test connection"}
          </button>
          <button
            type="button"
            className={`int-btn ${item.isEnabled ? "int-btn-danger" : "int-btn-primary"}`}
            disabled={busy !== null || (!item.isEnabled && item.status !== "verified")}
            title={!item.isEnabled && item.status !== "verified" ? "Test the connection successfully first" : undefined}
            onClick={onToggle}
          >
            {item.isEnabled ? "Disable" : "Enable"}
          </button>
        </footer>
      )}
    </article>
  );
}
