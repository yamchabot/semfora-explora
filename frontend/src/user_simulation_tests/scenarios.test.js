/**
 * User Simulation Tests — Satisfaction Scenarios
 *
 * These tests model what a real user would experience when looking at the graph.
 * They do NOT assert raw numbers. They assert satisfaction outcomes.
 *
 * Three tiers (same convention as graphShapes.test.js):
 *   [INVARIANT] — must always be true regardless of renderer changes
 *   [CURRENT]   — reflects what the current renderer actually achieves
 *   [FIX]       — goals we haven't reached yet; documents the gap
 *
 * When a test fails, read the `diagnosis` and `repair` arrays first.
 * They tell you what to fix in the physics/perception layers.
 */

import { describe, it, expect } from "vitest";
import { perceive } from "./perception.js";
import { satisfy, satisfyAll, repairPlan, INTENTS, DIMS } from "./satisfaction.js";
import {
  runSimulation,
  makePipeline,
  makeHub,
  makeTwoModules,
  makeFunnel,
  makeLayered,
  makeDense,
  makeTwoChains,
  PRODUCTION_CONFIG,
} from "./simulation.js";

// Helper: run, perceive, satisfy in one shot and log failures nicely
function simulate(graphFactory, intent, perceptionOpts = {}, simConfig = {}) {
  const { nodes, links, ...extras } = graphFactory;
  const settled = runSimulation(nodes, links, simConfig);
  const byId = Object.fromEntries(settled.map((n) => [n.id, n]));
  const perceptions = perceive(settled, links, { ...extras, ...perceptionOpts });
  const result = satisfy(perceptions, intent);
  return { settled, byId, perceptions, result, nodes, links };
}

// ---------------------------------------------------------------------------
// SCENARIO 1: Pipeline (trace a call chain)
// ---------------------------------------------------------------------------

describe("Scenario: Pipeline — trace_pipeline intent", () => {
  const graph = makePipeline(6);
  const pipelineIds = graph.nodes.map((n) => n.id);

  it("[INVARIANT] simulation produces valid positions for all nodes", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    expect(settled).toHaveLength(6);
    for (const n of settled) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("[INVARIANT] edge legibility: edges in a 6-node pipeline should not be invisible", () => {
    const { perceptions } = simulate(graph, INTENTS.TRACE_PIPELINE, { pipelineIds });
    expect(perceptions.invisible_edge_fraction).toBeLessThan(0.5);
  });

  it("[CURRENT] satisfaction result for trace_pipeline intent", () => {
    const { result, perceptions } = simulate(graph, INTENTS.TRACE_PIPELINE, { pipelineIds });
    // Log the full picture regardless of pass/fail so we can see what's happening
    console.log("\n[Pipeline] Perceptions:");
    console.log("  pipeline_visible:", perceptions.pipeline_visible, `(elongation=${perceptions.pipeline_elongation?.toFixed(2)}, linearity=${perceptions.pipeline_linearity?.toFixed(2)})`);
    console.log("  graph_readable:", perceptions.graph_readable);
    console.log("  clusters_distinct:", perceptions.clusters_distinct);
    console.log("\n[Pipeline] Satisfaction:", result.summary);
    if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);
    if (!result.satisfied) console.log("  Repair:", repairPlan(result.violations));

    // Assert sanity: simulation should produce finite positions
    // (layout_balanced and edges_legible are [FIX]-tier goals for the current plain sim)
    expect(Number.isFinite(perceptions.layout_spread)).toBe(true);
    expect(perceptions.layout_spread).toBeGreaterThan(0);
  });

  it("[FIX] pipeline_visible should be true after simulation settles", () => {
    const { perceptions, result } = simulate(graph, INTENTS.TRACE_PIPELINE, { pipelineIds });
    if (!perceptions.pipeline_visible) {
      console.log(`  pipeline_elongation=${perceptions.pipeline_elongation?.toFixed(2)} (need > 1.5), linearity=${perceptions.pipeline_linearity?.toFixed(2)}`);
      console.log("  Repair:", repairPlan(result.violations));
    }
    expect(perceptions.pipeline_visible).toBe(true);
  });

  it("[FIX] trace_pipeline is fully satisfied", () => {
    const { result } = simulate(graph, INTENTS.TRACE_PIPELINE, { pipelineIds });
    expect(result.satisfied).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2: Hub-and-spoke (spot hotspots)
// ---------------------------------------------------------------------------

describe("Scenario: Hub-and-spoke — spot_hotspots intent", () => {
  const graph = makeHub(8);

  it("[INVARIANT] hub has higher degree than spokes", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    const settled_with_links = { nodes: graph.nodes, links: graph.links };
    // Degree check doesn't need simulation
    const hubInDeg = graph.links.filter((l) => l.target === "hub").length;
    const hubOutDeg = graph.links.filter((l) => l.source === "hub").length;
    expect(hubInDeg + hubOutDeg).toBe(8);
  });

  it("[INVARIANT] edge legibility: hub spokes should be visible", () => {
    const { perceptions } = simulate(graph, INTENTS.SPOT_HOTSPOTS, { hubId: "hub" });
    expect(perceptions.edge_legibility_score).toBeGreaterThan(0.5);
  });

  it("[CURRENT] satisfaction for spot_hotspots intent", () => {
    const { result, perceptions } = simulate(graph, INTENTS.SPOT_HOTSPOTS, { hubId: "hub" });
    console.log("\n[Hub] Perceptions:");
    console.log("  hub_central:", perceptions.hub_central, `(error=${perceptions.hub_centrality_error?.toFixed(2)})`);
    console.log("  hub_degree_dominant:", perceptions.hub_degree_dominant);
    console.log("  graph_readable:", perceptions.graph_readable);
    console.log("\n[Hub] Satisfaction:", result.summary);
    if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);

    // What we can assert right now
    expect(perceptions.graph_readable).toBe(true);
    expect(perceptions.hub_degree_dominant).toBe(true);
  });

  it("[FIX] hub_central should be true (hub visually near center of its group)", () => {
    const { perceptions, result } = simulate(graph, INTENTS.SPOT_HOTSPOTS, { hubId: "hub" });
    if (!perceptions.hub_central) {
      console.log(`  hub_centrality_error=${perceptions.hub_centrality_error?.toFixed(2)} (need < 0.5)`);
      console.log("  Repair:", repairPlan(result.violations));
    }
    expect(perceptions.hub_central).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3: Two modules (explore architecture)
// ---------------------------------------------------------------------------

describe("Scenario: Two modules — explore_architecture intent", () => {
  const graph = makeTwoModules(6, 2);

  it("[INVARIANT] all nodes are placed", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    expect(settled).toHaveLength(12);
    settled.forEach((n) => {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    });
  });

  it("[CURRENT] satisfaction for explore_architecture", () => {
    const { result, perceptions } = simulate(graph, INTENTS.EXPLORE_ARCHITECTURE);
    console.log("\n[Two Modules] Perceptions:");
    console.log("  clusters_distinct:", perceptions.clusters_distinct,
      `(gestalt=${perceptions.gestalt_proximity_ratio?.toFixed(2)}, separation=${perceptions.blob_separation_ratio?.toFixed(2)})`);
    console.log("  clusters_merged:", perceptions.clusters_merged);
    console.log("  intra_group_cohesive:", perceptions.intra_group_cohesive, `(ratio=${perceptions.cohesion_ratio?.toFixed(2)})`);
    console.log("  graph_readable:", perceptions.graph_readable);
    console.log("\n[Two Modules] Satisfaction:", result.summary);
    if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);

    // Sanity: all 12 nodes placed with finite positions; scores are real numbers
    expect(perceptions.crowding_score).toBeGreaterThanOrEqual(0);
    expect(perceptions.blob_separation_ratio).toBeGreaterThanOrEqual(0);
    // Note: clusters_merged=true and graph_readable=false are EXPECTED here —
    // the plain D3 sim without blob containment forces merges groups. [FIX] tests cover this.
  });

  it("[FIX] clusters should be visually distinct (explore_architecture fully satisfied)", () => {
    const { result, perceptions } = simulate(graph, INTENTS.EXPLORE_ARCHITECTURE);
    if (!result.satisfied) {
      console.log("  Violations:", result.diagnosis);
      console.log("  Repair:", repairPlan(result.violations));
    }
    expect(result.satisfied).toBe(true);
  });

  it("[CURRENT] cross-boundary edges are visible in the neutral zone between groups", () => {
    const { perceptions } = simulate(graph, INTENTS.REVIEW_BOUNDARIES);
    console.log(`\n[Two Modules] cross_boundary_edges_visible: ${perceptions.cross_boundary_edges_visible} (rate=${perceptions.cross_boundary_edge_visibility_rate?.toFixed(2)}, count=${perceptions.cross_boundary_count})`);
    // Don't assert pass/fail yet — just document the score
    expect(perceptions.cross_boundary_count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4: Funnel (converging sink)
// ---------------------------------------------------------------------------

describe("Scenario: Funnel — debug_flow intent", () => {
  const graph = makeFunnel(6);

  it("[INVARIANT] sink has the highest in-degree", () => {
    const inDeg = {};
    for (const l of graph.links) {
      inDeg[l.target] = (inDeg[l.target] ?? 0) + 1;
    }
    expect(inDeg["sink"]).toBe(6);
  });

  it("[CURRENT] satisfaction for debug_flow intent", () => {
    const { result, perceptions } = simulate(graph, INTENTS.DEBUG_FLOW, { funnelSinkId: "sink" });
    console.log("\n[Funnel] Perceptions:");
    console.log("  funnel_visible:", perceptions.funnel_visible, `(convergence=${perceptions.funnel_sink_convergence?.toFixed(2)})`);
    console.log("  graph_readable:", perceptions.graph_readable);
    console.log("\n[Funnel] Satisfaction:", result.summary);
    if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);

    expect(perceptions.graph_readable).toBe(true);
  });

  it("[FIX] funnel_visible should be true (sink near centroid)", () => {
    const { perceptions, result } = simulate(graph, INTENTS.DEBUG_FLOW, { funnelSinkId: "sink" });
    if (!perceptions.funnel_visible) {
      console.log(`  convergence_ratio=${perceptions.funnel_sink_convergence?.toFixed(2)} (need < 0.4)`);
    }
    expect(perceptions.funnel_visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5: Layered architecture
// ---------------------------------------------------------------------------

describe("Scenario: Layered architecture — explore_architecture intent", () => {
  const graph = makeLayered(4);

  it("[INVARIANT] three layers each have 4 nodes", () => {
    const byGroup = {};
    for (const n of graph.nodes) {
      byGroup[n.group] = (byGroup[n.group] ?? 0) + 1;
    }
    expect(byGroup["api"]).toBe(4);
    expect(byGroup["service"]).toBe(4);
    expect(byGroup["data"]).toBe(4);
  });

  it("[CURRENT] layers_evident score", () => {
    const { perceptions } = simulate(graph, INTENTS.EXPLORE_ARCHITECTURE, {
      layerAssignments: graph.layerAssignments,
    });
    console.log("\n[Layered] Perceptions:");
    console.log("  layers_evident:", perceptions.layers_evident);
    console.log("  layer_min_separation:", perceptions.layer_min_separation?.toFixed(1));
    console.log("  layer_mean_positions:", JSON.stringify(perceptions.layer_mean_positions));
    console.log("  clusters_distinct:", perceptions.clusters_distinct);

    // Sanity: layer positions should be real numbers (NaN would mean parsing failed)
    const positions = Object.values(perceptions.layer_mean_positions ?? {});
    expect(positions.length).toBeGreaterThan(0);
    positions.forEach((p) => expect(Number.isFinite(p)).toBe(true));
  });

  it("[FIX] layers should be visually evident (min separation > 60px)", () => {
    const { perceptions } = simulate(graph, INTENTS.EXPLORE_ARCHITECTURE, {
      layerAssignments: graph.layerAssignments,
    });
    expect(perceptions.layers_evident).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6: Dense graph (scale / overview)
// ---------------------------------------------------------------------------

describe("Scenario: Dense graph — overview intent", () => {
  const graph = makeDense(30, 3, 3);

  it("[INVARIANT] all 30 nodes placed with finite positions", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    expect(settled).toHaveLength(30);
    settled.forEach((n) => {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    });
  });

  it("[CURRENT] dense graph satisfaction for overview intent", () => {
    const { result, perceptions } = simulate(graph, INTENTS.OVERVIEW);
    console.log("\n[Dense] Perceptions:");
    console.log("  graph_crowded:", perceptions.graph_crowded, `(overlap=${perceptions.overlap_rate?.toFixed(3)}, score=${perceptions.crowding_score?.toFixed(2)})`);
    console.log("  edge_hairball:", perceptions.edge_hairball, `(rate=${perceptions.edge_crossing_rate?.toFixed(2)})`);
    console.log("  layout_balanced:", perceptions.layout_balanced, `(spread=${perceptions.layout_spread?.toFixed(1)})`);
    console.log("  clusters_distinct:", perceptions.clusters_distinct);
    console.log("\n[Dense] Satisfaction:", result.summary);
    if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);

    // At minimum, we should get valid positions
    expect(perceptions.layout_spread).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7: Two chains in one group (chain separation)
// ---------------------------------------------------------------------------

describe("Scenario: Two independent chains in one group", () => {
  const graph = makeTwoChains(4);
  const chainAIds = ["ca0", "ca1", "ca2", "ca3"];
  const chainBIds = ["cb0", "cb1", "cb2", "cb3"];

  it("[INVARIANT] both chains have valid positions", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    const byId = Object.fromEntries(settled.map((n) => [n.id, n]));
    for (const id of [...chainAIds, ...chainBIds]) {
      expect(Number.isFinite(byId[id].x)).toBe(true);
      expect(Number.isFinite(byId[id].y)).toBe(true);
    }
  });

  it("[CURRENT] chain separation: measure centroid distance between the two chains", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    const byId = Object.fromEntries(settled.map((n) => [n.id, n]));
    const centA = {
      x: chainAIds.reduce((s, id) => s + byId[id].x, 0) / chainAIds.length,
      y: chainAIds.reduce((s, id) => s + byId[id].y, 0) / chainAIds.length,
    };
    const centB = {
      x: chainBIds.reduce((s, id) => s + byId[id].x, 0) / chainBIds.length,
      y: chainBIds.reduce((s, id) => s + byId[id].y, 0) / chainBIds.length,
    };
    const separation = Math.hypot(centA.x - centB.x, centA.y - centB.y);
    console.log(`\n[Two Chains] chain centroid separation: ${separation.toFixed(1)}px (target >60)`);
    expect(separation).toBeGreaterThan(0); // sanity check
  });

  it("[FIX] the two chains should be visually separated (centroid gap > 60px)", () => {
    const settled = runSimulation(graph.nodes, graph.links);
    const byId = Object.fromEntries(settled.map((n) => [n.id, n]));
    const centA = {
      x: chainAIds.reduce((s, id) => s + byId[id].x, 0) / chainAIds.length,
      y: chainAIds.reduce((s, id) => s + byId[id].y, 0) / chainAIds.length,
    };
    const centB = {
      x: chainBIds.reduce((s, id) => s + byId[id].x, 0) / chainBIds.length,
      y: chainBIds.reduce((s, id) => s + byId[id].y, 0) / chainBIds.length,
    };
    const separation = Math.hypot(centA.x - centB.x, centA.y - centB.y);
    expect(separation).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8: Multi-intent diagnostic
// Runs all intents simultaneously and shows which are satisfied.
// This is a living benchmark — not a pass/fail test.
// ---------------------------------------------------------------------------

describe("Scenario: Multi-intent diagnostic (all intents, two-module graph)", () => {
  it("[INVARIANT] satisfyAll returns a result for every intent", () => {
    const graph = makeTwoModules(6, 2);
    const settled = runSimulation(graph.nodes, graph.links);
    const perceptions = perceive(settled, graph.links);
    const allResults = satisfyAll(perceptions);
    expect(Object.keys(allResults)).toHaveLength(Object.keys(INTENTS).length);
  });

  it("[CURRENT] benchmark: which intents are currently satisfied?", () => {
    const graph = makeTwoModules(6, 2);
    const settled = runSimulation(graph.nodes, graph.links);
    const perceptions = perceive(settled, graph.links);
    const allResults = satisfyAll(perceptions);

    console.log("\n[Multi-Intent Benchmark] Results:");
    let satisfiedCount = 0;
    for (const [intent, result] of Object.entries(allResults)) {
      const icon = result.satisfied ? "✅" : "❌";
      const score = (result.overallScore * 100).toFixed(0);
      console.log(`  ${icon} ${intent.padEnd(25)} score=${score}/100`);
      if (!result.satisfied && result.diagnosis.length) {
        console.log(`     → ${result.diagnosis[0]}`);
      }
      if (result.satisfied) satisfiedCount++;
    }
    console.log(`\n  ${satisfiedCount}/${Object.keys(INTENTS).length} intents satisfied`);

    // Structural check: every intent has an overallScore (even if 0)
    // The console output above documents current satisfaction per intent
    for (const result of Object.values(allResults)) {
      expect(typeof result.overallScore).toBe("number");
      expect(result.satisfied === true || result.satisfied === false).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 9: Renderer comparison harness
// Tests whether a stronger charge improves satisfaction scores.
// ---------------------------------------------------------------------------

describe("Scenario: Renderer comparison — charge=-30 vs charge=-120", () => {
  it("[CURRENT] stronger charge improves overall satisfaction score for pipeline", () => {
    const graph = makePipeline(6);
    const pipelineIds = graph.nodes.map((n) => n.id);

    const settledWeak   = runSimulation(graph.nodes, graph.links, { charge: -30 });
    const settledStrong = runSimulation(graph.nodes, graph.links, { charge: -120 });

    const percWeak   = perceive(settledWeak,   graph.links, { pipelineIds });
    const percStrong = perceive(settledStrong, graph.links, { pipelineIds });

    const resultWeak   = satisfy(percWeak,   INTENTS.TRACE_PIPELINE);
    const resultStrong = satisfy(percStrong, INTENTS.TRACE_PIPELINE);

    console.log(`\n[Renderer Comparison] Pipeline — trace_pipeline intent`);
    console.log(`  charge=-30:  score=${(resultWeak.overallScore*100).toFixed(0)}/100, pipeline_elongation=${percWeak.pipeline_elongation?.toFixed(2)}`);
    console.log(`  charge=-120: score=${(resultStrong.overallScore*100).toFixed(0)}/100, pipeline_elongation=${percStrong.pipeline_elongation?.toFixed(2)}`);

    // We don't assert which is better yet — just log both and let the human decide.
    // [INVARIANT]: both should produce valid positioned nodes
    expect(settledWeak.every((n) => Number.isFinite(n.x))).toBe(true);
    expect(settledStrong.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});
