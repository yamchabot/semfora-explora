# Graph Algorithms for Static Code Analysis

Semfora produces a directed graph where nodes are symbols (functions, methods, classes, variables) and edges represent call relationships derived from AST traversal. This unlocks a family of graph algorithms that are far more precise than text-based tools.

---

## Core Graph Properties

| Property | What it tells you |
|---|---|
| Nodes | Every named symbol in the codebase |
| Directed edges | "A calls B" (control flow) |
| Edge weight | Call frequency, path depth, or criticality score |
| Node metadata | File, line, language, type, complexity metrics |

---

## Algorithms

### 1. Strongly Connected Components (SCC)
**Algorithm:** Tarjan's or Kosaraju's  
**Use:** Find cycles — functions that call each other directly or transitively. Cycles in call graphs are a major source of tight coupling and make refactoring dangerous.  
**Output:** Sets of symbols that are mutually dependent. If a set is larger than ~3 nodes, that's a design smell.

### 2. Topological Sort
**Algorithm:** Kahn's or DFS-based  
**Use:** Establish a safe refactoring order. If you want to extract a module, you need to know what it depends on and what depends on it. Topo sort gives you the dependency-safe sequencing.  
**Output:** A ranked list of symbols/modules ordered by dependency depth.

### 3. Shortest Path / All-Paths
**Algorithm:** Dijkstra, BFS, DFS with memoization  
**Use:** "How does execution flow from entrypoint A to function B?" Great for understanding the blast radius of a change and tracing bugs through unfamiliar code.  
**Output:** One or all execution paths between two symbols.

### 4. Betweenness Centrality
**Algorithm:** Brandes' algorithm  
**Use:** Find "load-bearing" functions — symbols that lie on the most paths between other symbols. These are your highest-risk refactoring targets. If this function breaks, many things break.  
**Output:** Centrality score per node. High-betweenness nodes are architectural chokepoints.

### 5. PageRank / Authority Scoring
**Algorithm:** PageRank (iterative)  
**Use:** Rank functions by how "important" they are to the system, based on how many other important things call them. Surfaces core infrastructure vs. leaf utility code.  
**Output:** Importance score per node. Useful for prioritizing test coverage.

### 6. Community Detection / Graph Clustering
**Algorithm:** Louvain, Leiden, or label propagation  
**Use:** Automatically discover module boundaries from call behavior, not from file organization. Ideal for spotting when a "utils" file has secretly become a god object, or when two "separate" modules are actually deeply coupled.  
**Output:** Clusters of symbols that should logically belong together.

### 7. Graph Diffing
**Algorithm:** Maximum common subgraph (MCS) or subgraph isomorphism heuristics  
**Use:** Compare the call graph before and after a change. A text diff shows you what lines changed; a graph diff shows you what *dependencies changed*. This is the killer app for reviewing AI-generated code.  
**Output:** Added edges, removed edges, new nodes, deleted nodes, and a structural similarity score.

### 8. Reachability Analysis
**Algorithm:** BFS/DFS from a source set  
**Use:** "What is the full blast radius if I change this function?" or "What is dead code that nothing ever reaches?"  
**Output:** Set of all reachable/unreachable symbols from a given starting point. Dead code = unreachable from any entrypoint.

### 9. Critical Path Analysis
**Algorithm:** Longest path in a DAG  
**Use:** Find the deepest call chain in your system. Excessively deep call chains are a proxy for over-abstraction, tight coupling, and debugging difficulty.  
**Output:** The longest execution path(s) in the system.

### 10. Coupling/Cohesion Metrics (Structural)
**Algorithm:** Derived from in-degree/out-degree statistics  
- **Afferent coupling (Ca):** How many modules depend on this one? (in-degree at module level)  
- **Efferent coupling (Ce):** How many modules does this one depend on? (out-degree at module level)  
- **Instability:** `I = Ce / (Ca + Ce)` — 0 = stable (many dependents), 1 = unstable (many dependencies)  
- **Cohesion:** Are symbols within a cluster tightly connected to each other relative to connections going out?

---

## Priority for Semfora Explorer

For a first release, the highest-value algorithms are:

1. **Graph Diff** — The core reason Semfora exists
2. **Reachability / Blast Radius** — Immediate practical value for any code review
3. **Betweenness Centrality** — Find the scary functions before you touch them
4. **Community Detection** — Automatically discover "real" module boundaries
5. **SCC / Cycle Detection** — Flag tight coupling fast
