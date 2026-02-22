import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

const NAV = [
  { to: "/dashboard",    icon: "📊",  label: "Dashboard",          section: "Analysis" },
  { to: "/graph",        icon: "🕸️",  label: "Call Graph",          section: null },
  { to: "/blast-radius", icon: "💥",  label: "Blast Radius",        section: null },
  { to: "/dead-code",    icon: "🪦",  label: "Dead Code",           section: null },
  { to: "/centrality",   icon: "⭐",  label: "Centrality",          section: null },
  { to: "/cycles",       icon: "🔄",  label: "Cycles",              section: null },
  { to: "/modules",      icon: "🧩",  label: "Module Coupling",     section: "Modules" },
  { to: "/module-graph", icon: "🗺️",  label: "Module Graph",        section: null },
  { to: "/communities",  icon: "🔬",  label: "Communities",         section: null },
  { to: "/load-bearing", icon: "🏛️",  label: "Load-Bearing",        section: "Structure" },
  { to: "/building",     icon: "🏗️",  label: "Building View",       section: null },
  { to: "/diff",         icon: "🔀",  label: "Graph Diff",          section: "Compare" },
];

export default function Layout() {
  const { repoId, setRepoId } = useContext(RepoContext);
  const { data } = useQuery({ queryKey: ["repos"], queryFn: api.repos });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{ borderRight: "1px solid var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--blue)" }}>
            semfora<span style={{ color: "var(--text)" }}>explorer</span>
          </div>
        </div>

        {/* Repo selector */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Repository</div>
          <select
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            style={{ width: "100%", fontSize: 12 }}
          >
            {Object.entries(
              (data?.repos || []).reduce((acc, r) => {
                const proj = r.id.includes("@") ? r.id.split("@")[0] : r.id;
                const commit = r.id.includes("@") ? r.id.split("@")[1] : "HEAD";
                if (!acc[proj]) acc[proj] = [];
                acc[proj].push({ ...r, commit });
                return acc;
              }, {})
            ).map(([proj, versions]) => (
              <optgroup key={proj} label={proj}>
                {versions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.commit} — {r.node_count.toLocaleString()} nodes
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Nav */}
        <nav style={{ padding: "8px 0", flex: 1 }}>
          {NAV.map(({ to, icon, label, section }) => (
            <div key={to}>
              {section && (
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 20px 4px" }}>
                  {section}
                </div>
              )}
              <NavLink
                to={to}
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 20px",
                  color: isActive ? "var(--blue)" : "var(--text2)",
                  borderLeft: isActive ? "2px solid var(--blue)" : "2px solid transparent",
                  background: isActive ? "var(--bg2)" : "transparent",
                  textDecoration: "none",
                  fontSize: 13,
                  transition: "all 0.1s",
                })}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </NavLink>
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text3)" }}>
          Powered by semfora-engine
        </div>
      </aside>

      {/* Main content */}
      <main style={{ padding: "28px 32px", overflowY: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
