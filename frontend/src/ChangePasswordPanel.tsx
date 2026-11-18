import PasswordInput from "./PasswordInput";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "./api/client";

/** Lets any signed-in member replace their own password, e.g. the temporary one an owner issued. */
export default function ChangePasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone(false);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      const response = await apiRequest<{ token: string }>("/auth/change-password", {
        method: "POST",
        token: sessionStorage.getItem("pos_token") || "",
        body: { currentPassword: current, newPassword: next },
      });
      // Old tokens (including this one) are now rejected; keep this device signed in with the fresh one.
      if (response.data?.token) sessionStorage.setItem("pos_token", response.data.token);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { display: "grid", gap: 6, maxWidth: 360 };

  return (
    <article className="panel" style={{ padding: 24, marginTop: 20 }}>
      <div className="panel-heading">
        <div>
          <h2>My password</h2>
          <p>Change the password you use to sign in. This signs you out on other devices and does not affect anyone else.</p>
        </div>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <label style={field}>Current password
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label style={field}>New password
          <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </label>
        <label style={field}>Confirm new password
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{error}</p>}
        {done && <p role="status" style={{ color: "#067647", margin: 0 }}>Password changed. Use it the next time you sign in.</p>}
        <div><button type="submit" className="button-primary" disabled={busy}>{busy ? "Saving..." : "Change password"}</button></div>
      </form>
    </article>
  );
}
