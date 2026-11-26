import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import AuthGate from "./AuthGate";
import PlatformAdmin from "./PlatformAdmin";
import StaffInvite, { staffTokenFromHash } from "./StaffInvite";
import AppToaster from "./AppToaster";
import "./receipt-premium.css";
import "./mobile.css"; // last, so the phone layout wins over the desktop styles

const DEMO = import.meta.env.VITE_DEMO_MODE === "true";

/** Shown only on the separate demo deployment (VITE_DEMO_MODE=true), so nobody mistakes it for live data. */
function DemoBanner() {
  return (
    <div role="note" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 9999, background: "#fff7e0", color: "#6b4a00", border: "1px solid #e8c766", borderRadius: 8, padding: "6px 12px", fontSize: 13, boxShadow: "0 2px 8px rgba(0,0,0,.12)", pointerEvents: "none" }}>
      DEMO — sample data only. M-Pesa and KRA eTIMS are not connected.
    </div>
  );
}

// The platform owner's screen lives at /#platform; it is not linked from anywhere in the normal app.
function Root() {
  const [staffToken] = useState(staffTokenFromHash);
  return (
    <>
      {window.location.hash.startsWith("#platform") ? <PlatformAdmin /> : staffToken ? <StaffInvite token={staffToken} /> : <BusinessApp />}
      <AppToaster />
    </>
  );
}

function BusinessApp() {
  const [authenticated, setAuthenticated] = useState(
    () =>
      Boolean(
        sessionStorage.getItem("pos_token") &&
        sessionStorage.getItem("pos_business_id")
      )
  );

  return (
    <>
      {authenticated ? <App /> : <AuthGate onAuthenticated={() => setAuthenticated(true)} />}
      {DEMO && <DemoBanner />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);

// Lets the till open with no internet (production only, so local development never serves stale files).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}
