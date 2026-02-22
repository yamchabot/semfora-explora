import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

export default function DeadCode() {
  const { repoId } = useContext(RepoContext);
  const [expanded, setExpanded] = useState({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["dead-code", repoId],
    queryFn: () => api.deadCode(repoId),
  });

  if (isLoading) return <div className="loading">Scanning for unreachable symbols…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const toggle = (file) => setExpanded((e) => ({ ...e, [file]: !e[file] }));
  const totalLines = data.file_groups.reduce(
    (sum, g) => sum + g.nodes.reduce((s, n) => s + ((n.line_end || n.line_start || 0) - (n.line_start || 0)), 0),
    0
  );

  return (
    <div>
      <div className="page-header">
        <h1>🪦 Dead Code Detector</h1>
        <p>
          Symbols with zero callers — unreachable from any known entrypoint. The safest refactor is
          deleting code nothing calls.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{data.total_dead.toLocaleString()}</div>
          <div className="stat-label">Dead symbols</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>{data.safe_count ?? 0}</div>
          <div className="stat-label">✓ Safe to delete</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--yellow)" }}>{data.review_count ?? 0}</div>
          <div className="stat-label">Needs review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--text2)" }}>{data.caution_count ?? 0}</div>
          <div className="stat-label">Likely false positive</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "✓ Safe", color: "var(--green)", bg: "var(--green-bg)", desc: "Private names, low complexity, not in test files. High confidence actually unused." },
          { label: "⚠ Review", color: "var(--yellow)", bg: "var(--yellow-bg)", desc: "No callers found but pattern not conclusively private. Verify before deleting." },
          { label: "⊘ Caution", color: "var(--text3)", bg: "var(--bg3)", desc: "Likely a false positive: entrypoints, test hooks, public APIs, class definitions." },
        ].map(({ label, color, bg, desc }) => (
          <div key={label} style={{ background: bg, border: `1px solid ${color}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
            <div style={{ fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
            <div style={{ color: "var(--text2)", lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>

      {data.file_groups.map((group) => (
        <div key={group.file} className="card" style={{ marginBottom: 10, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 16px",
              background: "var(--bg3)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              borderBottom: expanded[group.file] ? "1px solid var(--border)" : "none",
            }}
            onClick={() => toggle(group.file)}
          >
            <span style={{ fontSize: 12, color: "var(--text2)" }}>{expanded[group.file] ? "▾" : "▸"}</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--blue)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {group.file}
            </span>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {group.safe_count > 0 && (
                <span style={{ background: "var(--green-bg)", color: "var(--green)", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 12 }}>
                  {group.safe_count} safe
                </span>
              )}
              <span style={{ background: "var(--red-bg)", color: "var(--red)", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 12 }}>
                {group.dead_count} dead
              </span>
            </div>
          </div>

          {expanded[group.file] && (
            <div>
              {group.nodes.map((node) => (
                <div
                  key={node.hash}
                  style={{
                    padding: "9px 16px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    fontSize: 12,
                    opacity: node.confidence === "caution" ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{node.name}</span>
                    <span style={{ background: "var(--bg3)", color: "var(--text2)", fontSize: 10, padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>
                      {node.kind}
                    </span>
                    {node.confidence === "safe" && (
                      <span style={{ background: "var(--green-bg)", color: "var(--green)", fontSize: 10, padding: "1px 6px", borderRadius: 4, marginLeft: 4, fontWeight: 700 }}>
                        ✓ safe
                      </span>
                    )}
                    {node.confidence === "caution" && (
                      <span style={{ background: "var(--bg3)", color: "var(--text3)", fontSize: 10, padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>
                        ⊘ likely false positive
                      </span>
                    )}
                    {node.complexity > 5 && (
                      <span style={{ background: "var(--yellow-bg)", color: "var(--yellow)", fontSize: 10, padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>
                        complexity {node.complexity}
                      </span>
                    )}
                    <div style={{ color: "var(--text3)", marginTop: 2 }}>{node.module}</div>
                  </div>
                  <div style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>L:{node.line_start}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
