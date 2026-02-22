import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import GraphView from "./pages/GraphView";
import BlastRadius from "./pages/BlastRadius";
import ModuleCoupling from "./pages/ModuleCoupling";
import DeadCode from "./pages/DeadCode";
import LoadBearing from "./pages/LoadBearing";
import Centrality from "./pages/Centrality";
import Diff from "./pages/Diff";
import Cycles from "./pages/Cycles";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export const RepoContext = React.createContext(null);

import React from "react";

export default function App() {
  const [repoId, setRepoId] = useState("semfora-engine");

  return (
    <QueryClientProvider client={queryClient}>
      <RepoContext.Provider value={{ repoId, setRepoId }}>
        <BrowserRouter>
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
            </Route>
          </Routes>
        </BrowserRouter>
      </RepoContext.Provider>
    </QueryClientProvider>
  );
}
