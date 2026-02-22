# Semfora Explorer

A web UI for exploring and analyzing codebases using the [Semfora](https://github.com/Semfora-AI/semfora-engine) graph engine.

Semfora indexes a codebase into a call graph — nodes are symbols (functions, methods, classes), edges are call relationships derived from the AST. Semfora Explorer makes that graph useful for staff engineers, code reviewers, and anyone maintaining a large or legacy codebase.

## Quick Start

### 1. Index a repo with Semfora

```bash
cd /your/project
semfora-engine query callgraph --export /path/to/semfora-explorer/data/my-project.db --limit 999999
```

### 2. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** — the app auto-discovers all `.db` files in `data/`.

Or run both at once:

```bash
chmod +x start.sh && ./start.sh
```

---

## Features

| Tool | Description |
|---|---|
| **Dashboard** | Repo overview — node/edge counts, module breakdown, risk distribution |
| **Call Graph** | Interactive force-directed graph, filterable by module. Click nodes to inspect. |
| **Blast Radius** | Search any symbol — see all transitive callers by depth |
| **Module Coupling** | Ca/Ce/instability scores per module + cross-module dependency heatmap |
| **Dead Code** | Symbols with zero callers, grouped by file |
| **Load-Bearing Nodes** | Detects intentional vs unexpected high-centrality nodes |
| **Centrality** | Ranked list of highest-centrality symbols — your riskiest refactoring targets |
| **Cycles** | Strongly connected components (circular dependencies) |
| **Graph Diff** | Compare two indexed repos structurally — added/removed symbols and module edges |

---

## Architecture

```
semfora-explorer/
├── backend/          FastAPI — serves graph analysis from SQLite DBs
│   ├── main.py       All API endpoints
│   └── requirements.txt
├── frontend/         React + Vite
│   └── src/
│       ├── pages/    One page per feature
│       ├── components/Layout.jsx
│       └── api.js    API client
├── data/             *.db files (Semfora SQLite exports — gitignored)
├── docs/             Design documents and use-case specs
└── mockups/          Static HTML mockups (open directly in browser)
```

## Data Source

The backend reads Semfora SQLite exports with this schema:

- **nodes**: `hash, name, kind, module, file_path, line_start, line_end, risk, complexity, caller_count, callee_count`
- **edges**: `caller_hash, callee_hash, call_count, edge_kind`
- **module_edges**: `caller_module, callee_module, edge_count`

To add a new repo, just export it:

```bash
cd /your/project
semfora-engine query callgraph --export /path/to/data/repo-name.db --limit 999999
```

Restart the backend — the new repo appears in the selector automatically.

## Design Documents

- [Graph Algorithms for Static Code Analysis](docs/graph-algorithms.md)
- [Use Case: Call Graph Diff](docs/use-case-call-graph-diff.md)
- [Use Case: Blast Radius Explorer](docs/use-case-blast-radius.md)
- [Use Case: Module Coupling & Cohesion](docs/use-case-module-coupling.md)
- [Use Case: Dead Code & Entrypoint Mapping](docs/use-case-dead-code-and-entrypoints.md)
- [Use Case: Legacy Modernization Planner](docs/use-case-legacy-modernization.md)
- [Use Case: Feature Risk & Integration Test Traceability](docs/use-case-feature-risk.md)
- [Use Case: Load-Bearing Nodes & Unexpected Coupling](docs/use-case-load-bearing-nodes.md)
- [Extended Feature Brainstorm](docs/feature-brainstorm-extended.md)

## Related

- [semfora-engine](https://github.com/Semfora-AI/semfora-engine) — The core indexing engine
- [yamchabot/semfora-engine](https://github.com/yamchabot/semfora-engine) — Our fork
