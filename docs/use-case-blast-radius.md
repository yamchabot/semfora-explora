# Use Case: Blast Radius Explorer

## The Problem

You need to change a function deep in a shared utility layer. Before you touch it, you want to know: *how many things will this break if I get it wrong?* Grepping for the function name tells you direct callers. It does not tell you the full transitive closure — all the things that call the things that call this thing.

In a legacy codebase with poor test coverage, this uncertainty is what causes engineers to avoid refactoring entirely, leading to deeper and deeper rot.

## What Semfora Enables

Semfora's call graph enables **reachability analysis** — starting from any node, compute the full set of symbols that would be affected by a change to it, at any depth.

## The Feature

**Blast Radius Explorer**

1. Search for or click on any symbol in the codebase
2. See a radial/tree visualization expanding outward: direct callers → their callers → and so on
3. Color-coded by depth (immediate, 2-hop, 3-hop+)
4. Node size proportional to how many *other* things that node connects to
5. Collapse/expand branches to manage large graphs

**Stats panel:**
- Total affected symbols
- Affected files / modules
- Estimated test coverage for affected nodes (if coverage data is available)
- Highest-betweenness node in the blast radius (the one most worth worrying about)

**Reverse mode: Dependency Trace**  
Start from an entrypoint (e.g., an API route handler) and trace *downward* — see everything it will invoke. Useful for auditing what a given feature actually touches.

## Why It's Useful

- Gives engineers the confidence to refactor by making the risk visible and bounded
- Surfaces hidden blast radii in "simple" utility functions
- Helps prioritize test coverage — write tests for the high-blast-radius nodes first
- Immediately useful for any engineer onboarding to an unfamiliar codebase

## Who Uses This

**Any engineer** before touching a shared function in a large or legacy codebase. Also useful for **tech leads** doing architectural planning — "can we safely extract this module?" becomes a measurable question.

## Mockup

See: `mockups/blast-radius.html`
