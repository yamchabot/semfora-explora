# Ideal Dataset Design

This document defines the metrics we wish we had at each node, module, and
repo level — working backward from the visualizations we want to render.
It drives step 1 of the improvement plan (brainstorm ideal dataset), which
precedes step 2 (benchmark tests) and step 3 (improved analyzers).

---

## The graph thinking problem

Our current analytics mostly treat the call graph as a list of nodes and a
list of edges. SQLite reinforces this: GROUP BY, COUNT, JOIN. But the structure
of the graph itself — paths, cycles, reachability, cuts, communities — encodes
the most important architectural information, and none of it is a simple count.

A call graph is a directed graph G = (V, E) where V = symbols and E = calls.
The right questions to ask are graph questions:

- What can reach X? (utility)
- What can X reach? (blast radius)
- Is X on a cycle? (coupling tightness)
- Does X bridge otherwise-disconnected subgraphs? (structural importance)
- Do X's neighbors form a tight cluster? (cohesion)
- Does the community algorithm agree with the declared module of X? (alignment)
- Does X call mostly into its own module, or into others? (boundary behavior)

None of these are answered by `SELECT COUNT(*) FROM edges WHERE caller_hash = X`.

---

## Dimension 1: Symbol utility (replaces dead/alive binary)

"Dead code" is a binary that discards most of the useful information.
What we really want is a continuous measure of how useful a symbol is.

### Transitive caller count (reverse reachability)

The number of distinct symbols that can eventually reach X through any
sequence of calls. A symbol with transitive_callers = 0 is genuinely dead.
A symbol with transitive_callers = 500 is deeply integrated regardless of
its direct caller_count.

This is more honest than caller_count:
- A private helper called once by a function with 100 callers has
  transitive_callers ≈ 100+. It IS useful even though caller_count = 1.
- A public function with caller_count = 50 but all 50 callers are themselves
  dead has transitive_callers = 0. It IS dead despite high caller_count.

**Computation:** Reverse BFS/DFS from X on the transposed graph.
Expensive for large graphs — approximate with strongly-connected-component
condensation + topological sort, precomputed offline.

### Transitive callee count (forward reachability / blast radius)

The number of distinct symbols X can eventually invoke. High = X is a
load-bearing orchestrator. Low = X is a leaf. This is the blast radius of
a change to X.

**Already implemented** in analytics/centrality.py. Extend to all nodes, not
just on-demand.

### Utility score (combined)

utility = log(1 + transitive_callers) × log(1 + xmod_fan_in + 1)

Captures: a symbol is useful if (a) many things ultimately depend on it, AND
(b) those things are in different modules (not just one hot caller chain).
Symbols with utility = 0 are the safest delete candidates.

---

## Dimension 2: Cycle structure (continuous, not binary)

Cycles are not just bad; they are a structural signature. FP code (mutual
recursion, higher-order function patterns) will have many small, tight cycles.
OO code with clean dependency injection will have none. Both can be correct.

### in_scc (bool)

Is this symbol in a strongly-connected component of size > 1?

### scc_size (int)

Size of the SCC this symbol belongs to. 1 = acyclic. >1 = cycle participant.
Distribution of SCC sizes is the architectural signature:
- All 1s: clean DAG (traditional layered architecture)
- Many small (2–5): mutual recursion common (FP or event-driven)
- Few large (50+): dangerous coupling blobs

### scc_cross_module (bool)

Does this symbol's SCC span multiple declared modules? Cross-module cycles
are architectural violations; intra-module cycles may be intentional.

### local_clustering_coefficient

For node X with neighbors N(X): what fraction of pairs in N(X) are also
connected to each other? High clustering = X lives in a tightly knit
neighborhood. In FP codebases, this will be high everywhere. In clean
layered architecture, it will be low for most nodes.

Formula: C(X) = |{(u,v) : u,v ∈ N(X), (u,v) ∈ E}| / (|N(X)| × (|N(X)|-1))

**Computation:** O(k²) per node where k = degree. Feasible for most
codebases. Already available in NetworkX as clustering().

### cycle_participation_ratio (repo-level)

What fraction of symbols are in SCCs of size > 1?

Empirical baselines from our data:
- taskboard clean: 0%
- semfora-engine: 1% (41/4188 nodes)
- CAD_Sketcher: 2% (18/1007 nodes)

Anomaly: anything above ~5% in an OO codebase warrants investigation.
In a known FP codebase, >20% would be expected and fine.

---

## Dimension 3: Boundary behavior

How does a symbol relate to its declared module boundary?

### xmod_call_ratio

Fraction of this symbol's direct callees that are in other modules.
```
xmod_call_ratio = |{callee : callee.module ≠ self.module}| / |callees|
```

Empirical baselines: mean ≈ 0.54 in all repos tested (half of all calls
cross a module boundary on average).

### dominant_callee_module

The module that this symbol most frequently calls into. If dominant_callee_module
≠ self.module AND that fraction exceeds ~60% of total callees: **feature envy**.
The symbol is more interested in another module than its own.

Empirical: detectable and substantial. 623 candidates in semfora-engine,
50 in CAD_Sketcher (both filtered to ≥3 callees, 60%+ concentration).
Note: test functions calling test utilities will be dominant — need a
filter for test modules or the signal:noise improves dramatically.

### dominant_callee_fraction

The fraction of callees that go to dominant_callee_module. Used as the
feature envy confidence score.

### boundary_crossing_count

Number of distinct module boundaries crossed in this symbol's forward call
tree (approximate: unique cross-module edges reachable from X). High = X
orchestrates across many modules. Low = X is contained. This is a structural
measure of coupling scope.

---

## Dimension 4: Community alignment

Community detection gives us the algorithmically inferred module structure.
Comparing it to the declared structure is one of the most powerful signals we have.

### community_id

Which Louvain community does this symbol belong to? (integer, not stable
across runs — use dominant_module below for comparison)

### community_dominant_module

The most common declared module among all symbols in this community.
This is the "algorithmically suggested home" for this symbol.

### community_alignment (bool, per node)

Does community_dominant_module == self.module?

### community_purity (float, per community)

Fraction of the community that shares the dominant module. High purity = the
community maps cleanly to one declared module. Low purity = community spans
multiple declared modules (the declared modules are coupled, or one should be split).

### module_fragmentation (float, per module)

The inverse: across how many communities are this module's symbols spread?
```
fragmentation = 1 - (max_community_count / total_symbol_count)
```
A module that is perfectly cohesive will have all symbols in one community
(fragmentation ≈ 0). A module that should be split will have symbols in
multiple communities (fragmentation → 1).

### recommended_split (list[str], per module)

If module_fragmentation > threshold, name the detected sub-communities
as candidate split targets. Each name is derived from the community's
dominant callee patterns or the highest-degree node within it.

---

## Dimension 5: Topological structure (replaces caller_count percentile)

The call graph is a directed graph that (after condensing SCCs) forms a DAG.
The DAG encodes the true dependency depth of the codebase.

### topological_depth

Depth of this node in the condensation DAG — the length of the longest
dependency chain from this node to a leaf (node with no outgoing edges).

```
depth = 0 if no callees in DAG
depth = 1 + max(depth of callees) otherwise
```

Foundation = topological_depth > threshold (everything else depends on it).
Leaves = topological_depth = 0.

This is architecturally correct in a way caller_count percentile is not.
A storage utility with depth 0 (it calls nothing) is correctly a leaf;
an orchestrator with depth 5 (it calls services which call domain which
calls storage) is correctly a platform/feature node.

### reverse_topological_depth (= topological depth in transposed graph)

How many hops from this node to an entry point? This is the "distance from
the surface" — Features are 1-2 hops from entry; Foundation is many hops.

### stability_rank

Martin's component stability (I = Ce/(Ca+Ce)) computed at the *symbol* level
using xmod_fan_in as Ca and xmod_fan_out as Ce. Unlike the module-level
instability which lumps everything together, per-symbol stability tells us
which individual symbols are stable (safe to depend on) vs. unstable (likely to change).

---

## Dimension 6: Complexity and risk (already have, need better use)

### complexity (already have)

McCabe cyclomatic complexity. Must be used as a percentile within repo,
not as an absolute value. p90+ = high complexity (anomalous for this repo).

### complexity_percentile (derived)

Pre-computed: what percentile is this symbol's complexity within its repo?
Allows cross-repo comparison and thresholds.

### complexity × xmod_fan_in (product signal)

High complexity + called from many modules = the highest risk combination.
These are the symbols most likely to cause widespread breakage when they have bugs.
A simple helper with complexity 1 called from 6 modules is fine.
A 30-branch function called from 6 modules is a liability.

---

## Aggregation levels

### Per symbol (finest grain)

All dimensions above. Used in: Building view (node properties),
dead-code view (utility), cycle view (SCC membership), community view
(alignment), search results.

### Per module (architectural grain)

| Metric | Aggregation |
|---|---|
| Ca, Ce, I | Sum of cross-module edges |
| symbol_count | COUNT |
| avg_complexity | MEAN (or p90 for anomaly detection) |
| dead_ratio | dead_count / total |
| utility_density | mean(utility_score) across module's symbols |
| fragmentation | 1 - max_community_count/total (see above) |
| avg_xmod_call_ratio | mean(xmod_call_ratio) across module's symbols |
| feature_envy_count | count of symbols with dominant_callee_module ≠ self.module |
| in_cycle_count | count of symbols with scc_size > 1 |
| mean_clustering | mean(local_clustering_coefficient) |
| boundary_crossings | sum of distinct cross-module edges outgoing |

### Per repo (single number health metrics)

| Metric | Aggregation |
|---|---|
| cycle_participation_ratio | in_scc_nodes / total_nodes |
| overall_community_alignment | aligned_nodes / total_nodes |
| mean_module_fragmentation | mean(fragmentation) across modules |
| dead_ratio | dead_nodes / total_nodes |
| feature_envy_ratio | feature_envy_nodes / total_nodes |
| mean_topological_depth | mean depth |
| p90_complexity | 90th percentile complexity |
| graph_density | edges / (n*(n-1)) |

These become the "health score" dimensions for a repo overview.

---

## Approximated patterns from literature

Patterns previously marked "not detectable" can be partially approximated:

| Pattern | Approximation using call-graph data | Confidence |
|---|---|---|
| **Feature Envy** | dominant_callee_module ≠ home module AND fraction ≥ 60% | Medium |
| **Shotgun Surgery** | Nodes called together that span many modules (co-call clustering) | Low-Medium |
| **Inappropriate Intimacy** | High xmod_call_ratio between two specific modules, both directions | Medium |
| **Divergent Change** | Module with high module_fragmentation (its symbols form multiple communities) | Low-Medium |
| **Connascence of Name** | Same function name appearing in multiple modules with similar call patterns | Low |
| **Long Method** | complexity percentile > 90 within repo | Medium |
| **Large Class** | Symbol count grouped by class prefix, top outliers | Medium |
| **Message Chain** | Paths of length ≥ 4 that cross module boundaries at each hop | Medium |
| **Middleman** | Symbol with caller_count > 3, callee_count > 3, complexity = 0–1 (pure relay) | High |

---

## What the benchmark tests should verify

These are the unit tests for analytics functions (not integration tests).
Each takes constructed node/edge lists and asserts expected output.

```
Utility:
  test_transitive_caller_count_chain()
    → a→b→c: transitive_callers of c = {a,b}, b = {a}, a = {}
  test_utility_zero_for_truly_dead()
    → isolated node: utility = 0
  test_utility_high_for_deep_dependency()
    → node with 50 transitive callers in 3 modules: utility >> leaf node

Cycles:
  test_scc_detects_mutual_recursion()
    → a↔b: both in same SCC of size 2
  test_scc_cross_module_flagged()
    → a(mod1)↔b(mod2): scc_cross_module = True
  test_acyclic_graph_zero_cycle_participation()
    → a→b→c (no cycles): all scc_size=1
  test_clustering_high_in_clique()
    → fully connected subgraph of 4: clustering = 1.0 for all

Feature Envy:
  test_feature_envy_detected()
    → node in module A with 5 callees all in module B: envy = True
  test_no_envy_mixed_callees()
    → node with 3 callees in A, 3 in B: envy = False (no concentration)

Community Alignment:
  test_aligned_module_high_purity()
    → 5 nodes all in one module, all connected: community = one group, purity = 1.0
  test_fragmented_module_detected()
    → 10 nodes declared in one module but two disconnected clusters: fragmentation > 0.5

Topological depth:
  test_leaf_depth_zero()
    → node with no internal callees: topological_depth = 0
  test_chain_depth_correct()
    → a→b→c→d (no cycles): depths = {a:3, b:2, c:1, d:0}
  test_scc_condensed_before_depth()
    → a↔b→c: condensed to [a,b]→c, depth of [a,b] = 1

Building view:
  test_foundation_has_high_xmod_fan_in()
    → node called from 4 modules: layer = Foundation
  test_leaf_called_only_within_module()
    → node called only from same module, caller_count > 0: layer = Features
  test_dead_node_is_leaf()
    → caller_count = 0: layer = Leaves
```

---

## Ideal enriched node schema

The current nodes table has: hash, name, kind, module, file_path, line_start,
line_end, complexity, caller_count, callee_count, risk.

The enriched schema we want (computed offline and cached):

```sql
ALTER TABLE nodes ADD COLUMN transitive_callers   INTEGER;  -- reverse reachability
ALTER TABLE nodes ADD COLUMN transitive_callees   INTEGER;  -- forward reachability
ALTER TABLE nodes ADD COLUMN utility_score        REAL;     -- log-weighted composite
ALTER TABLE nodes ADD COLUMN scc_id               INTEGER;  -- which SCC
ALTER TABLE nodes ADD COLUMN scc_size             INTEGER;  -- size of SCC (1 = acyclic)
ALTER TABLE nodes ADD COLUMN scc_cross_module     BOOLEAN;  -- SCC spans modules?
ALTER TABLE nodes ADD COLUMN clustering_coeff     REAL;     -- local clustering
ALTER TABLE nodes ADD COLUMN topological_depth    INTEGER;  -- depth in condensation DAG
ALTER TABLE nodes ADD COLUMN xmod_fan_in          INTEGER;  -- distinct caller modules
ALTER TABLE nodes ADD COLUMN xmod_fan_out         INTEGER;  -- distinct callee modules
ALTER TABLE nodes ADD COLUMN xmod_call_ratio      REAL;     -- fraction of callees in other modules
ALTER TABLE nodes ADD COLUMN dominant_callee_mod  TEXT;     -- module called most
ALTER TABLE nodes ADD COLUMN dominant_callee_frac REAL;     -- fraction to dominant callee mod
ALTER TABLE nodes ADD COLUMN community_id         INTEGER;  -- Louvain community
ALTER TABLE nodes ADD COLUMN community_alignment  BOOLEAN;  -- matches declared module?
ALTER TABLE nodes ADD COLUMN complexity_pct       REAL;     -- percentile within repo
ALTER TABLE nodes ADD COLUMN stability_rank       REAL;     -- symbol-level instability I
```

These columns are computed once by an enrichment pass and stored. Analytics
functions then work on plain data — no graph algorithms at query time.
