# Use Case: Feature Risk & Integration Test Traceability

## The Problem

Unit tests are written close to the code and use mocks — they verify that a function does what its author thought it should do. They don't verify that the system works. They don't show you what happens when `payments/` calls `notifications/` calls `email-service/` and one of those has a subtle contract mismatch.

Integration tests and end-to-end tests *do* exercise real call paths. But most teams have no visibility into *which code* an integration test actually exercises. You can see if a test passes or fails, but you can't see what it covers, which features it relates to, or what the risk is if it starts failing.

The result: teams have hundreds of integration tests and no map. They don't know which user-facing features are well-covered, which are covered only by unit tests (with mocks), and which have no meaningful verification at all.

## What Semfora Enables

Semfora can trace the call path of a test — the actual subgraph of the call graph that an integration test exercises at runtime (or can statically approximate). Combine that with a user story → test mapping (from test names, tags, or explicit annotations), and you get a three-layer graph:

```
User Story / Feature
    └── Integration Tests
            └── Code Paths (call subgraph)
                    └── Code Quality Signals (coupling, complexity, dead ends)
```

## The Feature

**Feature Risk Dashboard**

### Layer 1: Feature → Test Coverage
A list of user stories / features (sourced from test annotations, story IDs in test names, or a CSV/YAML import). For each feature:
- How many integration tests cover it?
- Are those tests green?
- What is the estimated code coverage depth?
- **Feature Risk Score** — a composite of: test coverage depth, code quality under the covered paths, coupling metrics of the call subgraph, and presence of known bad patterns

### Layer 2: Test → Code Path Explorer
Click any integration test → visualize the call subgraph it exercises:
- Nodes are the real functions invoked
- Color-coded by module
- Highlights load-bearing nodes in the path (expected) vs. unexpected mid-path coupling

### Layer 3: Feature Coupling Analysis (Product Perspective)
Features share code paths. When two features share the same call path node, a failure in that node affects both features. This view:
- Shows the overlap between feature call subgraphs
- Identifies which features are **tightly coupled through shared code paths**
- Distinguishes coupling through **load-bearing nodes** (expected, acceptable) from coupling through **business logic** (dangerous — one feature's bug can break another feature)
- Helps product and engineering align: "If Feature A's checkout flow breaks, it will also break Feature B's order history because they share the `OrderRepository.save()` path"

### Risk Score Components
| Signal | Weight |
|---|---|
| No integration test coverage | High |
| Tests exist but call path is shallow (thin coverage) | Medium |
| Unexpected tight coupling in call path | High |
| High-betweenness nodes in call path with no test isolation | High |
| Call path passes through deprecated/flagged code | Medium |
| Feature shares critical path node with 3+ other features | Medium |
| Call path is long (deep call chains) | Low |

## Why It's Useful

- Gives product teams visibility into *which features are risky* before a release, not after an incident
- Prioritizes integration test writing by showing uncovered features and call paths
- Makes the "what breaks if X breaks?" question answerable from a product/user perspective (not just a technical one)
- Enables architecture decisions: "we should decouple Feature A and Feature B at this call path node"

## Who Uses This

**QA leads and engineering managers** tracking feature coverage. **Product managers** who want to understand risk before a release. **Staff engineers** planning decoupling work.

## Mockup

See: `mockups/feature-risk.html`
