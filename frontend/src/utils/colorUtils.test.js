import { describe, it, expect } from "vitest";
import {
  hex,
  lerpColor,
  makeStepColors,
  makeStepWidths,
  makeStepArrows,
} from "./colorUtils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// hex
// ═══════════════════════════════════════════════════════════════════════════════

describe("hex", () => {
  it("converts 0 to '00'", () => {
    expect(hex(0)).toBe("00");
  });

  it("converts 255 to 'ff'", () => {
    expect(hex(255)).toBe("ff");
  });

  it("converts mid-range values correctly", () => {
    expect(hex(16)).toBe("10");
    expect(hex(127)).toBe("7f");
    expect(hex(128)).toBe("80");
  });

  it("clamps negative values to '00'", () => {
    expect(hex(-1)).toBe("00");
    expect(hex(-100)).toBe("00");
  });

  it("clamps values > 255 to 'ff'", () => {
    expect(hex(256)).toBe("ff");
    expect(hex(999)).toBe("ff");
  });

  it("rounds fractional values", () => {
    expect(hex(127.4)).toBe("7f"); // 127
    expect(hex(127.6)).toBe("80"); // 128
    expect(hex(0.4)).toBe("00");   // 0
    expect(hex(0.6)).toBe("01");   // 1
  });

  it("always returns a 2-character string", () => {
    for (const n of [0, 1, 15, 16, 255]) {
      expect(hex(n)).toHaveLength(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// lerpColor
// ═══════════════════════════════════════════════════════════════════════════════

describe("lerpColor", () => {
  it("returns the start colour at t=0", () => {
    expect(lerpColor("#ff0000", "#0000ff", 0)).toBe("#ff0000");
  });

  it("returns the end colour at t=1", () => {
    expect(lerpColor("#ff0000", "#0000ff", 1)).toBe("#0000ff");
  });

  it("returns the midpoint colour at t=0.5", () => {
    // #ff0000 → #0000ff at t=0.5: each channel rounds 127.5 → 128 = 0x80
    // R: 255 + (0-255)*0.5 = 127.5 → 128; G: 0; B: 0 + (255-0)*0.5 = 127.5 → 128
    expect(lerpColor("#ff0000", "#0000ff", 0.5)).toBe("#800080");
  });

  it("interpolates a grey scale correctly", () => {
    // #000000 → #ffffff at t=0.5: each channel = 0 + 255*0.5 = 127.5 → 128 = 0x80
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("handles same start and end colours", () => {
    expect(lerpColor("#aabbcc", "#aabbcc", 0.5)).toBe("#aabbcc");
  });

  it("returns a valid hex colour string (# + 6 hex chars)", () => {
    const result = lerpColor("#123456", "#abcdef", 0.3);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// makeStepColors
// ═══════════════════════════════════════════════════════════════════════════════

describe("makeStepColors", () => {
  it("returns an array of the correct length", () => {
    expect(makeStepColors(1)).toHaveLength(1);
    expect(makeStepColors(5)).toHaveLength(5);
    expect(makeStepColors(10)).toHaveLength(10);
  });

  it("all entries are rgb() strings", () => {
    for (const c of makeStepColors(5)) {
      expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });

  it("first step is the bright orange anchor (#ff9500)", () => {
    const [first] = makeStepColors(5);
    expect(first).toBe("rgb(255,149,0)");
  });

  it("last step is the faint cream anchor (#fff4cc) for n > 1", () => {
    const steps = makeStepColors(5);
    expect(steps.at(-1)).toBe("rgb(255,244,204)");
  });

  it("n=1 returns a single step at t=0 (orange anchor)", () => {
    const [only] = makeStepColors(1);
    expect(only).toBe("rgb(255,149,0)");
  });

  it("produces a monotone sequence (R stays 255, G increases, B increases)", () => {
    const steps = makeStepColors(4);
    // R is 255 throughout (both anchors have R=255)
    for (const c of steps) {
      const [, r] = c.match(/rgb\((\d+)/);
      expect(Number(r)).toBe(255);
    }
    // G and B should increase monotonically as we go from orange to cream
    const gs = steps.map(c => Number(c.match(/rgb\(\d+,(\d+)/)[1]));
    for (let i = 1; i < gs.length; i++) {
      expect(gs[i]).toBeGreaterThanOrEqual(gs[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// makeStepWidths
// ═══════════════════════════════════════════════════════════════════════════════

describe("makeStepWidths", () => {
  it("returns an array of the correct length", () => {
    expect(makeStepWidths(3)).toHaveLength(3);
    expect(makeStepWidths(1)).toHaveLength(1);
  });

  it("first width is 2.8 (widest, for direct neighbour)", () => {
    expect(makeStepWidths(5)[0]).toBeCloseTo(2.8);
  });

  it("last width is 0.65 (thinnest, for farthest hop) for n > 1", () => {
    expect(makeStepWidths(5).at(-1)).toBeCloseTo(0.65);
  });

  it("n=1 returns a single width at the widest value", () => {
    expect(makeStepWidths(1)[0]).toBeCloseTo(2.8);
  });

  it("widths decrease monotonically (tapers from direct to far)", () => {
    const widths = makeStepWidths(6);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    }
  });

  it("all widths are positive numbers", () => {
    for (const w of makeStepWidths(8)) {
      expect(w).toBeGreaterThan(0);
      expect(typeof w).toBe("number");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// makeStepArrows
// ═══════════════════════════════════════════════════════════════════════════════

describe("makeStepArrows", () => {
  it("returns an array of the correct length", () => {
    expect(makeStepArrows(4)).toHaveLength(4);
  });

  it("first arrow size is 8 (largest)", () => {
    expect(makeStepArrows(5)[0]).toBe(8);
  });

  it("last arrow size is 4 (smallest) for n > 1", () => {
    expect(makeStepArrows(5).at(-1)).toBe(4);
  });

  it("n=1 returns a single entry at the largest value", () => {
    expect(makeStepArrows(1)[0]).toBe(8);
  });

  it("arrow sizes decrease monotonically", () => {
    const arrows = makeStepArrows(5);
    for (let i = 1; i < arrows.length; i++) {
      expect(arrows[i]).toBeLessThanOrEqual(arrows[i - 1]);
    }
  });

  it("all values are integers (Math.round applied)", () => {
    for (const a of makeStepArrows(7)) {
      expect(a).toBe(Math.round(a));
    }
  });
});
