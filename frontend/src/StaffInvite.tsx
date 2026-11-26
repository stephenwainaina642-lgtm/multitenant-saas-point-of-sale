import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import PasswordInput from "./PasswordInput";
import "./AuthGate.css";

/** A new employee opens /#staff=<token>, types the PIN they were given and chooses their own password. */
export function staffTokenFromHash(): string {
  const m = /^#staff=([\w-]{20,100})$/.exec(window.location.hash);
  return m ? m[1]! : "";
}

export default function StaffInvite({ token }: { token: string }) {
  const [info, setInfo] = useState<{ name: string; email: string; businessName: string } | null>(null);
  const [state, setState] = useState<"checking" | "ok" | "bad" | "done">("checking");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<{ name: string; email: string; businessName: string }>(`/auth/staff-invite/${encodeURIComponent(token)}`)
      .then((r) => { setInfo(r.data ?? null); setState("ok"); })
      .catch(() => setState("bad"));
  }, [token]);

  function goToSignIn() { window.location.hash = ""; window.location.reload(); }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setError("");
    if (!/^\d{6}$/.test(pin.trim())) return setError("Enter the 6-digit PIN you were given.");
    if (password.length < 8) return setError("Choose a password of at least 8 characters.");
    if (password !== again) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await apiRequest("/auth/staff-invite/accept", { method: "POST", body: { token, pin: pin.trim(), password } });
      setState("done");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-brand-mark">P</span><span>POS<span className="auth-brand-light"> Suite</span></span></div>
        {state === "checking" && <p className="auth-subtitle">Checking your link…</p>}
        {state === "bad" && (
          <>
            <p className="auth-eyebrow">LINK NOT VALID</p>
            <h1>This sign-in link can't be used</h1>
            <p className="auth-subtitle">It may have expired, already been used, or been cancelled. Ask the business owner to send you a new one.</p>
            <button className="auth-submit" type="button" onClick={goToSignIn}>Go to sign in</button>
          </>
        )}
        {state === "done" && (
          <>
            <p className="auth-eyebrow">ALL SET</p>
            <h1>Your account is ready</h1>
            <p className="auth-subtitle">Sign in with <strong>{info?.email}</strong> and the password you just chose.</p>
            <button className="auth-submit" type="button" onClick={goToSignIn}>Go to sign in</button>
          </>
        )}
        {state === "ok" && info && (
          <>
            <p className="auth-eyebrow">YOU'RE INVITED</p>
            <h1>Join {info.businessName}</h1>
            <p className="auth-subtitle">Hello {info.name}. Enter the 6-digit PIN you were given separately, then choose your own password.</p>
            <form onSubmit={submit}>
              <label className="auth-label" htmlFor="staff-email">Email address</label>
              <input id="staff-email" className="auth-input" value={info.email} readOnly />
              <label className="auth-label" htmlFor="staff-pin">PIN</label>
              <input id="staff-pin" className="auth-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="6 digits" required />
              <label className="auth-label" htmlFor="staff-pw">Choose a password</label>
              <PasswordInput id="staff-pw" className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
              <label className="auth-label" htmlFor="staff-pw2">Type it again</label>
              <PasswordInput id="staff-pw2" className="auth-input" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" minLength={8} required />
              {error && <p role="alert" style={{ color: "#b3412f", fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
              <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : "Create my account"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
