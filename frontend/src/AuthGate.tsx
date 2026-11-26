import { checkName, cleanName } from "./validation";
import PasswordInput from "./PasswordInput";
import { useEffect, useState } from "react";
import { BUSINESS_TYPE_OPTIONS } from "./businessTypes";
import { apiRequest, SESSION_MARKER } from "./api/client";
import "./AuthGate.css";
import { storePermissions } from "./permissions";
import { storeModules } from "./modules";
import { ForgotPasswordScreen, ResetPasswordScreen } from "./ForgotPassword";

/** Reads (and removes) a reset token from the address bar, so it is not left in the history or shared by accident. */
function takeResetToken(): string {
  const m = /^#reset-password=([0-9a-f]{64})$/.exec(window.location.hash);
  if (!m) return "";
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return m[1];
}

type Business = {
  id: string;
  name: string;
  role: string;
};

type AuthResult = {
  token?: string; // only present for non-browser clients; browsers get an httpOnly cookie
  user: { id: string; name: string; email: string };
  businesses: Business[];
};

type SelectedBusiness = {
  businessId: string;
  businessName: string;
  businessType: string;
  role: string;
  permissions?: string[];
  modules?: string[];
};

type Props = {
  onAuthenticated: () => void;
};

/** A client invitation arrives as /#join=<token>. Keep it in memory and take it out of the address bar. */
function takeJoinToken(): string {
  const m = /^#join=([\w-]{20,100})$/.exec(window.location.hash);
  if (!m) return "";
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return m[1]!;
}

export default function AuthGate({ onAuthenticated }: Props) {
  const [joinToken] = useState(takeJoinToken);
  const [invitePin, setInvitePin] = useState("");
  const [inviteState, setInviteState] = useState<"none" | "checking" | "ok" | "bad">(joinToken ? "checking" : "none");
  const [openSignup, setOpenSignup] = useState(false);
  const [mode, setMode] = useState<"login" | "register">(joinToken ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("retail");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [token, setToken] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState(takeResetToken);
  const [forgotOpen, setForgotOpen] = useState(false);
  useEffect(() => {
    if (joinToken) {
      apiRequest<{ email: string; businessName: string | null }>(`/auth/invite/${encodeURIComponent(joinToken)}`)
        .then((r) => {
          setEmail(r.data?.email ?? ""); if (r.data?.businessName) setBusinessName(r.data.businessName);
          setInviteState("ok");
        })
        .catch((e) => { setInviteState("bad"); setMessage(e instanceof Error ? e.message : "This invitation is not valid."); });
    } else {
      apiRequest<{ open: boolean }>("/auth/signup-mode").then((r) => setOpenSignup(Boolean(r.data?.open))).catch(() => undefined);
    }
  }, [joinToken]);
  useEffect(() => {
    const onHash = () => { const t = takeResetToken(); if (t) { setResetToken(t); setForgotOpen(false); } };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function finishBusinessSelection(
    accessToken: string,
    business: Business
  ) {
    const response = await apiRequest<SelectedBusiness>(
      "/business-context/select",
      {
        method: "POST",
        token: accessToken,
        body: { businessId: business.id },
      }
    );

    sessionStorage.setItem("pos_token", accessToken);
    sessionStorage.setItem("pos_business_id", response.data!.businessId);
    sessionStorage.setItem("pos_business_name", response.data!.businessName);
    sessionStorage.setItem("pos_business_role", response.data!.role);
    storePermissions(response.data!.permissions);
    storeModules(response.data!.modules);
    sessionStorage.setItem("pos_user_name", sessionStorage.getItem("pos_pending_user") || "");
    sessionStorage.removeItem("pos_pending_user");
    onAuthenticated();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);

    try {
      if (mode === "register") {
        const problem = checkName(name, "Your name");
        if (problem) { setMessage(problem); return; }
        if (joinToken && !/^\d{6}$/.test(invitePin.trim())) { setMessage("Enter the 6-digit PIN you were given."); return; }
        const response = await apiRequest<AuthResult>("/auth/register", {
          method: "POST",
          body: { name, email, password, businessName, businessType, ...(joinToken && { inviteToken: joinToken, invitePin: invitePin.trim() }) },
        });

        const result = response.data!;
        sessionStorage.setItem("pos_pending_user", result.user.name);
        if (result.businesses.length === 1) {
          await finishBusinessSelection(SESSION_MARKER, result.businesses[0]);
        } else {
          setToken(SESSION_MARKER);
          setBusinesses(result.businesses);
          setSelectedBusinessId(result.businesses[0]?.id ?? "");
        }
      } else {
        const response = await apiRequest<AuthResult>("/auth/login", {
          method: "POST",
          body: { email, password },
        });

        const result = response.data!;
        sessionStorage.setItem("pos_pending_user", result.user.name);

        if (result.businesses.length === 0) {
          setMessage("Your account has no active businesses. Please contact your administrator.");
        } else if (result.businesses.length === 1) {
          await finishBusinessSelection(SESSION_MARKER, result.businesses[0]);
        } else {
          setToken(SESSION_MARKER);
          setBusinesses(result.businesses);
          setSelectedBusinessId(result.businesses[0].id);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBusinessSelection() {
    const business = businesses.find((item) => item.id === selectedBusinessId);
    if (!business) {
      setMessage("Please select a business.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      await finishBusinessSelection(token, business);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not select business.");
    } finally {
      setBusy(false);
    }
  }

  if (resetToken) return <ResetPasswordScreen token={resetToken} onDone={() => { setResetToken(""); setForgotOpen(false); setMode("login"); }} />;
  if (forgotOpen) return <ForgotPasswordScreen initialEmail={email} onBack={() => setForgotOpen(false)} />;

  if (businesses.length > 0 && token) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand"><span className="auth-brand-mark">P</span><span>POS<span className="auth-brand-light"> Suite</span></span></div>
          <p className="auth-eyebrow">WORKSPACE</p>
          <h1>Select your business</h1>
          <p className="auth-subtitle">Choose the business workspace you want to manage.</p>
          <label className="auth-label" htmlFor="business-choice">Business</label>
          <select id="business-choice" className="auth-input" value={selectedBusinessId} onChange={(event) => setSelectedBusinessId(event.target.value)}>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>{business.name} — {business.role}</option>
            ))}
          </select>
          {message && <p className="auth-message">{message}</p>}
          <button className="auth-submit" disabled={busy} onClick={handleBusinessSelection}>
            {busy ? "Opening workspace..." : "Continue to POS"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-brand-mark">P</span><span>POS<span className="auth-brand-light"> Suite</span></span></div>
        <p className="auth-eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</p>
        <h1>{mode === "login" ? "Sign in to your workspace" : "Create your business account"}</h1>
        <p className="auth-subtitle">{mode === "login" ? "Manage sales, stock, and your business in one place." : "Set up your business and start managing your operations."}</p>

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <>
              <label className="auth-label" htmlFor="full-name">Your full name</label>
              <input id="full-name" className="auth-input" value={name} onChange={(event) => setName(cleanName(event.target.value))} placeholder="e.g. Stephen Wainaina" autoComplete="name" required />

              <label className="auth-label" htmlFor="business-name">Business name</label>
              <input id="business-name" className="auth-input" value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Your business name" required />

              <label className="auth-label" htmlFor="business-type">Business type</label>
              <select id="business-type" className="auth-input" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>
                {BUSINESS_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </>
          )}

          <label className="auth-label" htmlFor="email">Email address</label>
          <input id="email" className="auth-input" type="email" value={email} readOnly={Boolean(joinToken)} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" autoComplete="email" required />

          <label className="auth-label" htmlFor="password">Password</label>
          <PasswordInput id="password" className="auth-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />

          {mode === "register" && joinToken && (
            <>
              <label className="auth-label" htmlFor="invite-pin">Invitation PIN</label>
              <input id="invite-pin" className="auth-input" inputMode="numeric" maxLength={6} value={invitePin} onChange={(event) => setInvitePin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 digits, given to you separately" autoComplete="one-time-code" required />
            </>
          )}

          {mode === "login" && <p className="auth-forgot"><button type="button" onClick={() => { setMessage(""); setForgotOpen(true); }}>Forgot password?</button></p>}

          {message && <p className="auth-message">{message}</p>}

          <button className="auth-submit" type="submit" disabled={busy || inviteState === "checking" || inviteState === "bad"}>
            {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {(openSignup || joinToken || mode === "register") ? (
          <p className="auth-switch">
            {mode === "login" ? "New to POS Suite?" : "Already have an account?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        ) : (
          <p className="auth-switch">New business? Sign-up is by invitation. Ask us for your link.</p>
        )}
        <p className="auth-footer">Secure workspace access for your business.</p>
      </section>
    </main>
  );
}
