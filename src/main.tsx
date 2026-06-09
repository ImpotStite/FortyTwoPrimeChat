import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { PrivyProvider } from "@privy-io/react-auth";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { RouteSeo } from "./components/RouteSeo";
import { PRIVY_APP_ID, privyConfig } from "./lib/privy";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import "./styles/index.css";

const PrimeApp = lazy(() => import("./PrimeApp"));
const LegacyApp = lazy(() => import("./LegacyApp"));

function RouteFallback() {
  return (
    <div className="route-lazy-fallback" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

function PrimeLayout() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
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
        <Route
          path="/test"
          element={
            <Suspense fallback={<RouteFallback />}>
              <LegacyApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal */
    });
  });
}
