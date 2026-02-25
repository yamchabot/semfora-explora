# Architecture

Developer reference. ~5 min read.

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
│   └── main.py       App entry point — registers routers + serves frontend
├── frontend/         React 18 + Vite
│   └── src/
│       ├── pages/        One file per route
│       ├── components/   Shared UI components
│       ├── utils/        Pure functions — all unit-tested
│       ├── App.jsx       Router, RepoContext, ConsoleToasts
│       └── api.js        API client (fetch wrappers)
├── data/             *.db / *.enriched.db files (gitignored)
└── tests/            pytest — 138 tests, must stay green
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
- **`_DIM_SRC` / `_DIM_TGT`** — maps dimension name → SQL expression for the node being grouped vs. its edge target. Used by `fetch_graph_edges()` to build the induced subgraph.
- **Symbol grain** — `dimensions=["symbol"]` triggers `_fetch_symbol_grain()`, which returns individual symbols instead of aggregated groups.
- **Enriched dims** — `community`, `utility`, `pagerank`, etc. require a JOIN to `node_features`. The `_ENRICHED_DIMS` set drives an auto-join when needed.

---

## Frontend

### App.jsx

- `RepoContext` — provides `{ repoId, setRepoId }` to all pages. The repo selector in the sidebar writes here.
- `ConsoleToasts` — monkeypatches `console.error`/`console.warn` to show overlay toasts. Useful for surfacing library errors in dev.
- React Router routes defined here. Adding a new page = add a `<Route>` + an entry in `Layout.jsx`'s nav.

### api.js

All `fetch` calls go through here. Each function maps to one backend endpoint. If a backend route changes, this is the only frontend file that needs updating.

### pages/

One file per feature. Pages own their URL state (`useSearchParams`), data fetching (`useQuery`), and top-level layout. Sub-components live inside the page file until they're big enough to extract.

| Page | What it does |
|---|---|
| `Dashboard.jsx` | Repo overview — counts, module breakdown, risk distribution |
| `Explore.jsx` | OLAP pivot / graph / node table — the main analytical tool (see below) |
| `GraphView.jsx` | Raw force-directed call graph, filterable by module |
| `BlastRadius.jsx` | Search a symbol → see all transitive callers by depth |
| `ModuleCoupling.jsx` | Ca/Ce/instability scores per module |
| `ModuleGraph.jsx` | Module-level dependency graph |
| `DeadCode.jsx` | Symbols with zero callers, grouped by file |
| `LoadBearing.jsx` | High-centrality symbols — riskiest refactoring targets |
| `Centrality.jsx` | Full centrality rankings |
| `Cycles.jsx` | Strongly connected components (circular dependencies) |
| `Communities.jsx` | Louvain community detection visualisation |
| `Building.jsx` | Layered architecture view (Foundation → Platform → Services → Features → Leaves) |
| `Diff.jsx` | Structural diff between two indexed repos |

### components/

- `Layout.jsx` — sidebar + `<main>` wrapper. Nav items defined here.
- `DiffGraph.jsx` — force-graph component used only by `Diff.jsx`.

### utils/

All pure functions. Every file has a corresponding `.test.js`. **Do not put React or DOM logic here.**

| File | What it contains |
|---|---|
| `exploreConstants.js` | Shared metadata: `SPECIAL_LABELS`, `FIELD_META`, `AGGS`, `BUCKET_MODES`, `DIM_LABELS`, `BUCKET_FIELDS_META`, `DEFAULT_DIMS`, `DEFAULT_MEASURES` |
| `measureUtils.js` | `measureKey`, `measureStr`, `measureLabel`, `fmtValue`, `parseMeasuresParam` |
| `dimUtils.js` | `parseBucketedDim`, `dimDisplayLabel`, `parseFiltersParam` |
| `colorUtils.js` | `hex`, `lerpColor`, `makeStepColors/Widths/Arrows` |
| `graphAlgo.js` | `buildAdjacencyMaps`, `bfsFromNode`, `findChainEdges`, `collectChainNodeIds`, `convexHull` |
| `filterUtils.js` | `matchExpr`, `applyFilters`, `filterEdgesToNodes` |

---

## The Explore Page

`Explore.jsx` is the most complex file (~1965 lines). It contains:

1. **`GraphRenderer`** (~700 lines, lines ~900–1650) — ForceGraph2D wrapper. Handles canvas drawing, d3 physics, selection state, node search, scroll/zoom interception.
2. **`GraphNodeDetails`** — click-to-inspect panel for selected nodes.
3. **`PivotTable`** — drill-down table renderer.
4. **`NodeTable`** — raw symbol table with edge pillboxes.
5. **Sub-components** — `FilterChip`, `MeasureChip`, `DimChip`, `KindFilter`, `AddDimMenu`, `AddMeasureMenu`, `SortableDimChip`, `SortableMeasureChip` — all inlined, candidates for extraction.
6. **`Explore()`** — the page component itself. Owns all URL-synced state.

### URL params

| Param | State | Default |
|---|---|---|
| `r` | `repoId` | first repo |
| `v` | renderer (graph/pivot/nodes) | `graph` |
| `d` | dimensions (comma-separated) | `module` |
| `m` | measures (comma-separated) | symbol_count,dead_ratio,caller_count:avg |
| `k` | kind filter | (all) |
| `f` | filters (JSON) | [] |
| `mw` | min edge weight | 1 |
| `tk` | top-K edges per source | 10 |
| `c` | color key override | (first measure) |
| `hops` | fan-out / max chain depth | 5 |
| `sel` | selected node IDs (comma-separated) | (none) |
| `hi` | hide isolated nodes | false |

### Graph modes

- **1-dim** — nodes are groups (e.g. modules). Edges are inter-group call edges.
- **2-dim (blob)** — outer dim = blob groups (coloured hulls), inner dim = nodes inside. Blobs are drawn in `onRenderFramePre` using convex hull + bezier smoothing.
- **Symbol grain** — `dimensions=["symbol"]` shows individual symbols (top 500).

### Selection / physics

- **Single select** — BFS fan-out from selected node. Reachable nodes get step-coloured edges. `makeSelectionRadialForce` pulls BFS rings into concentric layout.
- **Multi select (Shift+click)** — chain mode. `findChainEdges` (in `graphAlgo.js`) finds all directed paths between selected nodes. `makeChainCentroidForce` pulls the chain toward centre.

---

## Where to Make Changes

**Add a new measure field** → `exploreConstants.js` (`FIELD_META`), then `backend/queries/explore.py` (`FIELD_AGG_EXPRS`)

**Add a new special measure** → `exploreConstants.js` (`SPECIAL_LABELS`), then `backend/queries/explore.py` (`_special_expr()`)

**Add a new dimension** → `exploreConstants.js` (`DIM_LABELS`), then `backend/queries/explore.py` (`AVAILABLE_DIMENSIONS`, `_DIM_SRC`, `_DIM_TGT`). If it requires `node_features`, add to `_ENRICHED_DIMS`.

**Add a new bucketed dimension field** → `exploreConstants.js` (`BUCKET_FIELDS_META`), then `backend/queries/explore.py` (`BUCKET_FIELDS`)

**Add a new filter expression type** → `filterUtils.js` (`matchExpr`), add tests in `filterUtils.test.js`

**Change graph physics** → `GraphRenderer` in `Explore.jsx` — `makeSelectionRadialForce`, `makeChainCentroidForce`, `makeGroupCentroidForce`, d3 force setup in the `useEffect([selectedNodeIds, …])`

**Change the chain-finding algorithm** → `graphAlgo.js` (`findChainEdges`) — has its own test suite in `graphAlgo.test.js`

**Add a new backend feature** → create `analytics/feature.py` (pure) + `queries/feature.py` (DB) + `routers/feature.py` (HTTP), register in `main.py`, add `api.js` fetch function, add `pages/Feature.jsx`, register route in `App.jsx` and nav in `Layout.jsx`

**Change how enrichment works** → `backend/enrich.py`. Re-run against existing DBs; `get_db()` picks up the new `.enriched.db` automatically.

**Add a test** → frontend: add to the relevant `*.test.js` in `src/utils/`, run `npx vitest run`. Backend: add to `tests/`, run `pytest tests/ -q`.

---

## Test Coverage

| Layer | Runner | Count | What's covered |
|---|---|---|---|
| Backend analytics + queries + routers | pytest | 138 | All query functions, analytics, API responses |
| Frontend utils | Vitest | 205 | All pure functions in `src/utils/` |
| Frontend components | — | 0 | None yet — next step is `@testing-library/react` for `PivotTable`, `KindFilter`, `MeasureChip`, etc. |

Frontend component tests need `@testing-library/react` + `jsdom` (not yet installed). See plan in comments at top of `Explore.jsx`.
