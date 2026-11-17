import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";

const Brand = () => (
  <div className="auth-brand"><span className="auth-brand-mark">P</span><span>POS<span className="auth-brand-light"> Suite</span></span></div>
);

/** "Forgot password?" — asks for the e-mail address and, if the server can send mail, requests a link. */
export function ForgotPasswordScreen({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [canEmail, setCanEmail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    apiRequest<{ passwordResetEmail: boolean }>("/auth/capabilities")
      .then((r) => setCanEmail(Boolean(r.data?.passwordResetEmail)))
      .catch(() => setCanEmail(false));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
      setMessage(r.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <p className="auth-eyebrow">ACCOUNT HELP</p>
        <h1>Reset your password</h1>
        {canEmail === false ? (
          <>
            <p className="auth-subtitle">E-mail reset is not set up on this system yet. Ask the business owner or an administrator to reset your password from the Employees screen, then sign in with the temporary password they give you.</p>
            <button className="auth-submit" type="button" onClick={onBack}>Back to sign in</button>
          </>
        ) : sent ? (
          <>
            <p className="auth-message auth-ok">{message}</p>
            <p className="auth-subtitle">The link works for 30 minutes and only once. Check your spam folder if it does not arrive.</p>
            <button className="auth-submit" type="button" onClick={onBack}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="auth-subtitle">Enter the e-mail address you sign in with and we will send you a link to choose a new password.</p>
            <form onSubmit={submit}>
              <label className="auth-label" htmlFor="forgot-email">Email address</label>
              <input id="forgot-email" className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" autoComplete="email" required />
              {message && <p className="auth-message">{message}</p>}
              <button className="auth-submit" type="submit" disabled={busy || canEmail === null}>{busy ? "Please wait..." : "Send reset link"}</button>
            </form>
            <p className="auth-switch"><button type="button" onClick={onBack}>Back to sign in</button></p>
          </>
        )}
      </section>
    </main>
  );
}

/** Opened from the e-mailed link (…/#reset-password=<token>). */
export function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password !== confirm) return setMessage("The two passwords do not match.");
    setBusy(true);
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: { token, newPassword: password } });
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <p className="auth-eyebrow">ACCOUNT HELP</p>
        <h1>Choose a new password</h1>
        {done ? (
          <>
            <p className="auth-message auth-ok">Your password has been changed. Any device that was signed in has been signed out.</p>
            <button className="auth-submit" type="button" onClick={onDone}>Go to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="auth-label" htmlFor="new-password">New password</label>
            <input id="new-password" className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" minLength={8} maxLength={72} required />
            <label className="auth-label" htmlFor="confirm-password">Repeat new password</label>
            <input id="confirm-password" className="auth-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required />
            {message && <p className="auth-message">{message}</p>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait..." : "Save new password"}</button>
            <p className="auth-switch"><button type="button" onClick={onDone}>Back to sign in</button></p>
          </form>
        )}
      </section>
    </main>
  );
}
