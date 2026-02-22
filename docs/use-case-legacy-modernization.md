# Use Case: Legacy Modernization Planner

## The Problem

Migrating a legacy codebase to a modern architecture — extracting microservices, introducing clean architecture layers, converting a monolith — is one of the hardest things a team can do. The usual approach is to have senior engineers hold the whole system in their heads and make decisions based on intuition and tribal knowledge. That doesn't scale, it's risky, and it leaves when people leave.

Teams also frequently make the mistake of drawing a clean architectural diagram and then trying to force the code into it, rather than understanding what the code *actually is* first.

## What Semfora Enables

The call graph is a factual record of what the code actually does, independent of what the directory structure or documentation claims. That makes it the right foundation for migration planning.

## The Feature

**Migration Planner**

A structured workflow for planning a large architectural change:

**Step 1: Understand the current architecture**
- Auto-detect module clusters from the call graph (community detection)
- Display the "real" architecture vs. the "intended" architecture (file structure)
- Identify the largest clusters — these are your most entangled components

**Step 2: Define the target architecture**
- User draws target module boundaries on a canvas, or defines them as directory patterns
- System computes: how many edges currently cross those boundaries?
- Shows the "migration distance" — how far is the current code from the target?

**Step 3: Identify the extraction order**
- Topological sort of modules by dependency — which ones have the fewest inbound dependencies and can be extracted first?
- "Strangler fig" candidates — modules with clean inbound interfaces that can be replaced incrementally
- Circular dependency breakers — the minimum set of interfaces you'd need to introduce to decouple a cycle

**Step 4: Track migration progress**
- Over time, as the code changes, show a coupling trend graph
- Cross-boundary edge count should go down as the migration proceeds
- Alerts when a PR increases cross-boundary coupling (regression detection)

## Why It's Useful

- Turns a vague "we should modernize this" into a concrete, sequenced plan
- Provides objective progress tracking — not just "how does it feel?" but "how many cross-boundary edges remain?"
- Reduces dependence on tribal knowledge by encoding architectural understanding in the tool
- Helps justify investment in refactoring to stakeholders with quantitative metrics

## Who Uses This

**Tech leads and staff engineers** planning large-scale refactors. Also useful for **new CTOs or engineering leads** trying to quickly understand and improve an inherited codebase.

## Mockup

See: `mockups/legacy-planner.html`
