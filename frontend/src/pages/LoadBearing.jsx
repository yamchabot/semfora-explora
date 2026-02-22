import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RepoContext } from "../App";
import { api } from "../api";

function NodeCard({ node, type }) {
  const nav = useNavigate();
  const borderColor = type === "load-bearing" ? "var(--purple)" : "var(--red)";
  const bgColor = type === "load-bearing" ? "var(--purple-bg)" : "var(--red-bg)";
  const labelColor = type === "load-bearing" ? "var(--purple)" : "var(--red)";
  const labelText = type === "load-bearing" ? "🏛 Load-Bearing" : "⚠ Unexpected";

  return (
    <div
      className="card"
      style={{ padding: 14, borderColor, cursor: "pointer" }}
      onClick={() => nav(`/blast-radius?hash=${node.hash}&name=${node.name}`)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{node.name}</div>
        <span style={{ background: bgColor, color: labelColor, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12, whiteSpace: "nowrap" }}>
          {labelText}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
        <div>{node.module} · {node.file_path}</div>
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
        <div>
          <span style={{ color: "var(--text2)" }}>Calling modules: </span>
          <strong style={{ color: labelColor }}>{node.calling_module_count}</strong>
        </div>
        <div>
          <span style={{ color: "var(--text2)" }}>Total callers: </span>
          <strong>{node.caller_count}</strong>
        </div>
        <div>
          <span style={{ color: "var(--text2)" }}>Callees: </span>
          <strong>{node.callee_count}</strong>
        </div>
      </div>
    </div>
  );
}

export default function LoadBearing() {
  const { repoId } = useContext(RepoContext);
  const [threshold, setThreshold] = useState(3);

  const { data, isLoading, error } = useQuery({
    queryKey: ["load-bearing", repoId, threshold],
    queryFn: () => api.loadBearing(repoId, threshold),
  });

  if (isLoading) return <div className="loading">Analyzing load-bearing nodes…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const declared = data?.declared_load_bearing || [];
  const unexpected = data?.unexpected_load_bearing || [];

  return (
    <div>
      <div className="page-header">
        <h1>🏛️ Load-Bearing Nodes</h1>
        <p>
          Distinguish expected infrastructure coupling from accidental coupling. Not all
          high-centrality nodes are problems.
        </p>
      </div>

      {/* Explainer */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={{ background: "var(--green-bg)", border: "1px solid var(--green)", borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontWeight: 600, color: "var(--green)", marginBottom: 6 }}>🏛 Load-Bearing (Expected)</div>
          <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
            Infrastructure nodes in <code>core/</code>, <code>platform/</code>, <code>shared/</code>, etc.
            High centrality here is <em>by design</em> — these compress complexity into consistent abstractions.
          </div>
        </div>
        <div style={{ background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 6 }}>⚠ Unexpected Coupling</div>
          <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
            Business-logic nodes that have quietly become load-bearing without being designed for it.
            These fail in non-obvious ways and resist change.
          </div>
        </div>
      </div>

      {/* Threshold control */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>
          Show nodes called from at least
        </span>
        <select value={threshold} onChange={(e) => setThreshold(+e.target.value)} style={{ width: 70 }}>
          {[2, 3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>distinct modules</span>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--purple)" }}>{declared.length}</div>
          <div className="stat-label">Load-bearing nodes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{unexpected.length}</div>
          <div className="stat-label">Unexpected load-bearing</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>
            {declared.length + unexpected.length > 0
              ? Math.round((declared.length / (declared.length + unexpected.length)) * 100)
              : 0}%
          </div>
          <div className="stat-label">Coupling is expected</div>
        </div>
      </div>

      {unexpected.length > 0 && (
        <div className="section">
          <div className="section-title" style={{ color: "var(--red)" }}>
            ⚠ Unexpected Load-Bearing Nodes — Review Required
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {unexpected.map((n) => <NodeCard key={n.hash} node={n} type="unexpected" />)}
          </div>
        </div>
      )}

      {declared.length > 0 && (
        <div className="section">
          <div className="section-title" style={{ color: "var(--purple)" }}>
            🏛 Load-Bearing Infrastructure Nodes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {declared.map((n) => <NodeCard key={n.hash} node={n} type="load-bearing" />)}
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
