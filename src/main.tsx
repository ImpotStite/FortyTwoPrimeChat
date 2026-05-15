import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { PrivyProvider } from "@privy-io/react-auth";
import { Analytics } from "@vercel/analytics/react";
import { RouteSeo } from "./components/RouteSeo";
import LegacyApp from "./LegacyApp";
import PrimeApp from "./PrimeApp";
import { PRIVY_APP_ID, privyConfig } from "./lib/privy";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import "./styles/index.css";

function PrimeLayout() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <Outlet />
    </PrivyProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteSeo />
      <Routes>
        <Route element={<PrimeLayout />}>
          <Route path="/" element={<PrimeApp />} />
          <Route
            path="/automatisation"
            element={<PrimeApp automationLoop />}
          />
        </Route>
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
