# Perception-Satisfaction Architecture

## The Problem With Pure Metrics

We have `layoutMetrics.js`. It computes things like `blobSeparation`, `chainLinearity`, `hubCentrality`. These are useful signals, but they are the wrong abstraction for reasoning about quality.

A Staff Engineer looking at a graph render doesn't think:
> "The `blobSeparation.minClearance` is 38px, threshold was 60px — FAIL"

They think:
> "I can barely tell where one cluster ends and another begins"
> "That pipeline looks like a blob — I can't see the flow"
> "Everything is crammed into the center"

The gap between those two framings is not just cosmetic. It's architectural. If we want to model whether a user is **satisfied**, we need layers that think the way they think.

---

## Three Layers

### Layer 1 — Instrumentation

**What it is**: Raw extraction of observable facts from the rendered system.

This layer asks: *what is actually true about this configuration of pixels, nodes, and edges?*

Examples:
- Node positions `(x, y)` and radii
- Edge endpoint pairs
- Group membership lists
- Inter-node Euclidean distances
- Edge crossing pairs (A→B crosses C→D)
- Node-to-centroid distances per group

This is geometry. No judgement. No thresholds. Just measurements that a camera could theoretically take.

**Why it's special**: We almost never write this kind of code. We write debugging printouts. We write CPU profilers. But we don't usually write code that says "extract the structural facts of this rendered output so someone else can reason about them." This layer is new territory.

`layoutMetrics.js` currently lives somewhere between Layer 1 and Layer 2. It needs to be split.

---

### Layer 2 — Perception

**What it is**: A model of how a human processes what they see and forms qualitative conclusions.

This layer asks: *given these raw facts, what would a person notice?*

Crucially, perception is not the same as measurement. Measurement says `distance=38`. Perception says `"those two blobs look like they're touching"`. The human never sees 38 — they see touching.

Perception can be multi-layered. Some perceptions are composed from other perceptions:

```
raw: inter-node distances, group membership
  → perceptual primitive: "these nodes look clustered" (gestalt proximity)
    → composed perception: "the module boundary is visible"
      → higher-order: "I can read the architecture from this graph"
```

Perception may use:
- **Geometric thresholds** — simple rules calibrated to human visual acuity (e.g. "two nodes overlap if gap < 8px at 1x zoom")
- **Statistical models** — "linearity" is high if variance in the perpendicular axis is low relative to the main axis
- **ML classifiers** — "does this subgraph look like a pipeline?" trained on human labels
- **Constraint systems** — some perceptions are themselves satisfaction problems

Output of this layer is **named perceptual qualities**, not raw scores. Something like:

```js
{
  pipeline_visible: true,
  clusters_distinct: false,
  hub_central: true,
  graph_crowded: true,
  structure_readable: false
}
```

These are the things a person would write in a code review comment about the graph.

---

### Layer 3 — Satisfaction (Ego Layer)

**What it is**: A constraint satisfaction problem that models the user's judgement.

This layer asks: *given all my perceptions, am I happy with this?*

This is separate from perception. You can perceive that a graph is crowded AND be fine with it (if it's a large project and you just want to see connectivity). You can perceive that a pipeline is slightly non-linear AND be unhappy (if you're specifically trying to communicate flow).

Satisfaction is **contextual and intentional**. It depends on what the user is trying to accomplish.

**Formulation as a CSP:**

Variables are satisfaction dimensions:
```
readable: {satisfied, unsatisfied}
structural_fidelity: {satisfied, unsatisfied}
visual_comfort: {satisfied, unsatisfied}
cluster_clarity: {satisfied, unsatisfied}
```

Constraints are rules that link perceptual qualities to satisfaction:
```
IF pipeline_detected AND NOT pipeline_visible → structural_fidelity = unsatisfied
IF graph_crowded AND NOT clusters_distinct → visual_comfort = unsatisfied
IF hub_exists AND NOT hub_central → structural_fidelity = unsatisfied
IF clusters_distinct → cluster_clarity = satisfied
```

Solve for: **satisfiability** — is there an assignment of satisfaction variables consistent with all constraints?

If UNSAT: which constraints are violated? → This is the diagnosis.

If SAT: what is the minimum set of perceptual changes needed to reach SAT? → This is the prescription.

---

## Why This Architecture

### Separation of concerns is real here

The three layers can evolve independently:
- You can swap the perception model (rule-based → ML) without touching the satisfaction constraints
- You can tighten satisfaction constraints without touching how crowding is measured
- You can add new instrumentation without changing what "satisfaction" means

### Diagnosis becomes automatic

Instead of manually reading metric numbers to understand why a layout is bad, the constraint layer tells you which constraints are violated. That's the diagnosis. You don't need to know that `blobSeparation=38`. You need to know that `cluster_clarity = unsatisfied` because `clusters_distinct = false`.

### The prescription points at the right thing to fix

The satisfaction solver can be run in reverse: "what perceptual qualities need to change for this layout to be satisfying?" That directly tells the physics system what to optimize for — not abstract scores but named qualities that map to specific force parameters.

### This is a platform, not a test suite

Today we use it to improve the graph renderer. Tomorrow it could be used to:
- Auto-tune physics parameters via search
- Give users a "quality report" when a layout settles
- Validate that a code change didn't regress perceived quality
- Train a model on "what makes a good layout" using the satisfaction layer as labels

---

## Current State

| Layer | Status |
|-------|--------|
| Instrumentation | Partial — raw geometry mixed into `layoutMetrics.js`, needs extraction |
| Perception (primitives) | Partial — some metrics in `layoutMetrics.js` are perceptual, e.g. `gestaltProximity` |
| Perception (composed) | Not started |
| Perception (named qualities) | Not started |
| Satisfaction (CSP) | Not started |

---

## Implementation Plan

### Step 1: Split `layoutMetrics.js`

Move raw geometry into `src/utils/layoutInstrumentation.js` (Layer 1).
Keep perceptual computations in `layoutMetrics.js` but refactor them to return named quality objects, not bare numbers.

### Step 2: Build `src/utils/layoutPerception.js`

Takes instrumentation output. Returns named perceptual qualities (`pipeline_visible`, `clusters_distinct`, etc.). Start with rule-based. Add ML hooks later.

### Step 3: Build `src/utils/layoutSatisfaction.js`

A lightweight CSP engine (or just a rule evaluator, depending on complexity). Takes perception output + user intent. Returns SAT/UNSAT + violated constraints.

### Step 4: Wire into tests

Tests stop asserting raw numbers. They assert satisfaction outcomes:
```js
const result = satisfactionCheck(layout, { intent: "show_pipeline" });
expect(result.satisfied).toBe(true);
expect(result.violations).toHaveLength(0);
```

### Step 5 (optional): Wire into the renderer

The satisfaction layer can run after simulation settles and surface a quality score in the UI, or trigger a layout re-run with adjusted parameters.

---

## Key Distinctions To Keep Sharp

| Concept | Question it answers | Example |
|---------|-------------------|---------|
| Instrumentation | What is true? | `inter_node_distance = 38px` |
| Perception | What do I notice? | `"those clusters look merged"` |
| Satisfaction | Am I happy? | `cluster_clarity = unsatisfied` |

These are not the same thing. Conflating them is how you end up with tests that check `blobSeparation > 60` and still have no idea whether the graph looks good.
