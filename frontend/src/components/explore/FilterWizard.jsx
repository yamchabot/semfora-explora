import { useEffect, useRef } from "react";
import { dimDisplayLabel } from "../../utils/dimUtils.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function newId() { return Math.random().toString(36).slice(2, 9); }

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, color:"var(--text3)",
      textTransform:"uppercase", letterSpacing:"0.10em", marginBottom:8 }}>
      {children}
    </div>
  );
}

// ── FilterWizard ──────────────────────────────────────────────────────────────
/**
 * Full-screen filter / group-by wizard.
 *
 * Opened automatically when the graph exceeds the size limit, or manually
 * via the config panel.  ESC or clicking outside the card closes it.
 *
 * Changes apply immediately (live) so the user can see the effect in the
 * background as they interact.
 */
export function FilterWizard({
  isOpen,
  onClose,
  forced       = false,   // true → opened because graph too big; disables trivial close
  nodeCount    = 0,
  allDims,                // all available dim keys
  activeDims,             // currently selected dims (string[])
  disabledDims,           // Set<string> of toggled-off dims
  dimValues,              // { module: [...], class: [...] }
  availableKinds,
  activeKinds,
  filters,
  onToggleDim,            // (dim) => void  — add if missing, remove if present
  onToggleDisableDim,     // (dim) => void  — toggle disabled status
  onAddFilter,            // (filter) => void
  onUpdateFilter,         // (filter) => void
  onRemoveFilter,         // (id) => void
  onSetKinds,             // (kinds[]) => void
}) {
  const cardRef = useRef(null);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    function handler(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Current module filter (include / exclude mode)
  const modFilter = filters.find(f => f.kind === "dim" && f.field === "module");

  function toggleModuleValue(v) {
    if (!modFilter) {
      // Create include filter with just this value
      onAddFilter({ id: newId(), kind: "dim", field: "module",
        mode: "include", values: [v], pattern: "" });
    } else {
      const has  = modFilter.values.includes(v);
      const next = has
        ? modFilter.values.filter(x => x !== v)
        : [...modFilter.values, v];
      if (next.length === 0) onRemoveFilter(modFilter.id);
      else                   onUpdateFilter({ ...modFilter, values: next });
    }
  }

  function setModuleMode(mode) {
    if (!modFilter) return;
    onUpdateFilter({ ...modFilter, mode });
  }

  function clearModuleFilter() {
    if (modFilter) onRemoveFilter(modFilter.id);
  }

  const modules          = dimValues?.module ?? [];
  const selectedModules  = modFilter?.values ?? [];
  const moduleMode       = modFilter?.mode ?? "include";
  const moduleActive     = modFilter && selectedModules.length > 0;

  // ── Structural dims for the "Group by" section ─────────────────────────────
  const structDims = ["module", "class", "risk", "kind", "symbol"];

  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)",
        zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}
      onClick={e => { if (!forced && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={cardRef}
        className="card"
        style={{ width:"min(640px, 92vw)", maxHeight:"84vh", overflowY:"auto",
          padding:"24px 28px", boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
          display:"flex", flexDirection:"column", gap:20 }}
      >
        {/* ── Header ── */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--text)", marginBottom:4 }}>
              {forced ? "⚠ Graph too large to render" : "Filter wizard"}
            </div>
            {nodeCount > 0 && (
              <div style={{ fontSize:12, color:"var(--text3)" }}>
                {forced
                  ? `${nodeCount.toLocaleString()} nodes — apply filters to narrow the view`
                  : `${nodeCount.toLocaleString()} nodes in current view`}
              </div>
            )}
          </div>
          {!forced && (
            <button
              onClick={onClose}
              style={{ background:"none", border:"none", fontSize:18, color:"var(--text3)",
                cursor:"pointer", lineHeight:1, padding:"0 2px", flexShrink:0 }}
              title="Close (Esc)"
            >×</button>
          )}
        </div>

        {/* ── Group by ── */}
        <div>
          <SectionLabel>Group by</SectionLabel>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {structDims.map(d => {
              const isActive   = activeDims.includes(d);
              const isDisabled = isActive && disabledDims.has(d);
              return (
                <button
                  key={d}
                  onClick={() => {
                    if (!isActive)       onToggleDim(d);         // add
                    else if (isDisabled) onToggleDisableDim(d);  // re-enable
                    else                 onToggleDisableDim(d);  // disable (keep in list)
                  }}
                  title={isActive
                    ? (isDisabled ? "Click to enable" : "Click to disable (keeps in list)")
                    : "Click to add"}
                  style={{
                    padding:"5px 14px", fontSize:12, borderRadius:6, cursor:"pointer",
                    fontFamily:"monospace", fontWeight: isActive && !isDisabled ? 600 : 400,
                    background: isActive && !isDisabled ? "var(--blue)" : "var(--bg3)",
                    color:      isActive && !isDisabled ? "#fff" : isDisabled ? "var(--text3)" : "var(--text2)",
                    border:     isActive ? "1px solid var(--blue)" : "1px solid var(--border2)",
                    opacity:    isDisabled ? 0.55 : 1,
                    textDecoration: isDisabled ? "line-through" : "none",
                  }}
                >
                  {dimDisplayLabel(d)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize:10, color:"var(--text3)", marginTop:6 }}>
            Active dims define the graph blobs. Disabled dims stay in the list but are excluded from grouping.
          </div>
        </div>

        {/* ── Module focus ── */}
        {modules.length > 0 && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <SectionLabel>Focus on modules</SectionLabel>
              <div style={{ display:"flex", gap:4, marginBottom:8 }}>
                {["include","exclude"].map(mode => (
                  <button key={mode}
                    onClick={() => setModuleMode(mode)}
                    style={{
                      padding:"2px 8px", fontSize:10, borderRadius:4, cursor:"pointer",
                      background: moduleMode === mode && moduleActive ? "var(--blue)" : "var(--bg3)",
                      color:      moduleMode === mode && moduleActive ? "#fff"        : "var(--text3)",
                      border:"1px solid var(--border2)",
                    }}
                  >{mode === "include" ? "only show selected" : "hide selected"}</button>
                ))}
                {moduleActive && (
                  <button onClick={clearModuleFilter}
                    style={{ padding:"2px 8px", fontSize:10, borderRadius:4, cursor:"pointer",
                      background:"none", border:"1px solid var(--border2)", color:"var(--text3)" }}
                  >clear</button>
                )}
              </div>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {modules.map(v => {
                const active = selectedModules.includes(v);
                const hilite = active && moduleMode === "include";
                const hidden = active && moduleMode === "exclude";
                return (
                  <button
                    key={v}
                    onClick={() => toggleModuleValue(v)}
                    style={{
                      padding:"4px 12px", fontSize:11, borderRadius:5, cursor:"pointer",
                      fontFamily:"monospace",
                      background: hilite ? "var(--blue)" : hidden ? "#f8514933" : "var(--bg3)",
                      color:      hilite ? "#fff"        : hidden ? "#f85149"   : "var(--text2)",
                      border:     hilite ? "1px solid var(--blue)"   :
                                  hidden ? "1px solid #f85149" : "1px solid var(--border2)",
                    }}
                  >{v}</button>
                );
              })}
            </div>
            {modules.length === 0 && (
              <div style={{ fontSize:11, color:"var(--text3)" }}>
                Run a query to load module names.
              </div>
            )}
          </div>
        )}

        {/* ── Kind filter ── */}
        {availableKinds.length > 0 && (
          <div>
            <SectionLabel>Kind</SectionLabel>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {availableKinds.map(k => {
                const active = activeKinds.includes(k);
                return (
                  <button
                    key={k}
                    onClick={() => {
                      const next = active
                        ? activeKinds.filter(x => x !== k)
                        : [...activeKinds, k];
                      onSetKinds(next);
                    }}
                    style={{
                      padding:"4px 12px", fontSize:11, borderRadius:5, cursor:"pointer",
                      fontFamily:"monospace",
                      background: active ? "var(--blue)" : "var(--bg3)",
                      color:      active ? "#fff"        : "var(--text2)",
                      border:     active ? "1px solid var(--blue)" : "1px solid var(--border2)",
                    }}
                  >{k}</button>
                );
              })}
            </div>
            {activeKinds.length > 0 && (
              <button onClick={() => onSetKinds([])}
                style={{ marginTop:6, fontSize:10, background:"none", border:"none",
                  color:"var(--text3)", cursor:"pointer", padding:0 }}>
                clear kind filter
              </button>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", paddingTop:4,
          borderTop:"1px solid var(--border)" }}>
          <div style={{ fontSize:11, color:"var(--text3)", flex:1, alignSelf:"center" }}>
            Press <kbd style={{ background:"var(--bg3)", border:"1px solid var(--border2)",
              borderRadius:3, padding:"1px 5px", fontFamily:"monospace", fontSize:10 }}>Esc</kbd> to close
          </div>
          <button
            className="btn btn-sm"
            onClick={onClose}
            disabled={forced && nodeCount > 500}
            title={forced && nodeCount > 500 ? "Add filters to reduce the graph size first" : ""}
            style={{ opacity: forced && nodeCount > 500 ? 0.4 : 1 }}
          >
            {forced ? (nodeCount > 500 ? `Still ${nodeCount.toLocaleString()} nodes…` : "Apply ✓") : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
