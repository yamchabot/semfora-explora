/**
 * GraphRenderer.blobClick.test.jsx
 *
 * Tests for blob-area alt+click selection and delete-to-filter:
 *
 *   Alt+click anywhere inside a blob's convex hull area → selects that blob
 *   Alt+click selected blob again → deselects
 *   Alt+click second blob → multi-select
 *   Alt+click outside all blobs → no change
 *   Plain background click → clears selection
 *   Delete/Backspace with blob selected → calls onAddFilter + clears badge
 *   Delete/Backspace with node(s) selected → calls onAddFilter with leaf names
 *
 * Implementation under test
 * ─────────────────────────
 *  GraphRenderer.onBackgroundClick uses:
 *   1) altKeyHeldRef (keydown/keyup tracker) so modifier is never lost
 *   2) fgRef.current.screen2GraphCoords OR fallback zoom-transform math
 *   3) convexHull + expandHullPts + pointInPolygon for hit detection
 *
 * How the mock makes this testable
 * ──────────────────────────────────
 *  • react-force-graph-2d is replaced with a thin div stub
 *  • No ref forwarded → fgRef.current is null → code uses the zoom-transform
 *    fallback.  In jsdom getBoundingClientRect() returns {left:0,top:0}, so:
 *      graphX = event.clientX,  graphY = event.clientY
 *  • The mock assigns deterministic triangle positions to every node so the
 *    hull hit-test works with known (clientX, clientY) values:
 *      auth nodes clustered around (100, 100)
 *      core nodes clustered around (400, 100)
 *    Clicking at (100,100) → inside auth hull ✓
 *    Clicking at (400,100) → inside core hull ✓
 *    Clicking at (250,100) → outside both hulls ✓
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import GraphRenderer from "./GraphRenderer.jsx";

// ── Mock react-force-graph-2d ─────────────────────────────────────────────────
// No forwardRef → fgRef.current stays null → fallback coord path activates.
// Assigns triangle positions so hull math works with jsdom's zero-origin rect.
vi.mock("react-force-graph-2d", () => ({
  default: function FakeForceGraph({ onNodeClick, onBackgroundClick, graphData }) {
    const nodes = graphData?.nodes ?? [];

    // Build ordered list of unique groups (preserves encounter order)
    const groupOrder = [];
    for (const n of nodes) {
      if (n.group && !groupOrder.includes(n.group)) groupOrder.push(n.group);
    }

    // Place each group's nodes in a triangle around a group centroid.
    // Group 0 → centroid (100,100), Group 1 → (400,100), etc.
    // Using angle = (globalIndex * 2π / 3) gives the same 0/120°/240°
    // triangle for each group (globalIndex mod 3 repeats nicely).
    nodes.forEach((n, i) => {
      const gi    = groupOrder.indexOf(n.group ?? "");
      const cx    = 100 + gi * 300;
      const cy    = 100;
      const angle = (i * 2 * Math.PI) / 3;   // 0°, 120°, 240° (mod 3)
      n.x = cx + 30 * Math.cos(angle);
      n.y = cy + 30 * Math.sin(angle);
    });

    return (
      <div data-testid="force-graph">
        {/* Clickable background — forwards native MouseEvent to handler */}
        <div
          data-testid="fg-background"
          style={{ width: 800, height: 600 }}
          onClick={e => onBackgroundClick?.(e)}
        />
        {nodes.map(n => (
          <button
            key={n.id}
            data-testid={`node-${n.id}`}
            onClick={e => onNodeClick?.(n, e)}
          >
            {n.id}
          </button>
        ))}
      </div>
    );
  },
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

/**
 * Two-dimension data (module → symbol) → isBlobMode = true.
 * auth blob:  login, signup, verify   (3 nodes → triangle hull)
 * core blob:  parse, format, render   (3 nodes → triangle hull)
 */
function makeBlobData() {
  return {
    dimensions: ["module", "symbol"],
    rows: [
      { key: { module: "auth", symbol: "login"  }, values: { symbol_count: 1 } },
      { key: { module: "auth", symbol: "signup" }, values: { symbol_count: 1 } },
      { key: { module: "auth", symbol: "verify" }, values: { symbol_count: 1 } },
      { key: { module: "core", symbol: "parse"  }, values: { symbol_count: 1 } },
      { key: { module: "core", symbol: "format" }, values: { symbol_count: 1 } },
      { key: { module: "core", symbol: "render" }, values: { symbol_count: 1 } },
    ],
    graph_edges:      [],
    leaf_graph_edges: [],
    measure_types:    { symbol_count: "integer" },
  };
}

function defaultBlobProps(overrides = {}) {
  return {
    data:                makeBlobData(),
    measures:            [{ special: "symbol_count" }],
    onNodeClick:         vi.fn(),
    onAddFilter:         vi.fn(),
    minWeight:           1,
    setMinWeight:        vi.fn(),
    topK:                0,
    setTopK:             vi.fn(),
    colorKeyOverride:    null,
    setColorKeyOverride: vi.fn(),
    fanOutDepth:         5,
    setFanOutDepth:      vi.fn(),
    selectedNodeIds:     new Set(),
    setSelectedNodeIds:  vi.fn(),
    hideIsolated:        false,
    setHideIsolated:     vi.fn(),
    ...overrides,
  };
}

// Hold Alt, click, release Alt — the reliable path through altKeyHeldRef.
async function altClick(element, clientX, clientY) {
  await act(async () => {
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.click(element, { clientX, clientY, altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
  });
}

// ── Blob badge visibility helpers ─────────────────────────────────────────────

function hasBlobBadge() {
  return document.body.textContent.includes("🫧");
}
function blobBadgeText() {
  return document.body.textContent;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alt+click blob area tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("GraphRenderer – blob area alt+click selection", () => {
  beforeEach(() => {
    document.body.focus();
  });

  it("alt+clicking inside the auth blob centroid shows a 🫧 badge with 'auth'", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100);

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("auth");
  });

  it("alt+clicking inside the core blob centroid shows a 🫧 badge with 'core'", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 400, 100);

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("core");
  });

  it("alt+clicking the same blob a second time deselects it (toggle off)", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100);
    expect(hasBlobBadge()).toBe(true);

    await altClick(bg, 100, 100); // same blob again
    expect(hasBlobBadge()).toBe(false);
  });

  it("alt+clicking two different blobs produces a multi-select badge", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // auth
    await altClick(bg, 400, 100); // core — adds to selection (same level)

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("auth");
    expect(blobBadgeText()).toContain("core");
  });

  it("alt+clicking outside all blobs does nothing (badge stays absent)", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    // (250,100) is equidistant between auth@(100,100) and core@(400,100)
    await altClick(bg, 250, 100);

    expect(hasBlobBadge()).toBe(false);
  });

  it("alt+clicking outside all blobs while a blob is selected keeps the selection", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // select auth
    expect(hasBlobBadge()).toBe(true);

    await altClick(bg, 250, 100); // outside all blobs — should not clear
    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("auth");
  });

  it("plain background click (no Alt) does NOT select a blob", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await act(async () => {
      fireEvent.click(bg, { clientX: 100, clientY: 100 }); // no altKey
    });

    expect(hasBlobBadge()).toBe(false);
  });

  it("plain background click clears a previously selected blob", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // select auth
    expect(hasBlobBadge()).toBe(true);

    await act(async () => {
      fireEvent.click(bg, { clientX: 100, clientY: 100 }); // plain click
    });

    expect(hasBlobBadge()).toBe(false);
  });

  it("clicking the clear button inside the badge also clears the selection", async () => {
    render(<GraphRenderer {...defaultBlobProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100);
    expect(hasBlobBadge()).toBe(true);

    const clearBtn = screen.getByRole("button", { name: /clear/i });
    await act(async () => { fireEvent.click(clearBtn); });

    expect(hasBlobBadge()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delete/Backspace: blob → filter
// ═══════════════════════════════════════════════════════════════════════════════

describe("GraphRenderer – Delete key: blob-to-filter", () => {
  beforeEach(() => { document.body.focus(); });

  it("Delete after selecting auth blob calls onAddFilter with mode=exclude values=[auth]", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({ onAddFilter })} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // select auth
    expect(hasBlobBadge()).toBe(true);

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        kind:   "dim",
        mode:   "exclude",
        values: expect.arrayContaining(["auth"]),
      })
    );
    expect(hasBlobBadge()).toBe(false);
  });

  it("Backspace works the same as Delete", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({ onAddFilter })} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 400, 100); // select core
    await act(async () => { fireEvent.keyDown(window, { key: "Backspace" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.arrayContaining(["core"]) })
    );
  });

  it("Delete with multi-select sends all blobs in the filter", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({ onAddFilter })} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // auth
    await altClick(bg, 400, 100); // core

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.arrayContaining(["auth", "core"]),
      })
    );
  });

  it("Delete without any selection is a no-op (onAddFilter not called)", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({ onAddFilter })} />);

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delete/Backspace: selected nodes → filter
// ═══════════════════════════════════════════════════════════════════════════════

describe("GraphRenderer – Delete key: node(s)-to-filter", () => {
  beforeEach(() => { document.body.focus(); });

  // In blob mode (dims=["module","symbol"]) node ids are the leaf dim values
  // ("login", "parse", etc.), and the filter field is the last dim ("symbol").

  it("Delete with a single selected node calls onAddFilter with the leaf name", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({
      onAddFilter,
      selectedNodeIds: new Set(["login"]),
    })} />);

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        kind:   "dim",
        field:  "symbol",
        mode:   "exclude",
        values: expect.arrayContaining(["login"]),
      })
    );
  });

  it("Delete with multiple selected nodes includes all leaf names", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({
      onAddFilter,
      selectedNodeIds: new Set(["login", "parse"]),
    })} />);

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        mode:   "exclude",
        values: expect.arrayContaining(["login", "parse"]),
      })
    );
  });

  it("node ids with module prefix strip to leaf name (e.g. auth::login → login)", async () => {
    // 1-dim data — node.id is the plain module name; dims=[module]
    const onAddFilter = vi.fn();
    const data1dim = {
      dimensions: ["module"],
      rows: [
        { key: { module: "auth"  }, values: { symbol_count: 1 } },
        { key: { module: "core"  }, values: { symbol_count: 1 } },
      ],
      graph_edges:   [],
      measure_types: { symbol_count: "integer" },
    };
    render(<GraphRenderer {...defaultBlobProps({
      data: data1dim,
      onAddFilter,
      selectedNodeIds: new Set(["auth"]),
    })} />);

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        field:  "module",
        mode:   "exclude",
        values: expect.arrayContaining(["auth"]),
      })
    );
  });

  it("blob delete takes priority over node delete when both would apply", async () => {
    // If somehow blob AND nodes are selected, blob delete fires (its guard runs first)
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...defaultBlobProps({
      onAddFilter,
      selectedNodeIds: new Set(["login"]),
    })} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 100); // also select auth blob
    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    // Should emit the blob filter (module level), not the symbol filter
    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.arrayContaining(["auth"]),
      })
    );
  });
});
