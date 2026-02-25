import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatternPanel } from "./PatternPanel.jsx";

// ── mock api ──────────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  api: { patterns: vi.fn() },
}));
import { api } from "../../api.js";

// The component destructures data.patterns, data.total_pattern_types, etc.
const MOCK_RESPONSE = {
  total_pattern_types: 2,
  total_instances:     3,
  patterns: [
    {
      pattern:      "singleton",
      display_name: "Singleton",
      count:        2,
      instances: [
        {
          nodes:       ["hash_a", "hash_b"],
          node_labels: ["mod.get_instance", "mod.create"],
          description: "get_instance is called by 5 callers",
          confidence:  0.75,
        },
        {
          nodes:       ["hash_c"],
          node_labels: ["mod.get_config"],
          description: "get_config is called by 4 callers",
          confidence:  0.63,
        },
      ],
    },
    {
      pattern:      "observer",
      display_name: "Observer / Event Bus",
      count:        1,
      instances: [
        {
          nodes:       ["hash_d", "hash_e", "hash_f"],
          node_labels: ["events.publish", "handlers.on_a", "handlers.on_b"],
          description: "publish fans out to 6 handlers",
          confidence:  0.80,
        },
      ],
    },
  ],
};

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("PatternPanel", () => {

  beforeEach(() => vi.clearAllMocks());

  // ── loading / error / empty ────────────────────────────────────────────────

  it("shows 'Detecting…' while fetching", () => {
    api.patterns.mockReturnValue(new Promise(() => {})); // never resolves
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    expect(screen.getByText(/Detecting/)).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    api.patterns.mockRejectedValue(new Error("network error"));
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() =>
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    );
  });

  it("shows 'no patterns detected' when result is empty", async () => {
    api.patterns.mockResolvedValue({ patterns: [], total_pattern_types: 0, total_instances: 0 });
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() =>
      expect(screen.getByText(/No patterns detected/)).toBeInTheDocument()
    );
  });

  // ── rendering pattern list ─────────────────────────────────────────────────

  it("renders pattern display names", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => {
      expect(screen.getByText("Singleton")).toBeInTheDocument();
      expect(screen.getByText("Observer / Event Bus")).toBeInTheDocument();
    });
  });

  it("shows instance count badges", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    // count=2 for Singleton, count=1 for Observer
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows summary line with totals", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    expect(screen.getByText(/2 types/)).toBeInTheDocument();
    expect(screen.getByText(/3 instances/)).toBeInTheDocument();
  });

  // ── expand / collapse ──────────────────────────────────────────────────────

  it("instances hidden by default", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    expect(screen.queryByText("get_instance is called by 5 callers")).not.toBeInTheDocument();
  });

  it("clicking pattern row expands its instances", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    fireEvent.click(screen.getByText("Singleton"));
    await waitFor(() =>
      expect(screen.getByText("get_instance is called by 5 callers")).toBeInTheDocument()
    );
  });

  it("clicking expanded row again collapses it", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    fireEvent.click(screen.getByText("Singleton")); // expand
    await waitFor(() => screen.getByText("get_instance is called by 5 callers"));
    fireEvent.click(screen.getByText("Singleton")); // collapse
    await waitFor(() =>
      expect(screen.queryByText("get_instance is called by 5 callers")).not.toBeInTheDocument()
    );
  });

  it("expanding a second pattern collapses the first", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));

    fireEvent.click(screen.getByText("Singleton"));
    await waitFor(() => screen.getByText("get_instance is called by 5 callers"));

    fireEvent.click(screen.getByText("Observer / Event Bus"));
    await waitFor(() => screen.getByText("publish fans out to 6 handlers"));
    expect(screen.queryByText("get_instance is called by 5 callers")).not.toBeInTheDocument();
  });

  // ── confidence display ─────────────────────────────────────────────────────

  it("shows confidence percentage per instance", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    fireEvent.click(screen.getByText("Singleton"));
    await waitFor(() => screen.getByText("get_instance is called by 5 callers"));
    // Instance with confidence=0.75 renders "conf 75%"
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  // ── confidence slider ──────────────────────────────────────────────────────

  it("renders a range slider", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("slider label shows default 60% threshold", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    expect(screen.getByText(/60%/)).toBeInTheDocument();
  });

  // ── highlight callback ─────────────────────────────────────────────────────

  it("clicking an instance fires onHighlight with patternKey and overrides", async () => {
    const onHighlight = vi.fn();
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={onHighlight} activePatternKey={null} />);
    await waitFor(() => screen.getByText("Singleton"));
    fireEvent.click(screen.getByText("Singleton"));
    await waitFor(() => screen.getByText("get_instance is called by 5 callers"));
    fireEvent.click(screen.getByText("get_instance is called by 5 callers"));

    expect(onHighlight).toHaveBeenCalledOnce();
    const [patternKey, overrides] = onHighlight.mock.calls[0];
    expect(patternKey).toBe("singleton");
    // overrides is an object mapping nodeId forms → color
    expect(typeof overrides).toBe("object");
  });

  it("'✕ clear' button appears when activePatternKey is set", async () => {
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={vi.fn()} activePatternKey="singleton" />);
    await waitFor(() => screen.getByText("Singleton"));
    expect(screen.getByText(/clear/i)).toBeInTheDocument();
  });

  it("clicking clear fires onHighlight with null", async () => {
    const onHighlight = vi.fn();
    api.patterns.mockResolvedValue(MOCK_RESPONSE);
    wrap(<PatternPanel repoId="r1" onHighlight={onHighlight} activePatternKey="singleton" />);
    await waitFor(() => screen.getByText("Singleton"));
    fireEvent.click(screen.getByText(/clear/i));
    expect(onHighlight).toHaveBeenCalledWith(null, {}, null, null);
  });

  // ── api call ──────────────────────────────────────────────────────────────

  it("calls api.patterns with repoId and default min_confidence", async () => {
    api.patterns.mockResolvedValue({ patterns: [], total_pattern_types: 0, total_instances: 0 });
    wrap(<PatternPanel repoId="test_repo" onHighlight={vi.fn()} activePatternKey={null} />);
    await waitFor(() => expect(api.patterns).toHaveBeenCalledWith("test_repo", 0.60));
  });
});
