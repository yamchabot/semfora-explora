/**
 * PatternPanel — detects and highlights classic programming patterns in the graph.
 *
 * Shows a collapsible side panel listing detected pattern types and their instances.
 * Clicking an instance pushes node color overrides to GraphRenderer via callback.
 *
 * Pattern → node highlight color scheme (consistent across sessions):
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";

// One color per pattern family — vivid, distinct, readable on dark bg
const PATTERN_COLORS = {
  singleton:               "#f5a623",   // amber
  factory_method:          "#ff7849",   // orange
  observer:                "#50fa7b",   // green
  decorator_chain:         "#ff79c6",   // pink
  facade:                  "#bd93f9",   // purple
  composite_recursive:     "#8be9fd",   // cyan
  strategy:                "#ffb86c",   // peach
  chain_of_responsibility: "#ff5555",   // red
  template_method:         "#f1fa8c",   // yellow
  command:                 "#6272a4",   // muted blue
  map_reduce:              "#00b4d8",   // sky blue
  mediator:                "#ff6e91",   // coral
  mutual_recursion:        "#ff2d55",   // hot red
  layered_architecture:    "#a8ff78",   // lime
  proxy:                   "#c9a227",   // gold
  pipeline:                "#e040fb",   // violet
};

const PATTERN_ICONS = {
  singleton:               "⭐",
  factory_method:          "🏭",
  observer:                "📡",
  decorator_chain:         "🎁",
  facade:                  "🏛️",
  composite_recursive:     "🌳",
  strategy:                "#️⃣",
  chain_of_responsibility: "⛓️",
  template_method:         "📋",
  command:                 "⌘",
  map_reduce:              "⚡",
  mediator:                "🔀",
  mutual_recursion:        "🔄",
  layered_architecture:    "📚",
  proxy:                   "🪞",
  pipeline:                "🔧",
};

export function PatternPanel({ repoId, onHighlight, activePatternKey }) {
  const [expanded, setExpanded]     = useState(null);  // pattern key expanded
  const [minConf, setMinConf]       = useState(0.60);

  const { data, isLoading, error } = useQuery({
    queryKey:  ["patterns", repoId, minConf],
    queryFn:   () => api.patterns(repoId, minConf),
    staleTime: 5 * 60 * 1000,
  });

  const patterns = data?.patterns ?? [];

  function handlePatternClick(patternKey) {
    setExpanded(exp => exp === patternKey ? null : patternKey);
  }

  function handleInstanceClick(e, pattern, inst) {
    e.stopPropagation();
    const color = PATTERN_COLORS[pattern.pattern] ?? "#ffffff";
    // Build nodeColorOverrides: { nodeId → color }
    const overrides = {};
    for (const label of inst.node_labels ?? []) {
      // node_labels are "module.name" — graph node ids are the name part only OR module::name
      // We emit all forms; GraphRenderer will match by whatever id it uses
      overrides[label] = color;
      const parts = label.split(".");
      if (parts.length === 2) {
        overrides[parts[1]] = color;                   // bare name
        overrides[`${parts[0]}::${parts[1]}`] = color; // module::name form
        overrides[`${parts[1]}::${parts[0]}`] = color; // name::module form (blob)
      }
    }
    onHighlight(pattern.pattern, overrides, color, inst);
  }

  function handleClearHighlight(e) {
    e.stopPropagation();
    onHighlight(null, {}, null, null);
  }

  if (isLoading) return (
    <div style={styles.panel}>
      <div style={styles.header}>🧩 Patterns</div>
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text3)" }}>Detecting…</div>
    </div>
  );

  if (error) return (
    <div style={styles.panel}>
      <div style={styles.header}>🧩 Patterns</div>
      <div style={{ padding: "12px 16px", fontSize: 11, color: "var(--red)" }}>{error.message}</div>
    </div>
  );

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span>🧩 Patterns</span>
        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>
          {data?.total_pattern_types ?? 0} types · {data?.total_instances ?? 0} instances
        </span>
        {activePatternKey && (
          <button
            onClick={handleClearHighlight}
            style={{ ...styles.clearBtn, marginLeft: "auto" }}
            title="Clear highlight"
          >✕ clear</button>
        )}
      </div>

      {/* Confidence slider */}
      <div style={styles.confRow}>
        <label style={{ fontSize: 11, color: "var(--text3)" }}>
          min confidence: {Math.round(minConf * 100)}%
        </label>
        <input
          type="range" min="0.40" max="0.95" step="0.05"
          value={minConf}
          onChange={e => setMinConf(parseFloat(e.target.value))}
          style={{ flex: 1, marginLeft: 8, accentColor: "var(--blue)" }}
        />
      </div>

      {/* Pattern list */}
      <div style={styles.list}>
        {patterns.length === 0 && (
          <div style={{ padding: "16px", fontSize: 12, color: "var(--text3)", textAlign: "center" }}>
            No patterns detected at {Math.round(minConf * 100)}% confidence
          </div>
        )}
        {patterns.map(p => {
          const color = PATTERN_COLORS[p.pattern] ?? "#aaa";
          const icon  = PATTERN_ICONS[p.pattern]  ?? "◆";
          const isExp = expanded === p.pattern;
          const isActive = activePatternKey === p.pattern;
          return (
            <div key={p.pattern}>
              {/* Pattern row */}
              <div
                style={{
                  ...styles.patternRow,
                  background: isActive ? `${color}22` : "transparent",
                  borderLeft: `3px solid ${isActive ? color : "transparent"}`,
                }}
                onClick={() => handlePatternClick(p.pattern)}
              >
                <span style={{ fontSize: 14, marginRight: 6 }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>
                  {p.display_name}
                </span>
                <span style={{
                  fontSize: 11, color, fontWeight: 600,
                  background: `${color}22`, padding: "1px 6px", borderRadius: 10,
                }}>
                  {p.count}
                </span>
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text3)" }}>
                  {isExp ? "▲" : "▼"}
                </span>
              </div>

              {/* Instances (expanded) */}
              {isExp && (
                <div style={styles.instances}>
                  {p.instances.slice(0, 8).map((inst, i) => (
                    <div
                      key={i}
                      style={styles.instanceRow}
                      onClick={e => handleInstanceClick(e, p, inst)}
                      title={`Click to highlight in graph\n${inst.node_labels?.join(", ")}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 10, color, fontWeight: 600 }}>
                          conf {Math.round(inst.confidence * 100)}%
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text3)" }}>
                          {inst.nodes?.length ?? 0} nodes
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.4 }}>
                        {inst.description.length > 90
                          ? inst.description.slice(0, 90) + "…"
                          : inst.description}
                      </div>
                    </div>
                  ))}
                  {p.instances.length > 8 && (
                    <div style={{ fontSize: 11, color: "var(--text3)", padding: "4px 12px" }}>
                      +{p.instances.length - 8} more instances
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    position:    "absolute",
    top:         8,
    right:       8,
    width:       300,
    maxHeight:   "calc(100vh - 120px)",
    background:  "var(--card-bg, #161b22)",
    border:      "1px solid var(--border)",
    borderRadius: 8,
    overflow:    "hidden",
    display:     "flex",
    flexDirection: "column",
    zIndex:      20,
    boxShadow:   "0 4px 24px rgba(0,0,0,0.5)",
  },
  header: {
    display:        "flex",
    alignItems:     "center",
    padding:        "10px 12px",
    fontSize:       13,
    fontWeight:     600,
    borderBottom:   "1px solid var(--border)",
    flexShrink:     0,
    background:     "var(--card-bg)",
  },
  confRow: {
    display:      "flex",
    alignItems:   "center",
    padding:      "6px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink:   0,
  },
  list: {
    overflowY:  "auto",
    flex:       1,
  },
  patternRow: {
    display:     "flex",
    alignItems:  "center",
    padding:     "8px 12px",
    cursor:      "pointer",
    borderBottom: "1px solid var(--border)",
    transition:  "background 0.12s",
  },
  instances: {
    background:   "var(--bg2, #0d1117)",
    borderBottom: "1px solid var(--border)",
  },
  instanceRow: {
    padding:    "8px 12px 8px 20px",
    cursor:     "pointer",
    borderBottom: "1px solid var(--border)",
    transition: "background 0.1s",
  },
  clearBtn: {
    fontSize:     10,
    background:   "transparent",
    border:       "1px solid var(--border)",
    borderRadius: 4,
    color:        "var(--text3)",
    cursor:       "pointer",
    padding:      "2px 6px",
  },
};
