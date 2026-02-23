import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatioCell, MeasureChip, AddMeasureMenu } from "./MeasureControls.jsx";

// ── RatioCell ──────────────────────────────────────────────────────────────────

describe("RatioCell", () => {
  it("renders a dash for null", () => {
    render(<RatioCell value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders percentage for 0", () => {
    render(<RatioCell value={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders 60% for value 0.6", () => {
    render(<RatioCell value={0.6} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("renders 35% for value 0.35", () => {
    render(<RatioCell value={0.35} />);
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("renders 100% for value 1", () => {
    render(<RatioCell value={1} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders a bar element alongside the percentage", () => {
    const { container } = render(<RatioCell value={0.5} />);
    expect(container.querySelector(".bar-bg")).toBeInTheDocument();
    expect(container.querySelector(".bar-fill")).toBeInTheDocument();
  });
});

// ── MeasureChip ────────────────────────────────────────────────────────────────

describe("MeasureChip", () => {
  const fieldMeasure   = { field: "caller_count", agg: "avg" };
  const specialMeasure = { special: "dead_ratio" };

  it("renders the measure label", () => {
    render(<MeasureChip m={fieldMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    expect(screen.getByText("callers")).toBeInTheDocument();
  });

  it("renders the label for a special measure", () => {
    render(<MeasureChip m={specialMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
  });

  it("shows the agg button for field measures", () => {
    render(<MeasureChip m={fieldMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    expect(screen.getByText(/avg/)).toBeInTheDocument();
  });

  it("does NOT show an agg button for special measures", () => {
    render(<MeasureChip m={specialMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    // Should not find avg / min / max text as a button
    expect(screen.queryByText(/avg ▾/)).not.toBeInTheDocument();
  });

  it("calls onRemove when × is clicked", () => {
    const onRemove = vi.fn();
    render(<MeasureChip m={fieldMeasure} onRemove={onRemove} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("opens agg dropdown when agg button is clicked", () => {
    render(<MeasureChip m={fieldMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    fireEvent.click(screen.getByText(/avg ▾/));
    // Should now show all agg options
    expect(screen.getByText("min")).toBeInTheDocument();
    expect(screen.getByText("max")).toBeInTheDocument();
    expect(screen.getByText("stddev")).toBeInTheDocument();
  });

  it("calls onChangeAgg with the selected agg", () => {
    const onChangeAgg = vi.fn();
    render(<MeasureChip m={fieldMeasure} onRemove={vi.fn()} onChangeAgg={onChangeAgg} dragHandleProps={{}} />);
    fireEvent.click(screen.getByText(/avg ▾/));
    fireEvent.click(screen.getByText("max"));
    expect(onChangeAgg).toHaveBeenCalledWith("max");
  });

  it("renders the drag handle", () => {
    const { container } = render(<MeasureChip m={fieldMeasure} onRemove={vi.fn()} onChangeAgg={vi.fn()} dragHandleProps={{}} />);
    expect(container.textContent).toContain("⠿");
  });
});

// ── AddMeasureMenu ─────────────────────────────────────────────────────────────

describe("AddMeasureMenu", () => {
  it("renders the trigger button", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={false} />);
    expect(screen.getByText(/Add measure/)).toBeInTheDocument();
  });

  it("menu is closed by default", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={false} />);
    expect(screen.queryByText("Specials")).not.toBeInTheDocument();
  });

  it("opens menu on button click", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={false} />);
    fireEvent.click(screen.getByText(/Add measure/));
    expect(screen.getByText("Specials")).toBeInTheDocument();
  });

  it("shows special measure options when open", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={false} />);
    fireEvent.click(screen.getByText(/Add measure/));
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.getByText("symbol count")).toBeInTheDocument();
  });

  it("shows field options when open", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={false} />);
    fireEvent.click(screen.getByText(/Add measure/));
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("complexity")).toBeInTheDocument();
  });

  it("calls onAdd with special measure descriptor", () => {
    const onAdd = vi.fn();
    render(<AddMeasureMenu onAdd={onAdd} hasEnriched={false} />);
    fireEvent.click(screen.getByText(/Add measure/));
    fireEvent.click(screen.getByText("dead ratio"));
    expect(onAdd).toHaveBeenCalledWith({ special: "dead_ratio" });
  });

  it("calls onAdd with field measure descriptor (avg default)", () => {
    const onAdd = vi.fn();
    render(<AddMeasureMenu onAdd={onAdd} hasEnriched={false} />);
    fireEvent.click(screen.getByText(/Add measure/));
    fireEvent.click(screen.getByText("callers"));
    expect(onAdd).toHaveBeenCalledWith({ field: "caller_count", agg: "avg" });
  });

  it("enriched fields show ✦ mark", () => {
    render(<AddMeasureMenu onAdd={vi.fn()} hasEnriched={true} />);
    fireEvent.click(screen.getByText(/Add measure/));
    // pagerank is enriched → should have ✦
    const enrichedItems = screen.getAllByText("✦");
    expect(enrichedItems.length).toBeGreaterThan(0);
  });
});
