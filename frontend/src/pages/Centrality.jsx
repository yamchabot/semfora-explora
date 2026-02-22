import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RepoContext } from "../App";
import { api } from "../api";

export default function Centrality() {
  const { repoId } = useContext(RepoContext);
  const nav = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["centrality", repoId],
    queryFn: () => api.centrality(repoId, 40),
  });

  if (isLoading) return <div className="loading">Computing centrality scores…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const nodes = data?.nodes || [];
  const maxScore = nodes[0]?.centrality || 1;

  const riskColor = (r) => ({ critical: "var(--red)", high: "var(--yellow)", medium: "var(--blue)", low: "var(--text2)" }[r] || "var(--text2)");

  return (
    <div>
      <div className="page-header">
        <h1>⭐ Centrality — High-Risk Nodes</h1>
        <p>
          The most central nodes in the call graph — everything flows through them. Changes here
          have the widest blast radius. Scored by in-degree (proxy for betweenness centrality).
        </p>
      </div>

      <div style={{ background: "var(--yellow-bg)", border: "1px solid var(--yellow)", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13 }}>
        ⚠ High-centrality nodes are your highest-risk refactoring targets. Before modifying any, run
        a <span style={{ color: "var(--blue)", cursor: "pointer" }} onClick={() => nav("/blast-radius")}>Blast Radius</span> analysis.
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Module</th>
              <th>Centrality</th>
              <th>Callers</th>
              <th>Callees</th>
              <th>Risk</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node, i) => (
              <tr key={node.hash}>
                <td style={{ color: "var(--text3)", width: 32 }}>{i + 1}</td>
                <td>
                  <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12 }}>{node.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{node.file_path}</div>
                </td>
                <td>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text2)" }}>{node.module}</span>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="bar-bg" style={{ width: 80 }}>
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(node.centrality / maxScore) * 100}%`,
                          background: node.centrality / maxScore > 0.6 ? "var(--red)" : node.centrality / maxScore > 0.3 ? "var(--yellow)" : "var(--blue)",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{node.centrality.toFixed(3)}</span>
                  </div>
                </td>
                <td style={{ fontWeight: 600, color: node.caller_count > 20 ? "var(--red)" : "var(--text)" }}>{node.caller_count}</td>
                <td style={{ color: "var(--text2)" }}>{node.callee_count}</td>
                <td>
                  <span style={{ color: riskColor(node.risk), fontSize: 12 }}>{node.risk}</span>
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => nav(`/blast-radius`)}
                  >
                    💥
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
