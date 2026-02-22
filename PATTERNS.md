# Structural Pattern Catalog

This document maps software architecture patterns to the signals available
in a semfora call-graph database. It is the foundation for deciding which
fields go into visualizations, what thresholds are principled, and what
unit tests should verify.

---

## 1. Available signals and their empirical distributions

All values from 4 real repos (semfora-engine, CAD_Sketcher, adk-playground,
ca_rts) and the 8 synthetic taskboard fixtures (1 clean, 7 anti-pattern).

### Node-level fields

| Field | What it counts | Typical shape |
|---|---|---|
| `caller_count` | raw call sites targeting this node | Power law. Median 0–1 in all repos. p95 = 4–8 in small repos, up to 533 max in large. |
| `callee_count` | raw call sites this node initiates | Less skewed than caller_count. Median 1–2. |
| `complexity` | McCabe cyclomatic complexity | Extreme right skew. Median 0 everywhere. Max 8 in synthetic, 146–324 in real repos. Any absolute threshold is meaningless across repos — must use percentile. |
| `kind` | function / method / class / module | Most nodes are functions/methods. |

### Derived signals (require JOIN)

| Signal | Definition | Typical shape |
|---|---|---|
| `xmod_fan_in` | distinct *other* modules that call into a node | Sparse. Only ~10–30% of nodes have any cross-module callers. When present, median 1, p95 = 1–8. |
| `xmod_fan_out` | distinct *other* modules this node calls into | Similar sparsity. |

### Module-level fields (from `module_edges`)

| Signal | Definition | Notes |
|---|---|---|
| `Ca` (afferent) | incoming cross-module edge count | Real repos: many modules with Ca=0 (leaf modules). |
| `Ce` (efferent) | outgoing cross-module edge count | |
| `I` (instability) | Ce / (Ca + Ce) | Real repos: heavily bimodal — many near 0 (sinks), few near 1 (pure sources). Synthetic repos are more uniform. |

### Key empirical observations

1. **caller_count is a poor absolute signal.** Its distribution is identical
   between the clean baseline and several anti-patterns. Relative rank within
   a repo is useful; cross-repo comparisons or fixed thresholds are not.

2. **xmod_fan_in is the right load-bearing signal.** It is sparse (only
   ~10–30% of nodes have any), which makes high values genuinely
   discriminative. A node with xmod_fan_in ≥ 3 is architecturally significant
   regardless of repo size. Raw caller_count does not distinguish a function
   called 20× in a single tight loop from one called 20× across 6 modules.

3. **Dead ratio ~39% in clean code is normal.** The clean taskboard baseline
   has 39% zero-caller nodes. This is not a problem — it reflects constructors,
   event handlers, and public API functions that are only called from outside
   the indexed graph. Dead ratio only becomes a signal when concentrated (whole
   file unreachable, or ratio significantly higher than repo baseline).

4. **Complexity must be repo-relative.** Synthetic repos have max complexity
   of 8–46. Real repos reach 146–324. Any hardcoded threshold (e.g. complexity
   > 10 = complex) is wrong for at least half the repos.

5. **Module instability in real repos is bimodal.** Many modules (especially
   utility leaf modules and thin adapter wrappers) have I ≈ 0. The interesting
   signals are modules with both high Ca AND Ce > 0 simultaneously.

---

## 2. Structural patterns catalog

### 2.1 Patterns we can detect with call-graph data

---

#### God Object / God Class

**What it is:** A single class or module absorbs responsibility from across
the codebase. Everything calls into it; it calls into everything. Violates
the Single Responsibility Principle and makes refactoring almost impossible.

**Classic literature:** Fowler "Refactoring" (Large Class, Divergent Change);
Martin "Clean Architecture" (SRP violation).

**Detectable signals:**
- Module with high `Ca` (called from many modules) AND high `Ce` (calls into
  many modules) — instability in the 0.5–0.8 range despite high traffic
- A specific node with `xmod_fan_in` ≥ 4–5 (called from many distinct modules)
- Other modules' `Ca` drops to near-zero while the god object's `Ca` is high
  (traffic was centralized)
- The god module has significantly more symbols than architectural peers

**What we cannot detect:** Whether a single *class* or a *module* is the
problem without grouping nodes by class name prefix.

**Proven:** Yes — god-object anti-pattern fixture. Services Ca drops to 0;
`god` module appears with 39 symbols.

**Our current detection:** Triage check `_check_unexpected_coupling`. ✓

---

#### Circular Dependencies

**What it is:** Module A depends on module B which depends back on A (directly
or through a chain). Prevents independent compilation/testing of modules,
creates tight coupling across module boundaries.

**Classic literature:** Martin "Clean Architecture" — Acyclic Dependencies
Principle (ADP). Martin defines this at the component level.

**Detectable signals:**
- Bidirectional entries in `module_edges`: (A→B AND B→A both exist)
- SCCs of size > 1 in the full call graph (function-level cycles)
- Cross-module SCCs: two or more distinct modules appear in the same SCC

**What we cannot detect:** Indirect cycles longer than 2 hops are harder to
surface usefully. The SCC approach catches them but the UX for explaining a
5-module cycle is unclear.

**Proven:** Yes — circular-deps fixture. `domain→services` AND
`services→domain` both exist (bidirectional module edge).

**Our current detection:** `analytics/cycles.py` find_cycles(). ✓

---

#### Dead Code Graveyard

**What it is:** Unreachable code that accumulates over time, usually in legacy
modules that were replaced but never deleted. Increases codebase size,
confuses newcomers, and can harbor latent bugs.

**Classic literature:** Fowler "Refactoring" (Dead Code smell).

**Detectable signals:**
- `caller_count = 0` on functions/methods/classes
- Dead ratio significantly higher than repo baseline (>5 percentage points)
- Entire files or modules where all symbols are zero-caller
- High concentration of zero-caller nodes in a single file (≥60% of file's
  symbols are dead AND file has ≥5 symbols)

**Confidence tiers:** Not all zero-caller nodes are removable. Entrypoints,
framework hooks, public API functions, and test fixtures are legitimately
never called within the indexed graph.

**Proven:** Yes — dead-code-graveyard fixture. Dead ratio: 51% vs 39% baseline.
Legacy module: 100% dead. Safe count >> caution count.

**Our current detection:** `analytics/dead_code.py`. ✓ Confidence tiers
(`safe`, `review`, `caution`) are heuristics. They need unit tests with
constructed data to validate the classifier logic.

---

#### Util Dumping Ground

**What it is:** A utils or helpers module becomes a catch-all for code that
has no obvious home. It accumulates unrelated functions, creating hidden
coupling: everything that needs "miscellaneous" functionality depends on utils,
which makes utils load-bearing by accident.

**Classic literature:** Fowler "Refactoring" (Inappropriate Intimacy). Martin
Common Closure Principle (CCP) violation — code that changes for different
reasons is together.

**Detectable signals:**
- `Ca` for the utils module is high AND much higher than its `Ce`
  (stable but fat — it has become a dependency hub)
- utils called from ≥ 3 distinct other modules
- utils symbol count inflated relative to its architectural role

**What we cannot detect:** Whether the symbols in utils are *cohesive*
(they're all string utilities) vs *dumped* (unrelated mix). Would need
semantic clustering of symbol names.

**Proven:** Yes — util-dumping-ground fixture. utils Ca: 6 (baseline) → 49
(anti-pattern).

**Our current detection:** Triage check `_check_unstable_modules` catches
this partially. Not a dedicated detection. **Gap.**

---

#### Tight Coupling (Layer Bypass)

**What it is:** Higher-level modules (e.g., API handlers) directly access
lower-level infrastructure (e.g., storage/DB) without going through the
intended service/abstraction layer. The service layer exists but is bypassed.

**Classic literature:** Layered Architecture principle; Martin Dependency
Inversion Principle (DIP). The service layer represents the abstraction;
bypassing it violates DIP.

**Detectable signals:**
- Direct `module_edges` entry from a high-level module to a low-level module
  that should not be directly accessible
- The intermediate (service) module's `Ca` drops significantly — it is
  being bypassed
- The low-level module's `Ca` is disproportionately high relative to its
  expected role

**What we cannot detect:** Which modules are "high-level" and which are
"low-level" without architectural declarations. We need the user to declare
the intended layer order, or we need to infer it from instability order.

**Proven:** Yes — tight-coupling fixture. api→storage edge: 36 calls;
services Ca drops from 11 (baseline) to 4.

**Our current detection:** Module edges view shows this. No dedicated
triage check. **Gap.**

---

#### Unstable Foundation

**What it is:** A core module (Domain, Core, or equivalent) is highly
depended upon by the rest of the system (high Ca) but simultaneously has
significant outgoing dependencies of its own (Ce > 0). Changes to its
dependencies cascade through everything that depends on it.

**Classic literature:** Martin — Stable Dependencies Principle (SDP).
Dependencies should flow toward stable components. If a stable (high-Ca)
component has outgoing deps to unstable components, stability assumptions break.

**Detectable signals:**
- Module has Ca ≥ threshold (it IS a foundation — heavily depended upon)
- Module has Ce > 0 (it SHOULDN'T have — foundations should be pure sinks)
- Specifically: Ce/Ca ratio > 0 in a module where Ce was previously 0

**Threshold guidance from data:** In the clean taskboard baseline, the
`domain` module has Ce = 0 (pure sink). Any Ce > 0 in a high-Ca module
is the signal, regardless of magnitude.

**Proven:** Yes — unstable-foundation fixture. Domain Ce: 0 (baseline) → 10
(anti-pattern). Domain Ca: 59 → 81.

**Our current detection:** `_check_unstable_modules` in triage catches part
of this. Not fully precise. **Gap.**

---

#### Feature Creep (Module Bloat)

**What it is:** A module grows far beyond its intended scope, absorbing
features that should live in separate modules. It becomes a dependency hub
by accumulation rather than design.

**Classic literature:** Fowler (Large Class); Martin (SRP and CCP violations).
The module is doing too many things; it changes for too many reasons.

**Detectable signals:**
- Module symbol count significantly exceeds architectural peers
  (e.g., >2× the mean symbol count of peer modules)
- A single function within the module has anomalously high `caller_count`
  or `xmod_fan_in` (it has become a cross-cutting hub)
- Module `Ca` is anomalously high relative to its size

**Proven:** Yes — feature-creep fixture. api: 31 symbols (baseline) → 68;
require_auth caller_count: 20 → 55.

**Our current detection:** Not in triage. **Gap.**

---

### 2.2 Patterns we cannot yet detect (require additional data)

| Pattern | What's needed | Notes |
|---|---|---|
| Feature Envy | AST: which object's fields does a method reference most? | A method in class A that mostly uses class B's data belongs in B. |
| Inappropriate Intimacy | AST: direct field access across class boundaries | We see module-level but not class-field-level coupling. |
| Shotgun Surgery | Commit history: which files change together? | One change requires edits in many places. |
| Divergent Change | Commit history: why does this file change? | One class changes for many different reasons. |
| Data Clumps | AST: parameter lists, field groups | Three fields always appearing together should be a class. |
| LCOM (Lack of Cohesion) | AST: which methods share which fields | Requires class field access graph, not call graph. |
| DIT (Depth of Inheritance) | AST: class hierarchy | Not represented in call graph. |
| Connascence | AST: shared knowledge between components | Semantic coupling beyond structural. |

---

## 3. The building view problem

The current building view assigns layers by `caller_count` percentile:
- Foundation: caller_count > 60% of max
- Platform: > 30%
- Services: > 10%
- Features: > 2%
- Leaves: everything else

**Why this is wrong:**

A function called 100× in a tight `for` loop in a single module has
`caller_count = 100` but is architecturally a Leaf (no other module depends
on it). Under the current scheme it lands in Foundation.

The right signal for architectural depth is `xmod_fan_in`: how many distinct
*other modules* depend on this node. This is what "foundational" actually
means — not "called often" but "many parts of the system depend on it."

**Proposed replacement:**

```
Foundation : xmod_fan_in ≥ 3  (multiple modules depend on this)
Platform   : xmod_fan_in = 2  (two modules depend on this)
Services   : xmod_fan_in = 1  (one other module depends on this)
Features   : caller_count > 0, xmod_fan_in = 0  (used, but only within its module)
Leaves     : caller_count = 0  (nothing calls it — dead or entry point)
```

**Why this is better:**

- Architecturally meaningful: "Foundation" = things other modules actually
  need, not hot paths in a single module.
- Naturally sparse: in practice only ~10–30% of nodes have any cross-module
  callers, which means Foundation and Platform will be a small, meaningful set.
- Load-bearing detection becomes exact: a Foundation-layer node that is NOT
  declared load-bearing IS the signal. No threshold tuning needed.

**What the data shows:**

In the clean taskboard baseline, `xmod_fan_in` max = 2 and median among
those with any = 1. Only 50/171 nodes have cross-module callers at all.
In semfora-engine, xmod_fan_in p95 = 8 and max = 29 — a proper long tail.
The xmod_fan_in signal is much more discriminative than raw caller_count in
all repos.

**Requires:** A new query that computes xmod_fan_in per node (a GROUP BY JOIN
not currently in the building query).

---

## 4. Open questions / research gaps

1. **Are our dead code confidence tiers (safe/review/caution) correct?**
   They are currently heuristics. We need unit tests with constructed
   node dicts to validate the classifier logic with known expected outputs.

2. **What instability profile does a "well-architected" repo have?**
   From data: real repos tend toward bimodal (many I≈0 leaf modules, few I≈1
   source modules). Is this good or bad? Martin's SDP predicts that *stable*
   modules should have low I. But stable modules *being used* by everything
   is different from modules that are stable *because nothing uses them*.

3. **Can we detect layer violations without explicit declarations?**
   If we assign layers by xmod_fan_in, a cross-layer edge (Features module
   calling directly into Foundation, bypassing Services) becomes detectable.
   This is the tight-coupling detection done structurally.

4. **Is xmod_fan_in computable accurately?**
   In large repos semfora-engine indexes 315 modules. xmod_fan_in = 29 max.
   Need to verify this isn't inflated by test modules or thin adapters.

5. **What is the right unit test for assign_layers()?**
   We need to construct a minimal graph where the expected layer of each node
   is known from first principles, run assign_layers(), and assert correctness.
   This does not currently exist.
