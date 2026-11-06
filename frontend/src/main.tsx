import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import AuthGate from "./AuthGate";

function Root() {
  const [authenticated, setAuthenticated] = useState(
    () =>
      Boolean(
        sessionStorage.getItem("pos_token") &&
        sessionStorage.getItem("pos_business_id")
      )
  );

  return authenticated ? (
    <App />
  ) : (
    <AuthGate onAuthenticated={() => setAuthenticated(true)} />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
