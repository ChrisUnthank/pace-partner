import { describe, it, expect } from "vitest";
import {
  expectedRpe,
  weekStartOf,
  buildRpeWeeks,
  analyseRpeTrend,
  type RpeSession,
} from "../rpe-trends";

function s(date: string, rpe: number | null, intent: string, extra: Partial<RpeSession> = {}): RpeSession {
  return { session_date: date, rpe, intent, ...extra };
}

describe("expectedRpe", () => {
  it("matches what session_training_load falls back to", () => {
    expect(expectedRpe("easy")).toBe(3);
    expect(expectedRpe("threshold")).toBe(7);
    expect(expectedRpe("vo2")).toBe(8);
    expect(expectedRpe(null, "race")).toBe(9);
    expect(expectedRpe(null, "recovery")).toBe(2);
  });

  it("day_type wins over intent, as it does in the SQL", () => {
    expect(expectedRpe("easy", "race")).toBe(9);
    // 'training' is not a special day type — fall through to intent.
    expect(expectedRpe("easy", "training")).toBe(3);
  });

  it("falls back rather than throwing on anything unrecognised", () => {
    expect(expectedRpe("nonsense")).toBe(4);
    expect(expectedRpe(null, null)).toBe(4);
    expect(expectedRpe(undefined, undefined)).toBe(4);
  });
});

describe("weekStartOf", () => {
  it("returns the Monday", () => {
    expect(weekStartOf("2026-08-19")).toBe("2026-08-17"); // Wed -> Mon
    expect(weekStartOf("2026-08-17")).toBe("2026-08-17"); // Mon -> itself
    expect(weekStartOf("2026-08-23")).toBe("2026-08-17"); // Sun -> that Mon
  });
});

describe("buildRpeWeeks", () => {
  it("delta is measured against the session TYPE, not a flat average", () => {
    // The point of the whole module. An easy run at 3 and a VO2 at 8 are both
    // exactly normal, so both score 0 — whereas a raw mean would report 5.5
    // and move whenever the shape of the week changed.
    const weeks = buildRpeWeeks([
      s("2026-08-17", 3, "easy"),
      s("2026-08-19", 8, "vo2"),
    ]);
    expect(weeks[0].meanDelta).toBe(0);
    expect(weeks[0].meanRpe).toBe(5.5);
  });

  it("catches an easy run that felt hard", () => {
    const weeks = buildRpeWeeks([s("2026-08-17", 6, "easy"), s("2026-08-19", 3, "easy")]);
    expect(weeks[0].meanDelta).toBe(1.5); // +3 and 0
  });

  it("counts health-affected days and flags a dominated week", () => {
    const weeks = buildRpeWeeks([
      s("2026-08-17", 6, "easy", { health_affected: true }),
      s("2026-08-18", 7, "easy", { health_affected: true }),
      s("2026-08-19", 3, "easy"),
    ]);
    expect(weeks[0].healthAffected).toBe(2);
    expect(weeks[0].healthDominated).toBe(true);
  });

  it("a single affected day in a full week does not dominate it", () => {
    const weeks = buildRpeWeeks([
      s("2026-08-17", 6, "easy", { health_affected: true }),
      s("2026-08-18", 3, "easy"),
      s("2026-08-19", 3, "easy"),
      s("2026-08-20", 3, "easy"),
    ]);
    expect(weeks[0].healthDominated).toBe(false);
  });

  it("unrated sessions count toward the week but not the averages", () => {
    const weeks = buildRpeWeeks([s("2026-08-17", null, "easy"), s("2026-08-18", 5, "easy")]);
    expect(weeks[0].sessions).toBe(2);
    expect(weeks[0].rated).toBe(1);
    expect(weeks[0].meanDelta).toBe(2);
  });

  it("weeks come back in order and degenerate input does not throw", () => {
    const weeks = buildRpeWeeks([s("2026-08-24", 5, "easy"), s("2026-08-17", 5, "easy")]);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-08-17", "2026-08-24"]);
    expect(buildRpeWeeks([])).toEqual([]);
    expect(() => buildRpeWeeks(null as any)).not.toThrow();
    expect(buildRpeWeeks([{ session_date: "" } as any])).toEqual([]);
  });
});

describe("analyseRpeTrend", () => {
  const week = (monday: string, rpe: number, intent = "easy", extra: Partial<RpeSession> = {}) =>
    [0, 2, 4].map((d) => {
      const dt = new Date(`${monday}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + d);
      return s(dt.toISOString().slice(0, 10), rpe, intent, extra);
    });

  it("reports rising effort when the same sessions are rated harder", () => {
    const r = analyseRpeTrend([
      ...week("2026-07-27", 3),
      ...week("2026-08-03", 3),
      ...week("2026-08-10", 5),
    ]);
    expect(r.direction).toBe("rising");
    expect(r.deltaChange).toBe(2);
    expect(r.note).toContain("higher than usual");
  });

  it("reports falling effort — the same work feeling easier", () => {
    const r = analyseRpeTrend([
      ...week("2026-07-27", 5),
      ...week("2026-08-03", 5),
      ...week("2026-08-10", 3),
    ]);
    expect(r.direction).toBe("falling");
    expect(r.note).toContain("easier");
  });

  it("small movement is steady, not a finding", () => {
    const r = analyseRpeTrend([
      ...week("2026-07-27", 3),
      ...week("2026-08-03", 3),
      ...week("2026-08-10", 3),
    ]);
    expect(r.direction).toBe("steady");
  });

  it("EXCLUDES illness weeks from the baseline rather than blaming training", () => {
    // Jackson's case. Two normal weeks, then a fortnight ill and rating
    // everything high. Without the exclusion this reads as accumulating
    // training fatigue and the advice would be to back off the training —
    // when the answer is that he was unwell.
    const r = analyseRpeTrend([
      ...week("2026-07-20", 3),
      ...week("2026-07-27", 3),
      ...week("2026-08-03", 7, "easy", { health_affected: true }),
      ...week("2026-08-10", 7, "easy", { health_affected: true }),
    ]);
    expect(r.excludedWeeks).toBe(2);
    expect(r.note).toContain("illness or injury");
    // The two clean weeks were identical, so nothing is claimed about a trend.
    expect(r.direction).toBe("steady");
  });

  it("says so plainly when illness leaves too little to compare", () => {
    const r = analyseRpeTrend([
      ...week("2026-08-03", 7, "easy", { health_affected: true }),
      ...week("2026-08-10", 3),
    ]);
    expect(r.direction).toBe("unknown");
    expect(r.deltaChange).toBeNull();
    expect(r.note).toContain("Not enough weeks unaffected");
  });

  it("refuses to conclude from one week, or from thin weeks", () => {
    expect(analyseRpeTrend(week("2026-08-10", 3)).direction).toBe("unknown");
    // One rated session a week is not a week.
    const thin = analyseRpeTrend([
      s("2026-07-27", 3, "easy"),
      s("2026-08-03", 8, "easy"),
      s("2026-08-10", 8, "easy"),
    ]);
    expect(thin.direction).toBe("unknown");
  });

  it("degenerate input", () => {
    expect(analyseRpeTrend([]).direction).toBe("unknown");
    expect(() => analyseRpeTrend(null as any)).not.toThrow();
  });
});
