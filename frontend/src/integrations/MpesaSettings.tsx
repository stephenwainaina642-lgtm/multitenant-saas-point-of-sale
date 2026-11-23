import { Loader2 } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "../api/client";
import { notify } from "../toast";
import SettingsForm from "./SettingsForm";
import { session, type Integration } from "./types";

type P = Omit<Parameters<typeof SettingsForm>[0], "intro">;
export default function MpesaSettings(props: P & { item: Integration; onChanged?: () => void }) {
  const [busy, setBusy] = useState<"" | "register" | "test">("");
  const [ack, setAck] = useState(false);
  const [amount, setAmount] = useState("100");
  const registered = props.item.config.c2bStatus === "registered";
  const production = props.item.environment === "production";
  const ready = props.item.status === "verified" || props.item.status === "enabled";

  async function register() {
    setBusy("register");
    try {
      await apiRequest("/integrations/mpesa/c2b/register", { ...session(), method: "POST", body: { acknowledgeOneTime: ack } });
      notify.success("Live payments switched on");
      props.onChanged?.();
    } catch (e) { notify.error(e instanceof Error ? e.message : "Could not register"); } finally { setBusy(""); }
  }
  async function testPayment() {
    setBusy("test");
    try {
      await apiRequest("/integrations/mpesa/c2b/simulate", { ...session(), method: "POST", body: { amount, billRef: "TEST" } });
      notify.success("Test payment sent. It should appear on the M-PESA Statement in a few seconds.");
    } catch (e) { notify.error(e instanceof Error ? e.message : "Could not send the test payment"); } finally { setBusy(""); }
  }

  return (
    <SettingsForm
      {...props}
      intro={
        <>
          <p className="int-intro">
            Use <strong>your own</strong> Safaricom Daraja app. Money goes straight to your shortcode; nexaPOS never holds it. “Test connection” checks your
            Consumer Key and Secret only. The shortcode and passkey are first proven by a real payment request.
          </p>
          <div className="int-c2b">
            <h4>Live statement (payments nobody prompted for)</h4>
            <p>Status: <strong>{registered ? "Switched on" : "Not switched on"}</strong></p>
            <p>This tells Safaricom to notify nexaPOS of every payment made to your shortcode, so they show on the “M-PESA Statement” page within seconds.</p>
            {production && (
              <label className="int-c2b-row">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <small>I understand that in production Safaricom registers these addresses once per shortcode and will not replace addresses another system (a bank, another POS) already uses.</small>
              </label>
            )}
            <div className="int-c2b-row">
              <button type="button" className="pos-secondary-button" disabled={busy !== "" || !ready || (production && !ack)} onClick={() => void register()}>
                {busy === "register" ? <><Loader2 size={14} className="stk-spin" /> Registering…</> : registered ? "Register again" : "Switch on live statement"}
              </button>
              {!ready && <small>Save your keys and run a passing connection test first.</small>}
            </div>
            {!production && registered && (
              <div className="int-c2b-row">
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" aria-label="Test amount in shillings" style={{ width: "6rem" }} />
                <button type="button" className="pos-secondary-button" disabled={busy !== "" || !amount} onClick={() => void testPayment()}>
                  {busy === "test" ? <><Loader2 size={14} className="stk-spin" /> Sending…</> : "Send a test payment (sandbox)"}
                </button>
              </div>
            )}
          </div>
        </>
      }
    />
  );
}
