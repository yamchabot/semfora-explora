# Semfora Explora — Roadmap

## Long-term vision: Unified analytic dashboard

The goal is one composable interface that replaces the current siloed views.
Think OLAP-style: a generic query model + a generic render model, so you can
compose queries and visualizers in any combination. Likely implemented as a
"panels" dashboard where each panel has a data source (query) and a renderer
(graph, table, building view, heatmap, etc.) that the user configures.

Current views would become first-party panel presets. The real value is being
able to answer questions like "show me the dead code in only the Feature layer"
or "show coupling for only the modules involved in this cycle" — queries and
visualizers that don't exist as fixed endpoints today.

This is a long-term goal. We get there by building the analytics layer well
first so that composing queries across analysis types is natural.

---

## Current focus: better analytics

The building view needs the most work. The layer assignment (Foundation →
Platform → Services → Features → Leaves) is currently based entirely on
caller_count percentile, which is a rough proxy at best. It doesn't reflect
architectural intent and the load-bearing column visualization needs to be
more meaningful.

Areas to improve:
- Layer assignment: consider edges/reachability, not just caller_count
- Better signal-to-noise in each view (the __external__ fix was step 1)
- More meaningful building view columns and load-bearing detection
- Cross-view filtering (e.g., cycle participants shown in building view)
