import { describe, it, expect } from "vitest";
import {
  healthStateOn,
  isActiveOn,
  healthEventLabel,
  healthEventShortLabel,
  healthKindNoun,
  trainingImpactSummary,
} from "../health-events";

const TODAY = "2026-08-20";

const injury = {
  kind: "injury",
  body_part: "Achilles",
  side: "left",
  onset_date: "2026-08-01",
  resolved_date: null as string | null,
  expected_resolved_date: null as string | null,
  is_chronic: false,
};

describe("healthStateOn", () => {
  it("nothing before onset", () => {
    expect(healthStateOn(injury, "2026-07-31", { today: TODAY })).toBeNull();
  });

  it("past and present days are fact, future days are forecast", () => {
    expect(healthStateOn(injury, "2026-08-05", { today: TODAY })).toBe("active");
    expect(healthStateOn(injury, TODAY, { today: TODAY })).toBe("active");
    expect(healthStateOn(injury, "2026-08-21", { today: TODAY })).toBe("expected");
  });

  it("an expected date ends the forecast", () => {
    const rec = { ...injury, expected_resolved_date: "2026-08-25" };
    expect(healthStateOn(rec, "2026-08-25", { today: TODAY })).toBe("expected");
    expect(healthStateOn(rec, "2026-08-26", { today: TODAY })).toBeNull();
    // The days it actually covered are unaffected.
    expect(healthStateOn(rec, "2026-08-05", { today: TODAY })).toBe("active");
  });

  it("a real resolution beats a forecast, including one that overran it", () => {
    // Cleared earlier than expected — the happy case, and the forecast must
    // not keep the marker alive past the day it actually ended.
    const rec = { ...injury, expected_resolved_date: "2026-08-30", resolved_date: "2026-08-10" };
    expect(healthStateOn(rec, "2026-08-10", { today: TODAY })).toBe("active");
    expect(healthStateOn(rec, "2026-08-11", { today: TODAY })).toBeNull();
  });

  it("a resolved record never reads as expected, even for future days", () => {
    const rec = { ...injury, resolved_date: "2026-09-30" };
    expect(healthStateOn(rec, "2026-09-15", { today: TODAY })).toBe("active");
    expect(healthStateOn(rec, "2026-10-01", { today: TODAY })).toBeNull();
  });

  it("with no expected date it runs open-ended rather than inventing a horizon", () => {
    expect(healthStateOn(injury, "2027-06-01", { today: TODAY })).toBe("expected");
  });

  it("chronic conditions are excluded unless asked for", () => {
    const asthma = { ...injury, kind: "illness", illness_type: "asthma", is_chronic: true, body_part: null };
    expect(healthStateOn(asthma, TODAY, { today: TODAY })).toBeNull();
    expect(healthStateOn(asthma, TODAY, { today: TODAY, includeChronic: true })).toBe("active");
  });

  it("survives a record with no onset", () => {
    expect(healthStateOn({ ...injury, onset_date: null }, TODAY, { today: TODAY })).toBeNull();
    expect(() => healthStateOn(null as any, TODAY)).not.toThrow();
  });

  it("isActiveOn stays consistent with it", () => {
    const rec = { ...injury, expected_resolved_date: "2026-08-25" };
    expect(isActiveOn(rec, "2026-08-21", { today: TODAY })).toBe(true);
    expect(isActiveOn(rec, "2026-08-26", { today: TODAY })).toBe(false);
  });
});

describe("labels", () => {
  it("names an injury by body part and an illness by type", () => {
    expect(healthEventLabel(injury)).toBe("Achilles (left)");
    expect(healthEventLabel({ kind: "illness", illness_type: "asthma" })).toBe("Asthma");
    expect(healthKindNoun({ kind: "illness" })).toBe("illness");
    expect(healthKindNoun(injury)).toBe("injury");
  });

  it("never renders blank, which is what the dashboard used to do for an illness", () => {
    expect(healthEventLabel({ kind: "illness" })).toBe("Illness");
    expect(healthEventLabel({ kind: "injury", body_part: null })).toBe("Unspecified injury");
    expect(healthEventShortLabel({ kind: "injury", body_part: null })).toBe("Injury");
    expect(healthEventLabel(null)).toBe("Unknown");
  });

  it("omits the side when it is not applicable", () => {
    expect(healthEventLabel({ kind: "injury", body_part: "Lower back", side: "n/a" })).toBe("Lower back");
  });
});

describe("trainingImpactSummary", () => {
  it("combines the impact with its specifics", () => {
    expect(
      trainingImpactSummary({
        training_impact: "modified",
        training_modifications: ["reduced_volume", "no_speed_work"],
      }),
    ).toBe("Trained around it: reduced volume, no speed work");
  });

  it("falls back to the impact alone", () => {
    expect(trainingImpactSummary({ training_impact: "stopped", training_modifications: [] })).toBe("No training");
  });

  it("empty when nothing was recorded", () => {
    expect(trainingImpactSummary({})).toBe("");
    expect(trainingImpactSummary(null)).toBe("");
  });
});
