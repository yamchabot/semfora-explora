# Feature Brainstorm: Extended Perspectives

Ideas beyond the core use cases — drawn from SRE practices, long-term codebase stewardship, and the goal of building software that survives decades.

---

## Perspective 1: Site Reliability Engineering (SRE)

SREs think about systems under stress: what breaks, what cascades, how fast you can recover. Semfora's call graph is a structural map of failure propagation.

### 1.1 Incident Blast Radius Prediction
Before a deploy, run reachability analysis on every function that changed. Show the maximum theoretical blast radius. If a function is in 5 critical paths that each serve a different SLO, that's information you need before pushing.

**Feature:** Pre-deploy impact summary — "This change touches 3 SLO-critical paths. Highest-risk: `/checkout` call chain (47 downstream symbols, no fallback path)."

### 1.2 Hotpath Identification
Some call paths are executed millions of times per day; others are exercised once a week. Combine call graph structure with performance profile data (e.g., from distributed tracing spans) to identify **hotpaths** — the call chains that are both structurally critical and operationally frequent.

**Feature:** Hotpath overlay — color the call graph by execution frequency. Nodes that are both high-centrality AND high-frequency are your optimization and reliability priorities.

### 1.3 Circuit Breaker Candidates
Where should you add circuit breakers / bulkheads / fallback paths? The optimal places are nodes with:
- High betweenness centrality (many paths flow through them)
- No existing fallback call edge in the graph
- External I/O or network calls as descendants

**Feature:** Auto-suggest circuit breaker insertion points with rationale.

### 1.4 Graceful Degradation Map
Given a set of features marked as "must stay up" vs "degradable", compute which load-bearing nodes serve only degradable features vs. those on the must-stay-up path. Visualize this so engineers can design failure modes intentionally.

**Feature:** "Isolation budget" — show which features can be shed under load without violating core SLOs.

### 1.5 Change Failure Path Analysis
After an incident: given a commit or diff, automatically compute which call paths were modified and overlay them with the reported failure paths. "The incident touched these 3 paths. The change modified nodes on 2 of them."

---

## Perspective 2: Fighting Bit-Rot

Bit-rot is the slow, invisible decay of a codebase. It's not one bad decision — it's a thousand small ones accumulating until the codebase becomes hostile to change.

### 2.1 Staleness Score
Track when each node was last modified. A function with high blast radius that hasn't been touched in 4 years is not necessarily safe — it may be "fossilized": too scary to change, holding the codebase back. 

**Feature:** Staleness overlay on the call graph. Flag "fossilized load-bearing nodes" — high-centrality, long-unmodified, large blast radius. These are your hidden technical debt.

### 2.2 Knowledge Concentration Risk
Analyze git blame at the symbol level. If a high-centrality node has only ever been modified by one person, that's a bus factor of 1. If that person leaves, nobody understands the code that everything depends on.

**Feature:** Per-node contributor count, with warnings on load-bearing nodes where contributor count = 1. "Bus factor alert: `PaymentProcessor.charge()` has only been modified by @alice. It has 83 dependents."

### 2.3 Vocabulary Drift Detection
As codebases grow, the naming conventions drift. Functions from 2018 use one idiom; functions from 2024 use another. Similar behaviors get named differently. Inconsistent naming makes the codebase harder to understand for new engineers.

**Feature:** Semantic clustering — group functions by their call graph neighborhood (what they call, what calls them). Flag functions with similar graph neighborhoods but dissimilar names. These are candidates for renaming or consolidation.

### 2.4 Dependency Age & Abandonment Tracking
Track external dependency versions over time. Flag dependencies that:
- Haven't had an upstream release in 2+ years (possibly abandoned)
- Have known CVEs
- Are blocking major version upgrades of their dependents in the call graph

**Feature:** Dependency health overlay — show which parts of your call graph are built on potentially abandoned or vulnerable external code.

### 2.5 Complexity Accumulation Trends
Track cyclomatic complexity, call depth, and coupling metrics per module over time. Plot them as trends. A module whose complexity is growing steadily is accumulating technical debt even if nothing is "broken."

**Feature:** Complexity trend charts per module. "This module's average call depth has increased from 4 to 11 over the past 18 months." Alert when a trend crosses a configurable threshold.

### 2.6 Test Coverage Decay
Track integration test coverage of call paths over time. If a path was covered 6 months ago and isn't now (because tests were deleted or the code restructured), that's a regression in confidence, not just coverage.

**Feature:** Coverage decay alerts. "3 call paths that were integration-tested in v1.4 are no longer covered by any test as of v1.8."

---

## Perspective 3: Long-Term Codebase Survival (50–70 Years)

Software that needs to run for decades faces problems most teams never think about. The code that runs air traffic control, hospital systems, financial settlement infrastructure, or national registries needs to survive technology shifts, team turnover, and the complete transformation of the surrounding ecosystem.

### 3.1 Architectural Entropy Score
Over time, every codebase drifts from its original design. Entropy is the gap between intended structure and actual structure. Semfora can compute this gap: how far has the actual call graph drifted from the declared architectural boundaries?

**Feature:** Entropy dashboard — track the "architectural drift" score over years. A rising entropy score means the codebase is getting harder to reason about. A stable or falling score means architectural discipline is being maintained.

### 3.2 Abstraction Layer Integrity
Well-designed long-lived software has clear abstraction layers: you don't call your database directly from your routing layer, you don't mix business logic with I/O. Over time, shortcuts violate these layers.

**Feature:** Layer violation detector. Define your intended layers (e.g., API → Service → Repository → Database). Semfora flags every call edge that skips a layer or goes "downward" against the flow. Track the layer violation count over time.

### 3.3 Survivor Analysis
Identify which parts of the codebase have survived multiple major technology shifts intact. Code that is still working and unchanged after a framework migration, a language version upgrade, or a major architectural refactor is evidence of good abstraction. Code that had to be rewritten every time is evidence of poor isolation.

**Feature:** Longevity map — color nodes by how many major version/refactor cycles they've survived unchanged. Surviving code is wisdom; code that's been rewritten repeatedly is a signal of poor boundaries.

### 3.4 Interface Surface Area Tracking
The interfaces between modules are the contracts that need to remain stable for decades. Internal implementations can change freely; interfaces must not change unexpectedly.

**Feature:** Interface surface area tracker. Define what counts as a public interface (exported symbols, API endpoints, event schemas). Track the interface surface area over time — is it growing? Which interfaces have the most callers? Flag interface changes that break existing callers.

### 3.5 Conway's Law Alignment
Conway's Law: the structure of your software will mirror the structure of your organization. When teams change (new org structure, acquisitions, distributed teams), codebases often go out of alignment — code that used to be owned by one team is now split across three, or code owned by a new team is still structured around the old team's mental model.

**Feature:** Team-to-module alignment analysis. Given a mapping of team → code ownership, show where the call graph crosses team boundaries most heavily. Flag "orphaned modules" — code with no clear current team. Identify "seams" where team boundaries could become clean service boundaries.

### 3.6 Semantic Stability Score
The most dangerous kind of bit-rot is when a module's *meaning* changes without its name changing. The `UserService` that started as a thin wrapper around the user table now also handles authentication, notifications, billing adjustments, and session management. Its call graph neighborhood has transformed completely, but it's still called `UserService`.

**Feature:** Semantic drift tracker. For each major module, record its "semantic fingerprint" — the set of domains it calls into (derived from the call graph). Track this fingerprint over time. When a module's fingerprint has drifted significantly from its original, flag it: "UserService has expanded its semantic scope by 340% over 3 years."

### 3.7 Documentation-to-Code Linkage Decay
Over decades, documentation becomes disconnected from code. The architecture diagram drawn in 2019 describes a system that no longer exists. The README describes a setup process that's been replaced three times.

**Feature:** Documentation drift detector. Parse documentation for references to code symbols, module names, and call patterns. Flag documentation that references symbols that no longer exist, or that describes call flows that have structurally changed.

### 3.8 Dead Language / Pattern Detection
Languages and ecosystems have idioms that go in and out of fashion. Callbacks that were replaced by promises, promises that were replaced by async/await, configuration patterns, error handling approaches. Old patterns accumulate in long-lived codebases and become barriers to new contributors.

**Feature:** Pattern vintage analysis. Detect use of deprecated or old-idiom patterns at the AST level. Group them in the call graph: "this cluster of 34 functions all use the callback-style error handling pattern from pre-2019." Gives teams a prioritized cleanup list.

---

## Summary: Feature Priority Ranking

Ordered by value-to-effort ratio for an engineering organization:

| Priority | Feature | Value | Why |
|---|---|---|---|
| ⭐⭐⭐ | Feature Risk / Integration Test Traceability | Immediate | Answers "is this safe to ship?" |
| ⭐⭐⭐ | Load-Bearing Node Registry | Immediate | Fixes false-positive coupling alerts |
| ⭐⭐⭐ | Unexpected Coupling Detection | Immediate | Catches the real problems |
| ⭐⭐ | Knowledge Concentration / Bus Factor | High | Survival risk |
| ⭐⭐ | Hotpath Identification (SRE) | High | Performance + reliability |
| ⭐⭐ | Staleness / Fossilized Node Detection | High | Bit-rot visibility |
| ⭐⭐ | Complexity Accumulation Trends | High | Early warning system |
| ⭐⭐ | Abstraction Layer Integrity | High | Long-term discipline |
| ⭐ | Circuit Breaker Candidates | Medium | SRE value, needs tracing data |
| ⭐ | Semantic Drift Tracker | Medium | Needs historical data |
| ⭐ | Conway's Law Alignment | Medium | Needs team mapping |
| ⭐ | Entropy Score | Long-term | Needs years of data |
| ⭐ | Survivor Analysis | Long-term | Needs version history |
