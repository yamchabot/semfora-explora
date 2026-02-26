/**
 * NodeMetaPanel
 *
 * A rich side panel that fetches and displays full node metadata when a
 * symbol-level node is selected in the graph.  Shows new schema fields:
 * is_async, arity, is_exported, is_self_recursive, decorators, base_classes,
 * return_type, framework_entry_point — plus callers / callees / inheritance.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function Badge({ label, color, bg, title }) {
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center",
      fontSize: 10, fontWeight: 700, padding: "1px 6px",
      borderRadius: 8, background: bg, color,
      border: `1px solid ${color}33`, whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function Field({ label, value, mono = false }) {
  if (value == null || value === "" || value === false || value === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0, minWidth: 70 }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: "var(--text2)",
        fontFamily: mono ? "monospace" : "inherit",
        wordBreak: "break-all",
      }}>
        {value === true ? "yes" : String(value)}
      </span>
    </div>
  );
}

function NodeRef({ node, xmod }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 4,
      padding: "2px 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{
        fontFamily: "monospace", fontSize: 11,
        color: xmod ? "var(--blue)" : "var(--text2)",
        fontWeight: 600, flexShrink: 0,
      }}>
        {node.name}
      </span>
      {xmod && (
        <span style={{ fontSize: 10, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.module}
        </span>
      )}
    </div>
  );
}

function Section({ title, children, count }) {
  if (!count) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.06em", color: "var(--text3)", marginBottom: 4,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {title}
        <span style={{ fontWeight: 400, color: "var(--text3)" }}>({count})</span>
      </div>
      <div style={{ maxHeight: 120, overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NodeMetaPanel({ repoId, sym, nodeModule }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["node-meta", repoId, sym],
    queryFn:  () => api.lookupNode(repoId, sym),
    enabled:  !!repoId && !!sym,
    staleTime: 30_000,
  });

  if (!sym) {
    return (
      <div style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", paddingTop: 30, padding: "30px 16px 0" }}>
        Click a symbol node to see details
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ color: "var(--text3)", fontSize: 12, padding: "12px 0", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (isError || !data?.node) {
    return (
      <div style={{ color: "var(--text3)", fontSize: 12, padding: "12px 0" }}>
        Node not found
      </div>
    );
  }

  const n = data.node;
  const callers  = data.callers  || [];
  const callees  = data.callees  || [];
  const parents  = data.parents  || [];
  const children = data.children || [];

  // Parse decoration list (comma-separated)
  const decorators = n.decorators ? n.decorators.split(",").filter(Boolean) : [];

  // Parse base classes (comma-separated)
  const baseClasses = n.base_classes ? n.base_classes.split(",").filter(Boolean) : [];

  const symModule = n.module;

  return (
    <div style={{ fontSize: 12, padding: "0 2px" }}>
      {/* ── Name + badges ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontFamily: "monospace", fontWeight: 700, fontSize: 13,
          color: "var(--text)", wordBreak: "break-all", marginBottom: 4,
        }}>
          {n.name}
        </div>
        <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 6 }}>
          {n.module} · {n.kind}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {n.is_async   === 1 && <Badge label="async"     color="#58a6ff" bg="#1d3050" title="Asynchronous function" />}
          {n.is_self_recursive === 1 && <Badge label="recursive" color="#d29922" bg="#2d2100" title="Self-recursive function" />}
          {n.is_exported === 1 && <Badge label="exported"  color="#3fb950" bg="#0d2d1f" title="Exported / public symbol" />}
          {n.framework_entry_point === "TestFunction" && <Badge label="test" color="#bc8cff" bg="#2d1d4d" title="Test function" />}
          {n.framework_entry_point && n.framework_entry_point !== "TestFunction" && (
            <Badge label={n.framework_entry_point} color="#f0883e" bg="#2d1a00" title="Framework entry point" />
          )}
          {n.risk === "high"   && <Badge label="high risk"  color="#f85149" bg="#2d1a1a" />}
          {n.risk === "medium" && <Badge label="medium risk" color="#d29922" bg="#2d2100" />}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginBottom: 8 }} />

      {/* ── Core fields ────────────────────────────────────────────── */}
      <Field label="arity"   value={n.arity} />
      <Field label="complexity" value={n.complexity} />
      <Field label="callers" value={n.caller_count} />
      <Field label="callees" value={n.callee_count} />
      <Field label="returns" value={n.return_type} mono />
      <Field label="file"    value={n.file_path ? `${n.file_path}:${n.line_start}` : null} mono />

      {/* ── Decorators ─────────────────────────────────────────────── */}
      {decorators.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>decorators</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {decorators.map((d, i) => (
              <span key={i} style={{
                fontFamily: "monospace", fontSize: 10,
                background: "var(--bg3)", border: "1px solid var(--border2)",
                borderRadius: 4, padding: "1px 5px", color: "var(--yellow)",
              }}>
                {d.startsWith("@") ? d : `@${d}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Base classes / Parents ─────────────────────────────────── */}
      {(baseClasses.length > 0 || parents.length > 0) && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>extends</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {baseClasses.map((cls, i) => (
              <span key={i} style={{
                fontFamily: "monospace", fontSize: 10,
                background: "var(--bg3)", border: "1px solid var(--blue)44",
                borderRadius: 4, padding: "1px 5px", color: "var(--blue)",
              }}>
                {cls}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Inheritance children ───────────────────────────────────── */}
      <Section title="Subclasses" count={children.length}>
        {children.map(c => (
          <NodeRef key={c.hash} node={c} xmod={c.module !== symModule} />
        ))}
      </Section>

      {/* ── Callers / Callees ──────────────────────────────────────── */}
      <Section title="Called by" count={callers.length}>
        {callers.slice(0, 20).map(c => (
          <NodeRef key={c.hash} node={c} xmod={c.module !== symModule} />
        ))}
        {callers.length > 20 && (
          <div style={{ fontSize: 10, color: "var(--text3)", padding: "2px 0" }}>
            +{callers.length - 20} more
          </div>
        )}
      </Section>

      <Section title="Calls" count={callees.length}>
        {callees.slice(0, 20).map(c => (
          <NodeRef key={c.hash} node={c} xmod={c.module !== symModule} />
        ))}
        {callees.length > 20 && (
          <div style={{ fontSize: 10, color: "var(--text3)", padding: "2px 0" }}>
            +{callees.length - 20} more
          </div>
        )}
      </Section>
    </div>
  );
}
