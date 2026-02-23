import { useContext, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";
import { applyFilters } from "../utils/filterUtils.js";
import { DEFAULT_DIMS, DEFAULT_MEASURES } from "../utils/exploreConstants.js";
import { measureKey, measureStr, measureLabel, parseMeasuresParam } from "../utils/measureUtils.js";
import { parseFiltersParam } from "../utils/dimUtils.js";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { FilterChip, AddFilterMenu }      from "../components/explore/FilterControls.jsx";
import { SortableMeasureChip, AddMeasureMenu } from "../components/explore/MeasureControls.jsx";
import { SortableDimChip, AddDimMenu }    from "../components/explore/DimControls.jsx";
import { KindFilter }                     from "../components/explore/KindFilter.jsx";
import { PivotTable }                     from "../components/explore/PivotTable.jsx";
import { GraphNodeDetails }               from "../components/explore/GraphNodeDetails.jsx";
import { NodeTable }                      from "../components/explore/NodeTable.jsx";
import GraphRenderer                      from "../components/GraphRenderer.jsx";

// parseMeasuresParam → measureUtils.js  |  parseFiltersParam → dimUtils.js

export default function Explore() {
  const { repoId, setRepoId } = useContext(RepoContext);
  const [searchParams, setSearchParams] = useSearchParams();

  // Lazy-init all state from URL params (runs once on mount)
  const [dims,             setDims]             = useState(() => {
    const d = searchParams.get("d");
    return d ? d.split(",").filter(Boolean) : DEFAULT_DIMS;
  });
  const [measures,         setMeasures]         = useState(() =>
    parseMeasuresParam(searchParams.get("m"))
  );
  const [kinds,            setKinds]            = useState(() => {
    const k = searchParams.get("k");
    return k ? k.split(",").filter(Boolean) : [];
  });
  const [renderer,         setRenderer]         = useState(() =>
    searchParams.get("v") || "graph"
  );
  const [filters,          setFilters]          = useState(() =>
    parseFiltersParam(searchParams.get("f"))
  );
  // ── Graph renderer config (lifted here so URL can persist them) ─────────────
  const [minWeight,        setMinWeight]        = useState(() => parseFloat(searchParams.get("mw")) || 1);
  const [topK,             setTopK]             = useState(() => parseInt(searchParams.get("tk"))   || 0);
  const [colorKeyOverride, setColorKeyOverride] = useState(() => searchParams.get("c") || null);
  const [fanOutDepth,      setFanOutDepth]      = useState(() => parseInt(searchParams.get("hops")) || 5);
  const [selectedNodeIds,  setSelectedNodeIds]  = useState(() => {
    const s = searchParams.get("sel");
    return s ? new Set(s.split(",").filter(Boolean)) : new Set();
  });
  const [hideIsolated, setHideIsolated] = useState(() => searchParams.get("hi") === "1");
  const [nodeDot,      setNodeDot]      = useState(() => searchParams.get("nd") === "1");

  // ── Compare / diff overlay ───────────────────────────────────────────────
  const [compareRepo, setCompareRepo] = useState(() => searchParams.get("cmp") || "");

  const [selectedNode,  setSelectedNode]  = useState(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);
  const [configOpen,    setConfigOpen]    = useState(true);
  const closeTimerRef = useRef(null);

  function startCloseTimer()  { closeTimerRef.current = setTimeout(() => setConfigOpen(false), 5000); }
  function cancelCloseTimer() { clearTimeout(closeTimerRef.current); }
  const configCardRef                   = useRef(null);
  const [controlsRect, setControlsRect] = useState({ width: 0, height: 0 });

  // Measure the floating config card so GraphRenderer can offset its center
  useEffect(() => {
    if (!configCardRef.current) {
      setControlsRect({ width: 0, height: 0 });
      return;
    }
    const obs = new ResizeObserver(() => {
      const r = configCardRef.current?.getBoundingClientRect();
      if (r) setControlsRect({ width: r.width, height: r.height });
    });
    obs.observe(configCardRef.current);
    return () => obs.disconnect();
  }, [sidebarOpen, renderer]); // re-run when card appears/disappears or layout changes

  // DnD sensors — require 5px of movement before activating so clicks still work
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDimDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setDims(prev => {
      const oldIdx = prev.indexOf(active.id);
      const newIdx = prev.indexOf(over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function handleMeasureDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setMeasures(prev => {
      const oldIdx = prev.findIndex(m => measureKey(m) === active.id);
      const newIdx = prev.findIndex(m => measureKey(m) === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  // On mount: if URL has a repo param, sync it to context
  useEffect(() => {
    const r = searchParams.get("r");
    if (r && r !== repoId) setRepoId(r);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync all state → URL on every change (replace, not push)
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("r", repoId);
    p.set("v", renderer);
    if (dims.length)                p.set("d", dims.join(","));
    p.set("m", measures.map(measureStr).join(","));
    if (kinds.length)               p.set("k", kinds.join(","));
    if (filters.length)             p.set("f", JSON.stringify(filters));
    // Graph renderer config — only write non-default values to keep URLs clean
    if (minWeight > 1)              p.set("mw",   minWeight);
    if (topK > 0)                   p.set("tk",   topK);
    if (colorKeyOverride)           p.set("c",    colorKeyOverride);
    if (fanOutDepth !== 5)          p.set("hops", fanOutDepth);
    if (selectedNodeIds.size > 0)   p.set("sel",  [...selectedNodeIds].join(","));
    if (hideIsolated)               p.set("hi",   "1");
    if (nodeDot)                    p.set("nd",   "1");
    if (compareRepo)                p.set("cmp",  compareRepo);
    setSearchParams(p, { replace: true });
  }, [repoId, renderer, dims, measures, kinds, filters, // eslint-disable-line react-hooks/exhaustive-deps
      minWeight, topK, colorKeyOverride, fanOutDepth, selectedNodeIds, hideIsolated,
      nodeDot, compareRepo]);

  // Always load available kinds for the selected repo
  const kindsQuery = useQuery({
    queryKey: ["explore-kinds", repoId],
    queryFn:  () => api.exploreKinds(repoId),
  });
  const availableKinds = kindsQuery.data?.kinds || [];

  // Always load distinct dim values for filter chips (independent of Group By)
  const dimValuesQuery = useQuery({
    queryKey: ["explore-dim-values", repoId],
    queryFn:  () => api.exploreDimValues(repoId),
    staleTime: 5 * 60 * 1000, // cache 5 min — these don't change often
  });
  const serverDimValues = dimValuesQuery.data?.dims || {};

  // When no dims selected, fall back to symbol grain (one row per node)
  const effectiveDims = dims.length === 0 ? ["symbol"] : dims;
  // symbolMode: zero-dim fallback OR explicit single symbol dim — both use the grain path
  const symbolMode    = effectiveDims.length === 1 && effectiveDims[0] === "symbol";

  const measuresStr = measures.map(measureStr).join(",");
  const kindsStr    = kinds.join(",");

  const pivotQuery = useQuery({
    queryKey: ["explore", repoId, effectiveDims.join(","), measuresStr, kindsStr, compareRepo],
    queryFn:  () => api.explorePivot(repoId, effectiveDims, measuresStr, kindsStr, compareRepo),
    enabled:  (renderer==="pivot"||renderer==="graph") && measures.length>0,
  });

  const hasEnriched = pivotQuery.data?.has_enriched ?? false;

  // ── Repos list for the compare selector ──────────────────────────────────
  const { data: reposData } = useQuery({ queryKey: ["repos"], queryFn: api.repos });
  const allRepos = reposData?.repos || [];
  const repoGroups = useMemo(() => {
    const g = {};
    for (const r of allRepos) {
      const at   = r.id.indexOf("@");
      const proj = at === -1 ? r.id : r.id.slice(0, at);
      if (!g[proj]) g[proj] = [];
      g[proj].push({ ...r, commit: at === -1 ? "HEAD" : r.id.slice(at + 1) });
    }
    return g;
  }, [allRepos]);

  // Apply client-side filters on top of pivot results
  // Declared here (before diff memos) to avoid TDZ in production builds.
  const filteredData = useMemo(() => {
    if (!pivotQuery.data) return null;
    if (!filters.length)  return pivotQuery.data;
    return { ...pivotQuery.data, rows: applyFilters(pivotQuery.data.rows, filters) };
  }, [pivotQuery.data, filters]);

  // ── Diff overlay — driven by diff_status_value measure in pivot rows ────────
  // When compareRepo is set, the explore endpoint annotates rows with
  // diff_status_value (0.0=added, 0.25=modified, 0.5=unchanged, 1.0=removed)
  // and edges with diff_status ("added"|"unchanged").

  // Auto-switch colorKey to diff_status_value when compare becomes active,
  // restore to null when cleared (if user hadn't manually overridden it).
  useEffect(() => {
    if (compareRepo) {
      setColorKeyOverride("diff_status_value");
    } else {
      setColorKeyOverride(prev => prev === "diff_status_value" ? null : prev);
    }
  }, [compareRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight set: node IDs with diff_status_value < 0.49 (i.e., changed nodes)
  const highlightSet = useMemo(() => {
    if (!compareRepo || !filteredData?.rows) return null;
    const set = new Set();
    for (const row of filteredData.rows) {
      const val = row.values?.diff_status_value;
      if (val !== undefined && val < 0.49) {
        // Symbol grain: key is row.key.symbol; group grain: key is row.key[dims[0]]
        const nodeId = row.key.symbol ?? row.key[effectiveDims[0]];
        if (nodeId) set.add(nodeId);
      }
      // Also check children for 2-dim pivot rows
      for (const child of row.children || []) {
        const cval = child.values?.diff_status_value;
        if (cval !== undefined && cval < 0.49) {
          const cid = child.key.symbol ?? child.key[effectiveDims[1]];
          if (cid) set.add(cid);
        }
      }
    }
    return set.size > 0 ? set : null;
  }, [filteredData, compareRepo, effectiveDims]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edge color overrides from diff_status on explore graph_edges
  // added=green, modified=yellow, removed=red (removed edges won't appear in HEAD graph)
  const DIFF_EDGE_COLORS = { added: "#3fb950", modified: "#e3b341", removed: "#f85149" };
  const diffEdgeOverrides = useMemo(() => {
    if (!compareRepo || !filteredData?.graph_edges) return null;
    const map = new Map();
    for (const e of filteredData.graph_edges) {
      const color = DIFF_EDGE_COLORS[e.diff_status];
      if (color) map.set(`${e.source}|${e.target}`, color);
    }
    return map.size > 0 ? map : null;
  }, [filteredData, compareRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Summary counts for the legend (derived from rows)
  const diffStats = useMemo(() => {
    if (!compareRepo || !filteredData?.rows) return null;
    const counts = { added: 0, modified: 0, removed: 0, unchanged: 0 };
    for (const row of filteredData.rows) {
      const val = row.values?.diff_status_value;
      if (val === 0.0)  counts.added++;
      else if (val === 0.25) counts.modified++;
      else if (val === 1.0)  counts.removed++;
      else if (val === 0.5)  counts.unchanged++;
    }
    return counts;
  }, [filteredData, compareRepo]);

  const allDims       = ["module", "class", "risk", "kind", "symbol", "dead", "high_risk", "in_cycle", "community"];
  const availableDims = allDims.filter(d => !dims.includes(d));

  // Distinct dimension values for filter chips.
  // Priority: server-fetched (all dims always available) → locally extracted from current pivot rows.
  const dimValues = useMemo(() => {
    // Start from server-fetched values so filters work regardless of current Group By
    const out = { ...serverDimValues };

    // Supplement with locally-extracted values from the current pivot result.
    // This picks up bucketed dim values (which the server endpoint doesn't cover)
    // and refreshes counts when a kind filter is active.
    const rows = pivotQuery.data?.rows;
    if (rows) {
      // Flatten top-level rows + children so 2-dim pivots expose both levels
      const allRows = rows.flatMap(r => [r, ...(r.children || [])]);
      for (const d of [...allDims, ...dims]) {
        const localVals = [...new Set(allRows.map(r => String(r.key[d] ?? "")))].filter(Boolean);
        if (localVals.length > 0) {
          out[d] = [...new Set([...(out[d] || []), ...localVals])].sort();
        }
      }
    }
    return out;
  }, [serverDimValues, pivotQuery.data, dims]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep GraphRenderer mounted through loading cycles so local selection state
  // (selectedNodeIds) survives measure/kind changes that temporarily null filteredData.
  const lastFilteredDataRef = useRef(null);
  if (filteredData) lastFilteredDataRef.current = filteredData;
  const stableFilteredData = lastFilteredDataRef.current; // non-null after first successful fetch

  function addMeasure(m) {
    if (m.special && measures.find(x => x.special === m.special)) return; // no duplicate specials
    setMeasures(p => [...p, m]);
  }
  function removeMeasure(key) { setMeasures(p => p.filter(m => measureKey(m) !== key)); }
  function changeAgg(key, agg) {
    setMeasures(p => p.map(m => measureKey(m)===key ? {...m, agg} : m));
  }

  // Replace a bucketed dim in-place with the same field but a new mode
  function changeDimMode(oldDim, newDim) {
    setDims(p => p.map(d => d === oldDim ? newDim : d));
  }

  // ── Shared config card content (rendered in both graph + normal layouts) ──
  const configContent = (<>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
      <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>View</span>
      {[{key:"pivot",label:"📊 Pivot"},{key:"graph",label:"🕸 Graph"},{key:"nodes",label:"🔬 Nodes"}].map(({key,label})=>(
        <button key={key} className={`btn btn-sm ${renderer===key?"":"btn-ghost"}`} onClick={()=>setRenderer(key)}>{label}</button>
      ))}
    </div>
    {/* Compare / diff row */}
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Compare</span>
      {compareRepo ? (<>
        <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--text2)" }}
          title={`base: ${compareRepo} → head: ${repoId}`}>
          base {compareRepo.split("@")[1]?.slice(0,7) ?? compareRepo}
        </span>
        {compareRepo && pivotQuery.isFetching && <span style={{ fontSize:11, color:"var(--text3)" }}>loading diff…</span>}
        {diffStats && (
          <span style={{ fontSize:11, color:"var(--text3)" }}>
            <span style={{ color:"#3fb950" }}>+{diffStats.added}</span>
            {" "}<span style={{ color:"#f85149" }}>-{diffStats.removed}</span>
            {" "}<span style={{ color:"#e3b341" }}>~{diffStats.modified}</span>
          </span>
        )}
        <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }}
          onClick={() => setCompareRepo("")}>✕ off</button>
      </>) : (
        <select style={{ fontSize:11, padding:"3px 6px", background:"var(--bg3)", color:"var(--text)", border:"1px solid var(--border)", borderRadius:4 }}
          value="" onChange={e => { if (e.target.value) { setCompareRepo(e.target.value); setRenderer("graph"); } }}>
          <option value="">Compare to…</option>
          {Object.entries(repoGroups).sort(([a],[b])=>a.localeCompare(b)).map(([proj, commits]) => (
            <optgroup key={proj} label={proj}>
              {commits.filter(c => c.id !== repoId).map(c => (
                <option key={c.id} value={c.id}>{c.commit.slice(0,7)} — {c.node_count.toLocaleString()} nodes</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
    {renderer!=="nodes" && (
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Group by</span>
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDimDragEnd}>
          <SortableContext items={dims} strategy={horizontalListSortingStrategy}>
            {dims.map((d,i) => (
              <SortableDimChip key={d} id={d} label={d} index={i}
                onRemove={() => setDims(p => p.filter(x => x !== d))}
                onChangeMode={newDim => changeDimMode(d, newDim)}/>
            ))}
          </SortableContext>
        </DndContext>
        <AddDimMenu available={availableDims} onAdd={d=>setDims(p=>[...p,d])}/>
        {symbolMode && <span style={{ fontSize:11, color:"var(--text3)", fontStyle:"italic", marginLeft:4 }}>No grouping → showing individual symbols</span>}
      </div>
    )}
    <div style={{ marginBottom:12 }}>
      {availableKinds.length > 0
        ? <KindFilter availableKinds={availableKinds} kinds={kinds} onChange={setKinds}/>
        : <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Kind filter</span>
            <span style={{ fontSize:11, color:"var(--text3)" }}>{kindsQuery.isLoading ? "loading…" : "no kinds found"}</span>
          </div>
      }
    </div>
    {renderer!=="nodes" && (
      <div style={{ display:"flex", alignItems:"flex-start", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80, paddingTop:5 }}>Measures</span>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleMeasureDragEnd}>
            <SortableContext items={measures.map(measureKey)} strategy={horizontalListSortingStrategy}>
              {measures.map(m => (
                <SortableMeasureChip key={measureKey(m)} id={measureKey(m)} m={m}
                  onRemove={() => removeMeasure(measureKey(m))}
                  onChangeAgg={agg => changeAgg(measureKey(m), agg)}/>
              ))}
            </SortableContext>
          </DndContext>
          <AddMeasureMenu onAdd={addMeasure} hasEnriched={hasEnriched}/>
        </div>
      </div>
    )}
    <div style={{ display:"flex", alignItems:"flex-start", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80, paddingTop:5 }}>Filters</span>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
        {filters.map(f => (
          <FilterChip key={f.id} filter={f}
            availableValues={f.kind === "dim" ? (dimValues[f.field] || []) : []}
            onUpdate={updated => setFilters(p => p.map(x => x.id === f.id ? updated : x))}
            onRemove={() => setFilters(p => p.filter(x => x.id !== f.id))}/>
        ))}
        <AddFilterMenu dims={allDims} measures={renderer !== "nodes" ? measures : []}
          onAdd={f => setFilters(p => [...p, f])}/>
      </div>
    </div>
  </>);

  // ── GRAPH mode: full-viewport overlay ─────────────────────────────────────
  if (renderer === "graph") return (
    // Negative margin bleeds out of Layout's 28px/32px padding → graph fills viewport
    <div style={{ position:"relative", height:"100vh", margin:"-28px -32px", overflow:"hidden" }}>
      {/* Graph fills the entire background */}
      {/* Loading + error states */}
      {measures.length === 0 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"var(--text3)", fontSize:13 }}>Select at least one measure.</div>
      )}
      {measures.length > 0 && pivotQuery.isLoading && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"var(--text3)", fontSize:13 }}>Computing…</div>
      )}
      {pivotQuery.error && (
        <div className="error" style={{ margin:40 }}>{pivotQuery.error.message}</div>
      )}
      {/* Graph renderer — always uses explore data; diff status overlaid as node colors */}
      {stableFilteredData && (
        <GraphRenderer
          data={stableFilteredData} measures={measures} onNodeClick={setSelectedNode}
          minWeight={minWeight}               setMinWeight={setMinWeight}
          topK={topK}                         setTopK={setTopK}
          colorKeyOverride={colorKeyOverride} setColorKeyOverride={setColorKeyOverride}
          fanOutDepth={fanOutDepth}           setFanOutDepth={setFanOutDepth}
          selectedNodeIds={selectedNodeIds}   setSelectedNodeIds={setSelectedNodeIds}
          hideIsolated={hideIsolated}         setHideIsolated={setHideIsolated}
          nodeDot={nodeDot}                   setNodeDot={setNodeDot}
          highlightSet={highlightSet}
          edgeColorOverrides={diffEdgeOverrides}
          controlsH={0} fillViewport={true}
        />
      )}
      {/* Diff legend — bottom-right, only shown when compare is active */}
      {compareRepo && diffStats && (
        <div style={{ position:"absolute", bottom:16, right:16, zIndex:10,
          display:"flex", flexDirection:"column", gap:6,
          background:"var(--bg2)", borderRadius:6, padding:"10px 14px",
          border:"1px solid var(--border2)", boxShadow:"0 2px 12px rgba(0,0,0,0.5)", fontSize:12 }}>
          <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            {diffStats.added > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:10, height:10, borderRadius:3, background:"#3fb950", flexShrink:0 }}/>
                <span style={{ color:"#3fb950" }}>{diffStats.added} added</span>
              </span>
            )}
            {diffStats.modified > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:10, height:10, borderRadius:3, background:"#e3b341", flexShrink:0 }}/>
                <span style={{ color:"#e3b341" }}>{diffStats.modified} modified</span>
              </span>
            )}
            {diffStats.removed > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:10, height:10, borderRadius:3, background:"#f85149", flexShrink:0 }}/>
                <span style={{ color:"#f85149" }}>{diffStats.removed} removed</span>
              </span>
            )}
          </div>
          <div style={{ color:"var(--text3)", fontSize:10, lineHeight:1.4 }}>
            {diffStats.removed > 0 && <div>⚠ Removed nodes not shown — they don&apos;t exist in this snapshot</div>}
            <div>Unchanged nodes keep their normal metric color</div>
          </div>
        </div>
      )}

      {/* Collapsible config dropdown — top-left, opens on hover, auto-closes 5s after mouse leaves */}
      <div
        style={{ position:"absolute", top:12, left:12, zIndex:20 }}
        onMouseEnter={cancelCloseTimer}
        onMouseLeave={startCloseTimer}
      >
        {/* Toggle button — opens on hover; click still toggles for explicit pin/close */}
        <button
          onMouseEnter={() => { setConfigOpen(true); cancelCloseTimer(); }}
          onClick={() => { setConfigOpen(v => !v); cancelCloseTimer(); }}
          style={{ fontSize:12, padding:"5px 12px", cursor:"pointer", borderRadius:6,
            border:"1px solid var(--border2)", background:"var(--bg2)",
            color:"var(--text)", boxShadow:"0 2px 8px rgba(0,0,0,0.4)",
            display:"flex", alignItems:"center", gap:6 }}
        >
          ⚙ Config <span style={{ opacity:0.6, fontSize:10 }}>{configOpen ? "▴" : "▾"}</span>
        </button>

        {/* Dropdown panel */}
        {configOpen && (
          <div ref={configCardRef} className="card" style={{
            position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:20,
            width:360, maxHeight:"calc(100vh - 100px)", overflowY:"auto",
            padding:"16px 20px", boxShadow:"0 4px 24px rgba(0,0,0,0.6)",
          }}>
            {configContent}
            {selectedNode && <>
              <div style={{ borderTop:"1px solid var(--border)", margin:"12px 0 8px" }}/>
              <GraphNodeDetails node={selectedNode} measures={measures}
                types={stableFilteredData?.measure_types || {}}/>
            </>}
          </div>
        )}
      </div>
    </div>
  );

  // ── PIVOT / NODES mode: normal flow layout ─────────────────────────────────
  return (
    <div>
      <div style={{ display:"flex", gap:16, alignItems:"flex-start", marginBottom:20 }}>
        <div ref={configCardRef} className="card" style={{ padding:"16px 20px", flex:1 }}>
          {configContent}
        </div>
      </div>
      {renderer==="pivot" && (<>
        {measures.length===0 && <div style={{ padding:"40px 0", textAlign:"center", color:"var(--text3)" }}>Select at least one measure.</div>}
        {measures.length>0 && <>
          {pivotQuery.isLoading && <div className="loading">Computing…</div>}
          {pivotQuery.error    && <div className="error">{pivotQuery.error.message}</div>}
          {filteredData && <>
            <div style={{ fontSize:12, color:"var(--text2)", marginBottom:10 }}>
              {symbolMode
                ? <>{filteredData.rows.length}{pivotQuery.data.symbol_total > filteredData.rows.length && ` of ${pivotQuery.data.symbol_total}`} symbols{pivotQuery.data.symbol_total > 500 && <span style={{ color:"var(--text3)", marginLeft:4 }}>(top {filteredData.rows.length} by caller count)</span>}</>
                : <>{filteredData.rows.length}{pivotQuery.data.rows.length !== filteredData.rows.length && ` of ${pivotQuery.data.rows.length}`} groups{effectiveDims.length>1&&` · click ▶ to drill into ${effectiveDims[1]}`}</>
              }
              {kinds.length>0&&<span style={{ marginLeft:6 }}>· kind: {kinds.join(", ")}</span>}
              {filters.length>0&&<span style={{ color:"var(--blue)", marginLeft:6 }}>· {filters.length} filter{filters.length>1?"s":""} active</span>}
            </div>
            <PivotTable data={filteredData} measures={measures}/>
          </>}
        </>}
      </>)}
      {renderer==="nodes" && <NodeTable repoId={repoId} hasEnriched={hasEnriched} kinds={kinds}/>}
    </div>
  );
}
