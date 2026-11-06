import { useState } from "react";
import { apiRequest } from "./api/client";
import "./AuthGate.css";

type Business = {
  id: string;
  name: string;
  role: string;
};

type AuthResult = {
  token: string;
  user: { id: string; name: string; email: string };
  businesses: Business[];
};

type SelectedBusiness = {
  businessId: string;
  businessName: string;
  businessType: string;
  role: string;
};

type Props = {
  onAuthenticated: () => void;
};

export default function AuthGate({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
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
        const response = await apiRequest<AuthResult>("/auth/register", {
          method: "POST",
          body: { name, email, password, businessName, businessType },
        });

        const result = response.data!;
        sessionStorage.setItem("pos_pending_user", result.user.name);
        if (result.businesses.length === 1) {
          await finishBusinessSelection(result.token, result.businesses[0]);
        } else {
          setToken(result.token);
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
          await finishBusinessSelection(result.token, result.businesses[0]);
        } else {
          setToken(result.token);
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
              <input id="full-name" className="auth-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Stephen Wainaina" autoComplete="name" required />

              <label className="auth-label" htmlFor="business-name">Business name</label>
              <input id="business-name" className="auth-input" value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Your business name" required />

              <label className="auth-label" htmlFor="business-type">Business type</label>
              <select id="business-type" className="auth-input" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>
                <option value="retail">General retail</option>
                <option value="hardware">Hardware & building materials</option>
                <option value="timber">Timber & wood</option>
                <option value="furniture">Furniture</option>
                <option value="wholesale">Wholesale</option>
                <option value="other">Other</option>
              </select>
            </>
          )}

          <label className="auth-label" htmlFor="email">Email address</label>
          <input id="email" className="auth-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" autoComplete="email" required />

          <label className="auth-label" htmlFor="password">Password</label>
          <input id="password" className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />

          {message && <p className="auth-message">{message}</p>}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "New to POS Suite?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="auth-footer">Secure workspace access for your business.</p>
      </section>
    </main>
  );
}
