# Semfora Explorer

A web UI for exploring and analyzing codebases using the [Semfora](https://github.com/Semfora-AI/semfora-engine) graph engine.

Semfora indexes a codebase into a call graph — nodes are symbols (functions, methods, classes), edges are call relationships derived from the AST. Semfora Explorer makes that graph useful for staff engineers, code reviewers, and anyone maintaining a large or legacy codebase.

## What This Is

A set of analysis tools built on top of Semfora's call graph:

| Tool | What it does |
|---|---|
| **Call Graph Diff** | Compare structural dependencies between two branches/commits — see what *actually* changed, not just what lines changed |
| **Blast Radius** | Select any symbol, see the full transitive set of everything that depends on it |
| **Module Coupling** | Measure afferent/efferent coupling and instability scores per module; detect god objects and shadow modules |
| **Dead Code Detector** | Find unreachable symbols from all known entrypoints |
| **Migration Planner** | Plan and track large-scale architectural migrations with real graph data |

## Status

🚧 Early design phase. This repo contains:

- `docs/` — Use-case documents and graph algorithm research
- `mockups/` — Static HTML mockups of each tool (no live data)

## Design Documents

- [Graph Algorithms for Static Code Analysis](docs/graph-algorithms.md)
- [Use Case: Call Graph Diff](docs/use-case-call-graph-diff.md)
- [Use Case: Blast Radius Explorer](docs/use-case-blast-radius.md)
- [Use Case: Module Coupling & Cohesion](docs/use-case-module-coupling.md)
- [Use Case: Dead Code & Entrypoint Mapping](docs/use-case-dead-code-and-entrypoints.md)
- [Use Case: Legacy Modernization Planner](docs/use-case-legacy-modernization.md)

## Mockups

Open any of these directly in a browser — no build step:

- [mockups/index.html](mockups/index.html) — Main dashboard
- [mockups/call-graph-diff.html](mockups/call-graph-diff.html)
- [mockups/blast-radius.html](mockups/blast-radius.html)
- [mockups/module-coupling.html](mockups/module-coupling.html)
- [mockups/dead-code.html](mockups/dead-code.html)
- [mockups/legacy-planner.html](mockups/legacy-planner.html)

## Why Semfora

Text diffs and linters were the best tools we had for reviewing code changes — especially AI-generated code. They're lossy. A 3-line change in a utility function can rewire how a dozen modules behave; no linter will catch that.

Semfora gives us the actual call graph. That opens up a family of graph algorithms (centrality, reachability, clustering, graph diffing) that are far more precise than anything text-based. This explorer makes those algorithms accessible to engineers who need them most.

## Related

- [semfora-engine](https://github.com/Semfora-AI/semfora-engine) — The core indexing engine
- [yamchabot/semfora-engine](https://github.com/yamchabot/semfora-engine) — Our fork
