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
| **Explore** ✦ | OLAP pivot / force-graph / node table — dimensional analysis with filters, multi-select chains, blob clustering |
| **Call Graph** | Interactive force-directed graph, filterable by module |
| **Blast Radius** | Search any symbol — see all transitive callers by depth |
| **Module Coupling** | Ca/Ce/instability scores per module + cross-module dependency heatmap |
| **Module Graph** | Module-level dependency graph |
| **Dead Code** | Symbols with zero callers, grouped by file |
| **Load-Bearing Nodes** | Detects intentional vs unexpected high-centrality nodes |
| **Centrality** | Ranked list of highest-centrality symbols — your riskiest refactoring targets |
| **Cycles** | Strongly connected components (circular dependencies) |
| **Communities** ✦ | Louvain community detection — algorithmic clusters vs declared modules |
| **Building** ✦ | Layered architecture view (Foundation → Platform → Services → Features → Leaves) |
| **Graph Diff** | Compare two indexed repos structurally — added/removed symbols and module edges |

✦ = requires enriched DB (run `python enrich.py data/<repo>.db` once)

---

## Architecture

```
semfora-explorer/
├── backend/          FastAPI — serves graph analysis from SQLite DBs
│   ├── analytics/    Pure analysis functions (no DB, fully testable)
│   ├── queries/      DB I/O — returns plain Python dicts/lists
│   ├── routers/      Thin HTTP handlers (one file per feature)
│   ├── db.py         Connection management + enriched-DB auto-promotion
│   ├── enrich.py     ML enrichment pipeline (run once per DB)
│   └── main.py       App entry point — registers routers + serves frontend
├── frontend/         React 18 + Vite
│   └── src/
│       ├── pages/    One file per route
│       ├── components/  Shared UI components
│       ├── utils/    Pure functions — all unit-tested
│       ├── App.jsx   Router, RepoContext, ConsoleToasts
│       └── api.js    API client
├── data/             *.db / *.enriched.db files (gitignored)
└── tests/            pytest test suite (138 tests)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full developer reference — layer contracts, file descriptions, and a "where to make changes" quick-reference.

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
