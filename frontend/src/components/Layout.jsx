import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";
import ImportRepoModal from "./ImportRepoModal";

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
  { to: "/explore",      icon: "📐",  label: "Explore",             section: "Explore" },
];

const SIDEBAR_KEY = "semfora_sidebar_collapsed";
const EXPANDED_W  = 220;
const COLLAPSED_W = 44;

export default function Layout() {
  const { repoId, setRepoId } = useContext(RepoContext);
  const { data } = useQuery({ queryKey: ["repos"], queryFn: api.repos });
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const [showImport, setShowImport] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "1"
  );

  const toggle = useCallback(() => {
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // Keyboard shortcut: [ or \ to toggle sidebar
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "[" || e.key === "\\") toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  const sidebarW = collapsed ? COLLAPSED_W : EXPANDED_W;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `${sidebarW}px 1fr`,
      minHeight: "100vh",
      transition: "grid-template-columns 0.18s ease",
    }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.18s ease",
        width: sidebarW,
        minWidth: sidebarW,
        position: "relative",
      }}>

        {/* Wordmark */}
        <div style={{
          padding: collapsed ? "16px 0" : "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}>
          {collapsed
            ? <span title="semforaexplorer" style={{ fontSize: 16 }}>🗺</span>
            : (
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--blue)" }}>
                semfora<span style={{ color: "var(--text)" }}>explorer</span>
              </div>
            )
          }
        </div>

        {/* Repo selector — hidden when collapsed */}
        {!collapsed && (
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
                      {proj} @ {r.commit} — {r.node_count.toLocaleString()} nodes{r.enriched ? " ✦" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              onClick={() => setShowImport(true)}
              style={{ marginTop: 6, width: "100%", fontSize: 11, padding: "4px 8px",
                background: "var(--bg3)", border: "1px solid var(--border2)",
                borderRadius: 4, color: "var(--text2)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              + Import GitHub repo
            </button>
          </div>
        )}

        {/* Collapsed: small repo icon as selector trigger */}
        {collapsed && (
          <div style={{ borderBottom: "1px solid var(--border)", padding: "8px 0", display: "flex", justifyContent: "center" }}>
            <select
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              title="Switch repository"
              style={{ opacity: 0, position: "absolute", width: 36, height: 28, cursor: "pointer" }}
            >
              {(data?.repos || []).map((r) => (
                <option key={r.id} value={r.id}>{r.id}</option>
              ))}
            </select>
            <span title="Switch repository" style={{ fontSize: 15, cursor: "pointer", userSelect: "none" }}>🗄</span>
          </div>
        )}

        {/* Nav */}
        <nav style={{ padding: "8px 0", flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map(({ to, icon, label, section }) => (
            <div key={to}>
              {section && !collapsed && (
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 20px 4px" }}>
                  {section}
                </div>
              )}
              {section && collapsed && (
                <div style={{ height: 1, background: "var(--border)", margin: "8px 6px 4px" }} />
              )}
              <NavLink
                to={to}
                title={collapsed ? `${section ? section + " / " : ""}${label}` : undefined}
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: collapsed ? 0 : 10,
                  padding: collapsed ? "8px 0" : "7px 20px",
                  color: isActive ? "var(--blue)" : "var(--text2)",
                  borderLeft: isActive ? "2px solid var(--blue)" : "2px solid transparent",
                  background: isActive ? "var(--bg2)" : "transparent",
                  textDecoration: "none",
                  fontSize: collapsed ? 17 : 13,
                  transition: "all 0.1s",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                })}
              >
                <span>{icon}</span>
                {!collapsed && <span>{label}</span>}
              </NavLink>
            </div>
          ))}
        </nav>

        {/* Footer: toggle button + "Powered by" */}
        <div style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          padding: collapsed ? "10px 0" : "10px 14px",
          gap: 6,
        }}>
          {!collapsed && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>Powered by semfora-engine</span>
          )}
          <button
            onClick={toggle}
            title={collapsed ? "Expand sidebar  ([)" : "Collapse sidebar  ([)"}
            style={{
              background: "var(--bg3)",
              border: "1px solid var(--border2)",
              borderRadius: 4,
              color: "var(--text3)",
              cursor: "pointer",
              fontSize: 12,
              padding: "3px 7px",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main style={{ padding: "28px 32px", overflowY: "auto" }}>
        <Outlet />
      </main>

      {showImport && (
        <ImportRepoModal
          onClose={() => setShowImport(false)}
          onImported={(newRepoId) => {
            queryClient.invalidateQueries({ queryKey: ["repos"] });
            setRepoId(newRepoId);
            setShowImport(false);
            navigate("/explore");
          }}
        />
      )}
    </div>
  );
}
