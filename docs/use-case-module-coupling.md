# Use Case: Module Coupling & Cohesion Analysis

## The Problem

Files and directories are how humans organize code. But after years of growth — especially with AI-assisted development — the *actual* dependency structure often looks nothing like the file structure. A "utilities" module quietly becomes a god object. Two "separate" services share so many internal call paths that they can't be independently deployed. A module that was supposed to be stateless has accumulated hidden state dependencies.

These problems are invisible until they become crises.

## What Semfora Enables

Semfora's graph enables computing structural coupling and cohesion metrics at any granularity — file, directory, or logical module — and can detect "natural" module boundaries by clustering the call graph independent of file organization.

## The Feature

**Module Health Dashboard**

Displays a matrix and/or force-directed graph of modules (configurable: by directory, by file, or auto-detected) showing:

**Coupling Metrics (per module):**
- **Afferent Coupling (Ca)** — How many other modules call into this one
- **Efferent Coupling (Ce)** — How many other modules this one calls into
- **Instability score** `I = Ce / (Ca + Ce)` — 0 is maximally stable, 1 is maximally unstable
- **Coupling ratio** — Ratio of cross-module edges to total edges (low = good)

**Cohesion Metrics (per module):**
- Internal call density — are functions in this module calling each other?
- Disconnected subgraphs within a module (dead weight or unrelated code lumped together)

**Auto-detected Module Boundaries:**  
Using community detection (Louvain/Leiden), show what the call graph *thinks* the modules should be. Highlight divergence from actual file structure — these are your "shadow modules" that exist in behavior but not in organization.

**Dependency Matrix:**  
A grid showing cross-module call edges. Cells with high numbers are coupling hotspots. Off-diagonal density indicates poor separation of concerns.

## Why It's Useful

- Provides objective, reproducible coupling metrics — no more arguing about whether something is "too coupled"
- Helps prioritize modularization efforts in legacy codebases (start with the highest-instability modules)
- Validates architectural decisions: "is this new service boundary we're drawing actually reflected in the code?"
- Great for tracking architecture improvements over time — watch coupling scores go down as you refactor

## Who Uses This

**Staff engineers and architects** planning refactors or module extractions. Also valuable for **engineering managers** who want a quantitative picture of codebase health without reading every file.

## Mockup

See: `mockups/module-coupling.html`
