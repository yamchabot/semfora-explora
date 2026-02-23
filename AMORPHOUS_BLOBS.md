# AMORPHOUS_BLOBS.md — Visualization Idea

## The Concept

Render individual symbols (functions, classes, variables — all nodes) as small dots in a force-directed graph, then **draw an amorphous bounding blob** around all nodes that share the same group value (module, class, etc.).

The blobs are organic/soft — not rectangles or convex hulls, but smoothed boundary polygons that feel like living clusters.

## How It Works

### Force Layout
- Each node has its normal inter-node forces (charge repulsion, edge attraction)
- Add a **grouping force**: a gentle pull toward the centroid of the node's group
  - Strength tunable — strong enough to cluster, weak enough to let edges breathe
  - Something like `d3.forceRadial(0, groupCentroid.x, groupCentroid.y).strength(0.08)`
  - Or a custom `alpha`-scaled force that nudges each node toward its group center each tick

### Blob Rendering
- After the force layout settles (or on each tick), compute the **convex hull** or better, a **concave hull / alpha-shape** of each group's node positions
- Expand the hull outward by a padding radius (e.g., 30px) so it wraps loosely around nodes
- Smooth the polygon with a Catmull-Rom or cardinal spline → amorphous organic shape
- Fill with a low-opacity group color, stroke with a slightly higher-opacity border

### Libraries / Approach
- `d3-delaunay` or `d3.polygonHull` for convex hull (quick start)
- `hull.js` or alphashape for concave hull (better for irregular clusters)
- Canvas path with `bezierCurveTo` for smoothing
- Can be drawn in `ForceGraph2D`'s `onRenderFramePost` callback (draws on top of everything)
  - Or switch to a raw d3 + canvas render loop for full control

## Aggregation Modes

| Group by | Blob represents |
|----------|-----------------|
| `module` | Module blobs — shows architectural boundaries |
| `class`  | Class blobs — shows encapsulation (or lack thereof) |
| `risk`   | Risk blobs — shows spatial clustering of danger zones |
| `community` | Algorithmic community detection blobs |

Switching the aggregation reruns the grouping force and redraws the blobs. Nodes stay in place but get pulled to new centroids — smooth animated transition.

## Visual Design
- Blob fill: group color at ~10-15% opacity
- Blob stroke: group color at ~40% opacity, 1.5-2px
- Label the blob centroid with the group name (large, low-opacity background text)
- Nodes themselves: small circles (4-8px), colored by a measure (e.g., dead_ratio heatmap)
- Edges: thin, low-opacity lines — the blobs are the story, edges are detail

## Why It's Cool
- **Immediately legible** — you see module structure without reading anything
- **Reveals coupling** — edges crossing blob boundaries = cross-module calls, visible at a glance
- **Organic feel** — blobs breathe and shift as the simulation runs; amorphous shape encodes "this is a real cluster, not a box someone drew"
- **Scalable** — works with hundreds of nodes; individual names matter less, spatial grouping matters more

## Implementation Notes
- `nodeCanvasObjectMode: () => "after"` still works for node dots
- Add `onRenderFramePost(ctx)` to ForceGraph2D for drawing blobs underneath everything on each frame tick — or `onRenderFramePre` to draw blobs before nodes (so nodes render on top)
- Group centroids: recompute each frame as `mean(x)` / `mean(y)` of all nodes in group
- The grouping force: can use `simulation.alpha()` to scale strength so it doesn't dominate when cooled

## Related Prior Art
- D3 force clustering examples (Mike Bostock)
- `d3.polygonHull` + smooth spline blobs
- Observable notebooks: "Bubble Map" / "Force-Directed Clusters"

## Open Questions
- How to handle overlapping blobs when two modules are heavily coupled? (Intentionally let them overlap — the visual mess IS the signal)
- Animate blob expansion/contraction as filters change?
- Click a blob to isolate/highlight that group?
