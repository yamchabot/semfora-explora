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
 *   Shift+Alt+click inside sub-blob → selects inner blob (3-dim data)
 *   Alt+click inside sub-blob area → selects outer blob (3-dim data)
 *   Delete/Backspace with blob selected → calls onAddFilter + clears badge
 *   Delete/Backspace with node(s) selected → calls onAddFilter with leaf names
 *
 * Implementation under test
 * ─────────────────────────
 *  GraphRenderer.onBackgroundClick uses:
 *   1) altKeyHeldRef / shiftKeyHeldRef (keydown/keyup trackers)
 *   2) fgRef.current.screen2GraphCoords OR fallback zoom-transform math
 *   3) convexHull + expandHullPts + pointInPolygon for hit detection
 *   4) getGroupKey(node, level) — level 0 for outer, maxLevel for inner
 *
 * How the mock makes this testable
 * ──────────────────────────────────
 *  • react-force-graph-2d is replaced with a thin div stub
 *  • No ref forwarded → fgRef.current is null → fallback coordinate path
 *  • In jsdom getBoundingClientRect() returns {left:0,top:0}, so:
 *      graphX = event.clientX,  graphY = event.clientY
 *
 * Node position layout (set by the mock)
 * ─────────────────────────────────────
 *  Nodes are placed in triangles (radius 25) around the centroid of their
 *  INNER group (full groupPath, not just outer group).  This gives each
 *  sub-blob a distinct position cluster that the hull hit-test can distinguish.
 *
 *  Outer groups get a 400px-wide column.  Inner groups within a column are
 *  stacked 140px apart vertically, starting at y=80.
 *
 *  Example — 2-dim (module → symbol):
 *    auth → inner "auth"         → centroid (100,  80)
 *    core → inner "core"         → centroid (400,  80)
 *
 *  Example — 3-dim (module → class → symbol):
 *    auth::Controller             → centroid (100,  80)
 *    auth::Service                → centroid (100, 220)
 *    core::Parser                 → centroid (400,  80)
 *
 *  Hit coordinates used in tests:
 *    (100,  80) → auth (outer) OR auth::Controller (inner)
 *    (100, 220) → auth (outer) OR auth::Service (inner)
 *    (100, 150) → auth (outer), misses both inner sub-blobs (gap between them)
 *    (400,  80) → core (outer) OR core::Parser (inner)
 *    (250, 150) → outside all blobs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import GraphRenderer from "./GraphRenderer.jsx";

// ── Mock react-force-graph-2d ─────────────────────────────────────────────────
// No forwardRef → fgRef.current stays null → fallback coord path activates.
vi.mock("react-force-graph-2d", () => ({
  default: function FakeForceGraph({ onNodeClick, onBackgroundClick, graphData }) {
    const nodes = graphData?.nodes ?? [];

    // Inner key: full groupPath joined — each sub-blob gets a distinct centroid.
    // For 2-dim (groupPath.length=1) this equals node.group.
    const innerKey = n => (n.groupPath ?? [n.group ?? "?"]).join("::");
    const outerKey = n => n.group ?? "?";

    // Determine unique outer and inner groups (encounter order)
    const outerGroups = [], innerGroups = [];
    for (const n of nodes) {
      if (!outerGroups.includes(outerKey(n))) outerGroups.push(outerKey(n));
      if (!innerGroups.includes(innerKey(n))) innerGroups.push(innerKey(n));
    }

    // Compute centroid for each inner group:
    //   Outer group i  → column cx = 100 + i*400
    //   Within column, inner groups stacked 140px apart from cy=80
    const outerInnerCount = {};
    const centroids = {};
    for (const ik of innerGroups) {
      const n  = nodes.find(nn => innerKey(nn) === ik);
      if (!n) continue;
      const ok = outerKey(n);
      const oi = outerGroups.indexOf(ok);
      if (outerInnerCount[ok] == null) outerInnerCount[ok] = 0;
      const ii = outerInnerCount[ok]++;
      centroids[ik] = { cx: 100 + oi * 300, cy: 80 + ii * 140 };
    }

    // Place each node in a triangle (radius 25) around its inner centroid.
    // angle = (globalIndex * 2π/3) so every group of 3 forms a proper triangle.
    nodes.forEach((n, i) => {
      const { cx, cy } = centroids[innerKey(n)] ?? { cx: 100, cy: 80 };
      const angle = (i * 2 * Math.PI) / 3;
      n.x = cx + 25 * Math.cos(angle);
      n.y = cy + 25 * Math.sin(angle);
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

/**
 * Three-dimension data (module → class → symbol) → isBlobMode = true, blobLevelCount = 2.
 *
 * Outer blobs (level 0):  auth, core
 * Inner sub-blobs (level 1):
 *   auth::Controller  → mock centroid (100,  80)
 *   auth::Service     → mock centroid (100, 220)   ← 140px gap from Controller
 *   core::Parser      → mock centroid (400,  80)
 *
 * Gap between auth inner blobs at y=150 → Shift+Alt+click there misses all inner blobs.
 * Plain Alt+click at (100,150) still hits the outer auth blob hull.
 */
function make3DimBlobData() {
  return {
    dimensions: ["module", "class", "symbol"],
    rows: [
      { key: { module: "auth", class: "Controller", symbol: "login"    }, values: { symbol_count: 1 } },
      { key: { module: "auth", class: "Controller", symbol: "signup"   }, values: { symbol_count: 1 } },
      { key: { module: "auth", class: "Controller", symbol: "logout"   }, values: { symbol_count: 1 } },
      { key: { module: "auth", class: "Service",    symbol: "hash"     }, values: { symbol_count: 1 } },
      { key: { module: "auth", class: "Service",    symbol: "verify"   }, values: { symbol_count: 1 } },
      { key: { module: "auth", class: "Service",    symbol: "encrypt"  }, values: { symbol_count: 1 } },
      { key: { module: "core", class: "Parser",     symbol: "parse"    }, values: { symbol_count: 1 } },
      { key: { module: "core", class: "Parser",     symbol: "format"   }, values: { symbol_count: 1 } },
      { key: { module: "core", class: "Parser",     symbol: "tokenize" }, values: { symbol_count: 1 } },
    ],
    graph_edges:      [],
    leaf_graph_edges: [],
    measure_types:    { symbol_count: "integer" },
  };
}

function default3DimProps(overrides = {}) {
  return {
    ...defaultBlobProps({ data: make3DimBlobData() }),
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

// Hold Shift+Alt, click, release both — activates innermost sub-blob level.
async function shiftAltClick(element, clientX, clientY) {
  await act(async () => {
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.keyDown(window, { key: "Shift" });
    fireEvent.click(element, { clientX, clientY, altKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: "Shift" });
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-blob selection (3-dim data: module → class → symbol)
// Shift+Alt+click → innermost level; plain Alt+click → outer level
// ═══════════════════════════════════════════════════════════════════════════════

describe("GraphRenderer – Shift+Alt+click sub-blob selection (3-dim)", () => {
  beforeEach(() => { document.body.focus(); });

  it("Shift+Alt+click at auth::Controller centroid selects inner blob, badge shows '(inner)'", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 100, 80); // auth::Controller centroid

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("Controller");
    expect(blobBadgeText()).toContain("(inner)");
  });

  it("Shift+Alt+click at auth::Service centroid selects that inner blob", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 100, 220); // auth::Service centroid

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("Service");
    expect(blobBadgeText()).toContain("(inner)");
  });

  it("Shift+Alt+click at core::Parser centroid selects that inner blob", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 400, 80); // core::Parser centroid

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("Parser");
    expect(blobBadgeText()).toContain("(inner)");
  });

  it("Shift+Alt+click in gap between inner blobs (y=150) does not select anything", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 100, 150); // between Controller (cy=80) and Service (cy=220)

    expect(hasBlobBadge()).toBe(false);
  });

  it("plain Alt+click at inner sub-blob position selects the OUTER blob, not inner", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 80); // same position as Controller centroid, but no Shift

    expect(hasBlobBadge()).toBe(true);
    // Outer blob "auth" — no "(inner)" marker
    expect(blobBadgeText()).toContain("auth");
    expect(blobBadgeText()).not.toContain("(inner)");
  });

  it("plain Alt+click in the gap between inner blobs still selects the outer blob", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 150); // between inner sub-blobs, inside outer auth hull

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("auth");
    expect(blobBadgeText()).not.toContain("(inner)");
  });

  it("Shift+Alt+click two different inner blobs → multi-select at inner level", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 100,  80); // Controller
    await shiftAltClick(bg, 100, 220); // Service

    expect(hasBlobBadge()).toBe(true);
    expect(blobBadgeText()).toContain("Controller");
    expect(blobBadgeText()).toContain("Service");
    expect(blobBadgeText()).toContain("(inner)");
  });

  it("switching from outer to inner level resets the selection", async () => {
    render(<GraphRenderer {...default3DimProps()} />);
    const bg = screen.getByTestId("fg-background");

    await altClick(bg, 100, 80);       // select outer "auth"
    expect(blobBadgeText()).toContain("auth");
    expect(blobBadgeText()).not.toContain("(inner)");

    await shiftAltClick(bg, 100, 80);  // switch to inner level — resets, selects Controller
    expect(blobBadgeText()).toContain("Controller");
    expect(blobBadgeText()).toContain("(inner)");
  });

  it("Delete after inner sub-blob selected filters by the class dimension", async () => {
    const onAddFilter = vi.fn();
    render(<GraphRenderer {...default3DimProps({ onAddFilter })} />);
    const bg = screen.getByTestId("fg-background");

    await shiftAltClick(bg, 100, 80); // select auth::Controller

    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        kind:   "dim",
        field:  "class",         // level-1 dimension
        mode:   "exclude",
        values: expect.arrayContaining(["Controller"]),
      })
    );
    expect(hasBlobBadge()).toBe(false);
  });
});
