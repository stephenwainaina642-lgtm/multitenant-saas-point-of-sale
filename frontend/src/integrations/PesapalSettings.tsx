import { Loader2 } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "../api/client";
import { notify } from "../toast";
import SettingsForm from "./SettingsForm";
import { session, type Integration } from "./types";

type P = Omit<Parameters<typeof SettingsForm>[0], "intro">;
export default function PesapalSettings(props: P & { item: Integration; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const registered = props.item.config.ipnStatus === "registered";
  const ready = props.item.status === "verified" || props.item.status === "enabled";

  async function register() {
    setBusy(true);
    try {
      await apiRequest("/integrations/pesapal/register-ipn", { ...session(), method: "POST" });
      notify.success("Notification address registered with Pesapal");
      props.onChanged?.();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not register");
    } finally { setBusy(false); }
  }

  return (
    <SettingsForm
      {...props}
      intro={
        <>
          <p className="int-intro">
            Use <strong>your own</strong> Pesapal merchant account (API 3.0). A payment is only counted once Pesapal's own status check
            confirms it; a notification or the customer's return page alone is never treated as proof.
          </p>
          <div className="int-ipn">
            <span>Notification address: <strong>{registered ? "Registered" : "Not registered yet"}</strong></span>
            <button type="button" className="pos-secondary-button" disabled={busy || !ready} onClick={() => void register()} title={ready ? undefined : "Save your keys and run a passing test first"}>
              {busy ? <><Loader2 size={14} className="stk-spin" /> Registering…</> : registered ? "Register again" : "Register notification address"}
            </button>
            {!ready && <small>Save your keys and run a passing connection test first.</small>}
          </div>
        </>
      }
    />
  );
}
