import PasswordInput from "./PasswordInput";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "./api/client";
import { can } from "./permissions";
import { createEntry, entryId, pinProblem } from "./offlineSigninCore";
import { getEntry, removeEntry, saveEntry, snapshotFromSession } from "./offlineSigninStore";

/**
 * Lets a signed-in member switch on PIN sign-in for this PC, for days when the internet is down. Which roles may do
 * this is a permission (Employees > Roles > "Use a PIN to sign in on a PC that has no internet"), so the owner decides.
 * The PIN stays on this PC as a salted hash; it is never sent anywhere.
 */
export default function OfflineSigninPanel() {
  const snapshot = snapshotFromSession();
  const [enabled, setEnabled] = useState(() => Boolean(snapshot && getEntry(entryId(snapshot.userId, snapshot.businessId))));
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const field: React.CSSProperties = { display: "grid", gap: 6, maxWidth: 360 };
  const allowed = can("offline.signin");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNote("");
    if (!snapshot) return setError("Sign out and sign in again, then try once more.");
    const problem = pinProblem(pin);
    if (problem) return setError(problem);
    if (pin !== again) return setError("The two PINs do not match.");
    setBusy(true);
    try {
      // Proves it is really this person at the keyboard before a PIN that opens their account is saved.
      await apiRequest("/auth/confirm-password", { method: "POST", token: sessionStorage.getItem("pos_token") || "", body: { password } });
      saveEntry(await createEntry(snapshot, pin));
      setEnabled(true);
      setChanging(false);
      setPassword(""); setPin(""); setAgain("");
      setNote("Saved. When the internet is down, choose \"Sign in with your PIN\" on the sign-in screen.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the PIN.");
    } finally {
      setBusy(false);
    }
  }

  function turnOff() {
    if (snapshot) removeEntry(snapshot.userId, snapshot.businessId);
    setEnabled(false);
    setChanging(false);
    setError("");
    setNote("Offline sign-in is off for you on this PC.");
  }

  return (
    <article className="panel" style={{ padding: 24, marginTop: 20 }}>
      <div className="panel-heading">
        <div>
          <h2>Sign in without internet</h2>
          <p>Choose a PIN for this PC so you can still open the till when the internet is down. Sales are saved on the PC and sent when the internet returns. Signing out turns this off, so close the window instead of signing out if you want it to stay.</p>
        </div>
      </div>

      {!allowed ? (
        <p style={{ margin: 0 }}>Your role is not allowed to use this. Ask the owner to turn on &ldquo;Use a PIN to sign in on a PC that has no internet&rdquo; for your role.</p>
      ) : enabled && !changing ? (
        <div style={{ display: "grid", gap: 12 }}>
          <p role="status" style={{ color: "#067647", margin: 0 }}>Turned on for you on this PC.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="button-secondary" onClick={() => { setChanging(true); setNote(""); }}>Change PIN</button>
            <button type="button" className="button-secondary" onClick={turnOff}>Turn off on this PC</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <label style={field}>Your account password
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label style={field}>New PIN (4 to 6 digits)
            <input className="auth-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          </label>
          <label style={field}>Repeat the PIN
            <input className="auth-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          </label>
          {error && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" className="button-primary" disabled={busy}>{busy ? "Saving..." : enabled ? "Save new PIN" : "Turn on for this PC"}</button>
            {changing && <button type="button" className="button-secondary" onClick={() => { setChanging(false); setError(""); }}>Cancel</button>}
          </div>
        </form>
      )}
      {note && <p role="status" style={{ color: "#067647", margin: "12px 0 0" }}>{note}</p>}
    </article>
  );
}
