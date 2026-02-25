# Architecture

Developer reference. ~7 min read.

---

## Overview

```
semfora-explora/
├── backend/          FastAPI (Python)
│   ├── analytics/    Pure analysis functions — no DB, fully testable
│   ├── queries/      DB I/O — returns plain Python dicts/lists
│   ├── routers/      Thin HTTP handlers — wire queries → analytics → response
│   ├── db.py         Connection management + enriched-DB promotion
│   ├── enrich.py     ML enrichment pipeline (run once per DB)
│   └── main.py       App entry point — registers routers, serves frontend + Win98
├── frontend/         React 18 + Vite
│   └── src/
│       ├── pages/        One file per route
│       ├── components/   Shared UI + explore sub-components
│       ├── utils/        Pure functions — all unit-tested
│       ├── App.jsx       Router, RepoContext, ConsoleToasts
│       └── api.js        API client (fetch wrappers)
├── data/             *.db / *.enriched.db files (gitignored)
├── tests/            pytest — 282 tests, must stay green
├── user_simulation/  3-layer Python simulation framework (see below)
└── win98-desktop/    Retro desktop served at /win95 with live workspace FS
```

---

## Backend

### 3-Layer Rule

Every feature follows this stack, strictly top-down:

```
routers/feature.py   HTTP only — parse params, call query, call analytics, return dict
    ↓
queries/feature.py   DB only — SQL, returns plain Python lists/dicts
    ↓
analytics/feature.py Pure functions — no DB, no HTTP, deterministic, testable
```

**Contract rules:**
- `analytics/` functions take plain Python primitives and return plain Python. Zero DB imports. If you can't test it without a DB file, it's in the wrong layer.
- `queries/` functions open/close their own cursor. Return `list[dict]` or similar — no ORM objects.
- `routers/` functions are thin. If the handler is more than ~20 lines, logic is leaking in — push it down.

### db.py

- `get_db(repo_id)` — returns a SQLite connection. Auto-promotes to `.enriched.db` when available. Use this everywhere; never construct paths directly.
- `build_nx_graph(conn)` — builds a `networkx.DiGraph` from the DB. Used by analytics that need graph algorithms.

### enrich.py

One-shot enrichment script. Run against a base `.db` to produce a `.enriched.db` with a `node_features` table containing:
- `utility_score`, `pagerank`, `betweenness`
- `topological_depth`, `reverse_topological_depth`
- `xmod_fan_in`, `community_id`, `community_dominant_mod`

The enriched DB is a strict superset — `get_db()` prefers it transparently.

### queries/explore.py

The most complex query file. Key concepts:

- **Measures** — `"symbol_count"` (special) or `"caller_count:avg"` (field:agg). The `_pivot_sql()` function builds the SELECT dynamically.
- **Dimensions** — plain (`"module"`, `"kind"`) or bucketed (`"caller_count:quartile"`). Bucketed dims generate CASE expressions; positional GROUP BY is required in SQLite.
- **`_DIM_SRC` / `_DIM_TGT`** — maps dimension name → SQL expression. Used by `fetch_graph_edges()` to build the induced subgraph.
- **Symbol grain** — `dimensions=["symbol"]` triggers `_fetch_symbol_grain()`, which returns individual symbols instead of aggregated groups.
- **Enriched dims** — `community`, `utility`, `pagerank`, etc. require a JOIN to `node_features`. The `_ENRICHED_DIMS` set drives an auto-join when needed.
- **Class dim** — implemented via line-range SQL containment subquery (no `class_name` column in nodes): `SELECT cls.name FROM nodes cls WHERE cls.kind='class' AND n.line_start >= cls.line_start AND n.line_end <= cls.line_end`.

### analytics/pattern_detector.py

16 structural graph detectors — no source code reading, purely degree/path analysis on the SQLite schema:

| Detector | Signal |
|---|---|
| `detect_singleton` | High in-degree (≥4), low out-degree (≤3) getter node |
| `detect_factory_method` | Hub calling ≥3 same-module low-in-degree nodes |
| `detect_observer` | Fan-out to ≥5 handlers each with in-degree ≤2 |
| `detect_decorator_chain` | Linear chain ≥4 with high-in-degree entry point |
| `detect_facade` | Node calling ≥3 distinct modules |
| `detect_composite` | Self-recursive nodes (self-loop in edges) |
| `detect_strategy` | Context calling 3–8 same-module sibling nodes |
| `detect_chain_of_responsibility` | Strict linear chain ≥5 with low-in-degree start |
| `detect_template_method` | Hub + hook nodes sharing a module |
| `detect_command_dispatcher` | Single dispatcher → many exclusive handlers |
| `detect_map_reduce` | Fan-out from one node, all targets converge to one sink |
| `detect_mediator` | Bidirectional hub with high degree in/out |
| `detect_mutual_recursion` | Kosaraju SCC with ≥2 nodes |
| `detect_layered_architecture` | Strict cross-module DAG in topological layers |
| `detect_proxy` | High in-degree + delegation to one downstream node |
| `detect_pipeline` | Linear chain ≥4 with no high-in-degree entry constraint |

Entry point: `detect_all_patterns(conn, min_confidence=0.50)` — returns list of `{pattern, display_name, count, instances}` sorted by count descending.

All detectors tested in `tests/test_pattern_detector.py` using in-memory SQLite with synthetic topologies.

### analytics/diff.py

Pure diff functions between two repo snapshots:

- `compute_diff_status_map(nodes_a, nodes_b)` — `{module::name: status}` for changed nodes only (added/removed/modified). Uses content hash (right side of `module_hash:content_hash`) to avoid false-positives on renames.
- `compute_diff(nodes_a, nodes_b, mod_edges_a, mod_edges_b)` — summary statistics dict.
- `compute_diff_graph(nodes_a, nodes_b, edges_a, edges_b)` — force-graph subgraph for visualisation, with context neighborhood.

Tested in `tests/test_diff.py`.

---

## Frontend

### App.jsx

- `RepoContext` — provides `{ repoId, setRepoId }` to all pages.
- `ConsoleToasts` — monkeypatches `console.error`/`console.warn` to show overlay toasts.
- React Router routes defined here. Adding a new page = add a `<Route>` + nav entry in `Layout.jsx`.

### api.js

All `fetch` calls go through here. If a backend route changes, this is the only frontend file that needs updating.

### pages/

| Page | What it does |
|---|---|
| `Dashboard.jsx` | Repo overview — counts, module breakdown, risk distribution |
| `Explore.jsx` | OLAP pivot / graph / node table — main analytical tool (see below) |
| `GraphView.jsx` | Raw force-directed call graph, filterable by module |
| `BlastRadius.jsx` | Search a symbol → see all transitive callers by depth |
| `ModuleCoupling.jsx` | Ca/Ce/instability scores per module |
| `ModuleGraph.jsx` | Module-level dependency graph |
| `DeadCode.jsx` | Symbols with zero callers, grouped by file |
| `LoadBearing.jsx` | High-centrality symbols — riskiest refactoring targets |
| `Centrality.jsx` | Full centrality rankings |
| `Cycles.jsx` | Strongly connected components (circular dependencies) |
| `Communities.jsx` | Louvain community detection visualisation |
| `Building.jsx` | Layered architecture view |
| `Diff.jsx` | Structural diff between two indexed repos — uses `DiffGraph.jsx` |

### components/explore/ — key sub-components

| Component | What it does | Tests |
|---|---|---|
| `GraphNodeDetails.jsx` | Click-to-inspect panel; shows dim values + measures for selected node | `GraphNodeDetails.test.jsx` |
| `PatternPanel.jsx` | Side panel listing detected patterns; click-to-highlight nodes in graph | `PatternPanel.test.jsx` |
| `FilterWizard.jsx` | Full-screen modal for managing dims, filters, kind filter | `FilterWizard.test.jsx` |
| `FilterControls.jsx` | Inline filter chip row | `FilterControls.test.jsx` |
| `MeasureControls.jsx` | Measure chips with inline agg dropdown | `MeasureControls.test.jsx` |
| `KindFilter.jsx` | Symbol kind toggle pills | `KindFilter.test.jsx` |
| `PivotTable.jsx` | Drill-down pivot table renderer | `PivotTable.test.jsx` |
| `NodeTable.jsx` | Raw node table with edge pillboxes | `NodeTable.test.jsx` |

### GraphNodeDetails — dim values

When a node is selected, the panel shows:
1. **Leaf dim value** as the bold name heading
2. **Leaf dim label** (e.g. "symbol") as a subtle badge below the name
3. **Ancestor dim values** from `node.groupPath` as a table (e.g. `module → decorator`, `class → Node`)
4. **Measures** separated by a divider

The `dims` prop must be passed from `stableFilteredData.dimensions` (the dims used for the current graph build). Without it, falls back to old `module::name` split display.

### utils/

All pure functions. Every file has a corresponding `.test.js`. **Do not put React or DOM logic here.**

| File | What it contains |
|---|---|
| `exploreConstants.js` | `SPECIAL_LABELS`, `FIELD_META`, `AGGS`, `BUCKET_MODES`, `DIM_LABELS`, `DEFAULT_DIMS`, `DEFAULT_MEASURES` |
| `measureUtils.js` | `measureKey`, `measureStr`, `measureLabel`, `fmtValue`, `parseMeasuresParam` |
| `dimUtils.js` | `parseBucketedDim`, `dimDisplayLabel`, `parseFiltersParam` |
| `colorUtils.js` | `hex`, `lerpColor`, `makeStepColors/Widths/Arrows` |
| `graphAlgo.js` | `buildAdjacencyMaps`, `bfsFromNode`, `findChainEdges`, `collectChainNodeIds`, `convexHull` |
| `filterUtils.js` | `matchExpr`, `applyFilters`, `filterEdgesToNodes` |
| `graphData.js` | `buildGraphData` — converts flat API rows into `{nodes, links}` for ForceGraph2D |
| `topologyLayout.js` | `computeMetaLayout` — crossing-optimal blob placement using circular permutations |

---

## The Explore Page

`Explore.jsx` (~715 lines) owns URL state, data fetching, and layout. It renders into 3 renderers:

| Renderer | Description |
|---|---|
| `graph` | Force-directed blob graph (default) |
| `pivot` | Drill-down OLAP pivot table |
| `nodes` | Raw symbol table with edge pillboxes |

### URL params

| Param | Default | Description |
|---|---|---|
| `r` | first repo | repo ID |
| `v` | `graph` | renderer (graph/pivot/nodes) |
| `d` | `module` | dimensions (comma-separated) |
| `m` | symbol_count,dead_ratio,caller_count:avg | measures |
| `k` | (all) | kind filter |
| `f` | [] | filters (JSON array) |
| `mw` | 1 | min edge weight |
| `tk` | 10 | top-K edges per source |
| `c` | first measure | color key override |
| `hops` | 5 | fan-out / max chain depth |
| `sel` | (none) | selected node IDs (comma-separated) |
| `hi` | false | hide isolated nodes |

### Graph modes

- **1-dim** — nodes are groups (e.g. modules). Edges are inter-group call edges.
- **2-dim (blob)** — outer dim = blob groups (coloured convex-hull blobs), inner dim = nodes inside.
- **3-dim** — three nesting levels; outer blobs contain mid-level sub-blobs.
- **Symbol grain** — `dimensions=["symbol"]` shows individual symbols (top 500).

### GraphRenderer (~700 lines, inside Explore.jsx)

The core `ForceGraph2D` wrapper. Key responsibilities:

**Physics:**
- Degree-based node sizing: `val = 4 + degree * 4` (creates visual hierarchy)
- Chain elongation: `forceX/forceY` for single-module linear chains
- Blob repulsion: inter-module centroid-based force prevents module collapse
- Cross-module link damping: strength=0.02, distance=300px (vs 0.4 intra-module)
- Blob collision: `forceCollide(7, strength=0.85)` in blob mode, charge=-5 (prevents ring accumulation)
- `computeMetaLayout` seed positions: topology-aware initial blob placement minimises corridor crossings

**Selection:**
- **Single select** — BFS fan-out from selected node; `makeSelectionRadialForce` pulls rings into concentric layout
- **Multi select (Shift+click)** — chain mode; `findChainEdges` (bidirectional BFS) finds all directed paths; `makeChainCentroidForce` pulls chain toward centre

**Blob selection (Alt+click):**
- Alt+click on blob area = select entire blob (highlights all nodes + cross-boundary edges)
- Alt+click on existing selection = deselect
- Shift+Alt+click = add blob to multi-selection
- `selectedBlob: { keys: Set<string>, level }` — multi-select at same nesting level
- Cross-boundary edges highlighted in red; internal blob edges dimmed
- Covered by `GraphRenderer.blobClick.test.jsx` (26 tests)

**Other UX:**
- **Hide tests toggle** — client-side filter on `filteredData` useMemo, pattern `test_*` / `*_test.py`
- **Size guard** — 500-node hard limit with `renderAnyway` escape hatch
- **Dim toggles (`disabledDims`)** — dims kept in the URL but excluded from effective grouping
- **Keyboard shortcuts** — `Escape` clears selection, `Delete`/`Backspace` adds exclude filter for selected blob
- **Trackpad pan** — intercepts wheel events (`ctrlKey` = zoom, else pan)
- **Directional particles** — 2 per edge, color-matched to step gradient, hidden on dimmed edges

---

## Pattern Detection

### Flow

1. User opens Explore graph view
2. Clicks "🧩 Patterns" button (only visible in graph mode)
3. `PatternPanel` calls `GET /api/repos/{id}/patterns?min_confidence=0.60`
4. Backend runs all 16 detectors via `detect_all_patterns(conn)`
5. Results returned as `{patterns, total_pattern_types, total_instances}`
6. User clicks pattern row → expands instances with descriptions
7. User clicks instance → `onHighlight(patternKey, nodeColorOverrides, color, inst)` fires
8. `Explore.jsx` stores `patternNodeColors` state → passed as `nodeColorOverrides` to `GraphRenderer`

### Node color overrides

`PatternPanel.handleInstanceClick` builds a `{nodeId: color}` object using all ID forms:
- `"module.name"` (the raw node_label form)
- `"name"` (bare name)
- `"module::name"` (explore pivot form)
- `"name::module"` (blob form)

`GraphRenderer` accepts `nodeColorOverrides: { [id]: cssColor }` — bypasses metric gradient for matching nodes.

---

## Diff Overlay (Explore page)

When a second repo is selected in the "Compare" dropdown:
1. `GET /api/repos/{id}/diff-status?compare_to={other}` returns a lightweight `{status_map: {vid: status}}`
2. `diffNodeColors` useMemo in `Explore.jsx` builds `nodeColorOverrides`:
   - Symbol nodes: direct `module::name` lookup
   - Module-group nodes: aggregate dominant status (modified > added > removed)
3. Normal explore data/dims/measures/filters are unchanged — diff is purely a color overlay

Diff colors: `added=#3fb950, removed=#f85149, modified=#e3b341, context=#3d4450`

---

## User Simulation System

Located in `user_simulation/`. A 3-layer framework that validates physics and UX against simulated users.

### Layers

```
instrumentation/layout_metrics.js   → raw physics metrics (JS, runs in Node)
         ↓
perceptions.py                      → boolean/numeric perceptions from metrics
         ↓
users/*.py                          → Z3 SMT formulas per person
         ↓
judgement.py                        → check_all() → satisfaction matrix
         ↓
run.py                              → main entry point, prints matrix
```

### Running

```bash
NODE=/workspace/node-v22.13.0-linux-arm64/bin/node python3 user_simulation/run.py
```

### Key metrics (layout_metrics.js → computeFacts)

| Metric | What it measures |
|---|---|
| `blob_integrity` | Fraction of intra-module edges with both endpoints in correct blob |
| `blob_separation_clearance` | Min pixel gap between blob hulls |
| `blob_edge_routing` | Fraction of inter-module corridors not threading through wrong blobs |
| `hub_normalised_error` | How far hub nodes are from their neighbourhood centroid |
| `edge_visibility_ratio` | Fraction of edges not obscured by node overlap |
| `gestalt_cohesion` | How well same-module nodes cluster visually |
| `layout_stress` | Kamada-Kawai stress (distance vs graph-theoretic distance) |
| `inter_module_crossings` | Segment-crossing pairs between inter-module edges (implemented, not yet wired into computeFacts) |

### 9 simulated users

`Sarah/CTO`, `Marcus/VP`, `Priya/EngMgr`, `Jordan/PeopleMgr`, `Kenji/Staff`, `Fatima/Architect`, `Alex/Senior`, `Dana/Engineer`, `Taylor/Junior` — each with different Z3 satisfaction formulas in `users/*.py`.

**Current score: 603/603 (9 people × 67 scenarios = 100%)**

---

## Win98 Desktop

A retro Windows 98-style web desktop served at `/win95`.

- Backend: `main.py` registers static file mounts + dynamic endpoints in `WINDOWS_95_AVAILABLE` block
- Live workspace filesystem: `GET /api/win95/ls?path=` and `GET /api/win95/cat?path=` serve real files from `WORKSPACE_ROOT` with `_safe_path()` enforcement (no path traversal)
- Frontend: `win98-desktop/` — standalone HTML/JS app using BrowserFS OverlayFS

---

## Where to Make Changes

**Add a new measure field** → `exploreConstants.js` (`FIELD_META`), then `backend/queries/explore.py` (`FIELD_AGG_EXPRS`)

**Add a new dimension** → `exploreConstants.js` (`DIM_LABELS`), then `backend/queries/explore.py` (`AVAILABLE_DIMENSIONS`, `_DIM_SRC`, `_DIM_TGT`). If it requires `node_features`, add to `_ENRICHED_DIMS`.

**Add a new pattern detector** → add a `detect_foo(nodes, out_adj, in_adj)` function in `pattern_detector.py`, register in `DETECTORS`, add tests in `tests/test_pattern_detector.py`.

**Change graph physics** → `GraphRenderer` in `Explore.jsx` — d3 force setup in the `useEffect([selectedNodeIds, …])`. **Always run blob physics regression tests after:** `npx vitest run GraphRenderer.blobPhysics`.

**Change the chain algorithm** → `graphAlgo.js` (`findChainEdges`) — has its own test suite in `graphAlgo.test.js`.

**Add a new backend feature** → create `analytics/feature.py` (pure) + `queries/feature.py` (DB) + `routers/feature.py` (HTTP), register in `main.py`, add `api.js` fetch, add page/component, register route in `App.jsx` + `Layout.jsx`.

**Add a test** → frontend: add to `src/utils/*.test.js` or `src/components/**/*.test.jsx`, run `npx vitest run`. Backend: add to `tests/`, run `python3 -m pytest tests/ -q`.

---

## Test Coverage

| Layer | Runner | Count | What's covered |
|---|---|---|---|
| Backend analytics (pure functions) | pytest | 282 | diff, pattern_detector, dimensionality, queries, API responses, antipatterns |
| Frontend utils | Vitest | 205 | All pure functions in `src/utils/` |
| Frontend components | Vitest | 412 | GraphRenderer (physics + blob-click), GraphNodeDetails, PatternPanel, FilterWizard, FilterControls, MeasureControls, KindFilter, PivotTable, NodeTable, layoutBenchmark |
| User simulation | pytest (in `user_simulation/`) | included in 282 | Physics perception checks for all 9 users × 67 scenarios |

### Running tests

```bash
# Backend
python3 -m pytest tests/ user_simulation/ -q

# Frontend
cd frontend
npx vitest run

# Both (from repo root)
python3 -m pytest tests/ user_simulation/ -q && \
  cd frontend && npx vitest run
```

### Physics regression guard

Before pushing any `GraphRenderer` physics change, run:
```bash
npx vitest run GraphRenderer.blobPhysics GraphRenderer.blobClick
```
These 47 tests catch regressions in blob separation, ring accumulation, and blob selection.
