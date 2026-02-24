# User Simulation Tests — Agent Skill

You are extending a three-layer perception-satisfaction system that models whether a user is happy with a graph layout. Read this entire document before touching any file.

---

## What This System Is

Most tests check *what the code does*. These tests check *how a person experiences the result*.

There are three layers, each doing different work:

```
instrumentation.js   →   perception.js   →   satisfaction.js
(what is true)           (what I notice)      (am I happy?)
```

A user never sees a number like `blobSeparationRatio = 0.16`. They see "I can't tell where one module ends and the other begins." The gap between those framings is architectural. These three files bridge it.

**The test file (`scenarios.test.js`) never reads raw numbers from instrumentation. It only reads named perceptual qualities and satisfaction outcomes.**

---

## Layer 1 — `instrumentation.js`

Pure geometry. No thresholds, no judgement.

**What goes here:** distances, radii, centroids, overlap counts, crossing counts, elongation ratios, degrees, gestalt ratios. Anything a camera could theoretically extract from a rendered frame.

**What does NOT go here:** thresholds, human-readable conclusions, anything that uses the word "visible" or "crowded."

**All functions are pure.** Input: `nodes` (with `{id, x, y, val?, group?}`) and `links` (with `{source, target}`). Output: plain objects or numbers.

**When to add here:** you need a new raw measurement that perception.js can consume. Ask yourself: does a number feel like a fact or a judgement? Facts go here.

---

## Layer 2 — `perception.js`

Models what a human notices. Returns named boolean/enum qualities.

**What goes here:** conclusions like `pipeline_visible`, `hub_central`, `clusters_distinct`, `edge_hairball`. These are the things a senior engineer would write in a code review about the graph.

**Key conventions:**
- Every perception function returns an object with a boolean quality AND numeric scores for calibration:
  ```js
  return {
    pipeline_visible: true,      // ← what the satisfaction layer consumes
    pipeline_strong: false,      // ← finer-grained version
    pipeline_score: 0.73,        // ← 0–1, for diagnostics
    pipeline_elongation: 1.84,   // ← raw number, for calibration
    pipeline_linearity: 0.91,    // ← raw number, for calibration
  };
  ```
- Use `...spread` in the master `perceive()` function so all qualities are top-level.
- Thresholds are named constants at the top of the file (e.g. `PIPELINE_LINEARITY_THRESHOLD = 1.5`). Never hardcode a threshold inside a function.
- Optional perceptions (those that require caller hints) check `if (!opts.hubId) return { hub_central: false }` and bail out gracefully.

**When to add here:** you want the satisfaction layer to reason about a new human-observable quality. Write a dedicated `perceiveXxx()` function, add its result to `perceive()` via spread.

**When NOT to add here:** you just want a different measurement. That's instrumentation.js.

---

## Layer 3 — `satisfaction.js`

Models the user's judgement: *given what I wanted, am I happy?*

Perception and satisfaction are separate. You can perceive a crowded graph and be fine with it. You can perceive clean clusters and be unhappy (if you wanted to trace a pipeline).

**Structure:**

```js
// Intents — what is the user trying to do?
export const INTENTS = { EXPLORE_ARCHITECTURE, TRACE_PIPELINE, ... }

// Dimensions — what the user judges
export const DIMS = { READABLE, STRUCTURAL_FIDELITY, VISUAL_COMFORT, ... }

// Constraints — inference rules
const CONSTRAINTS = [
  {
    id: "unique_snake_case_id",
    when: (perceptions, intent) => boolean,
    implies: { [DIMS.SOME_DIM]: "satisfied" | "unsatisfied" },
    reason: "human-readable diagnosis string (null for positive constraints)",
    repair: ["what perception needs to change to avoid this"],
  },
  ...
]
```

**The solver (`satisfy()`) runs forward-chaining inference:**
1. Fires every constraint whose `when()` returns true
2. Sets the implied dimension value
3. If two constraints set the same dimension to different values → contradiction → both become violations
4. Returns: `{ satisfied, dimensions, violations, diagnosis, repair, scores }`

**Critical rules:**
- `reason: null` on positive constraints (those that imply SATISFIED). Only negative constraints need a reason — those are the ones that get surfaced as diagnosis strings.
- Never write a constraint that implies both SATISFIED and UNSATISFIED for the same dimension. Split them into two constraints.
- `when()` should only read from the `perceptions` object (first arg) and `intent` (second arg). Never read global state.
- If you add a new INTENT, also add at least one constraint that can set `GOAL_ACHIEVABLE` to SATISFIED for that intent — otherwise it stays UNKNOWN and `satisfyAll` will miss it.

**When to add a constraint:** a new intent-specific rule, or a new perception quality that affects satisfaction. Think: "what would make a user happy or unhappy in this situation?"

**When NOT to add a constraint:** the rule is purely about measurement ("if overlap > 10"). That logic belongs in perception.js, not here.

---

## `simulation.js`

Shared D3 simulation runner for tests. Not part of the perception/satisfaction pipeline — it just produces settled node positions.

**`runSimulation(nodes, links, config)`** runs D3 synchronously for `config.ticks` (default 300). Returns settled nodes with `x, y` set.

**Production config** (`PRODUCTION_CONFIG`) mirrors `GraphRenderer.jsx` blob-mode settings:
- `charge: -30` (blob mode)
- `linkDistance: 120`
- `collisionRadius: n => (n.val ?? 6) + 15`
- `linkStrengthSameGroup: 0.4` / `linkStrengthCrossGroup: 0.02`

When testing a specific physics change, override only the keys you're changing:
```js
const settled = runSimulation(nodes, links, { charge: -120 });
```

**Graph factories** produce test graphs with known structure:
- `makePipeline(n)` — n-node linear chain
- `makeHub(spokes)` — 1 hub + spokes
- `makeTwoModules(n, crossEdges)` — two groups with cross-edges
- `makeFunnel(sources)` — multiple sources → one sink
- `makeLayered(nodesPerLayer)` — 3-layer api/service/data
- `makeDense(n, edgesPerNode, groups)` — stress test
- `makeTwoChains(length)` — two parallel chains in same group

**When to add a factory:** you need a reusable graph shape. Put it here, not inside a test describe block.

---

## `scenarios.test.js`

The test file. Entry point for humans and agents to understand what currently works.

**Test tier convention (mandatory):**
- `[INVARIANT]` — must always pass. If this breaks, the code is broken.
- `[CURRENT]` — documents what the renderer achieves *today*. May not be ideal but must pass.
- `[FIX]` — a goal not yet reached. These tests fail intentionally. When you fix the physics so one passes, upgrade it to `[CURRENT]` or `[INVARIANT]`.

**Never change a `[FIX]` test to pass by relaxing the threshold.** That defeats the purpose. Fix the physics, then the test passes naturally.

**Scenario structure:**
```js
describe("Scenario: [shape] — [intent] intent", () => {
  const graph = makeXxx();  // use a factory

  it("[INVARIANT] ...", () => { /* structural sanity */ });
  it("[CURRENT] ...", () => { /* log full perception + satisfaction state, assert only what currently works */ });
  it("[FIX] ...", () => { /* assert the goal */ });
});
```

**The `simulate()` helper** (defined at the top of scenarios.test.js) runs simulation + perception + satisfaction in one shot:
```js
const { settled, perceptions, result } = simulate(graph, INTENTS.TRACE_PIPELINE, { pipelineIds });
```

**`[CURRENT]` logging pattern:** always console.log the full perception state and satisfaction summary in `[CURRENT]` tests, so failures explain themselves:
```js
console.log("[Pipeline] Perceptions:");
console.log("  pipeline_visible:", perceptions.pipeline_visible, `(elongation=${perceptions.pipeline_elongation?.toFixed(2)})`);
console.log("[Pipeline] Satisfaction:", result.summary);
if (!result.satisfied) console.log("  Diagnosis:", result.diagnosis);
if (!result.satisfied) console.log("  Repair:", repairPlan(result.violations));
```

---

## How to Add a New Perception

1. **Add a raw measurement to `instrumentation.js`** if needed (e.g. a new geometric fact).

2. **Write a `perceiveXxx(nodes, links, opts)` function in `perception.js`:**
   - Name it after the human observation, not the measurement
   - Return a flat object: one boolean quality + supporting scores
   - Add a threshold constant at the top of the file if needed

3. **Add `...perceiveXxx(...)` to the `perceive()` master function** at the bottom of `perception.js`.

4. **Add a test in `scenarios.test.js`** to observe it. Start with `[CURRENT]` + console.log. Add `[FIX]` if it's a goal.

---

## How to Add a New Satisfaction Constraint

1. Identify which `DIMS.*` it affects.
2. Identify which `INTENTS.*` trigger it (or if it's intent-agnostic).
3. Write the constraint object in `CONSTRAINTS` in `satisfaction.js`:
   - Intent-agnostic: `when: (p) => p.some_quality`
   - Intent-specific: `when: (p, intent) => intent === INTENTS.XXX && p.some_quality`
4. Write `reason` for negative constraints only (those implying UNSATISFIED). Include what the user would say.
5. Write `repair` as a list of perception names that need to change, in plain English.
6. If you add a new INTENT, also add at least one SATISFIED constraint for `GOAL_ACHIEVABLE`.

---

## How to Add a New Scenario

1. **Create a graph factory in `simulation.js`** if the shape is reusable.
2. **Add a `describe` block in `scenarios.test.js`** following the tier pattern above.
3. At minimum include: one `[INVARIANT]` (sanity), one `[CURRENT]` (full logging), one `[FIX]` (the goal).
4. Run tests. Confirm: `[INVARIANT]` passes, `[CURRENT]` passes, `[FIX]` fails with a useful message.

---

## How to Fix a `[FIX]` Test

1. Run the test to see the current numbers logged by the `[CURRENT]` test in the same scenario.
2. Read `result.diagnosis` and `repairPlan(result.violations)` — these tell you which perception to improve and what to change.
3. Identify the physics parameter responsible (usually in `GraphRenderer.jsx`).
4. Make the physics change.
5. Re-run. If the `[FIX]` test now passes, upgrade it to `[CURRENT]` or `[INVARIANT]`.
6. Run the full vitest suite to verify no regressions: `npx vitest run`.

---

## Running Tests

```bash
# From /workspace/semfora-explorer/frontend
PATH="/workspace/node-v22.13.0-linux-arm64/bin:$PATH" npx vitest run src/user_simulation_tests/scenarios.test.js
```

To run only one describe block:
```bash
PATH="/workspace/node-v22.13.0-linux-arm64/bin:$PATH" npx vitest run --testNamePattern "Pipeline" src/user_simulation_tests/scenarios.test.js
```

Full suite (run this before submitting a PR):
```bash
PATH="/workspace/node-v22.13.0-linux-arm64/bin:$PATH" npx vitest run
```

---

## What NOT to Do

- **Do not assert raw numbers in tests.** Use perception qualities and satisfaction outcomes. If you need a raw number for debugging, put it in a `console.log` inside a `[CURRENT]` test.
- **Do not change a `[FIX]` threshold to make a test pass.** Fix the physics instead.
- **Do not add perception logic to `instrumentation.js`.** The word "visible" or "crowded" should never appear there.
- **Do not add measurement logic to `satisfaction.js`.** Constraints read from `perceptions` only — never from `nodes` or `links` directly.
- **Do not skip the tier label** (`[INVARIANT]`, `[CURRENT]`, `[FIX]`). Every test must have one.
- **Do not write a `[CURRENT]` test that passes only sometimes.** If it's flaky on the current physics, label it `[FIX]`.

---

## File Map

```
user_simulation_tests/
  SKILL.md               ← you are here
  instrumentation.js     ← Layer 1: raw geometry (facts)
  perception.js          ← Layer 2: named human observations
  satisfaction.js        ← Layer 3: constraint-based satisfaction judgement
  simulation.js          ← D3 runner + graph shape factories
  scenarios.test.js      ← test scenarios, [INVARIANT]/[CURRENT]/[FIX] tiers
```

---

## Current Test State (as of initial creation)

27 tests. 21 pass. 6 fail — all `[FIX]` tier, all intentional.

Passing:
- All `[INVARIANT]` tests (structural sanity)
- Hub-and-spoke: `spot_hotspots` fully satisfied ✅
- All `[CURRENT]` logging/benchmark tests

Failing `[FIX]` goals (physics improvements needed):
- `pipeline_visible` — elongation=1.32, need >1.5
- `trace_pipeline` fully satisfied — blocked by pipeline_visible
- `clusters_distinct` (two-module, explore_architecture) — separation_ratio=0.16
- `funnel_visible` — convergence_ratio=0.69, need <0.4
- `layers_evident` — layer_min_sep=21px, need >60px
- Two chains separated — 46px, need >60px
