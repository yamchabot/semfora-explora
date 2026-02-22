import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RepoContext } from "../App";
import { api } from "../api";

const SEVERITY_COLOR = { high: "var(--red)", medium: "var(--yellow)", low: "var(--text3)" };
const SEVERITY_BG    = { high: "var(--red-bg)", medium: "var(--yellow-bg)", low: "var(--bg3)" };

const TOOLS = [
  { to: "/graph",        icon: "🕸️", name: "Call Graph",          desc: "Explore the full symbol dependency graph for this repo.", badge: "Explore", badgeCls: "badge-blue" },
  { to: "/blast-radius", icon: "💥", name: "Blast Radius",         desc: "Select any symbol — see the full transitive impact if it changes.", badge: "Risk", badgeCls: "badge-yellow" },
  { to: "/modules",      icon: "🧩", name: "Module Coupling",      desc: "Ca, Ce, and instability scores per module. Find god objects.", badge: "Architecture", badgeCls: "badge-green" },
  { to: "/dead-code",    icon: "🪦", name: "Dead Code",            desc: "Symbols unreachable from any entrypoint. Safe to delete.", badge: "Cleanup", badgeCls: "badge-red" },
  { to: "/load-bearing", icon: "🏛️", name: "Load-Bearing Nodes",  desc: "Distinguish expected infrastructure from unexpected coupling.", badge: "Architecture", badgeCls: "badge-purple" },
  { to: "/centrality",   icon: "⭐", name: "Centrality",           desc: "The highest-risk nodes — everything routes through them.", badge: "Risk", badgeCls: "badge-yellow" },
  { to: "/cycles",       icon: "🔄", name: "Cycles",               desc: "Strongly connected components — circular dependencies.", badge: "Coupling", badgeCls: "badge-red" },
  { to: "/diff",         icon: "🔀", name: "Graph Diff",           desc: "Compare two repos structurally. See what dependencies changed.", badge: "Review", badgeCls: "badge-blue" },
];

export default function Dashboard() {
  const { repoId } = useContext(RepoContext);
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", repoId],
    queryFn: () => api.overview(repoId),
  });

  const { data: triageData } = useQuery({
    queryKey: ["triage", repoId],
    queryFn: () => api.triage(repoId),
  });

  if (isLoading) return <div className="loading">Loading overview…</div>;
  if (error) return <div className="error">Error: {error.message}</div>;

  const o = data;
  const riskBg = { low: "var(--green-bg)", medium: "var(--blue-bg)", high: "var(--yellow-bg)", critical: "var(--red-bg)" };
  const riskColor = { low: "var(--green)", medium: "var(--blue)", high: "var(--yellow)", critical: "var(--red)" };

  return (
    <div>
      <div className="page-header">
        <h1>📊 Dashboard</h1>
        <p>{repoId} — overview of the indexed call graph</p>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--blue)" }}>{o.node_count.toLocaleString()}</div>
          <div className="stat-label">Symbols indexed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>{o.edge_count.toLocaleString()}</div>
          <div className="stat-label">Call edges</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--blue)" }}>{o.module_count}</div>
          <div className="stat-label">Modules</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--yellow)" }}>{o.dead_symbol_estimate.toLocaleString()}</div>
          <div className="stat-label">Unreachable symbols</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{o.cycle_candidates.toLocaleString()}</div>
          <div className="stat-label">Cycle candidates</div>
        </div>
      </div>

      {/* Triage — top issues */}
      {triageData?.issues?.length > 0 && (
        <div className="section" style={{ marginBottom: 28 }}>
          <div className="section-title">⚡ Top Issues</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {triageData.issues.map((issue, i) => (
              <div key={i} className="card" style={{
                padding: "14px 18px",
                borderColor: SEVERITY_COLOR[issue.severity] + "55",
                display: "flex", gap: 14, alignItems: "flex-start"
              }}>
                <div style={{
                  flexShrink: 0, marginTop: 2,
                  width: 8, height: 8, borderRadius: "50%",
                  background: SEVERITY_COLOR[issue.severity],
                  boxShadow: `0 0 6px ${SEVERITY_COLOR[issue.severity]}`
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4,
                    fontFamily: issue.title.includes("`") ? "inherit" : undefined }}>
                    {issue.title.replace(/`([^`]+)`/g, (_, m) => m)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 6 }}>
                    {issue.detail}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--blue)", lineHeight: 1.5 }}>
                    → {issue.action}
                  </div>
                </div>
                <span style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 10,
                  background: SEVERITY_BG[issue.severity],
                  color: SEVERITY_COLOR[issue.severity],
                }}>
                  {issue.severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool grid */}
      <div className="section">
        <div className="section-title">Analysis Tools</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {TOOLS.map(({ to, icon, name, desc, badge, badgeCls }) => (
            <div
              key={to}
              className="card"
              style={{ padding: 20, cursor: "pointer", transition: "border-color 0.15s" }}
              onClick={() => nav(to)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--blue)"}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <div style={{ fontSize: 26, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 10 }}>{desc}</div>
              <span className={`badge ${badgeCls}`}>{badge}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Module breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Top Modules by Symbol Count</div>
          {o.top_modules.map((m) => (
            <div key={m.module} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
              <div style={{ width: 160, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.module}</div>
              <div className="bar-bg" style={{ maxWidth: "100%", flex: 1 }}>
                <div className="bar-fill" style={{ width: `${(m.cnt / o.top_modules[0].cnt) * 100}%`, background: "var(--blue)" }} />
              </div>
              <div style={{ color: "var(--text2)", width: 30, textAlign: "right" }}>{m.cnt}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Risk Distribution</div>
          {Object.entries(o.risk_distribution).map(([risk, count]) => (
            <div key={risk} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                background: riskBg[risk] || "var(--bg3)",
                color: riskColor[risk] || "var(--text2)",
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                width: 70, textAlign: "center"
              }}>{risk}</div>
              <div className="bar-bg" style={{ flex: 1, maxWidth: "100%" }}>
                <div className="bar-fill" style={{
                  width: `${(count / o.node_count) * 100}%`,
                  background: riskColor[risk] || "var(--text2)"
                }} />
              </div>
              <div style={{ color: "var(--text2)", fontSize: 12, width: 40, textAlign: "right" }}>{count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
