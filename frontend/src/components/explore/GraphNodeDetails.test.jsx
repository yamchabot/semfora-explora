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

  // ── Empty state ───────────────────────────────────────────────────────────

  it("shows empty-state prompt when node is null", () => {
    render(<GraphNodeDetails node={null} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText(/Click a node/)).toBeInTheDocument();
  });

  // ── Node name display ──────────────────────────────────────────────────────

  it("renders the leaf name for a plain (no ::) node name", () => {
    const node = { id: "my_function", name: "my_function", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("my_function")).toBeInTheDocument();
  });

  it("extracts only the last segment from a compound module::name id", () => {
    const node = { id: "core::my_function", name: "core::my_function", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    // Only the leaf segment shown as the name heading
    expect(screen.getByText("my_function")).toBeInTheDocument();
  });

  it("extracts only the deepest segment from a three-part id", () => {
    const node = { id: "core::sub::my_fn", name: "core::sub::my_fn", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("my_fn")).toBeInTheDocument();
  });

  // ── Dimension values (the new feature) ────────────────────────────────────

  // The leaf dim is shown as a subtle badge below the name heading.
  // Ancestor dims (groupPath) are shown in a table beneath that.
  // This avoids duplicating the leaf value (already prominent as the name).

  it("shows the leaf dim label as a badge in 1-dim mode (no ancestors)", () => {
    const node = { id: "fetch_resource", name: "fetch_resource", values: {}, groupPath: [] };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["symbol"]} />
    );
    // Name heading shows the value
    expect(screen.getByText("fetch_resource")).toBeInTheDocument();
    // Leaf dim label shown as subtle badge
    expect(screen.getByText("symbol")).toBeInTheDocument();
    // No ancestor table rows (single dim → no groupPath)
    expect(screen.queryByText("module")).not.toBeInTheDocument();
  });

  it("shows module ancestor and symbol badge for a 2-dim node", () => {
    const node = {
      id:        "fetch_resource",
      name:      "fetch_resource",
      groupPath: ["decorator"],
      group:     "decorator",
      values:    {},
    };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["module", "symbol"]} />
    );
    // Name heading = leaf value
    expect(screen.getByText("fetch_resource")).toBeInTheDocument();
    // Leaf dim badge
    expect(screen.getByText("symbol")).toBeInTheDocument();
    // Ancestor dims table
    expect(screen.getByText("module")).toBeInTheDocument();
    expect(screen.getByText("decorator")).toBeInTheDocument();
  });

  it("shows two ancestor rows for a 3-dim node (module / class / symbol)", () => {
    const node = {
      id:        "calculate_size",
      name:      "calculate_size",
      groupPath: ["composite", "Node"],
      group:     "composite",
      values:    {},
    };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["module", "class", "symbol"]} />
    );
    // Name heading
    expect(screen.getByText("calculate_size")).toBeInTheDocument();
    // Leaf dim badge
    expect(screen.getByText("symbol")).toBeInTheDocument();
    // Ancestor dim table — module and class rows
    expect(screen.getByText("module")).toBeInTheDocument();
    expect(screen.getByText("composite")).toBeInTheDocument();
    expect(screen.getByText("class")).toBeInTheDocument();
    expect(screen.getByText("Node")).toBeInTheDocument();
    // "calculate_size" appears only once (the name) — NOT repeated in dim table
    expect(screen.getAllByText("calculate_size").length).toBe(1);
  });

  it("strips '::' prefix from the leaf id and shows just the leaf segment", () => {
    const node = {
      id:        "composite::calculate_size",
      name:      "composite::calculate_size",
      groupPath: ["composite"],
      values:    {},
    };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["module", "symbol"]} />
    );
    // Only the stripped leaf name appears as the heading
    expect(screen.getByText("calculate_size")).toBeInTheDocument();
    // Ancestor table shows module value from groupPath
    expect(screen.getByText("composite")).toBeInTheDocument();
  });

  it("renders '—' for a missing groupPath entry", () => {
    const node = { id: "fn", name: "fn", values: {} };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["module", "symbol"]} />
    );
    // module value is missing → should show the em-dash placeholder
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("falls back to group label when no dims are provided (backward compat)", () => {
    const node = { name: "fn", group: "networking", values: {} };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("networking")).toBeInTheDocument();
  });

  it("does not show the group chip when dims prop is provided", () => {
    // With dims, we use the dims table instead of the group chip
    const node = {
      id: "fn", name: "fn",
      group: "networking",
      groupPath: ["networking"],
      values: {},
    };
    render(
      <GraphNodeDetails node={node} measures={[]} types={{}}
        dims={["module", "symbol"]} />
    );
    // "networking" appears as the ancestor dim value
    expect(screen.getByText("networking")).toBeInTheDocument();
  });

  // ── Measures ──────────────────────────────────────────────────────────────

  it("renders a row for each measure", () => {
    const node = { name: "fn", values: { dead_ratio: 0.3, caller_count_avg: 2.5 } };
    render(<GraphNodeDetails node={node} measures={MEASURES} types={TYPES} />);
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
  });

  it("renders formatted ratio value", () => {
    const node = { name: "fn", values: { dead_ratio: 0.5 } };
    render(<GraphNodeDetails node={node}
      measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("renders '—' for null measure value", () => {
    const node = { name: "fn", values: { dead_ratio: null } };
    render(<GraphNodeDetails node={node}
      measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders formatted float value", () => {
    const node = { name: "fn", values: { caller_count_avg: 2.567 } };
    render(<GraphNodeDetails node={node}
      measures={[{ field: "caller_count", agg: "avg" }]} types={{ caller_count_avg: "float" }} />);
    expect(screen.getByText("2.567")).toBeInTheDocument();
  });

  it("shows agg label for non-special measures", () => {
    const node = { name: "fn", values: {} };
    render(<GraphNodeDetails node={node}
      measures={[{ field: "caller_count", agg: "max" }]} types={{}} />);
    expect(screen.getByText("max")).toBeInTheDocument();
  });

  it("does not show agg label for special measures", () => {
    const node = { name: "fn", values: {} };
    render(<GraphNodeDetails node={node}
      measures={[{ special: "dead_ratio" }]} types={{}} />);
    expect(screen.getByText("dead ratio")).toBeInTheDocument();
    expect(screen.queryByText(/avg|max|min/)).not.toBeInTheDocument();
  });

  it("shows a divider between dims and measures when both are present", () => {
    const node = {
      id: "fn", name: "fn",
      groupPath: ["mymod"],
      values: { dead_ratio: 0.1 },
    };
    const { container } = render(
      <GraphNodeDetails node={node}
        measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }}
        dims={["module", "symbol"]} />
    );
    // The HR/divider element should be present when both sections render
    const divider = container.querySelector("[style*='border-top']");
    expect(divider).toBeInTheDocument();
  });

  // ── Sticky display ────────────────────────────────────────────────────────

  it("keeps showing the last node after node prop changes to null (sticky display)", () => {
    const node = { id: "fn_alpha", name: "fn_alpha", values: { dead_ratio: 0.1 } };
    const { rerender } = render(
      <GraphNodeDetails node={node}
        measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />
    );
    expect(screen.getByText("fn_alpha")).toBeInTheDocument();

    rerender(
      <GraphNodeDetails node={null}
        measures={[{ special: "dead_ratio" }]} types={{ dead_ratio: "ratio" }} />
    );
    // Should still show the last node (sticky)
    expect(screen.getByText("fn_alpha")).toBeInTheDocument();
    expect(screen.queryByText(/Click a node/)).not.toBeInTheDocument();
  });
});
