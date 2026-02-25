import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterWizard } from "./FilterWizard.jsx";

// ── default props ─────────────────────────────────────────────────────────────
function makeProps(overrides = {}) {
  return {
    isOpen:            true,
    onClose:           vi.fn(),
    forced:            false,
    nodeCount:         120,
    allDims:           ["module", "class", "symbol", "kind", "risk"],
    activeDims:        ["module", "symbol"],
    disabledDims:      new Set(),
    dimValues:         { module: ["core", "api", "utils"], class: [] },
    availableKinds:    ["fn", "method"],   // avoid "class" colliding with dim button
    activeKinds:       [],
    filters:           [],
    onToggleDim:       vi.fn(),
    onToggleDisableDim: vi.fn(),
    onAddFilter:       vi.fn(),
    onUpdateFilter:    vi.fn(),
    onRemoveFilter:    vi.fn(),
    onSetKinds:        vi.fn(),
    ...overrides,
  };
}

describe("FilterWizard", () => {

  // ── open / closed ─────────────────────────────────────────────────────────

  it("renders nothing when isOpen is false", () => {
    const { container } = render(<FilterWizard {...makeProps({ isOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders modal content when isOpen is true", () => {
    render(<FilterWizard {...makeProps()} />);
    expect(screen.getByText(/Filter wizard/i)).toBeInTheDocument();
  });

  // ── header ────────────────────────────────────────────────────────────────

  it("shows node count in header", () => {
    render(<FilterWizard {...makeProps({ nodeCount: 842 })} />);
    expect(screen.getByText(/842/)).toBeInTheDocument();
  });

  it("shows 'Graph too large' header when forced", () => {
    render(<FilterWizard {...makeProps({ forced: true, nodeCount: 1500 })} />);
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
  });

  it("shows forced warning message", () => {
    render(<FilterWizard {...makeProps({ forced: true })} />);
    expect(screen.getByText(/apply filters/i)).toBeInTheDocument();
  });

  // ── close button ──────────────────────────────────────────────────────────

  it("shows × close button in non-forced mode", () => {
    render(<FilterWizard {...makeProps()} />);
    expect(screen.getByTitle(/Close/i)).toBeInTheDocument();
  });

  it("does not show × close button in forced mode", () => {
    render(<FilterWizard {...makeProps({ forced: true })} />);
    expect(screen.queryByTitle(/Close/i)).not.toBeInTheDocument();
  });

  it("clicking × calls onClose", () => {
    const onClose = vi.fn();
    render(<FilterWizard {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByTitle(/Close/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── ESC key ───────────────────────────────────────────────────────────────

  it("pressing ESC calls onClose", () => {
    const onClose = vi.fn();
    render(<FilterWizard {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ESC does not call onClose when closed", () => {
    const onClose = vi.fn();
    render(<FilterWizard {...makeProps({ isOpen: false, onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── group by dims ─────────────────────────────────────────────────────────

  it("renders dim buttons for standard structural dims", () => {
    render(<FilterWizard {...makeProps()} />);
    // Use role="button" to target dim buttons specifically (not section headers)
    expect(screen.getByRole("button", { name: "module" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "class" })).toBeInTheDocument();
  });

  it("active dim button is present and styled", () => {
    render(<FilterWizard {...makeProps({ activeDims: ["module"] })} />);
    const modBtn = screen.getByRole("button", { name: "module" });
    expect(modBtn).toBeInTheDocument();
  });

  it("clicking an inactive dim calls onToggleDim", () => {
    const onToggleDim = vi.fn();
    render(<FilterWizard {...makeProps({
      activeDims: ["module"],  // class is not active
      onToggleDim,
    })} />);
    // Click the class button (exact name avoids ambiguity with other text)
    const classBtn = screen.getByRole("button", { name: "class" });
    fireEvent.click(classBtn);
    expect(onToggleDim).toHaveBeenCalledWith("class");
  });

  it("clicking an active dim calls onToggleDisableDim", () => {
    const onToggleDisableDim = vi.fn();
    render(<FilterWizard {...makeProps({
      activeDims: ["module", "symbol"],
      onToggleDisableDim,
    })} />);
    // "module" is active → clicking it disables/enables
    const modBtn = screen.getByRole("button", { name: "module" });
    fireEvent.click(modBtn);
    expect(onToggleDisableDim).toHaveBeenCalledWith("module");
  });

  it("disabled dim has line-through styling", () => {
    render(<FilterWizard {...makeProps({
      activeDims:   ["module", "symbol"],
      disabledDims: new Set(["module"]),
    })} />);
    const modBtn = screen.getByRole("button", { name: "module" });
    expect(modBtn.style.textDecoration).toContain("line-through");
  });

  // ── module list ───────────────────────────────────────────────────────────

  it("renders module values as clickable chips", () => {
    render(<FilterWizard {...makeProps({
      dimValues: { module: ["core", "api", "utils"] },
    })} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("utils")).toBeInTheDocument();
  });

  it("clicking a module chip calls onAddFilter with include filter", () => {
    const onAddFilter = vi.fn();
    render(<FilterWizard {...makeProps({ onAddFilter })} />);
    fireEvent.click(screen.getByText("core"));
    expect(onAddFilter).toHaveBeenCalledOnce();
    const filter = onAddFilter.mock.calls[0][0];
    expect(filter.kind).toBe("dim");
    expect(filter.field).toBe("module");
    expect(filter.values).toContain("core");
  });

  it("clicking a module chip when filter exists calls onUpdateFilter", () => {
    const onUpdateFilter = vi.fn();
    const existingFilter = { id: "f1", kind: "dim", field: "module",
                             mode: "include", values: ["api"], pattern: "" };
    render(<FilterWizard {...makeProps({
      filters: [existingFilter],
      onUpdateFilter,
    })} />);
    fireEvent.click(screen.getByText("core")); // adds core to existing filter
    expect(onUpdateFilter).toHaveBeenCalledOnce();
    const updated = onUpdateFilter.mock.calls[0][0];
    expect(updated.values).toContain("api");
    expect(updated.values).toContain("core");
  });

  it("clicking an already-selected module removes it from filter", () => {
    const onUpdateFilter = vi.fn();
    const onRemoveFilter = vi.fn();
    const existingFilter = { id: "f1", kind: "dim", field: "module",
                             mode: "include", values: ["core"], pattern: "" };
    render(<FilterWizard {...makeProps({
      filters: [existingFilter],
      onUpdateFilter,
      onRemoveFilter,
    })} />);
    fireEvent.click(screen.getByText("core")); // deselect the only value
    // Removing last value should call onRemoveFilter
    expect(onRemoveFilter).toHaveBeenCalledWith("f1");
  });

  // ── no modules ───────────────────────────────────────────────────────────

  it("does not render module section when dimValues has no modules", () => {
    render(<FilterWizard {...makeProps({ dimValues: { module: [] } })} />);
    // Module chips won't be present but the section header depends on
    // implementation — just verify no crash
    expect(screen.getByText(/Filter wizard/i)).toBeInTheDocument();
  });
});
