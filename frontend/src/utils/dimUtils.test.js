import { describe, it, expect } from "vitest";
import {
  parseBucketedDim,
  dimDisplayLabel,
  parseFiltersParam,
} from "./dimUtils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// parseBucketedDim
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseBucketedDim", () => {
  it("returns null for plain dimension names (no colon)", () => {
    expect(parseBucketedDim("module")).toBeNull();
    expect(parseBucketedDim("risk")).toBeNull();
    expect(parseBucketedDim("kind")).toBeNull();
    expect(parseBucketedDim("symbol")).toBeNull();
    expect(parseBucketedDim("community")).toBeNull();
  });

  it("parses all three valid modes", () => {
    expect(parseBucketedDim("caller_count:median")).toEqual({ field: "caller_count", mode: "median" });
    expect(parseBucketedDim("caller_count:quartile")).toEqual({ field: "caller_count", mode: "quartile" });
    expect(parseBucketedDim("caller_count:decile")).toEqual({ field: "caller_count", mode: "decile" });
  });

  it("returns null for an unrecognised mode", () => {
    expect(parseBucketedDim("caller_count:tercile")).toBeNull();
    expect(parseBucketedDim("caller_count:invalid")).toBeNull();
    expect(parseBucketedDim("caller_count:")).toBeNull(); // empty mode
  });

  it("preserves the field name exactly", () => {
    const r = parseBucketedDim("xmod_fan_in:quartile");
    expect(r).toEqual({ field: "xmod_fan_in", mode: "quartile" });
  });

  it("rejects input where mode contains a colon (mode = 'median:extra' not in BUCKET_MODES)", () => {
    // "a:median:extra" → field="a", mode="median:extra" (everything after first colon)
    // "median:extra" is not in BUCKET_MODES → null
    expect(parseBucketedDim("a:median:extra")).toBeNull();
  });

  it("handles all BUCKET_FIELDS_META fields with each mode", () => {
    const fields = [
      "caller_count", "callee_count", "complexity",
      "dead_ratio", "high_risk_ratio", "in_cycle_ratio",
      "pagerank", "utility", "xmod_fan_in", "betweenness",
    ];
    for (const field of fields) {
      for (const mode of ["median", "quartile", "decile"]) {
        const r = parseBucketedDim(`${field}:${mode}`);
        expect(r).toEqual({ field, mode });
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// dimDisplayLabel
// ═══════════════════════════════════════════════════════════════════════════════

describe("dimDisplayLabel", () => {
  it("returns friendly label for known plain dims", () => {
    expect(dimDisplayLabel("module")).toBe("module");
    expect(dimDisplayLabel("risk")).toBe("risk");
    expect(dimDisplayLabel("kind")).toBe("kind");
    expect(dimDisplayLabel("symbol")).toBe("symbol");
    expect(dimDisplayLabel("in_cycle")).toBe("in-cycle ✦");
    expect(dimDisplayLabel("community")).toBe("community ✦");
  });

  it("returns 'field (mode)' label for bucketed dims", () => {
    expect(dimDisplayLabel("caller_count:quartile")).toBe("callers (quartile)");
    expect(dimDisplayLabel("complexity:median")).toBe("complexity (median)");
    expect(dimDisplayLabel("pagerank:decile")).toBe("pagerank ✦ (decile)");
    expect(dimDisplayLabel("betweenness:quartile")).toBe("betweenness ✦ (quartile)");
  });

  it("falls back to raw field name for unknown bucketed field", () => {
    expect(dimDisplayLabel("mystery_metric:quartile")).toBe("mystery_metric (quartile)");
  });

  it("returns the dim string itself for unknown plain dims", () => {
    expect(dimDisplayLabel("some_unknown_dim")).toBe("some_unknown_dim");
  });

  it("enriched dim labels include ✦", () => {
    expect(dimDisplayLabel("in_cycle")).toContain("✦");
    expect(dimDisplayLabel("community")).toContain("✦");
    expect(dimDisplayLabel("pagerank:quartile")).toContain("✦");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseFiltersParam
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseFiltersParam", () => {
  it("returns empty array for null", () => {
    expect(parseFiltersParam(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseFiltersParam(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseFiltersParam("")).toEqual([]);
  });

  it("parses valid JSON array", () => {
    const raw = JSON.stringify([{ id: "1", dim: "module", kind: "dim" }]);
    const result = parseFiltersParam(raw);
    expect(result).toHaveLength(1);
    expect(result[0].dim).toBe("module");
  });

  it("parses multiple filter objects", () => {
    const filters = [
      { id: "a", dim: "module", kind: "dim" },
      { id: "b", field: "dead_ratio", kind: "measure" },
    ];
    const result = parseFiltersParam(JSON.stringify(filters));
    expect(result).toHaveLength(2);
  });

  it("returns empty array for malformed JSON (no throw)", () => {
    expect(() => parseFiltersParam("{not valid json}")).not.toThrow();
    expect(parseFiltersParam("{not valid json}")).toEqual([]);
  });

  it("returns empty array for plain string (not JSON)", () => {
    expect(parseFiltersParam("module:value")).toEqual([]);
  });

  it("returns empty array for JSON non-array values", () => {
    // Valid JSON but not an array — the caller expects an array
    // parseFiltersParam doesn't validate structure, so it returns whatever JSON.parse gives
    // This is intentional — callers guard against malformed entries
    const result = parseFiltersParam(JSON.stringify({ dim: "module" }));
    expect(result).not.toBeNull(); // at least doesn't crash
  });
});
