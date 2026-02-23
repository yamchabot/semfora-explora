import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChip, AddFilterMenu, DimFilterEditor, MeasureFilterEditor } from "./FilterControls.jsx";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function dimFilter(overrides = {}) {
  return { id: "1", kind: "dim", field: "module", mode: "exclude", values: [], pattern: "", ...overrides };
}

function measureFilter(overrides = {}) {
  return { id: "2", kind: "measure", mkey: "dead_ratio", label: "dead ratio", expr: "", ...overrides };
}

// ── DimFilterEditor ────────────────────────────────────────────────────────────

describe("DimFilterEditor", () => {
  it("renders mode buttons", () => {
    render(<DimFilterEditor filter={dimFilter()} availableValues={[]} onUpdate={vi.fn()} />);
    expect(screen.getByText("exclude")).toBeInTheDocument();
    expect(screen.getByText("include")).toBeInTheDocument();
    expect(screen.getByText("regex")).toBeInTheDocument();
  });

  it("clicking a mode button calls onUpdate with new mode", () => {
    const onUpdate = vi.fn();
    render(<DimFilterEditor filter={dimFilter({ mode: "exclude" })} availableValues={[]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("include"));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: "include" }));
  });

  it("regex mode shows a text input instead of value buttons", () => {
    render(<DimFilterEditor filter={dimFilter({ mode: "regex" })} availableValues={["core", "utils"]} onUpdate={vi.fn()} />);
    expect(screen.getByPlaceholderText(/e\.g\./)).toBeInTheDocument();
    // Value buttons should not appear
    expect(screen.queryByText("core")).not.toBeInTheDocument();
  });

  it("exclude/include mode shows value buttons", () => {
    render(<DimFilterEditor filter={dimFilter({ mode: "exclude" })} availableValues={["core", "utils"]} onUpdate={vi.fn()} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByText("utils")).toBeInTheDocument();
  });

  it("clicking a value toggles it in the filter values", () => {
    const onUpdate = vi.fn();
    render(<DimFilterEditor filter={dimFilter({ mode: "include", values: [] })} availableValues={["core"]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("core"));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ values: ["core"] }));
  });

  it("clicking an already-selected value removes it", () => {
    const onUpdate = vi.fn();
    render(<DimFilterEditor filter={dimFilter({ mode: "include", values: ["core"] })} availableValues={["core", "utils"]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("core"));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ values: [] }));
  });

  it("shows hint when no available values", () => {
    render(<DimFilterEditor filter={dimFilter({ mode: "include" })} availableValues={[]} onUpdate={vi.fn()} />);
    expect(screen.getByText(/Run a query first/)).toBeInTheDocument();
  });
});

// ── MeasureFilterEditor ────────────────────────────────────────────────────────

describe("MeasureFilterEditor", () => {
  it("renders the filter label", () => {
    render(<MeasureFilterEditor filter={measureFilter()} onUpdate={vi.fn()} />);
    expect(screen.getByText(/dead ratio/)).toBeInTheDocument();
  });

  it("renders the expression input", () => {
    render(<MeasureFilterEditor filter={measureFilter({ expr: "> 0.5" })} onUpdate={vi.fn()} />);
    expect(screen.getByDisplayValue("> 0.5")).toBeInTheDocument();
  });

  it("typing in the input calls onUpdate with new expr", () => {
    const onUpdate = vi.fn();
    render(<MeasureFilterEditor filter={measureFilter()} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "< 0.3" } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ expr: "< 0.3" }));
  });

  it("renders operator help text", () => {
    render(<MeasureFilterEditor filter={measureFilter()} onUpdate={vi.fn()} />);
    expect(screen.getByText(/Ops:/)).toBeInTheDocument();
  });
});

// ── FilterChip ─────────────────────────────────────────────────────────────────

describe("FilterChip", () => {
  it("calls onRemove when × is clicked", () => {
    const onRemove = vi.fn();
    render(<FilterChip filter={dimFilter()} availableValues={[]} onUpdate={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("renders a summary for an unset dim filter", () => {
    render(<FilterChip filter={dimFilter({ field: "module", mode: "exclude", values: [] })} availableValues={[]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/module/)).toBeInTheDocument();
  });

  it("renders a summary with values when set", () => {
    const f = dimFilter({ field: "module", mode: "include", values: ["core", "utils"] });
    render(<FilterChip filter={f} availableValues={[]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/core, utils/)).toBeInTheDocument();
  });

  it("renders +N overflow for more than 2 values", () => {
    const f = dimFilter({ values: ["a", "b", "c", "d"] });
    render(<FilterChip filter={f} availableValues={[]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });

  it("renders regex summary with pattern", () => {
    const f = dimFilter({ mode: "regex", pattern: "^core" });
    render(<FilterChip filter={f} availableValues={[]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/\^core/)).toBeInTheDocument();
  });

  it("renders measure filter summary", () => {
    const f = measureFilter({ label: "dead ratio", expr: "> 0.5" });
    render(<FilterChip filter={f} availableValues={[]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/dead ratio.*> 0\.5/)).toBeInTheDocument();
  });

  it("clicking the chip label opens the editor panel", () => {
    render(<FilterChip filter={dimFilter({ mode: "exclude", values: ["core"] })} availableValues={["core", "utils"]} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    // Editor not open yet — mode buttons hidden
    expect(screen.queryByText("exclude")).not.toBeInTheDocument();
    // Click the chip label (first span)
    fireEvent.click(screen.getByText(/module/));
    // Now editor appears
    expect(screen.getByText("exclude")).toBeInTheDocument();
  });
});

// ── AddFilterMenu ──────────────────────────────────────────────────────────────

describe("AddFilterMenu", () => {
  const dims     = ["module", "risk"];
  const measures = [{ field: "caller_count", agg: "avg" }];

  it("renders the trigger button", () => {
    render(<AddFilterMenu dims={dims} measures={[]} onAdd={vi.fn()} />);
    expect(screen.getByText(/Add filter/)).toBeInTheDocument();
  });

  it("menu is hidden by default", () => {
    render(<AddFilterMenu dims={dims} measures={[]} onAdd={vi.fn()} />);
    expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
  });

  it("opens menu on click", () => {
    render(<AddFilterMenu dims={dims} measures={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByText(/Add filter/));
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
  });

  it("lists all dimension options when open", () => {
    render(<AddFilterMenu dims={dims} measures={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByText(/Add filter/));
    expect(screen.getByText("module")).toBeInTheDocument();
    expect(screen.getByText("risk")).toBeInTheDocument();
  });

  it("calls onAdd with a dim filter object when a dimension is selected", () => {
    const onAdd = vi.fn();
    render(<AddFilterMenu dims={dims} measures={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByText(/Add filter/));
    fireEvent.click(screen.getByText("module"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "dim",
      field: "module",
      mode: "exclude",
    }));
  });

  it("shows measure section when measures are provided", () => {
    render(<AddFilterMenu dims={[]} measures={measures} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByText(/Add filter/));
    expect(screen.getByText("Measures")).toBeInTheDocument();
  });

  it("calls onAdd with a measure filter object when a measure is selected", () => {
    const onAdd = vi.fn();
    render(<AddFilterMenu dims={[]} measures={measures} onAdd={onAdd} />);
    fireEvent.click(screen.getByText(/Add filter/));
    fireEvent.click(screen.getByText("callers"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "measure",
      mkey: "caller_count_avg",
    }));
  });
});
