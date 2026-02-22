# Use Case: Load-Bearing Nodes & Unexpected Coupling

## The Problem

In any real system, some nodes in the call graph are *supposed* to be heavily depended upon. Your HTTP gateway, your job queue, your database client, your logging infrastructure — everything funnels through these. That's not a bug, it's the point. These are your **load-bearing nodes**: the deliberately shared infrastructure that compresses the complexity of many features into simpler, consistent abstractions.

The mistake most coupling analysis tools make is flagging *all* high-centrality nodes as problems. They aren't. A load-bearing node with high centrality is a sign of good design — shared infrastructure doing its job.

The *actual* problem is **unexpected coupling**: a node that wasn't designed to be load-bearing, but has quietly become one. A utility function that one module started using, then another, then three more. A service that grew to straddle multiple domains because it was convenient. A shared data model that's now the dependency pin of six different features.

Unexpected load-bearing nodes are the most dangerous things in a codebase. They're hard to change, they fail in non-obvious ways, and nobody knows they're there.

## Terminology

| Term | Definition |
|---|---|
| **Load-bearing node** | A node with intentionally high centrality — shared infrastructure like gateways, queues, registries, clients. Expected to be heavily depended upon. |
| **Unexpected load-bearing node** | A node whose centrality is high but which was not designed to be a shared foundation. A design smell. |
| **Expected coupling** | Dependencies on load-bearing nodes — normal, healthy, by design. |
| **Unexpected coupling** | Dependencies that cross feature/domain boundaries through non-foundation code. A risk signal. |
| **Coupling surface** | The set of non-load-bearing nodes through which two features or modules are coupled. Smaller = better. |

## The Feature

**Load-Bearing Node Registry & Coupling Audit**

### Step 1: Mark Load-Bearing Nodes
Engineers annotate which nodes are intended to be load-bearing. This can be done:
- Manually (via a config file: `semfora.load-bearing.yaml`)
- By convention (anything in `core/`, `infrastructure/`, `platform/`)
- By Semfora suggestion (high-centrality nodes in stable modules)

Load-bearing nodes are shown with a distinct visual treatment — a "pillar" marker. Everything else with high centrality is flagged as a candidate for review.

### Step 2: Coupling Audit
For any two features, modules, or code paths:
- Show the **coupling surface** — what nodes are shared between them?
- Classify each shared node: is it a load-bearing node (expected), or business logic (unexpected)?
- **Unexpected coupling score**: ratio of shared business-logic nodes to total coupling surface
- Trend over time: is the unexpected coupling surface growing?

### Step 3: Unexpected Load-Bearing Node Detection
Automatically surface nodes that:
- Were not declared as load-bearing
- Have high betweenness centrality AND high in-degree
- Span multiple feature domains (their callers belong to 3+ different features)
- Are in modules that weren't intended to be infrastructure

These are shown with a distinct warning: "This node has become load-bearing without being designed for it."

### Step 4: Coupling Health Per Feature Pair
A matrix showing, for each pair of features:
- Are they coupled at all?
- Is their coupling surface entirely through load-bearing nodes? (✅ healthy)
- Do they share business logic? (⚠️ risky)
- Are they coupled through an unexpected load-bearing node? (🚨 needs attention)

### Step 5: Decoupling Recommendations
For each unexpected coupling:
- Identify which specific call edges create the coupling
- Suggest the minimum interface or abstraction needed to decouple (e.g., "introduce an event between Feature A and Feature B here instead of a direct call")
- Estimate the effort: how many call sites need to change?

## Why It's Useful

- Transforms coupling analysis from "blame everything with high centrality" to "distinguish expected infrastructure from accidental coupling"
- Gives teams a language to talk about coupling: load-bearing vs. unexpected
- Enables product-level decisions about feature independence: "if payments goes down, can checkout survive?" — depends on whether their coupling is through load-bearing infrastructure or direct feature entanglement
- Tracks architectural health over time: is your unexpected coupling surface growing or shrinking?

## Who Uses This

**Staff engineers and architects** doing coupling audits. **SRE and platform teams** identifying blast radius and isolation boundaries. **Product teams** who need to understand feature interdependence for reliability planning.

## Mockup

See: `mockups/load-bearing-nodes.html`
