import { describe, it, expect } from "vitest";
import {
  measureKey,
  measureStr,
  measureLabel,
  fmtValue,
  parseMeasuresParam,
} from "./measureUtils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// measureKey
// ═══════════════════════════════════════════════════════════════════════════════

describe("measureKey", () => {
  it("returns the special string for special measures", () => {
    expect(measureKey({ special: "dead_ratio" })).toBe("dead_ratio");
    expect(measureKey({ special: "symbol_count" })).toBe("symbol_count");
  });

  it("returns field_agg for field+agg measures", () => {
    expect(measureKey({ field: "caller_count", agg: "avg" })).toBe("caller_count_avg");
    expect(measureKey({ field: "complexity", agg: "stddev" })).toBe("complexity_stddev");
  });

  it("prefers special over field when both present (special takes priority)", () => {
    // special is checked first via ?? — if special is defined (even ""), it wins
    expect(measureKey({ special: "dead_ratio", field: "caller_count", agg: "avg" }))
      .toBe("dead_ratio");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// measureStr
// ═══════════════════════════════════════════════════════════════════════════════

describe("measureStr", () => {
  it("returns the special string for special measures", () => {
    expect(measureStr({ special: "in_cycle_ratio" })).toBe("in_cycle_ratio");
  });

  it("returns field:agg format for field+agg measures", () => {
    expect(measureStr({ field: "caller_count", agg: "avg" })).toBe("caller_count:avg");
    expect(measureStr({ field: "pagerank", agg: "max" })).toBe("pagerank:max");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// measureLabel
// ═══════════════════════════════════════════════════════════════════════════════

describe("measureLabel", () => {
  it("returns human label for known specials", () => {
    expect(measureLabel({ special: "dead_ratio" })).toBe("dead ratio");
    expect(measureLabel({ special: "symbol_count" })).toBe("symbol count");
    expect(measureLabel({ special: "high_risk_ratio" })).toBe("high-risk %");
    expect(measureLabel({ special: "in_cycle_ratio" })).toBe("in-cycle %");
  });

  it("returns the special string itself for unknown specials", () => {
    expect(measureLabel({ special: "unknown_special" })).toBe("unknown_special");
  });

  it("returns the field label for known fields", () => {
    expect(measureLabel({ field: "caller_count", agg: "avg" })).toBe("callers");
    expect(measureLabel({ field: "complexity", agg: "max" })).toBe("complexity");
    expect(measureLabel({ field: "pagerank", agg: "avg" })).toBe("pagerank");
  });

  it("falls back to the field name for unknown fields", () => {
    expect(measureLabel({ field: "mystery_field", agg: "avg" })).toBe("mystery_field");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// fmtValue
// ═══════════════════════════════════════════════════════════════════════════════

describe("fmtValue", () => {
  it("returns null for null value", () => {
    expect(fmtValue(null, "ratio")).toBeNull();
    expect(fmtValue(null, "float")).toBeNull();
    expect(fmtValue(null)).toBeNull();
  });

  it("returns null for undefined value", () => {
    expect(fmtValue(undefined, "ratio")).toBeNull();
  });

  describe("ratio type", () => {
    it("formats as percentage with 1 decimal place", () => {
      expect(fmtValue(0.5, "ratio")).toBe("50.0%");
      expect(fmtValue(0, "ratio")).toBe("0.0%");
      expect(fmtValue(1, "ratio")).toBe("100.0%");
      expect(fmtValue(0.333, "ratio")).toBe("33.3%");
    });

    it("treats null/0 value as 0 (avoids NaN)", () => {
      // value=0 is falsy but should still work
      expect(fmtValue(0, "ratio")).toBe("0.0%");
    });
  });

  describe("float type", () => {
    it("formats small values in exponential notation", () => {
      expect(fmtValue(0.001, "float")).toBe("1.00e-3");
      expect(fmtValue(0.009, "float")).toBe("9.00e-3");
    });

    it("formats values >= 0.01 to 3 decimal places", () => {
      expect(fmtValue(0.01, "float")).toBe("0.010");
      expect(fmtValue(1.5, "float")).toBe("1.500");
      expect(fmtValue(42.1234, "float")).toBe("42.123");
    });

    it("treats 0 value as 0.000", () => {
      expect(fmtValue(0, "float")).toBe("0.000");
    });
  });

  describe("integer/default type", () => {
    it("rounds to nearest integer", () => {
      expect(fmtValue(42, "count")).toBe(42);
      expect(fmtValue(42.6, "count")).toBe(43);
      expect(fmtValue(42.4, "count")).toBe(42);
    });

    it("rounds with no type argument", () => {
      expect(fmtValue(7.8)).toBe(8);
    });

    it("handles large numbers", () => {
      expect(fmtValue(1234567)).toBe(1234567);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseMeasuresParam
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMeasuresParam", () => {
  it("returns DEFAULT_MEASURES for null input", () => {
    const result = parseMeasuresParam(null);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("special"); // first default is symbol_count
  });

  it("returns DEFAULT_MEASURES for empty string", () => {
    const result = parseMeasuresParam("");
    expect(result.length).toBeGreaterThan(0);
  });

  it("parses a single known special", () => {
    const result = parseMeasuresParam("dead_ratio");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ special: "dead_ratio" });
  });

  it("parses multiple specials", () => {
    const result = parseMeasuresParam("symbol_count,dead_ratio,in_cycle_ratio");
    expect(result).toHaveLength(3);
    expect(result.map(m => m.special)).toEqual([
      "symbol_count", "dead_ratio", "in_cycle_ratio",
    ]);
  });

  it("parses a field:agg measure", () => {
    const result = parseMeasuresParam("caller_count:avg");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ field: "caller_count", agg: "avg" });
  });

  it("parses mixed specials and field:agg", () => {
    const result = parseMeasuresParam("dead_ratio,caller_count:avg,complexity:max");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ special: "dead_ratio" });
    expect(result[1]).toEqual({ field: "caller_count", agg: "avg" });
    expect(result[2]).toEqual({ field: "complexity", agg: "max" });
  });

  it("drops unknown special names", () => {
    const result = parseMeasuresParam("dead_ratio,totally_made_up");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ special: "dead_ratio" });
  });

  it("drops field:agg entries with unknown field names", () => {
    const result = parseMeasuresParam("caller_count:avg,unknown_field:avg");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ field: "caller_count", agg: "avg" });
  });

  it("handles enriched fields (utility, pagerank, etc.)", () => {
    const result = parseMeasuresParam("pagerank:avg,utility:max,betweenness:stddev");
    expect(result).toHaveLength(3);
  });

  it("ignores empty segments from trailing/leading commas", () => {
    const result = parseMeasuresParam(",dead_ratio,");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ special: "dead_ratio" });
  });

  it("field:agg with first colon only — handles colons in field name defensively", () => {
    // "caller_count:avg:extra" — indexOf(":") takes first colon
    const result = parseMeasuresParam("caller_count:avg:extra");
    // field="caller_count", agg="avg:extra" — FIELD_META won't have agg problems,
    // but field is valid so it should parse (even if agg is weird)
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("caller_count");
  });
});
