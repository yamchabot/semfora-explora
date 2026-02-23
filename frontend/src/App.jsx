import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import GraphView from "./pages/GraphView";
import BlastRadius from "./pages/BlastRadius";
import ModuleCoupling from "./pages/ModuleCoupling";
import DeadCode from "./pages/DeadCode";
import LoadBearing from "./pages/LoadBearing";
import Centrality from "./pages/Centrality";
import Diff from "./pages/Diff";
import Building from "./pages/Building";
import Cycles from "./pages/Cycles";
import ModuleGraph from "./pages/ModuleGraph";
import Communities from "./pages/Communities";
import Explore from "./pages/Explore";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export const RepoContext = React.createContext(null);

import React from "react";

// ── Console error toasts ─────────────────────────────────────────────────────
let _toastId = 0;

function ConsoleToasts() {
  const [toasts, setToasts] = useState([]);
  const origError = useRef(null);
  const origWarn  = useRef(null);

  const push = useCallback((level, args) => {
    const text = args
      .map(a => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      })
      .join(" ");
    // Deduplicate: skip if the last toast has the same text
    setToasts(prev => {
      if (prev.length && prev[prev.length - 1].text === text) return prev;
      const id = ++_toastId;
      // Cap at 6 toasts; drop oldest
      const next = [...prev.slice(-5), { id, level, text }];
      return next;
    });
  }, []);

  useEffect(() => {
    origError.current = console.error;
    origWarn.current  = console.warn;

    console.error = (...args) => { origError.current?.(...args); push("error", args); };
    console.warn  = (...args) => { origWarn.current?.(...args);  push("warn",  args); };

    return () => {
      console.error = origError.current;
      console.warn  = origWarn.current;
    };
  }, [push]);

  const dismiss = useCallback(id =>
    setToasts(prev => prev.filter(t => t.id !== id)), []);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, display: "flex", flexDirection: "column", gap: 6,
      maxWidth: 680, width: "calc(100vw - 32px)", pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "8px 10px 8px 12px",
          background: t.level === "error" ? "rgba(248,81,73,0.15)" : "rgba(210,153,34,0.15)",
          border: `1px solid ${t.level === "error" ? "rgba(248,81,73,0.5)" : "rgba(210,153,34,0.5)"}`,
          borderRadius: 6,
          backdropFilter: "blur(6px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          pointerEvents: "auto",
        }}>
          <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>
            {t.level === "error" ? "🔴" : "🟡"}
          </span>
          <pre style={{
            margin: 0, flex: 1, fontSize: 11, lineHeight: 1.5,
            color: t.level === "error" ? "#ff6b6b" : "#e3b341",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
            maxHeight: 120, overflowY: "auto", fontFamily: "monospace",
          }}>{t.text}</pre>
          <button
            onClick={() => dismiss(t.id)}
            style={{
              flexShrink: 0, background: "none", border: "none",
              color: "var(--text3)", cursor: "pointer", fontSize: 14,
              padding: "0 2px", lineHeight: 1, marginTop: 1,
            }}
          >✕</button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [repoId, setRepoId] = useState("semfora-engine");

  return (
    <QueryClientProvider client={queryClient}>
      <RepoContext.Provider value={{ repoId, setRepoId }}>
        <BrowserRouter>
          <ConsoleToasts />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="graph" element={<GraphView />} />
              <Route path="blast-radius" element={<BlastRadius />} />
              <Route path="modules" element={<ModuleCoupling />} />
              <Route path="dead-code" element={<DeadCode />} />
              <Route path="load-bearing" element={<LoadBearing />} />
              <Route path="centrality" element={<Centrality />} />
              <Route path="cycles" element={<Cycles />} />
              <Route path="diff" element={<Diff />} />
              <Route path="building" element={<Building />} />
              <Route path="module-graph" element={<ModuleGraph />} />
              <Route path="communities" element={<Communities />} />
              <Route path="explore"     element={<Explore />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </RepoContext.Provider>
    </QueryClientProvider>
  );
}
