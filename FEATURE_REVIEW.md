# Semfora Explorer — Critical Feature Review

**Perspective:** Software Engineer (IC), Staff Engineer, Engineering Manager  
**Date:** 2026-02-22  
**Method:** Full code review of all 12 pages + realistic user story analysis

---

## The Core Problem

The tool is almost entirely **diagnostic without being prescriptive**. Almost every feature answers *what* (this module has instability 0.83, this function has 47 callers) but stops short of *so what* (this means you should do X) or *what next* (here's how to address it). For an engineer under deadline pressure or a manager who needs to justify engineering investment, a list of numbers with no recommended action is hard to act on.

A second systemic problem: **no trend data**. Every single view is a point-in-time snapshot. The tool can tell you "you have 3 cycles today" but not "you had 1 cycle six months ago." Engineering health lives in trajectories, not snapshots.

---

## Feature-by-Feature Assessment

### ✅ Effective

**💥 Blast Radius** — `HIGH VALUE`  
*User story: "I'm about to refactor `SessionManager.get_user()`. I need to know if I'm going to break something in a module my team doesn't own."*

This is the clearest use case in the entire product. The depth-based exploration is well-designed, the affected-modules sidebar answers the right question, and the high-risk callout at 20+ affected symbols is appropriate. Engineers will actually use this before touching a high-centrality node.

**Gaps:**  
- The search doesn't pre-populate when you click 💥 from Centrality — that's a broken user journey
- No way to filter affected nodes by module/team ownership  
- The depth control is good but there's no "why is this depth the right one?" guidance
- Can't compare blast radius of two candidate approaches ("if I change A vs. if I change B")

---

**🪦 Dead Code** — `HIGH VALUE, DANGEROUS FRAMING`  
*User story: "We're doing a cleanup sprint. I want to find safe deletions without reading the entire codebase."*

The file-grouped view is the right design. Files with 3+ dead symbols are genuinely high-confidence cleanup targets. This is immediately actionable in a way most other features aren't.

**Serious problem:** The phrase "safe to delete" is too strong. Zero static callers ≠ actually dead. Dynamic dispatch, reflection, public SDK surface, test fixtures called by the framework, CLI entrypoints, and event handlers all have zero callers in the call graph and are definitely NOT safe to delete. An engineer who trusts this label and deletes aggressively will break things. The disclaimer is present but undersized — it should be the primary framing, not a small blue callout.

**Gaps:**  
- No confidence scoring ("this has no callers AND is private AND is in a non-public module = high confidence")  
- No way to mark a symbol as "intentionally unreachable" (public API, entrypoint, etc.)  
- No "ignore" list to suppress known false positives across sessions  
- Complex dead symbols (complexity > 5) are flagged but no explanation of why that matters for deletion confidence

---

**🔄 Cycles** — `SOLID, ONE-SHOT VALUE`  
*User story: "We're onboarding a new service that needs to import cleanly. I need to know if we have circular dependencies that would block clean extraction."*

The SCC detection is correct and the expandable list grouped by module is appropriate. The visualization is clear.

**Gaps:**  
- No prescription: tells you the cycle exists, doesn't help you break it. Which single edge would you cut to eliminate the cycle with the least disruption? This is a graph problem the tool could solve.
- After you've reviewed cycles once, the page has no new value until code changes. Better as a CI badge + "new cycles this week" alert than a standalone page.
- Cross-module cycles (the dangerous ones) are treated the same as intra-module cycles (much less concerning). Need severity stratification by module-boundary crossing.

---

### ⚠️ Close — Needs Improvement

**🧩 Module Coupling** — `CORRECT ANALYSIS, DRY DELIVERY`  
*User story (staff): "I need to make the case to the team that our payments module is a liability. I need numbers that non-engineers understand."*

Ca/Ce/instability are academically correct metrics. The heatmap is genuinely the best visualization in the product — you can immediately see "frontend calls backend in 47 places" which is both surprising and actionable. The table tells a real story when module instability is high.

**Gaps:**  
- The table is numbers without narrative. "Instability 0.83" means nothing to an engineer who hasn't read Robert Martin. The table needs a "what this means" column or at least a severity descriptor beyond the badge ("unstable" = "this module depends on many things and little depends on it — changes here are risky").  
- Heatmap cells are not clickable. You can see "47 edges from frontend to backend" but can't drill to see which 47 functions. That drill-through would be the most useful thing in the product.  
- Module data is path-derived (directories), not meaningful architectural boundaries. The metrics are accurate for the data, but the data itself may not reflect real modules.
- The heatmap truncates module names — you lose context on which module you're looking at.

---

**🏛️ Building View** — `DISTINCTIVE VISUAL, UNCLEAR UTILITY`  
*User story: "I want to explain our architecture to a new engineer in a way that shows its structural depth, not just a file tree."*

The building metaphor is genuinely distinctive and the load-bearing column visualization is the most visually memorable thing in the product. After today's edge alignment fix, the structural rendering is correct. The gravity-based layout where columns sit under what they support is architecturally meaningful.

**Gaps:**  
- The metaphor communicates structural depth but doesn't immediately tell you what to DO. A highly loaded Foundation layer is visually obvious but doesn't trigger a recommendation.  
- The load-bearing declare/undeclare workflow has no documented effect on other views. What changes elsewhere in the tool when you declare a node load-bearing? If nothing changes, the declaration is a dead action.
- The Building View in Diff mode is the most interesting use — seeing which layer a new node lands in tells you a lot about whether an addition is architecturally appropriate. But the "Diff Building View" tab is easy to miss.

---

**🗺️ Module Graph** — `RIGHT ABSTRACTION, NEEDS NAVIGATION`  
*User story: "I'm doing an architecture review. I want to see the system as modules, not thousands of individual functions."*

This is what the Call Graph should have been. Module-level reduces noise to something navigable. The depth slider is the right insight — path-derived modules need human-controlled zoom. Instability as color is correct.

**Gaps:**  
- Arrows between modules are hard to follow because many edges at the same depth create visual crossing. The force layout needs edge bundling or at least directional clarity.
- No click-through from a module node to see its top callers and callees from other modules.
- No filter to show "only the modules my team owns" — in a monorepo, most of this graph is noise.
- Edge weight (call count) differences aren't visually obvious enough — a line with 1 call looks the same as one with 1000.

---

**🔬 Community Detection** — `INTERESTING CONCEPT, UNCLEAR FRAMING`  
*User story (staff): "I'm proposing a service extraction. I want evidence that the code I want to extract is already naturally decoupled."*

The alignment score concept is genuinely novel and useful — "your file structure says one thing, your call graph says another" is exactly the kind of structural insight staff engineers need for architectural proposals. The community meta-graph is the right level of abstraction.

**Gaps:**  
- The resolution slider changes results dramatically with no stable interpretation of "what is a good resolution value." Most users will not know what 1.0 vs 2.5 means and will just fiddle randomly.
- Misaligned symbols are listed but with no prescription: "these 5 functions in `payments.utils` behave like they belong in `payments.core`" is an observation, not a recommendation.  
- The connection between communities and actionable decisions (service boundaries, module reorganization) is not made explicit.
- The community coloring is pretty but the numbered IDs (Community 4, Community 7) are meaningless — they should be named by their dominant module.

---

**🔀 Graph Diff (List View)** — `GREAT FOR PR REVIEW, UNDISCOVERABLE`  
*User story: "I'm reviewing a large PR. I want to understand the structural impact of these changes beyond what GitHub shows me."*

The added/removed symbol lists grouped by module are exactly right for PR review. The graph-level view ("which module boundaries changed?") is a genuinely useful perspective that no other code review tool offers.

**Gaps:**  
- There is no way to get here from a PR. The tool requires you to manually select two repo snapshots — the connection to a specific PR or commit range is entirely manual.  
- The "Diff Building View" is the most interesting part but is in a tab that most users won't find. It should be the primary view.
- Adding a symbol deep in the Foundation layer is architecturally more significant than adding one to the Leaves layer — but all additions are shown equally.

---

### ❌ Not Effective As Standalone Pages

**⭐ Centrality** — `REDUNDANT`  
*User story: "I want to know which functions are most important to the system."*

The top-40 by in-degree list is correct but answers a question that Blast Radius, Load-Bearing, and Module Coupling all also answer. Centrality as a standalone page doesn't add value that isn't already visible elsewhere.

Specific failure: the 💥 button doesn't pre-populate blast radius search with the symbol. It navigates to a blank search box. That's a broken link.

Should be: a table view within Blast Radius ("these are the highest-centrality starting points — pick one"), not a standalone page.

---

**🕸️ Call Graph** — `DEMO FEATURE, NOT A WORKING TOOL`  
*User story: "I want to visually explore the call graph of our codebase."*

A force-directed graph of 700+ nodes is visually impressive for a demo but practically unnavigable. Every large codebase produces a hairball. You cannot extract architectural decisions from it. This page likely hasn't been used productively after the first viewing.

Should be: an ego graph viewer (show just the N-hop neighborhood of a selected node) or eliminated in favor of the Module Graph.

---

## Missing Features

### High Impact

**1. Actionable Triage — "Top 3 Issues"**  
Every persona lands on the Dashboard and sees raw numbers. What they need is a prioritized list: "Here are the 3 most important structural problems right now, ranked by estimated refactoring cost and risk." This requires combining signals: an unexpected load-bearing node in a rapidly changing module with high complexity is higher priority than a stable one.

**2. Trend Timeline**  
A sparkline or timeline of key metrics (instability per module, cycle count, dead symbol count) across all indexed snapshots. Without this, the tool can never answer "are we getting better or worse?" which is the primary question engineering managers have.

**3. Blast Radius from Centrality (Fixed Navigation)**  
The jump from Centrality → Blast Radius should pre-populate the symbol. Currently it navigates to a blank search. This is a broken user journey.

**4. Dead Code Confidence Tiers**  
Split dead symbols into: (a) High confidence safe to delete (private, non-test, non-complex, not matching common entrypoint patterns), (b) Review required (public, complex, matches framework patterns), (c) Likely false positive (matches `__init__`, `main`, CLI handlers, etc.).

**5. Heatmap Cell Drill-Through**  
Clicking a cell in the Module Coupling heatmap should show the specific function calls that make up that edge count. "47 calls from frontend to backend" → "here are the 47 functions."

### Medium Impact

**6. Named Communities**  
Replace "Community 7" with the dominant module name. Communities page should frame output as "suggested module groupings" with a diff showing current structure vs. suggested.

**7. Cycle Break Suggestion**  
For each cycle, identify the minimum-weight edge to cut (fewest calls through it) that would break the cycle. "Cut the call from `auth.session` → `user.profile` and this cycle is gone."

**8. Module Filter Across Views**  
In every view, add "show only modules matching [pattern]." In monorepos and large systems, 80% of the data is noise for any given team.

**9. Load-Bearing Declaration Effect**  
Make it explicit what declaring a node load-bearing changes in other views. If it suppresses "unexpected coupling" warnings, say so. If it affects the Building View color, show that. Otherwise it's a label that does nothing.

---

## Priority Order

| Priority | Feature | Effort | Persona |
|---|---|---|---|
| 1 | Fix Centrality → Blast Radius pre-population | Trivial | IC |
| 2 | Dead Code confidence tiers + false positive framing | Small | IC |
| 3 | Heatmap cell drill-through (module → function list) | Medium | IC / Staff |
| 4 | Dashboard "Top 3 issues" triage | Medium | All |
| 5 | Trend timeline for key metrics | Large | Staff / EM |
| 6 | Cycle break suggestion | Medium | Staff |
| 7 | Named communities + "suggested reorganization" framing | Small | Staff |
| 8 | Load-bearing declaration visible effect on other views | Medium | IC / Staff |
| 9 | Ego graph view to replace/supplement Call Graph | Medium | IC |
| 10 | Module filter across all views | Medium | All |

---

## What to Kill or Merge

- **Centrality page** → merge into Blast Radius as "high-centrality starting points" table
- **Load-Bearing page** → already absorbed into Building View ✅  
- **Call Graph** → replace with ego graph viewer or keep only as "neighborhood of selected node"
- **Module Coupling + Module Graph** → consider consolidating; heatmap belongs in Module Graph as a second tab

---

## Summary

The strongest features are **Blast Radius**, **Dead Code**, and **Graph Diff** — they answer specific, frequent engineering questions and the output is legible. The architectural features (Module Coupling, Building View, Communities) are conceptually correct but need prescription added: what should the user DO with this information?

The biggest gap is that nothing improves over time. The tool is a microscope, not a monitor. Adding a timeline layer would fundamentally change how useful this is for staff engineers and managers who need to show progress, justify investment, and track architectural debt reduction.
