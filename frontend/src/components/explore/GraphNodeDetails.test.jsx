import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphNodeDetails } from "./GraphNodeDetails.jsx";

const MEASURES = [
  { special: "dead_ratio" },
  { field: "caller_count", agg: "avg" },
];

const TYPES = {
  dead_ratio:       "ratio",
  caller_count_avg: "float",
};

describe("GraphNodeDetails", () => {
  it("shows empty-state prompt when node is null", () => {
    render(<GraphNodeDetails node={null} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText(/Click a node/)).toBeInTheDocument();
  });

  it("renders the node name", () => {
    const node = { name: "my_function", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("my_function")).toBeInTheDocument();
  });

  it("splits module::name — shows just the function name", () => {
    const node = { name: "core::my_function", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("my_function")).toBeInTheDocument();
    expect(screen.getByText("core")).toBeInTheDocument();
  });

  it("handles deeply nested module::sub::name", () => {
    const node = { name: "core::sub::my_fn", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("sub::my_fn")).toBeInTheDocument();
    expect(screen.getByText("core")).toBeInTheDocument();
  });

  it("shows the group/community label when present", () => {
    const node = { name: "fn", group: "networking", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("networking")).toBeInTheDocument();
  });

  it("renders a row for each measure", () => {
    const node = { name: "fn", values: { dead_ratio: 0.3, caller_count_avg: 2.5 } };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
  });

  it("renders formatted ratio value", () => {
    const node = { name: "fn", values: { dead_ratio: 0.5 } };
    render(<GraphNodeDetails node={node} measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("renders '—' for null measure value", () => {
    const node = { name: "fn", values: { dead_ratio: null } };
    render(<GraphNodeDetails node={node} measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders formatted float value", () => {
    const node = { name: "fn", values: { caller_count_avg: 2.567 } };
    render(<GraphNodeDetails node={node} measures={[{ field: "caller_count", agg: "avg" }]} types={{ caller_count_avg: "float" }} />);
    expect(screen.getByText("2.567")).toBeInTheDocument();
  });

  it("shows agg label for non-special measures", () => {
    const node = { name: "fn", values: {} };
    render(<GraphNodeDetails node={node} measures={[{ field: "caller_count", agg: "max" }]} types={{}} />);
    expect(screen.getByText("max")).toBeInTheDocument();
  });

  it("does not show agg label for special measures", () => {
    const node = { name: "fn", values: {} };
    render(<GraphNodeDetails node={node} measures={[{ special: "dead_ratio" }]} types={{}} />);
    // The label "dead ratio" should be there, but no agg suffix
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.queryByText(/avg|max|min/)).not.toBeInTheDocument();
  });

  it("keeps showing the last node after node prop changes to null (sticky display)", () => {
    const node = { name: "fn_alpha", values: { dead_ratio: 0.1 } };
    const { rerender } = render(
      <GraphNodeDetails node={node} measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />
    );
    expect(screen.getByText("fn_alpha")).toBeInTheDocument();

    // Simulate mouse-out → node becomes null
    rerender(
      <GraphNodeDetails node={null} measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />
    );
    // Should still show the last node (sticky)
    expect(screen.getByText("fn_alpha")).toBeInTheDocument();
    // Empty-state prompt should NOT appear
    expect(screen.queryByText(/Click a node/)).not.toBeInTheDocument();
  });
});
