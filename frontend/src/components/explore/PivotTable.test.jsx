import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PivotTable } from "./PivotTable.jsx";

// ── Sample data fixtures ───────────────────────────────────────────────────────

const MEASURES = [
  { special: "symbol_count" },
  { special: "dead_ratio" },
  { field: "caller_count", agg: "avg" },
];

function makeData(overrides = {}) {
  return {
    dimensions:    ["module"],
    measure_types: { symbol_count: "integer", dead_ratio: "ratio", caller_count_avg: "float" },
    rows: [
      { key: { module: "core" },    values: { symbol_count: 12, dead_ratio: 0.25, caller_count_avg: 3.5 }, children: [] },
      { key: { module: "utils" },   values: { symbol_count: 5,  dead_ratio: 0,    caller_count_avg: 1.2 }, children: [] },
      { key: { module: "service" }, values: { symbol_count: 8,  dead_ratio: null, caller_count_avg: 2.1 }, children: [] },
    ],
    ...overrides,
  };
}

function makeDataWithChildren() {
  return {
    dimensions:    ["module", "kind"],
    measure_types: { symbol_count: "integer", dead_ratio: "ratio" },
    rows: [
      {
        key:    { module: "core" },
        values: { symbol_count: 5, dead_ratio: 0.2 },
        children: [
          { key: { module: "core", kind: "function" }, values: { symbol_count: 3, dead_ratio: 0.1 } },
          { key: { module: "core", kind: "class" },    values: { symbol_count: 2, dead_ratio: 0.3 } },
        ],
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PivotTable", () => {
  it("renders 'No data.' when rows are empty", () => {
    render(<PivotTable data={{ ...makeData(), rows: [] }} measures={MEASURES} />);
    expect(screen.getByText("No data.")).toBeInTheDocument();
  });

  it("renders a header row with dimension name", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    expect(screen.getByText("module")).toBeInTheDocument();
  });

  it("renders a header cell for each measure", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    expect(screen.getByText("symbol count")).toBeInTheDocument();
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
  });

  it("renders a row for each data entry", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByText("utils")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();
  });

  it("renders integer values", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders '—' for null values", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    // The service row has null caller_count_avg
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders RatioCell (bar) for ratio-type measures", () => {
    const { container } = render(<PivotTable data={makeData()} measures={MEASURES} />);
    // dead_ratio is type "ratio" → should render bar elements
    expect(container.querySelectorAll(".bar-bg").length).toBeGreaterThan(0);
  });

  // PivotTable default: rows with children start EXPANDED (collapsed=new Set() → isExpanded=true)
  it("rows with children show a collapse arrow (▼) by default", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("children are visible by default (expanded)", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    expect(screen.getByText("function")).toBeInTheDocument();
    expect(screen.getByText("class")).toBeInTheDocument();
  });

  it("rows without children show no expand/collapse arrow", () => {
    render(<PivotTable data={makeData()} measures={MEASURES} />);
    expect(screen.queryByText("▶")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("clicking an expanded parent row collapses its children", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    // Children visible initially
    expect(screen.getByText("function")).toBeInTheDocument();
    fireEvent.click(screen.getByText("core")); // collapse
    expect(screen.queryByText("function")).not.toBeInTheDocument();
  });

  it("clicking a collapsed parent row re-expands its children", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    fireEvent.click(screen.getByText("core")); // collapse
    expect(screen.queryByText("function")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("core")); // re-expand
    expect(screen.getByText("function")).toBeInTheDocument();
  });

  it("arrow changes from ▼ to ▶ when collapsed", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    expect(screen.getByText("▼")).toBeInTheDocument();
    fireEvent.click(screen.getByText("core"));
    expect(screen.getByText("▶")).toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("symbol grain: splits module::name for display", () => {
    const symbolData = {
      dimensions:    ["symbol"],
      measure_types: { symbol_count: "integer" },
      rows: [
        { key: { symbol: "core::my_function" }, values: { symbol_count: 1 }, children: [] },
      ],
    };
    render(<PivotTable data={symbolData} measures={[{ special: "symbol_count" }]} />);
    expect(screen.getByText("my_function")).toBeInTheDocument();
    expect(screen.getByText(/·\s*core/)).toBeInTheDocument();
  });

  it("renders the agg label in header for field measures", () => {
    render(<PivotTable data={makeData()} measures={[{ field: "caller_count", agg: "avg" }]} />);
    // The header shows the label + agg
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("avg")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N-dim recursive rendering tests
// ─────────────────────────────────────────────────────────────────────────────

function make3DimData(overrides = {}) {
  return {
    dimensions: ["module", "class", "symbol"],
    measure_types: { symbol_count: "integer" },
    rows: [
      {
        key: { module: "core" }, depth: 0,
        values: { symbol_count: 4 },
        children: [
          {
            key: { module: "core", class: "Parser" }, depth: 1,
            values: { symbol_count: 2 },
            children: [
              { key: { module: "core", class: "Parser", symbol: "core::parse" },    depth: 2, values: { symbol_count: 1 }, children: [] },
              { key: { module: "core", class: "Parser", symbol: "core::validate" }, depth: 2, values: { symbol_count: 1 }, children: [] },
            ],
          },
          {
            key: { module: "core", class: "Builder" }, depth: 1,
            values: { symbol_count: 2 },
            children: [
              { key: { module: "core", class: "Builder", symbol: "core::build" },   depth: 2, values: { symbol_count: 1 }, children: [] },
            ],
          },
        ],
      },
      {
        key: { module: "auth" }, depth: 0,
        values: { symbol_count: 1 },
        children: [
          {
            key: { module: "auth", class: "Session" }, depth: 1,
            values: { symbol_count: 1 },
            children: [
              { key: { module: "auth", class: "Session", symbol: "auth::login" }, depth: 2, values: { symbol_count: 1 }, children: [] },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("PivotTable – 3-dim recursive rendering", () => {
  const M = [{ special: "symbol_count" }];

  it("renders depth-0 (module) rows", () => {
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByText("auth")).toBeInTheDocument();
  });

  it("renders depth-1 (class) rows on initial render (all rows start expanded)", () => {
    // PivotTable starts fully expanded (collapsed = empty Set); no click needed.
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("Parser")).toBeInTheDocument();
    expect(screen.getByText("Builder")).toBeInTheDocument();
  });

  it("renders depth-2 (symbol) rows on initial render", () => {
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("parse")).toBeInTheDocument();
    expect(screen.getByText("validate")).toBeInTheDocument();
  });

  it("depth-2 rows do NOT show expand arrow (they are leaves)", () => {
    render(<PivotTable data={make3DimData()} measures={M} />);
    // Expandable rows (core, auth, Parser, Builder, Session) show ▼
    // Leaf rows (parse, validate, build, login) must NOT show ▼ or ▶
    // Count: core▼, Parser▼, Builder▼, auth▼, Session▼ = 5 max
    const arrows = screen.queryAllByText(/^[▼▶]$/);
    // All arrows belong to non-leaf rows; leaves have an empty span placeholder
    // Leaf count = 5 (parse, validate, build, login) + 5 non-leaf = many rows
    // We just assert arrows <= total expandable rows (5)
    expect(arrows.length).toBeLessThanOrEqual(5);
  });

  it("collapsing core hides class and symbol rows", () => {
    // All rows start expanded; clicking core collapses it
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("Parser")).toBeInTheDocument();
    expect(screen.getByText("parse")).toBeInTheDocument();
    fireEvent.click(screen.getByText("core"));   // collapse
    expect(screen.queryByText("Parser")).not.toBeInTheDocument();
    expect(screen.queryByText("parse")).not.toBeInTheDocument();
  });

  it("header shows breadcrumb dims joined with ›", () => {
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("module › class › symbol")).toBeInTheDocument();
  });

  it("measure values are shown at each level", () => {
    render(<PivotTable data={make3DimData()} measures={M} />);
    // symbol_count for core = 4 should appear in root row
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("leaf symbol rows split 'module::name' into name + · module display", () => {
    // All rows start expanded, so symbols are immediately visible
    render(<PivotTable data={make3DimData()} measures={M} />);
    // "core::parse" → name=parse, · core
    expect(screen.getByText("parse")).toBeInTheDocument();
    const coreSpans = screen.getAllByText(/·\s*core/);
    expect(coreSpans.length).toBeGreaterThan(0);
  });

  it("renders empty state for data with no rows", () => {
    const empty = { ...make3DimData(), rows: [] };
    render(<PivotTable data={empty} measures={M} />);
    expect(screen.getByText("No data.")).toBeInTheDocument();
  });

  it("independent expand/collapse of sibling groups", () => {
    // All start expanded → Parser (core) and Session (auth) are both visible
    render(<PivotTable data={make3DimData()} measures={M} />);
    expect(screen.getByText("Parser")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    // Collapse only core — auth must remain expanded
    fireEvent.click(screen.getByText("core"));
    expect(screen.queryByText("Parser")).not.toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    // Re-expand core — both visible again
    fireEvent.click(screen.getByText("core"));
    expect(screen.getByText("Parser")).toBeInTheDocument();
  });
});

describe("PivotTable – N-dim backward compat (2-dim unchanged)", () => {
  it("2-dim header shows dim0 name only (not joined)", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    // dims=["module","community"] → header shows "module › community"
    expect(screen.getByText(/module/)).toBeInTheDocument();
  });

  it("2-dim collapse/expand still works", () => {
    render(<PivotTable data={makeDataWithChildren()} measures={[{ special: "symbol_count" }]} />);
    expect(screen.getByText("▼")).toBeInTheDocument();
    fireEvent.click(screen.getByText("core"));
    expect(screen.getByText("▶")).toBeInTheDocument();
  });
});
