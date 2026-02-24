/**
 * Layer 2: Perception
 *
 * Models how a human processes a graph render and forms qualitative conclusions.
 * Takes raw geometry (instrumentation output) and returns named perceptual qualities.
 *
 * Perceptions are NOT raw measurements. "graph_crowded" is not "overlapRate = 0.3".
 * A person never sees 0.3 — they see "I can barely find the node I'm looking for."
 *
 * Some perceptions compose from simpler perceptions (marked with ← sources).
 * Numeric scores are included alongside booleans for diagnostics and calibration.
 */

import {
  groupCentroids,
  groupRadii,
  groupBounds,
  nodeDegrees,
  nodeToGroupCentroidDist,
  nodeToGlobalCentroidDist,
  edgeLengths,
  overlapRate,
  edgeCrossingRate,
  elongationRatio,
  hubCentralityError,
  chainLinearityScore,
  blobSeparationRatio,
  gestaltProximityRatio,
  layoutSpread,
  nodeRadius,
  dist,
  nodeId,
} from "./instrumentation.js";

// ---------------------------------------------------------------------------
// Perception calibration constants
// (represent what "normal" human visual thresholds look like at our scale)
// ---------------------------------------------------------------------------

const CROWDING_OVERLAP_THRESHOLD = 0.08;    // >8% node pairs overlapping = crowded
const CROWDING_DENSITY_THRESHOLD = 0.004;   // nodes per sq-px area; above = dense
const HAIRBALL_CROSSING_THRESHOLD = 0.25;   // >25% edge pairs crossing = hairball (15% too tight for small chains)
const EDGE_MIN_VISIBLE_LENGTH = 12;         // edges shorter than this are invisible
const EDGE_INVISIBLE_FRACTION = 0.25;       // >25% invisible edges = not legible
const PIPELINE_LINEARITY_THRESHOLD = 1.5;   // elongation ratio above this = pipeline visible
const PIPELINE_STRONG_THRESHOLD = 2.5;      // above this = clearly a pipeline
const HUB_CENTRALITY_THRESHOLD = 0.5;       // error < 0.5 = hub looks central
const BLOB_SEPARATED_RATIO = 1.2;           // blobSeparationRatio > this = blobs look separate
const BLOB_MERGED_RATIO = 0.8;              // below this = blobs look merged
const GESTALT_DISTINCT_THRESHOLD = 0.55;    // intra/inter < 0.55 = clusters visually distinct
const BALANCE_SPREAD_MIN = 80;              // layout with spread < 80px looks cramped
const FUNNEL_CONVERGENCE_THRESHOLD = 0.4;  // sink within this fraction of group radius = funnel visible
const LAYER_SEPARATION_THRESHOLD = 60;      // layers must be > 60px apart on primary axis
const ISOLATION_DISTANCE_FACTOR = 2.5;      // isolated node > 2.5× mean group radius away

// ---------------------------------------------------------------------------
// Individual perception functions (composable, exported for testing)
// ---------------------------------------------------------------------------

/** Is the graph too crowded to navigate comfortably? */
export function perceiveCrowding(nodes, links) {
  const overlap = overlapRate(nodes);

  // Density: nodes per area of bounding box
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const area =
    (Math.max(...xs) - Math.min(...xs)) *
    (Math.max(...ys) - Math.min(...ys));
  const density = area < 1 ? 0 : nodes.length / area;

  const score = Math.max(overlap / CROWDING_OVERLAP_THRESHOLD, density / CROWDING_DENSITY_THRESHOLD);
  return {
    graph_crowded: overlap > CROWDING_OVERLAP_THRESHOLD || density > CROWDING_DENSITY_THRESHOLD,
    crowding_score: Math.min(1, score),       // 0=empty, 1=very crowded
    overlap_rate: overlap,
    node_density: density,
  };
}

/**
 * Can edges be seen? An edge is legible if it's long enough to distinguish.
 * Note: crossing rate is a separate perception (edge_hairball) — do not conflate them.
 * A 6-node chain with one bent edge is still legible even if two segments cross.
 */
export function perceiveEdgeLegibility(nodes, links) {
  const lengths = edgeLengths(nodes, links).map((e) => e.length).filter((l) => l !== null);

  if (!lengths.length) return { edges_legible: true, edge_legibility_score: 1, invisible_edge_fraction: 0 };

  const invisible = lengths.filter((l) => l < EDGE_MIN_VISIBLE_LENGTH).length;
  const invisibleFraction = invisible / lengths.length;

  return {
    edges_legible: invisibleFraction < EDGE_INVISIBLE_FRACTION,
    edge_legibility_score: 1 - invisibleFraction,
    invisible_edge_fraction: invisibleFraction,
  };
}

/** Does the layout feel like a hairball (too many crossings)? */
export function perceiveHairball(nodes, links) {
  const rate = edgeCrossingRate(nodes, links);
  return {
    edge_hairball: rate > HAIRBALL_CROSSING_THRESHOLD,
    hairball_score: Math.min(1, rate / HAIRBALL_CROSSING_THRESHOLD),
    crossing_rate: rate,
  };
}

/** Is the layout using space well, or is everything collapsed to one area? */
export function perceiveBalance(nodes) {
  const spread = layoutSpread(nodes);
  const gc = { x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length, y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length };

  // Is the layout off-center from origin?
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  return {
    layout_balanced: spread > BALANCE_SPREAD_MIN,
    layout_spread: spread,
    layout_aspect_ratio: height < 1 ? Infinity : width / height,
    layout_width: width,
    layout_height: height,
  };
}

/**
 * Does a specific set of nodes look like a pipeline (elongated, directional)?
 * opts.pipelineIds: ordered array of node IDs forming the chain.
 */
export function perceivePipeline(nodes, links, opts = {}) {
  const { pipelineIds } = opts;
  if (!pipelineIds?.length) return { pipeline_visible: false, pipeline_score: 0 };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const pipelineNodes = pipelineIds.map((id) => byId[id]).filter(Boolean);
  if (pipelineNodes.length < 2) return { pipeline_visible: false, pipeline_score: 0 };

  const elongation = elongationRatio(pipelineNodes);
  const linearity = chainLinearityScore(pipelineIds, byId);

  // Pipeline is visible if nodes are elongated (PCA shape, not path order).
  // Linearity by ID order is unreliable — D3 may place p0 and p5 next to each other.
  // A human sees "elongated cluster" and reads pipeline regardless of which end is which.
  const visible = elongation > PIPELINE_LINEARITY_THRESHOLD;
  const strong = elongation > PIPELINE_STRONG_THRESHOLD;

  return {
    pipeline_visible: visible,
    pipeline_strong: strong,
    pipeline_score: Math.min(1, (elongation / PIPELINE_STRONG_THRESHOLD) * linearity),
    pipeline_elongation: elongation,
    pipeline_linearity: linearity,
  };
}

/**
 * Is a hub node visually central in its group (not pushed to the edge)?
 * opts.hubId: node ID of the hub.
 */
export function perceiveHub(nodes, links, opts = {}) {
  const { hubId } = opts;
  if (!hubId) return { hub_central: false, hub_score: 0 };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const hub = byId[hubId];
  if (!hub) return { hub_central: false, hub_score: 0 };

  const groupNodes = nodes.filter((n) => (n.group ?? "__default__") === (hub.group ?? "__default__"));
  const cents = groupCentroids(groupNodes);
  const centroid = cents[hub.group ?? "__default__"];

  const error = hubCentralityError(hub, groupNodes, centroid);
  const degrees = nodeDegrees(nodes, links);
  const hubDegree = degrees[hubId]?.total ?? 0;
  const maxDeg = Math.max(...Object.values(degrees).map((d) => d.total));

  // Hub is central if: close to centroid AND has notably high degree
  const degreeDominant = maxDeg > 0 && hubDegree / maxDeg > 0.5;

  return {
    hub_central: error < HUB_CENTRALITY_THRESHOLD,
    hub_degree_dominant: degreeDominant,
    hub_score: Math.max(0, 1 - error),
    hub_centrality_error: error,
    hub_degree: hubDegree,
  };
}

/**
 * Are multi-group blob clusters visually distinct from each other?
 * Relies on gestalt proximity and physical blob separation.
 */
export function perceiveClusters(nodes) {
  const groups = [...new Set(nodes.map((n) => n.group ?? "__default__"))];
  if (groups.length < 2) return { clusters_distinct: true, cluster_score: 1 };

  const proximity = gestaltProximityRatio(nodes);   // lower = more distinct
  const separation = blobSeparationRatio(nodes);    // higher = more distinct

  // Clusters are distinct if nodes within groups are closer together than between groups
  const proximityOk = proximity < GESTALT_DISTINCT_THRESHOLD;
  const separationOk = separation > BLOB_SEPARATED_RATIO;

  return {
    clusters_distinct: proximityOk || separationOk,
    clusters_merged: separation < BLOB_MERGED_RATIO,
    cluster_score: Math.min(1, (GESTALT_DISTINCT_THRESHOLD / Math.max(proximity, 0.01)) * 0.5 +
                              Math.min(separation / BLOB_SEPARATED_RATIO, 1) * 0.5),
    gestalt_proximity_ratio: proximity,
    blob_separation_ratio: separation,
  };
}

/**
 * Does a specific node appear isolated from the rest of the graph?
 * Isolated nodes are often important outliers (dead code, bridges, etc.)
 * and should be visually distinct, not buried in a cluster.
 */
export function perceiveIsolation(nodes, links, opts = {}) {
  const { isolatedIds } = opts;
  if (!isolatedIds?.length) return { isolated_nodes_visible: true };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const cents = groupCentroids(nodes.filter((n) => !isolatedIds.includes(n.id)));
  const radii = groupRadii(nodes, cents);

  const results = isolatedIds.map((id) => {
    const node = byId[id];
    if (!node) return { id, visible: false };
    const nearestGroup = Object.entries(cents).reduce((best, [g, c]) => {
      const d = dist(node, c);
      return d < best.d ? { g, d } : best;
    }, { g: null, d: Infinity });
    const threshold = (radii[nearestGroup.g] ?? 50) * ISOLATION_DISTANCE_FACTOR;
    return { id, visible: nearestGroup.d > threshold, distance: nearestGroup.d, threshold };
  });

  return {
    isolated_nodes_visible: results.every((r) => r.visible),
    isolated_node_details: results,
  };
}

/**
 * Is a funnel shape visible — multiple sources converging to one sink node?
 * opts.funnelSinkId: node ID of the converging sink.
 */
export function perceiveFunnel(nodes, links, opts = {}) {
  const { funnelSinkId } = opts;
  if (!funnelSinkId) return { funnel_visible: false, funnel_score: 0 };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const sink = byId[funnelSinkId];
  if (!sink) return { funnel_visible: false, funnel_score: 0 };

  const groupNodes = nodes.filter((n) => (n.group ?? "__default__") === (sink.group ?? "__default__"));
  const cents = groupCentroids(groupNodes);
  const centroid = cents[sink.group ?? "__default__"];
  if (!centroid) return { funnel_visible: false, funnel_score: 0 };

  const radii = groupRadii(groupNodes, cents);
  const groupRadius = radii[sink.group ?? "__default__"] ?? 100;
  const sinkDist = dist(sink, centroid);
  const convergenceRatio = sinkDist / groupRadius;

  // Funnel visible if: sink is near centroid (many paths converge = centripetal gravity)
  // AND sink has high in-degree
  const degrees = nodeDegrees(nodes, links);
  const sinkInDeg = degrees[funnelSinkId]?.in ?? 0;
  const maxInDeg = Math.max(...Object.values(degrees).map((d) => d.in));

  return {
    funnel_visible: convergenceRatio < FUNNEL_CONVERGENCE_THRESHOLD && maxInDeg > 0 && sinkInDeg / maxInDeg > 0.5,
    funnel_score: Math.max(0, (1 - convergenceRatio / FUNNEL_CONVERGENCE_THRESHOLD)),
    funnel_sink_convergence: convergenceRatio,
    funnel_sink_indegree_dominance: maxInDeg > 0 ? sinkInDeg / maxInDeg : 0,
  };
}

/**
 * Are there visible horizontal or vertical strata (layers)?
 * opts.layerAssignments: { [nodeId]: layerIndex } (0, 1, 2...)
 * opts.axis: "y" (default) or "x"
 */
export function perceiveLayers(nodes, links, opts = {}) {
  const { layerAssignments, axis = "y" } = opts;
  if (!layerAssignments) return { layers_evident: false };

  const coord = axis === "x" ? "x" : "y";
  const layers = {};
  for (const [id, layerIdx] of Object.entries(layerAssignments)) {
    if (!layers[layerIdx]) layers[layerIdx] = [];
    const n = nodes.find((n) => n.id === id);
    if (n) layers[layerIdx].push(n[coord]);
  }

  const layerMeans = Object.fromEntries(
    Object.entries(layers).map(([l, coords]) => [
      l,
      coords.reduce((a, b) => a + b, 0) / coords.length,
    ])
  );

  const sortedLayers = Object.keys(layerMeans).sort((a, b) => layerMeans[a] - layerMeans[b]);
  const separations = [];
  for (let i = 1; i < sortedLayers.length; i++) {
    separations.push(Math.abs(layerMeans[sortedLayers[i]] - layerMeans[sortedLayers[i - 1]]));
  }

  const minSep = separations.length ? Math.min(...separations) : 0;
  return {
    layers_evident: separations.length > 0 && minSep > LAYER_SEPARATION_THRESHOLD,
    layer_min_separation: minSep,
    layer_mean_positions: layerMeans,
    layers_evident_score: Math.min(1, minSep / LAYER_SEPARATION_THRESHOLD),
  };
}

/**
 * Can the direction of flow be read from edge orientations?
 * (Do most edges point in a consistent direction?)
 */
export function perceiveDirectionality(nodes, links) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  if (!links.length) return { direction_readable: false, direction_score: 0 };

  const angles = links.map((l) => {
    const s = byId[nodeId(l.source)], t = byId[nodeId(l.target)];
    if (!s || !t) return null;
    return Math.atan2(t.y - s.y, t.x - s.x);
  }).filter((a) => a !== null);

  if (!angles.length) return { direction_readable: false, direction_score: 0 };

  // Compute circular mean and variance
  const sinSum = angles.reduce((s, a) => s + Math.sin(a), 0);
  const cosSum = angles.reduce((s, a) => s + Math.cos(a), 0);
  const R = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / angles.length; // 0=random, 1=aligned

  return {
    direction_readable: R > 0.5,
    direction_score: R,
    mean_direction_angle: Math.atan2(sinSum, cosSum),
  };
}

/**
 * Are cross-group edges visually distinct from within-group edges?
 * (Cross-boundary calls should not look like local calls — they're architectural signals)
 */
export function perceiveCrossBoundaryEdges(nodes, links) {
  const crossLinks = links.filter((l) => {
    const s = nodes.find((n) => n.id === nodeId(l.source));
    const t = nodes.find((n) => n.id === nodeId(l.target));
    return s && t && (s.group ?? "__default__") !== (t.group ?? "__default__");
  });

  if (!crossLinks.length) return { cross_boundary_edges_visible: true, cross_boundary_count: 0 };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const cents = groupCentroids(nodes);
  const radii = groupRadii(nodes, cents);

  // A cross-boundary edge is "visible" if the midpoint lies in a neutral zone
  // (outside both group radii) — if it's buried inside a group, it looks local
  const visible = crossLinks.filter((l) => {
    const s = byId[nodeId(l.source)], t = byId[nodeId(l.target)];
    if (!s || !t) return false;
    const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
    const sg = s.group ?? "__default__", tg = t.group ?? "__default__";
    const sc = cents[sg], tc = cents[tg];
    const distFromSrc = sc ? Math.hypot(mid.x - sc.x, mid.y - sc.y) : Infinity;
    const distFromTgt = tc ? Math.hypot(mid.x - tc.x, mid.y - tc.y) : Infinity;
    return distFromSrc > (radii[sg] ?? 0) * 0.7 || distFromTgt > (radii[tg] ?? 0) * 0.7;
  });

  return {
    cross_boundary_edges_visible: visible.length / crossLinks.length > 0.5,
    cross_boundary_edge_visibility_rate: crossLinks.length ? visible.length / crossLinks.length : 1,
    cross_boundary_count: crossLinks.length,
  };
}

/**
 * Do nodes within each group stay together (intra-group cohesion)?
 * A cluster that is spread all over the canvas doesn't read as a cluster.
 */
export function perceiveGroupCohesion(nodes) {
  const groups = [...new Set(nodes.map((n) => n.group ?? "__default__"))];
  if (groups.length < 2) return { intra_group_cohesive: true, cohesion_score: 1 };

  const cents = groupCentroids(nodes);
  const radii = groupRadii(nodes, cents);

  // Compare each group's radius to global inter-centroid distances
  const centList = Object.entries(cents);
  const interDists = [];
  for (let i = 0; i < centList.length; i++) {
    for (let j = i + 1; j < centList.length; j++) {
      interDists.push(Math.hypot(
        centList[i][1].x - centList[j][1].x,
        centList[i][1].y - centList[j][1].y
      ));
    }
  }
  const meanInterDist = interDists.length ? interDists.reduce((a, b) => a + b, 0) / interDists.length : 1;
  const meanRadius = Object.values(radii).reduce((a, b) => a + b, 0) / Object.values(radii).length;

  const cohesionRatio = meanRadius / (meanInterDist || 1); // lower = more cohesive

  return {
    intra_group_cohesive: cohesionRatio < 0.6,
    cohesion_score: Math.max(0, 1 - cohesionRatio),
    mean_group_radius: meanRadius,
    mean_inter_centroid_dist: meanInterDist,
    cohesion_ratio: cohesionRatio,
  };
}

// ---------------------------------------------------------------------------
// Master perception function
// ---------------------------------------------------------------------------

/**
 * Run all perceptions and return a unified perception object.
 *
 * opts:
 *   pipelineIds    — ordered node ID array for pipeline perception
 *   hubId          — node ID for hub-centrality perception
 *   funnelSinkId   — node ID for funnel perception
 *   layerAssignments — { [nodeId]: layerIndex }
 *   isolatedIds    — node IDs expected to be isolated
 */
export function perceive(nodes, links, opts = {}) {
  const crowding       = perceiveCrowding(nodes, links);
  const legibility     = perceiveEdgeLegibility(nodes, links);
  const hairball       = perceiveHairball(nodes, links);
  const balance        = perceiveBalance(nodes);
  const pipeline       = perceivePipeline(nodes, links, opts);
  const hub            = perceiveHub(nodes, links, opts);
  const clusters       = perceiveClusters(nodes);
  const isolation      = perceiveIsolation(nodes, links, opts);
  const funnel         = perceiveFunnel(nodes, links, opts);
  const layers         = perceiveLayers(nodes, links, opts);
  const directionality = perceiveDirectionality(nodes, links);
  const crossBoundary  = perceiveCrossBoundaryEdges(nodes, links);
  const cohesion       = perceiveGroupCohesion(nodes);

  // Composed perception: "I can read this graph" (requires multiple primitives)
  const graph_readable =
    !crowding.graph_crowded &&
    legibility.edges_legible &&
    !hairball.edge_hairball &&
    balance.layout_balanced;

  // Composed perception: "the structure is clear" (depends on what's in the graph)
  const structure_clear =
    clusters.clusters_distinct &&
    cohesion.intra_group_cohesive &&
    !clusters.clusters_merged;

  return {
    // Visual comfort
    ...crowding,
    ...legibility,
    ...hairball,
    ...balance,

    // Structural patterns (optional — only meaningful when opts provided)
    ...pipeline,
    ...hub,
    ...funnel,
    ...layers,

    // Group-level
    ...clusters,
    ...cohesion,
    ...isolation,

    // Topology
    ...directionality,
    ...crossBoundary,

    // Composed perceptions
    graph_readable,
    structure_clear,
  };
}
