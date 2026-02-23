import { describe, it, expect } from "vitest";
import { matchExpr, applyFilters, filterEdgesToNodes } from "./filterUtils.js";

// ── matchExpr ─────────────────────────────────────────────────────────────────

describe("matchExpr — pass-through cases", () => {
  it("empty expr → true", ()    => expect(matchExpr(42,   "")).toBe(true));
  it("whitespace expr → true", () => expect(matchExpr(42, "  ")).toBe(true));
  it("null val → true",  ()     => expect(matchExpr(null, "> 0")).toBe(true));
  it("undefined val → true", () => expect(matchExpr(undefined, "> 0")).toBe(true));
  it("unknown syntax → true", () => expect(matchExpr(10, "between 5 and 15")).toBe(true));
});

describe("matchExpr — greater than", () => {
  it("> 0 passes positive", ()  => expect(matchExpr(1,   "> 0")).toBe(true));
  it("> 0 fails zero", ()       => expect(matchExpr(0,   "> 0")).toBe(false));
  it("> 0 fails negative", ()   => expect(matchExpr(-1,  "> 0")).toBe(false));
  it("> 10 passes 11", ()       => expect(matchExpr(11,  "> 10")).toBe(true));
  it("> 10 fails 10", ()        => expect(matchExpr(10,  "> 10")).toBe(false));
  it("> 0.5 passes 0.6", ()     => expect(matchExpr(0.6, "> 0.5")).toBe(true));
  it("> 0.5 fails 0.4", ()      => expect(matchExpr(0.4, "> 0.5")).toBe(false));
});

describe("matchExpr — greater than or equal", () => {
  it(">= 10 passes 10", ()  => expect(matchExpr(10, ">= 10")).toBe(true));
  it(">= 10 passes 11", ()  => expect(matchExpr(11, ">= 10")).toBe(true));
  it(">= 10 fails 9", ()    => expect(matchExpr(9,  ">= 10")).toBe(false));
});

describe("matchExpr — less than", () => {
  it("< 10 passes 9", ()    => expect(matchExpr(9,  "< 10")).toBe(true));
  it("< 10 fails 10", ()    => expect(matchExpr(10, "< 10")).toBe(false));
  it("< 10 fails 11", ()    => expect(matchExpr(11, "< 10")).toBe(false));
  it("< 0.5 passes 0.3", () => expect(matchExpr(0.3, "< 0.5")).toBe(true));
});

describe("matchExpr — less than or equal", () => {
  it("<= 10 passes 10", ()  => expect(matchExpr(10, "<= 10")).toBe(true));
  it("<= 10 passes 9", ()   => expect(matchExpr(9,  "<= 10")).toBe(true));
  it("<= 10 fails 11", ()   => expect(matchExpr(11, "<= 10")).toBe(false));
});

describe("matchExpr — equality", () => {
  it("= 5 passes 5",   ()   => expect(matchExpr(5,   "= 5")).toBe(true));
  it("= 5 fails 6",    ()   => expect(matchExpr(6,   "= 5")).toBe(false));
  it("== 5 passes 5",  ()   => expect(matchExpr(5,   "== 5")).toBe(true));
  it("== 5 fails 5.1", ()   => expect(matchExpr(5.1, "== 5")).toBe(false));
});

describe("matchExpr — not equal", () => {
  it("!= 0 fails 0",   ()  => expect(matchExpr(0,  "!= 0")).toBe(false));
  it("!= 0 passes 1",  ()  => expect(matchExpr(1,  "!= 0")).toBe(true));
  it("!= 0 passes -1", ()  => expect(matchExpr(-1, "!= 0")).toBe(true));
  it("! 0 fails 0",    ()  => expect(matchExpr(0,  "! 0")).toBe(false));
  it("! 0 passes 1",   ()  => expect(matchExpr(1,  "! 0")).toBe(true));
});

describe("matchExpr — inclusive range N..M", () => {
  it("10..50 passes 10",  () => expect(matchExpr(10, "10..50")).toBe(true));
  it("10..50 passes 30",  () => expect(matchExpr(30, "10..50")).toBe(true));
  it("10..50 passes 50",  () => expect(matchExpr(50, "10..50")).toBe(true));
  it("10..50 fails 9",    () => expect(matchExpr(9,  "10..50")).toBe(false));
  it("10..50 fails 51",   () => expect(matchExpr(51, "10..50")).toBe(false));
  it("0.1..0.9 passes 0.5", () => expect(matchExpr(0.5, "0.1..0.9")).toBe(true));
  it("0.1..0.9 fails 0",    () => expect(matchExpr(0,   "0.1..0.9")).toBe(false));
});

describe("matchExpr — outside range !N..M", () => {
  it("!10..50 passes 5",  () => expect(matchExpr(5,  "!10..50")).toBe(true));
  it("!10..50 passes 60", () => expect(matchExpr(60, "!10..50")).toBe(true));
  it("!10..50 fails 10",  () => expect(matchExpr(10, "!10..50")).toBe(false));
  it("!10..50 fails 30",  () => expect(matchExpr(30, "!10..50")).toBe(false));
  it("!10..50 fails 50",  () => expect(matchExpr(50, "!10..50")).toBe(false));
});

describe("matchExpr — spaces handled", () => {
  it(">  0 (extra space) passes", () => expect(matchExpr(1, ">  0")).toBe(true));
  it("leading/trailing spaces",   () => expect(matchExpr(1, "  > 0  ")).toBe(true));
});

// ── applyFilters ──────────────────────────────────────────────────────────────

// Helper factories
function mkRow(dimKey, dimVal, values, children = []) {
  return { key: { [dimKey]: dimVal }, values, children, depth: 0 };
}

function mkChild(key, values) {
  return { key, values, children: [], depth: 1 };
}

const ROWS = [
  mkRow("module", "core",    { symbol_count: 40, dead_ratio: 0.1 }),
  mkRow("module", "utils",   { symbol_count: 15, dead_ratio: 0.5 }),
  mkRow("module", "service", { symbol_count: 80, dead_ratio: 0.3 }),
];

describe("applyFilters — no filters", () => {
  it("empty filters → all rows pass", () =>
    expect(applyFilters(ROWS, [])).toHaveLength(3));
  it("null filters → all rows pass", () =>
    expect(applyFilters(ROWS, null)).toHaveLength(3));
});

describe("applyFilters — dim exclude filter", () => {
  const f = { kind: "dim", field: "module", mode: "exclude", values: ["utils"], pattern: "" };

  it("excludes matching row", () => {
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["core", "service"]);
  });

  it("empty values list → no exclusion", () => {
    const f2 = { ...f, values: [] };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });

  it("excludes multiple values", () => {
    const f2 = { ...f, values: ["utils", "core"] };
    const result = applyFilters(ROWS, [f2]);
    expect(result.map(r => r.key.module)).toEqual(["service"]);
  });
});

describe("applyFilters — dim include filter", () => {
  const f = { kind: "dim", field: "module", mode: "include", values: ["core", "service"], pattern: "" };

  it("keeps only included values", () => {
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["core", "service"]);
  });

  it("empty values list → all pass (no restriction)", () => {
    const f2 = { ...f, values: [] };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });
});

describe("applyFilters — dim regex filter", () => {
  const f = { kind: "dim", field: "module", mode: "regex", pattern: "core|service", values: [] };

  it("keeps matching rows", () => {
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["core", "service"]);
  });

  it("case insensitive", () => {
    const f2 = { ...f, pattern: "CORE" };
    const result = applyFilters(ROWS, [f2]);
    expect(result.map(r => r.key.module)).toEqual(["core"]);
  });

  it("empty pattern → all pass", () => {
    const f2 = { ...f, pattern: "" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });

  it("^ matches everything (anchored start)", () => {
    const f2 = { ...f, pattern: "^" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });

  it("$ matches everything (anchored end)", () => {
    const f2 = { ...f, pattern: "$" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });

  it("non-matching pattern → empty result", () => {
    const f2 = { ...f, pattern: "xyz_not_present" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(0);
  });

  it("invalid regex → pass (graceful degradation)", () => {
    const f2 = { ...f, pattern: "[invalid" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });

  // THE BUG: filtering on a dim NOT in the row key
  it("include filter on dim NOT in key → all pass (no false negatives)", () => {
    // rows have key.module but not key.risk
    const riskFilter = { kind: "dim", field: "risk", mode: "include", values: ["high"], pattern: "" };
    expect(applyFilters(ROWS, [riskFilter])).toHaveLength(3);
  });

  it("regex on dim NOT in key → all pass (no false negatives)", () => {
    // rows have key.module but not key.risk
    const riskFilter = { kind: "dim", field: "risk", mode: "regex", pattern: "high", values: [] };
    // After fix: rows with missing dim key should NOT be silently removed
    // (or at minimum: behaviour is documented and predictable)
    const result = applyFilters(ROWS, [riskFilter]);
    // Current behaviour: val="" for missing dim → "high" doesn't match "" → rows removed.
    // Desired behaviour: rows with no data for the filtered dim should PASS (we can't filter what we don't have).
    expect(result).toHaveLength(3);   // <-- this is the fix target
  });

  it("! prefix negates — excludes matching rows", () => {
    const f2 = { ...f, pattern: "!core" };
    const result = applyFilters(ROWS, [f2]);
    expect(result.map(r => r.key.module).sort()).toEqual(["service", "utils"]);
  });

  it("! prefix is case-insensitive", () => {
    const f2 = { ...f, pattern: "!CORE" };
    const result = applyFilters(ROWS, [f2]);
    expect(result.map(r => r.key.module).sort()).toEqual(["service", "utils"]);
  });

  it("! prefix with pipe — excludes any matching", () => {
    const f2 = { ...f, pattern: "!core|service" };
    const result = applyFilters(ROWS, [f2]);
    expect(result.map(r => r.key.module)).toEqual(["utils"]);
  });

  it("! prefix empty pattern → all pass", () => {
    const f2 = { ...f, pattern: "!" };
    expect(applyFilters(ROWS, [f2])).toHaveLength(3);
  });
});

describe("applyFilters — measure filter", () => {
  it("> 20 keeps rows with symbol_count > 20", () => {
    const f = { kind: "measure", mkey: "symbol_count", expr: "> 20" };
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["core", "service"]);
  });

  it("< 0.2 keeps rows with dead_ratio < 0.2", () => {
    const f = { kind: "measure", mkey: "dead_ratio", expr: "< 0.2" };
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["core"]);
  });

  it("0.1..0.5 keeps rows with dead_ratio in range (inclusive)", () => {
    // core=0.1 (boundary ✓), utils=0.5 (boundary ✓), service=0.3 (inside ✓)
    const f = { kind: "measure", mkey: "dead_ratio", expr: "0.1..0.5" };
    const result = applyFilters(ROWS, [f]);
    expect(result).toHaveLength(3); // all three in range
  });

  it("0.4..1.0 excludes low dead_ratio rows", () => {
    // core=0.1 (out ✗), utils=0.5 (in ✓), service=0.3 (out ✗)
    const f = { kind: "measure", mkey: "dead_ratio", expr: "0.4..1.0" };
    const result = applyFilters(ROWS, [f]);
    expect(result.map(r => r.key.module)).toEqual(["utils"]);
  });

  it("!= 0 excludes rows where symbol_count is exactly 0", () => {
    const rowsWithZero = [...ROWS, mkRow("module", "empty", { symbol_count: 0, dead_ratio: 1.0 })];
    const f = { kind: "measure", mkey: "symbol_count", expr: "!= 0" };
    const result = applyFilters(rowsWithZero, [f]);
    expect(result.map(r => r.key.module)).not.toContain("empty");
    expect(result).toHaveLength(3);
  });

  it("null value → row passes (don't filter unknowns)", () => {
    const rowsWithNull = [...ROWS, mkRow("module", "unknown", { symbol_count: null, dead_ratio: null })];
    const f = { kind: "measure", mkey: "symbol_count", expr: "> 10" };
    const result = applyFilters(rowsWithNull, [f]);
    expect(result.map(r => r.key.module)).toContain("unknown");
  });

  it("missing mkey → row passes", () => {
    const f = { kind: "measure", mkey: "pagerank", expr: "> 0.01" };
    // Rows don't have pagerank
    expect(applyFilters(ROWS, [f])).toHaveLength(3);
  });
});

describe("applyFilters — multiple filters (AND logic)", () => {
  it("both must pass", () => {
    const f1 = { kind: "measure", mkey: "symbol_count", expr: "> 20" };
    const f2 = { kind: "measure", mkey: "dead_ratio",   expr: "< 0.4" };
    const result = applyFilters(ROWS, [f1, f2]);
    // core: 40 > 20 ✓, 0.1 < 0.4 ✓  → pass
    // utils: 15 > 20 ✗                → fail
    // service: 80 > 20 ✓, 0.3 < 0.4 ✓ → pass
    expect(result.map(r => r.key.module)).toEqual(["core", "service"]);
  });

  it("dim + measure combined", () => {
    const f1 = { kind: "dim",     field: "module", mode: "exclude", values: ["utils"], pattern: "" };
    const f2 = { kind: "measure", mkey: "symbol_count", expr: "> 50" };
    const result = applyFilters(ROWS, [f1, f2]);
    expect(result.map(r => r.key.module)).toEqual(["service"]);
  });
});

describe("applyFilters — nested rows (parent + children)", () => {
  const nestedRows = [
    {
      key: { risk: "high" }, depth: 0,
      values: { symbol_count: 60, dead_ratio: 0.2 },
      children: [
        mkChild({ risk: "high", module: "core"    }, { symbol_count: 40, dead_ratio: 0.1 }),
        mkChild({ risk: "high", module: "utils"   }, { symbol_count: 20, dead_ratio: 0.6 }),
      ],
    },
    {
      key: { risk: "low" }, depth: 0,
      values: { symbol_count: 15, dead_ratio: 0.4 },
      children: [
        mkChild({ risk: "low", module: "service" }, { symbol_count: 15, dead_ratio: 0.4 }),
      ],
    },
  ];

  it("parent-level measure filter", () => {
    const f = { kind: "measure", mkey: "symbol_count", expr: "> 20" };
    const result = applyFilters(nestedRows, [f]);
    expect(result.map(r => r.key.risk)).toEqual(["high"]);
  });

  it("child dim filter keeps parent if any child survives", () => {
    // exclude utils child → high risk parent should still appear with only core child
    const f = { kind: "dim", field: "module", mode: "exclude", values: ["utils"], pattern: "" };
    const result = applyFilters(nestedRows, [f]);
    expect(result).toHaveLength(2); // both parents survive
    const highRow = result.find(r => r.key.risk === "high");
    expect(highRow.children.map(c => c.key.module)).toEqual(["core"]);
  });

  it("child filter removes parent when ALL children removed", () => {
    // include only "nonexistent" module → no children survive in either parent
    const f = { kind: "dim", field: "module", mode: "include", values: ["nonexistent"], pattern: "" };
    const result = applyFilters(nestedRows, [f]);
    // Parents with no children AND parents that don't themselves pass should be removed
    expect(result).toHaveLength(0);
  });
});

// ── filterEdgesToNodes ────────────────────────────────────────────────────────

describe("filterEdgesToNodes — basic", () => {
  const edges = [
    { source: "a", target: "b", value: 3 },
    { source: "b", target: "c", value: 1 },
    { source: "a", target: "c", value: 2 },
    { source: "c", target: "d", value: 5 }, // d is not in valid set
  ];

  it("keeps edges where both endpoints are valid", () => {
    const result = filterEdgesToNodes(edges, new Set(["a", "b", "c"]));
    expect(result).toHaveLength(3);
    expect(result.every(e => e.source !== "d" && e.target !== "d")).toBe(true);
  });

  it("drops edge with missing target", () => {
    const result = filterEdgesToNodes(edges, new Set(["a", "b", "c"]));
    expect(result.some(e => e.source === "c" && e.target === "d")).toBe(false);
  });

  it("accepts Array instead of Set for validNodeIds", () => {
    const result = filterEdgesToNodes(edges, ["a", "b", "c"]);
    expect(result).toHaveLength(3);
  });

  it("returns [] when no nodes are valid", () => {
    expect(filterEdgesToNodes(edges, new Set())).toHaveLength(0);
  });

  it("returns [] for null/empty edges", () => {
    expect(filterEdgesToNodes(null,  new Set(["a"]))).toEqual([]);
    expect(filterEdgesToNodes([],    new Set(["a"]))).toEqual([]);
  });

  it("keeps all edges when all nodes are valid", () => {
    const result = filterEdgesToNodes(edges, new Set(["a", "b", "c", "d"]));
    expect(result).toHaveLength(4);
  });
});

describe("filterEdgesToNodes — THIS IS THE GRAPH FILTER BUG", () => {
  // Simulates the scenario that caused the console crash:
  // Module pivot has nodes [backend, tests, scripts].
  // User adds filter "include backend" → nodes becomes [backend].
  // Edges still reference "tests" and "scripts" → d3 throws "node not found".
  const allEdges = [
    { source: "backend",  target: "tests",   value: 10 },
    { source: "backend",  target: "scripts", value:  5 },
    { source: "tests",    target: "backend", value:  2 },
    { source: "scripts",  target: "backend", value:  1 },
  ];

  it("after include-backend filter: edges with removed nodes are dropped", () => {
    const filteredNodes = new Set(["backend"]);
    const result = filterEdgesToNodes(allEdges, filteredNodes);
    // No edge has both endpoints in {backend} since backend→tests has tests missing
    expect(result).toHaveLength(0);
  });

  it("no 'node not found' risk: every returned edge has both endpoints in the valid set", () => {
    const nodes = ["backend", "scripts"];
    const filteredEdges = filterEdgesToNodes(allEdges, new Set(nodes));
    const nodeSet = new Set(nodes);
    for (const e of filteredEdges) {
      expect(nodeSet.has(String(e.source))).toBe(true);
      expect(nodeSet.has(String(e.target))).toBe(true);
    }
  });
});

describe("filterEdgesToNodes — d3 mutation safety", () => {
  // d3 mutates link.source from "backend" → {id:"backend", x:..., y:...} after first tick.
  // filterEdgesToNodes must handle both raw strings and mutated node objects.
  it("handles d3-mutated source/target objects", () => {
    const mutatedEdges = [
      { source: { id: "a", x: 10, y: 20 }, target: { id: "b", x: 30, y: 40 }, value: 1 },
      { source: { id: "a", x: 10, y: 20 }, target: { id: "c", x: 50, y: 60 }, value: 2 },
    ];
    // "c" filtered out
    const result = filterEdgesToNodes(mutatedEdges, new Set(["a", "b"]));
    expect(result).toHaveLength(1);
    expect(result[0].target).toMatchObject({ id: "b" });
  });

  it("handles mixed string + object endpoints", () => {
    const mixed = [
      { source: "a", target: { id: "b" }, value: 1 }, // mixed
      { source: { id: "a" }, target: "c", value: 2 }, // c missing
    ];
    const result = filterEdgesToNodes(mixed, new Set(["a", "b"]));
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyFilters — N-dim recursive tree filtering
// ─────────────────────────────────────────────────────────────────────────────

function dimExclude(field, values) {
  return { kind: "dim", field, mode: "exclude", values, pattern: "", id: `ex_${field}` };
}

function make3DimRows() {
  // module → class → symbol  (3 levels)
  return [
    {
      key: { module: "core" }, depth: 0, values: { symbol_count: 4 },
      children: [
        {
          key: { module: "core", class: "Parser" }, depth: 1, values: { symbol_count: 2 },
          children: [
            { key: { module: "core", class: "Parser", symbol: "core::parse" },    depth: 2, values: { symbol_count: 1, dead_ratio: 0.1 }, children: [] },
            { key: { module: "core", class: "Parser", symbol: "core::validate" }, depth: 2, values: { symbol_count: 1, dead_ratio: 0.9 }, children: [] },
          ],
        },
        {
          key: { module: "core", class: "Builder" }, depth: 1, values: { symbol_count: 2 },
          children: [
            { key: { module: "core", class: "Builder", symbol: "core::build" }, depth: 2, values: { symbol_count: 1, dead_ratio: 0.5 }, children: [] },
          ],
        },
      ],
    },
    {
      key: { module: "tests" }, depth: 0, values: { symbol_count: 2 },
      children: [
        {
          key: { module: "tests", class: "(top-level)" }, depth: 1, values: { symbol_count: 2 },
          children: [
            { key: { module: "tests", class: "(top-level)", symbol: "tests::test_parse" }, depth: 2, values: { symbol_count: 1 }, children: [] },
          ],
        },
      ],
    },
  ];
}

describe("applyFilters – 3-dim recursive tree filtering", () => {
  it("module exclude filter removes entire subtree", () => {
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("module", ["tests"])]);
    expect(result).toHaveLength(1);
    expect(result[0].key.module).toBe("core");
  });

  it("class exclude filter removes matching class and its symbols", () => {
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("class", ["Builder"])]);
    // Both modules survive: core (still has Parser), tests (has '(top-level)', not Builder)
    expect(result).toHaveLength(2);
    const coreRow = result.find(r => r.key.module === "core");
    const coreClasses = coreRow.children.map(c => c.key.class);
    expect(coreClasses).not.toContain("Builder");
    expect(coreClasses).toContain("Parser");
  });

  it("class exclude keeps parent (core) when at least one child class survives", () => {
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("class", ["Builder"])]);
    expect(result[0].key.module).toBe("core");
    expect(result[0].children).toHaveLength(1);
  });

  it("symbol-level field filter works at depth 2 (recursive fix)", () => {
    // Filter: symbol include 'core::parse' only
    const rows = make3DimRows();
    const result = applyFilters(rows, [{
      kind: "dim", field: "symbol", mode: "include", values: ["core::parse"], pattern: ""
    }]);
    // core module → Parser class → only core::parse survives
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1); // only Parser
    expect(result[0].children[0].children).toHaveLength(1); // only core::parse
    expect(result[0].children[0].children[0].key.symbol).toBe("core::parse");
  });

  it("measure filter at depth 2 prunes low dead_ratio leaves", () => {
    const rows = make3DimRows();
    // Keep only symbols with dead_ratio >= 0.5
    const result = applyFilters(rows, [{
      kind: "measure", mkey: "dead_ratio", expr: ">=0.5"
    }]);
    // core::parse (0.1) excluded; core::validate (0.9) and core::build (0.5) survive
    const symbols = [];
    const walk = (rows) => rows.forEach(r => {
      if (r.depth === 2) symbols.push(r.key.symbol);
      (r.children || []).forEach(c => walk([c]));
    });
    walk(result);
    expect(symbols).not.toContain("core::parse");
    expect(symbols).toContain("core::validate");
    expect(symbols).toContain("core::build");
  });

  it("removing all descendants of a parent removes the parent too", () => {
    // Exclude Builder AND Parser → core has no class children left → core removed
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("class", ["Parser", "Builder"])]);
    // tests module only has (top-level) class → still present
    // core has no surviving classes → removed
    const modules = result.map(r => r.key.module);
    expect(modules).not.toContain("core");
    expect(modules).toContain("tests");
  });

  it("preserves symbol children of surviving class rows", () => {
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("module", ["tests"])]);
    // core → Parser (2 symbols), Builder (1 symbol) — all intact
    const parserRow = result[0].children.find(c => c.key.class === "Parser");
    expect(parserRow.children).toHaveLength(2);
    const builderRow = result[0].children.find(c => c.key.class === "Builder");
    expect(builderRow.children).toHaveLength(1);
  });

  it("no-op filter preserves full 3-level structure", () => {
    const rows = make3DimRows();
    const result = applyFilters(rows, [dimExclude("module", ["nonexistent"])]);
    expect(result).toHaveLength(2);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[0].children).toHaveLength(2);
  });

  it("regex filter works at all depths", () => {
    const rows = make3DimRows();
    // Leading ! negates — "!test" excludes rows whose module matches /test/i
    const result = applyFilters(rows, [{
      kind: "dim", field: "module", mode: "regex", pattern: "!test", values: [], id: "x"
    }]);
    const modules = result.map(r => r.key.module);
    expect(modules).not.toContain("tests");
    expect(modules).toContain("core");
  });
});
