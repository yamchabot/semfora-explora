# Use Case: Dead Code & Entrypoint Mapping

## The Problem

In long-lived codebases, dead code accumulates. Functions are written but never called, old API handlers linger after features are removed, entire modules become orphaned. Dead code isn't just bloat — it's a maintenance hazard. It gets accidentally modified, it confuses new engineers, and it inflates complexity metrics.

On the other side of the same problem: teams often don't have a clear map of what the *real entrypoints* of their system are. This makes security audits painful, onboarding slow, and refactoring risky.

## What Semfora Enables

Reachability analysis from a known set of entrypoints gives you an exact partition of the codebase: **live code** (reachable from at least one entrypoint) vs. **dead code** (unreachable from any entrypoint).

## The Feature

**Dead Code Detector**

1. User defines entrypoints — or the system auto-detects them (main functions, exported symbols, route handlers, test files)
2. BFS/DFS traversal marks every reachable symbol
3. Everything unmarked is dead code

**Display:**
- List of dead symbols with file + line number
- Dead code grouped by module/file (some files may be entirely dead)
- Size estimate: lines of code that could be deleted
- Confidence level: "definitely unreachable" vs. "unreachable in static analysis but may be called dynamically"

**Entrypoint Map:**  
Flip the view — for each entrypoint, show the full tree of what it calls. Produces a "feature map" of the system: each top-level feature owns a subtree of the call graph. Overlapping subtrees reveal shared infrastructure.

**Entrypoint coverage:**  
Which entrypoints have no test coverage? Which have the deepest call trees with no tests anywhere in the chain?

## Why It's Useful

- Dead code deletion is the safest possible refactor — nothing can break that isn't already broken
- Produces a concrete, prioritized list of cleanup work
- The entrypoint map is often the most useful onboarding document for a new engineer
- Security teams can use the entrypoint map to understand the attack surface

## Who Uses This

**Any engineer doing cleanup work.** Also useful for **security reviewers** mapping the attack surface and **tech leads** creating onboarding materials.

## Mockup

See: `mockups/dead-code.html`
