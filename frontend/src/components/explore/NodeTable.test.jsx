import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NodeTable } from "./NodeTable.jsx";

// ── Mock api ───────────────────────────────────────────────────────────────────

vi.mock("../../api.js", () => ({
  api: {
    exploreNodes: vi.fn(),
  },
}));

import { api } from "../../api.js";

const SAMPLE_NODES = [
  {
    hash: "abc1",
    name: "do_work",
    module: "core",
    kind: "function",
    file_path: "core/work.py",
    line_start: 10,
    risk: "high",
    caller_count: 15,
    callee_count: 3,
    complexity: 7,
    utility_score: 0.821,
    pagerank: 0.0034,
    outbound_edges: [],
  },
  {
    hash: "abc2",
    name: "parse",
    module: "utils",
    kind: "function",
    file_path: "utils/parse.py",
    line_start: 5,
    risk: null,
    caller_count: 2,
    callee_count: 1,
    complexity: 2,
    utility_score: null,
    pagerank: null,
    outbound_edges: [{ name: "helper", module: "utils", call_count: 3 }],
  },
];

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.exploreNodes.mockResolvedValue({ nodes: SAMPLE_NODES, total: 2 });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("NodeTable", () => {
  it("shows loading state initially", () => {
    api.exploreNodes.mockReturnValue(new Promise(() => {})); // never resolves
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    expect(screen.getByText(/Loading nodes/)).toBeInTheDocument();
  });

  it("renders node rows after loading", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    expect(await screen.findByText("do_work")).toBeInTheDocument();
    expect(screen.getByText("parse")).toBeInTheDocument();
  });

  it("shows total count", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    expect(await screen.findByText(/Showing 2 of 2/)).toBeInTheDocument();
  });

  it("shows column headers", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText(/Module/)).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
  });

  it("renders module and kind for each node", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getAllByText("function").length).toBeGreaterThan(0);
  });

  it("renders risk badge for nodes that have risk", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("does NOT render enriched columns when hasEnriched=false", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.queryByText("utility")).not.toBeInTheDocument();
    expect(screen.queryByText("pagerank")).not.toBeInTheDocument();
  });

  it("renders enriched columns when hasEnriched=true", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={true} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText("utility")).toBeInTheDocument();
    expect(screen.getByText("pagerank")).toBeInTheDocument();
  });

  it("shows kind filter badge when kinds are filtered", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={["function"]} />, { wrapper });
    await screen.findByText(/function only/i);
  });

  it("renders file path and line number", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText(/core\/work\.py:10/)).toBeInTheDocument();
  });

  it("renders outbound edge pill for nodes with edges", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(screen.getByText(/helper/)).toBeInTheDocument();
  });

  it("calls api with repoId and default sort", async () => {
    render(<NodeTable repoId="testrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    expect(api.exploreNodes).toHaveBeenCalledWith("testrepo", "caller_count", "desc", 200, "");
  });

  it("clicking a sort header re-queries with that column", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    fireEvent.click(screen.getByText(/complexity/));
    expect(api.exploreNodes).toHaveBeenCalledWith("myrepo", "complexity", "desc", 200, "");
  });

  it("clicking the same sort header twice reverses direction", async () => {
    render(<NodeTable repoId="myrepo" hasEnriched={false} kinds={[]} />, { wrapper });
    await screen.findByText("do_work");
    fireEvent.click(screen.getByText(/callers/));
    // First click: already sorted by caller_count desc → flip to asc
    expect(api.exploreNodes).toHaveBeenCalledWith("myrepo", "caller_count", "asc", 200, "");
  });
});
