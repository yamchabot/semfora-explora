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
