import { useContext, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RepoContext } from "../App";
import { api } from "../api";

function NodeRow({ node, onDeclare, onUndeclare }) {
  const isExplicit = node.declaration === "explicit";
  const isAuto = node.declaration === "auto";
  const isLB = node.is_load_bearing;

  return (
    <div style={{
      padding: "12px 16px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{node.name}</span>
          {isExplicit && (
            <span style={{ background: "var(--purple-bg)", color: "var(--purple)", fontSize: 10, padding: "1px 7px", borderRadius: 12, fontWeight: 600 }}>
              🏛 declared
            </span>
          )}
          {isAuto && (
            <span style={{ background: "var(--bg3)", color: "var(--text2)", fontSize: 10, padding: "1px 7px", borderRadius: 12 }}>
              auto-detected
            </span>
          )}
          {!isLB && (
            <span style={{ background: "var(--red-bg)", color: "var(--red)", fontSize: 10, padding: "1px 7px", borderRadius: 12, fontWeight: 600 }}>
              ⚠ unexpected
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text2)" }}>
          {node.module} · {node.file_path}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 12 }}>
          <span style={{ color: node.calling_module_count >= 5 ? "var(--red)" : "var(--yellow)" }}>
            {node.calling_module_count} modules depend on this
          </span>
          <span style={{ color: "var(--text3)" }}>{node.caller_count} total callers</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
        {isExplicit ? (
          <button
            className="btn btn-sm btn-ghost"
            style={{ borderColor: "var(--red)", color: "var(--red)", fontSize: 11 }}
            onClick={() => onUndeclare(node.hash)}
          >
            undeclare
          </button>
        ) : (
          <button
            className="btn btn-sm"
            style={{ background: "var(--purple-bg)", color: "var(--purple)", border: "1px solid var(--purple)", fontSize: 11 }}
            onClick={() => onDeclare(node.hash)}
          >
            🏛 declare load-bearing
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoadBearing() {
  const { repoId } = useContext(RepoContext);
  const [threshold, setThreshold] = useState(3);
  const [moduleInput, setModuleInput] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["load-bearing", repoId, threshold],
    queryFn: () => api.loadBearing(repoId, threshold),
  });

  const declare = useMutation({
    mutationFn: ({ hash, module, remove }) => api.lbDeclare(repoId, hash, module, remove),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["load-bearing", repoId] }),
  });

  if (isLoading) return <div className="loading">Analyzing load-bearing nodes…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const declared = data?.declared_load_bearing || [];
  const unexpected = data?.unexpected_load_bearing || [];
  const config = data?.config || {};
  const declaredModules = config.declared_modules || [];

  return (
    <div>
      <div className="page-header">
        <h1>🏛️ Load-Bearing Nodes</h1>
        <p>
          Distinguish expected infrastructure coupling from accidental coupling. Declare nodes
          explicitly, or let Semfora auto-detect by module naming convention.
        </p>
      </div>

      {/* Concept cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={{ background: "var(--purple-bg)", border: "1px solid var(--purple)44", borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontWeight: 600, color: "var(--purple)", marginBottom: 6 }}>🏛 Load-Bearing (Expected)</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            Infrastructure nodes intentionally shared across the codebase — gateways, queues, DB clients.
            High centrality here is <em>by design</em>. Like a structural column: it's supposed to carry weight.
          </div>
        </div>
        <div style={{ background: "var(--red-bg)", border: "1px solid var(--red)44", borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 6 }}>⚠ Unexpected Coupling</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            Business-logic or feature code quietly becoming a dependency of everything else.
            These weren't designed to bear weight — they'll fail non-obviously and resist refactoring.
          </div>
        </div>
      </div>

      {/* Stats + controls */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div className="stat-grid" style={{ flex: 1 }}>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--purple)" }}>{declared.length}</div>
            <div className="stat-label">Load-bearing</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--red)" }}>{unexpected.length}</div>
            <div className="stat-label">Unexpected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--green)" }}>
              {declared.length + unexpected.length > 0
                ? Math.round((declared.length / (declared.length + unexpected.length)) * 100) : 0}%
            </div>
            <div className="stat-label">Expected coupling</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Min modules:</span>
          <select value={threshold} onChange={(e) => setThreshold(+e.target.value)} style={{ width: 60 }}>
            {[2, 3, 4, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => nav("/building")}
          style={{ borderColor: "var(--purple)", color: "var(--purple)" }}
        >
          🏗 View as Building
        </button>
      </div>

      {/* Declare by module */}
      <div className="card" style={{ padding: 14, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Declare entire module as load-bearing</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            style={{ flex: 1, fontFamily: "monospace" }}
            placeholder="e.g. src.core, platform, shared.utils"
            value={moduleInput}
            onChange={(e) => setModuleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && moduleInput.trim()) {
                declare.mutate({ module: moduleInput.trim(), remove: false });
                setModuleInput("");
              }
            }}
          />
          <button
            className="btn btn-sm"
            style={{ background: "var(--purple-bg)", color: "var(--purple)", border: "1px solid var(--purple)" }}
            onClick={() => {
              if (moduleInput.trim()) {
                declare.mutate({ module: moduleInput.trim(), remove: false });
                setModuleInput("");
              }
            }}
          >
            🏛 Declare module
          </button>
        </div>
        {declaredModules.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {declaredModules.map((m) => (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--purple-bg)", border: "1px solid var(--purple)44", borderRadius: 12, padding: "2px 10px", fontSize: 12 }}>
                <span style={{ fontFamily: "monospace", color: "var(--purple)" }}>{m}</span>
                <button
                  style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: "0 2px", fontSize: 13 }}
                  onClick={() => declare.mutate({ module: m, remove: true })}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unexpected — most important to review */}
      {unexpected.length > 0 && (
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div className="section-title" style={{ color: "var(--red)", margin: 0 }}>
              ⚠ Unexpected Load-Bearing — Review Required
            </div>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>
              If intentional, click "declare" to mark as expected
            </span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {unexpected.map((n) => (
              <NodeRow
                key={n.hash}
                node={n}
                onDeclare={(hash) => declare.mutate({ hash, remove: false })}
                onUndeclare={(hash) => declare.mutate({ hash, remove: true })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Declared */}
      {declared.length > 0 && (
        <div className="section">
          <div className="section-title" style={{ color: "var(--purple)" }}>🏛 Load-Bearing Nodes</div>
          <div className="card" style={{ overflow: "hidden" }}>
            {declared.map((n) => (
              <NodeRow
                key={n.hash}
                node={n}
                onDeclare={(hash) => declare.mutate({ hash, remove: false })}
                onUndeclare={(hash) => declare.mutate({ hash, remove: true })}
              />
            ))}
          </div>
        </div>
      )}

      {declared.length === 0 && unexpected.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
          No nodes found called from {threshold}+ distinct modules. Try lowering the threshold.
        </div>
      )}
    </div>
  );
}
