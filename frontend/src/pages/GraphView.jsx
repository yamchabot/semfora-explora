import { useContext, useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";
import { RepoContext } from "../App";
import { api } from "../api";

const MODULE_COLORS = [
  "#58a6ff","#3fb950","#e3b341","#f85149","#a371f7",
  "#39c5cf","#ff9966","#c8c8ff","#79c0ff","#56d364",
];

function moduleColor(module, colorMap) {
  if (!colorMap.has(module)) {
    colorMap.set(module, MODULE_COLORS[colorMap.size % MODULE_COLORS.length]);
  }
  return colorMap.get(module);
}

export default function GraphView() {
  const { repoId } = useContext(RepoContext);
  const [module, setModule] = useState("");
  const [moduleInput, setModuleInput] = useState("");
  const [selected, setSelected] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const colorMap = useRef(new Map());
  const fgRef = useRef();

  const { data: modulesData } = useQuery({
    queryKey: ["modules", repoId],
    queryFn: () => api.modules(repoId),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["graph", repoId, module],
    queryFn: () => api.graph(repoId, { module: module || undefined, limit: 300 }),
  });

  const { data: nodeDetail } = useQuery({
    queryKey: ["node", repoId, selected],
    queryFn: () => api.node(repoId, selected),
    enabled: !!selected,
  });

  const graphData = useCallback(() => {
    if (!data) return { nodes: [], links: [] };
    const nodeMap = new Map(data.nodes.map((n) => [n.hash, n]));
    return {
      nodes: data.nodes.map((n) => ({
        id: n.hash,
        name: n.name,
        module: n.module,
        kind: n.kind,
        caller_count: n.caller_count,
        callee_count: n.callee_count,
        risk: n.risk,
        file_path: n.file_path,
        val: Math.log(1 + (n.caller_count || 0)) + 1,
        color: moduleColor(n.module, colorMap.current),
      })),
      links: data.edges.map((e) => ({
        source: e.caller_hash,
        target: e.callee_hash,
        call_count: e.call_count,
      })),
    };
  }, [data]);

  const gd = graphData();

  const handleNodeClick = useCallback((node) => {
    setSelected(node.id);
  }, []);

  // Risk color override
  const nodeColor = (node) => {
    if (node.risk === "critical") return "#f85149";
    if (node.risk === "high") return "#e3b341";
    return moduleColor(node.module, colorMap.current);
  };

  return (
    <div>
      <div className="page-header">
        <h1>🕸️ Call Graph</h1>
        <p>Interactive force-directed visualization of symbol dependencies. Node size = number of callers.</p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={module}
          onChange={(e) => { setModule(e.target.value); colorMap.current.clear(); }}
          style={{ minWidth: 200 }}
        >
          <option value="">All modules (first 300 nodes)</option>
          {modulesData?.modules?.map((m) => (
            <option key={m.module} value={m.module}>{m.module} ({m.symbol_count})</option>
          ))}
        </select>
        <span style={{ color: "var(--text2)", fontSize: 12 }}>
          {data ? `${data.nodes.length} nodes · ${data.edges.length} edges` : ""}
        </span>
        {fgRef.current && (
          <button className="btn btn-ghost btn-sm" onClick={() => fgRef.current.zoomToFit(400)}>
            Fit view
          </button>
        )}
      </div>

      <div className="two-col">
        {/* Graph */}
        <div className="graph-canvas">
          {isLoading && <div className="loading">Loading graph…</div>}
          {error && <div className="error">{error.message}</div>}
          {!isLoading && !error && (
            <ForceGraph2D
              ref={fgRef}
              graphData={gd}
              nodeLabel={(n) => `${n.name}\n${n.module}\n${n.caller_count} callers`}
              nodeColor={nodeColor}
              nodeRelSize={4}
              linkColor={() => "#30363d"}
              linkWidth={0.5}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              backgroundColor="#161b22"
              onNodeClick={handleNodeClick}
              onBackgroundClick={() => setSelected(null)}
              nodeCanvasObjectMode={() => "after"}
              nodeCanvasObject={(node, ctx, globalScale) => {
                if (globalScale < 3) return;
                const label = node.name;
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px sans-serif`;
                ctx.fillStyle = "rgba(230,237,243,0.9)";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, node.x, node.y + 6 / globalScale);
              }}
            />
          )}
        </div>

        {/* Node detail panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13, color: "var(--text2)" }}>
              {selected ? "Selected Node" : "Click a node to inspect"}
            </div>
            {selected && nodeDetail && (
              <div>
                <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                  {nodeDetail.node.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
                  <div><strong>Module:</strong> {nodeDetail.node.module}</div>
                  <div><strong>File:</strong> {nodeDetail.node.file_path}:{nodeDetail.node.line_start}</div>
                  <div><strong>Kind:</strong> {nodeDetail.node.kind}</div>
                  <div><strong>Callers:</strong> {nodeDetail.node.caller_count}</div>
                  <div><strong>Callees:</strong> {nodeDetail.node.callee_count}</div>
                  <div><strong>Risk:</strong> <span style={{ color: nodeDetail.node.risk === "high" || nodeDetail.node.risk === "critical" ? "var(--red)" : "var(--text2)" }}>{nodeDetail.node.risk}</span></div>
                </div>
                {nodeDetail.callers.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Callers ({nodeDetail.callers.length})</div>
                    <div style={{ maxHeight: 140, overflowY: "auto" }}>
                      {nodeDetail.callers.slice(0, 10).map((c) => (
                        <div key={c.hash} className="node-item" onClick={() => setSelected(c.hash)}>
                          <div>
                            <div className="node-name">{c.name}</div>
                            <div className="node-meta">{c.module}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {nodeDetail.callees.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Calls ({nodeDetail.callees.length})</div>
                    <div style={{ maxHeight: 140, overflowY: "auto" }}>
                      {nodeDetail.callees.slice(0, 10).map((c) => (
                        <div key={c.hash} className="node-item" onClick={() => setSelected(c.hash)}>
                          <div>
                            <div className="node-name">{c.name}</div>
                            <div className="node-meta">{c.module}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Module legend */}
          {gd.nodes.length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Modules</div>
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {[...colorMap.current.entries()].slice(0, 20).map(([mod, color]) => (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <div style={{ fontFamily: "monospace", color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mod}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
