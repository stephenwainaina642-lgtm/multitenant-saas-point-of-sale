import { AlertTriangle, CheckCircle2, CircleDashed, Lock, PauseCircle, Power } from "lucide-react";
import type { Integration, Status } from "./types";

const META: Record<Status, { label: string; tone: string; Icon: typeof Power }> = {
  unavailable: { label: "Not available yet", tone: "muted", Icon: Lock },
  not_configured: { label: "Not set up", tone: "muted", Icon: CircleDashed },
  configured: { label: "Saved, not tested", tone: "amber", Icon: PauseCircle },
  verified: { label: "Verified, switched off", tone: "blue", Icon: CheckCircle2 },
  failed: { label: "Test failed", tone: "red", Icon: AlertTriangle },
  enabled: { label: "Enabled", tone: "green", Icon: Power },
};

export function StatusPill({ status }: { status: Status }) {
  const { label, tone, Icon } = META[status];
  return <span className={`int-pill int-${tone}`}><Icon size={13} aria-hidden /> {label}</span>;
}

export function EnvPill({ env }: { env: Integration["environment"] }) {
  return <span className={`int-env ${env === "production" ? "int-env-live" : ""}`}>{env === "production" ? "Production" : "Sandbox"}</span>;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
