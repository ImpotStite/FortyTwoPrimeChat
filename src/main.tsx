import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PrivyProvider } from "@privy-io/react-auth";
import { Analytics } from "@vercel/analytics/react";
import LegacyApp from "./LegacyApp";
import PrimeApp from "./PrimeApp";
import { PRIVY_APP_ID, privyConfig } from "./lib/privy";
import "highlight.js/styles/github-dark.css";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
              <PrimeApp />
            </PrivyProvider>
          }
        />
        <Route path="/test" element={<LegacyApp />} />
      </Routes>
    </BrowserRouter>
    <Analytics />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal */
    });
  });
}
