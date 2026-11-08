import "@fontsource-variable/inter";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { Skeleton } from "./components/ui";
import { AppProvider } from "./state/app";

// Pages are split so the first paint stays light; Recharts loads only on the Benchmark page.
const Live = lazy(() => import("./pages/Live"));
const Playground = lazy(() => import("./pages/Playground"));
const Ledger = lazy(() => import("./pages/Ledger"));
const Benchmark = lazy(() => import("./pages/Benchmark"));
const PolicyPage = lazy(() => import("./pages/Policy"));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageFallback() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-8 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)}
      </div>
    </div>
  );
}

const page = (el: ReactNode) => (
  <ErrorBoundary><Suspense fallback={<PageFallback />}>{el}</Suspense></ErrorBoundary>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={page(<Live />)} />
                <Route path="playground" element={page(<Playground />)} />
                <Route path="ledger" element={page(<Ledger />)} />
                <Route path="benchmark" element={page(<Benchmark />)} />
                <Route path="bench" element={<Navigate to="/benchmark" replace />} />
                <Route path="policy" element={page(<PolicyPage />)} />
                <Route path="*" element={page(<NotFound />)} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AppProvider>
    </MotionConfig>
  </StrictMode>,
);
