import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KindFilter } from "./KindFilter.jsx";

const KINDS = ["function", "method", "class"];

describe("KindFilter", () => {
  it("renders all kind buttons", () => {
    render(<KindFilter availableKinds={KINDS} kinds={[]} onChange={vi.fn()} />);
    expect(screen.getByText("function")).toBeInTheDocument();
    expect(screen.getByText("method")).toBeInTheDocument();
    expect(screen.getByText("class")).toBeInTheDocument();
  });

  it("renders the 'all' button", () => {
    render(<KindFilter availableKinds={KINDS} kinds={[]} onChange={vi.fn()} />);
    expect(screen.getByText("all")).toBeInTheDocument();
  });

  it("clicking 'all' calls onChange with empty array", () => {
    const onChange = vi.fn();
    render(<KindFilter availableKinds={KINDS} kinds={["function"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("all"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("when kinds=[], clicking a kind deselects it (all others remain)", () => {
    const onChange = vi.fn();
    render(<KindFilter availableKinds={KINDS} kinds={[]} onChange={onChange} />);
    // kinds=[] means ALL active; clicking "function" should select all EXCEPT "function"
    fireEvent.click(screen.getByText("function"));
    expect(onChange).toHaveBeenCalledWith(["method", "class"]);
  });

  it("when a kind is active in a subset, clicking it removes it", () => {
    const onChange = vi.fn();
    render(<KindFilter availableKinds={KINDS} kinds={["function", "method"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("function"));
    expect(onChange).toHaveBeenCalledWith(["method"]);
  });

  it("when only one kind is active and you deselect it, falls back to all (empty)", () => {
    const onChange = vi.fn();
    render(<KindFilter availableKinds={KINDS} kinds={["function"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("function"));
    // Removing last selection → resets to [] (all)
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clicking an inactive kind adds it to the selection", () => {
    const onChange = vi.fn();
    render(<KindFilter availableKinds={KINDS} kinds={["function"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("class"));
    expect(onChange).toHaveBeenCalledWith(["function", "class"]);
  });

  it("when adding a kind completes the set, collapses back to all (empty)", () => {
    const onChange = vi.fn();
    // All except "class" are active — adding "class" = full set = reset to []
    render(<KindFilter availableKinds={KINDS} kinds={["function", "method"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("class"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders with no available kinds without crashing", () => {
    expect(() =>
      render(<KindFilter availableKinds={[]} kinds={[]} onChange={vi.fn()} />)
    ).not.toThrow();
  });

  it("renders the kind filter label", () => {
    render(<KindFilter availableKinds={KINDS} kinds={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/kind filter/i)).toBeInTheDocument();
  });
});
