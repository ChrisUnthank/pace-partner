import { describe, it, expect } from "vitest";
import {
  flagAgainstRange,
  positionInRange,
  findMarker,
  BLOOD_MARKERS,
} from "../blood-markers";

describe("flagAgainstRange", () => {
  it("flags either side of a two-sided range", () => {
    expect(flagAgainstRange(25, 30, 300)).toBe("low");
    expect(flagAgainstRange(400, 30, 300)).toBe("high");
    expect(flagAgainstRange(120, 30, 300)).toBe("in_range");
  });

  it("boundaries are inside the range, not outside", () => {
    expect(flagAgainstRange(30, 30, 300)).toBe("in_range");
    expect(flagAgainstRange(300, 30, 300)).toBe("in_range");
  });

  it("handles one-sided ranges, which labs report often", () => {
    expect(flagAgainstRange(2, null, 5)).toBe("in_range");
    expect(flagAgainstRange(9, null, 5)).toBe("high");
    expect(flagAgainstRange(9, 20, null)).toBe("low");
    expect(flagAgainstRange(40, 20, null)).toBe("in_range");
  });

  it("never invents a range", () => {
    // The important one. A value with no reported range must not come back
    // as in_range — that would be presenting an absent judgement as a result.
    expect(flagAgainstRange(120, null, null)).toBe("no_range");
    expect(flagAgainstRange(120, undefined, undefined)).toBe("no_range");
    expect(flagAgainstRange(120, NaN, NaN)).toBe("no_range");
  });

  it("survives an unusable value", () => {
    expect(flagAgainstRange(NaN, 30, 300)).toBe("no_range");
  });
});

describe("positionInRange", () => {
  it("positions within a two-sided range", () => {
    expect(positionInRange(30, 30, 130)).toBe(0);
    expect(positionInRange(130, 30, 130)).toBe(100);
    expect(positionInRange(80, 30, 130)).toBe(50);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(positionInRange(10, 30, 130)).toBe(0);
    expect(positionInRange(500, 30, 130)).toBe(100);
  });

  it("returns null rather than drawing a range that does not exist", () => {
    expect(positionInRange(50, null, 130)).toBeNull();
    expect(positionInRange(50, 30, null)).toBeNull();
    expect(positionInRange(50, null, null)).toBeNull();
    // Inverted or zero-width bounds are unusable, not something to guess at.
    expect(positionInRange(50, 130, 30)).toBeNull();
    expect(positionInRange(50, 30, 30)).toBeNull();
  });
});

describe("marker list", () => {
  it("every marker has a unit and a category", () => {
    for (const m of BLOOD_MARKERS) {
      expect(m.name.trim().length).toBeGreaterThan(0);
      expect(m.unit.trim().length).toBeGreaterThan(0);
      expect(m.category).toBeTruthy();
    }
  });

  it("no duplicate names", () => {
    const names = BLOOD_MARKERS.map((m) => m.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries no target or optimal values anywhere", () => {
    // Guards the decision that this file stores units and descriptions only.
    // A threshold added here would be presented to a coach as the app's
    // answer, and those figures are contested clinical opinion.
    const serialized = JSON.stringify(BLOOD_MARKERS).toLowerCase();
    for (const banned of ["optimal", "target", "ideal", "reflow", "refhigh", "min", "max"]) {
      expect(serialized).not.toContain(`"${banned}"`);
    }
  });

  it("finds markers case-insensitively", () => {
    expect(findMarker("ferritin")?.unit).toBe("µg/L");
    expect(findMarker("  FERRITIN ")?.name).toBe("Ferritin");
    expect(findMarker("nonsense")).toBeUndefined();
  });
});
