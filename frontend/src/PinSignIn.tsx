import { useState } from "react";
import { readEntries } from "./offlineSigninStore";
import { isLocked } from "./offlineSigninCore";
import { signInWithPin } from "./offlineSignin";
import "./AuthGate.css";

type Props = { onDone: () => void; onBack: () => void };

/** Sign-in with a PIN, shown only while the server cannot be reached. */
export default function PinSignIn({ onDone, onBack }: Props) {
  const [entries, setEntries] = useState(readEntries);
  const [chosen, setChosen] = useState(() => entries[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = entries.find((e) => e.id === chosen);
  const locked = current ? isLocked(current) : false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const out = await signInWithPin(current.id, pin);
      if (out.result === "ok") return onDone();
      setEntries(readEntries());
      setPin("");
      if (out.result === "locked") setMessage("Too many wrong PINs. Connect to the internet and sign in with your password to unlock this PC.");
      else if (out.result === "wrong") setMessage(out.left > 0 ? `Wrong PIN. ${out.left} ${out.left === 1 ? "try" : "tries"} left.` : "Too many wrong PINs. Connect to the internet and sign in with your password to unlock this PC.");
      else setMessage("This PIN is no longer saved on this PC. Sign in with your password when you are online.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-brand-mark">P</span><span>POS<span className="auth-brand-light"> Suite</span></span></div>
        <p className="auth-eyebrow">NO INTERNET</p>
        <h1>Sign in with your PIN</h1>
        <p className="auth-subtitle">You can make sales now. They are sent to the server when the internet is back.</p>

        {entries.length === 0 ? (
          <p className="auth-message">No PIN is saved on this PC. Sign in with your password when you are online.</p>
        ) : (
          <form onSubmit={submit}>
            {entries.length > 1 ? (
              <>
                <label className="auth-label" htmlFor="pin-account">Who is signing in</label>
                <select id="pin-account" className="auth-input" value={chosen} onChange={(e) => { setChosen(e.target.value); setMessage(""); setPin(""); }}>
                  {entries.map((e) => <option key={e.id} value={e.id}>{e.userName} — {e.businessName}</option>)}
                </select>
              </>
            ) : (
              <p className="auth-subtitle"><strong>{current?.userName}</strong> · {current?.businessName}</p>
            )}

            <label className="auth-label" htmlFor="pin-code">PIN</label>
            <input
              id="pin-code" className="auth-input" type="password" inputMode="numeric" autoComplete="off" autoFocus
              maxLength={6} value={pin} disabled={locked}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Your 4 to 6 digit PIN"
            />

            {locked && !message && <p className="auth-message">Too many wrong PINs. Connect to the internet and sign in with your password to unlock this PC.</p>}
            {message && <p className="auth-message">{message}</p>}

            <button className="auth-submit" type="submit" disabled={busy || locked || pin.length < 4}>{busy ? "Checking..." : "Open the till"}</button>
          </form>
        )}

        <p className="auth-switch"><button type="button" onClick={onBack}>Back to password sign-in</button></p>
      </section>
    </main>
  );
}
