import { describe, it, expect } from "vitest";
import {
  buildFillPlan,
  applyFillPlan,
  detectFillCollisions,
  applyCollisionPolicy,
  computeCampaignWriteBacks,
  buildFillRows,
  defaultAlignmentForPhase,
  isIsoDate,
  type FillTargetWeek,
  type RemappableDraft,
} from "../campaign-fill";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function week(n: number, start: string, loadPct = 100, extra: Partial<FillTargetWeek> = {}): FillTargetWeek {
  return {
    id: `w${n}`,
    weekNumber: n,
    weekStart: start,
    loadPct,
    isDeload: false,
    phase: "base",
    isLocked: false,
    ...extra,
  };
}

/** Six consecutive Mondays from 2026-09-14 (a real Monday). */
const MONDAYS = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];

function blockOf(n: number, loads?: number[]): FillTargetWeek[] {
  return Array.from({ length: n }, (_, i) => week(i + 1, MONDAYS[i], loads?.[i] ?? 100));
}

function draft(weekNumber: number, dayOffset: number, startDate: string, title: string): RemappableDraft {
  const d = new Date(Date.parse(`${startDate}T00:00:00Z`) + ((weekNumber - 1) * 7 + dayOffset) * 86400000);
  return {
    tempId: `${weekNumber}-${dayOffset + 1}`,
    sourceSessionId: `${weekNumber}-${dayOffset + 1}`,
    athlete_id: "",
    week_number: weekNumber,
    session_date: d.toISOString().slice(0, 10),
    title,
    day_type: "training",
    intent: "easy",
    structure: "continuous",
    is_long_run: false,
    bucket: "easy",
    needsReview: false,
    steps: [{ kind: "work", reps: 1, target_kind: "distance", target_distance_m: 10000 }] as any,
    session_template_id: null,
  };
}

// ---------------------------------------------------------------------------

describe("isIsoDate", () => {
  it("accepts a real date and rejects rollovers and partials", () => {
    expect(isIsoDate("2026-09-14")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false); // Date.parse would roll this to March
    expect(isIsoDate("2026-11-")).toBe(false); // what a date input emits mid-typing
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("defaultAlignmentForPhase", () => {
  it("tail-aligns only taper and race week", () => {
    expect(defaultAlignmentForPhase("taper")).toBe("tail");
    expect(defaultAlignmentForPhase("race_week")).toBe("tail");
    expect(defaultAlignmentForPhase("base")).toBe("head");
    expect(defaultAlignmentForPhase("build")).toBe("head");
    expect(defaultAlignmentForPhase("peak")).toBe("head");
    expect(defaultAlignmentForPhase(null)).toBe("head");
  });
});

describe("buildFillPlan — exact fit", () => {
  it("maps one to one and drops nothing", () => {
    const p = buildFillPlan({
      weeks: blockOf(4),
      templateDurationWeeks: 4,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([1, 2, 3, 4]);
    expect(p.templateWeeksDropped).toEqual([]);
    expect(p.slots.every((s) => !s.isRepeat)).toBe(true);
    expect(p.startDate).toBe("2026-09-14");
  });
});

describe("buildFillPlan — template shorter than block", () => {
  it("repeats from week 1 by default", () => {
    const p = buildFillPlan({
      weeks: blockOf(6),
      templateDurationWeeks: 4,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([1, 2, 3, 4, 1, 2]);
    expect(p.slots.map((s) => s.isRepeat)).toEqual([false, false, false, false, true, true]);
    expect(p.templateWeeksDropped).toEqual([]);
  });

  it("leaves the shortfall empty when told to", () => {
    const p = buildFillPlan({
      weeks: blockOf(6),
      templateDurationWeeks: 4,
      alignment: "head",
      shortfall: "leave_empty",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([1, 2, 3, 4, null, null]);
    expect(p.weekOverrides).toHaveLength(4);
    expect(p.notes.some((n) => n.includes("left empty"))).toBe(true);
  });

  it("tail alignment with a shorter template puts the repeat at the FRONT", () => {
    // The template's last week must land on the block's last week, so the
    // opening two slots are the ones that fall short.
    const p = buildFillPlan({
      weeks: blockOf(6),
      templateDurationWeeks: 4,
      alignment: "tail",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([3, 4, 1, 2, 3, 4]);
    // The negative-index modulo is the thing being checked here: a naive
    // rawIndex % duration would give -2 and -1 and blow up.
    expect(p.slots.every((s) => (s.templateWeekNumber ?? 1) >= 1)).toBe(true);
  });
});

describe("buildFillPlan — template longer than block", () => {
  it("head alignment drops the tail", () => {
    const p = buildFillPlan({
      weeks: blockOf(3),
      templateDurationWeeks: 6,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([1, 2, 3]);
    expect(p.templateWeeksDropped).toEqual([4, 5, 6]);
    expect(p.notes.some((n) => n.includes("head-aligned"))).toBe(true);
  });

  it("tail alignment drops the head — the taper case", () => {
    const p = buildFillPlan({
      weeks: blockOf(3),
      templateDurationWeeks: 6,
      alignment: "tail",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.templateWeekNumber)).toEqual([4, 5, 6]);
    expect(p.templateWeeksDropped).toEqual([1, 2, 3]);
  });
});

describe("buildFillPlan — load bridging", () => {
  it("converts load_pct to a volume delta", () => {
    const p = buildFillPlan({
      weeks: blockOf(4, [100, 110, 115, 70]),
      templateDurationWeeks: 4,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.volumePct)).toEqual([0, 10, 15, -30]);
    expect(p.weekOverrides.map((o) => o.volumePct)).toEqual([0, 10, 15, -30]);
    // Keyed by CAMPAIGN week number, which is what the remapped drafts carry.
    expect(p.weekOverrides.map((o) => o.fromWeek)).toEqual([1, 2, 3, 4]);
  });

  it("a deload week needs no separate cutback — its load already carries it", () => {
    const p = buildFillPlan({
      weeks: blockOf(4, [100, 105, 110, 70]).map((w, i) => (i === 3 ? { ...w, isDeload: true } : w)),
      templateDurationWeeks: 4,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots[3].isDeload).toBe(true);
    expect(p.slots[3].volumePct).toBe(-30); // once, not twice
  });

  it("ignores campaign load when told to, and says so", () => {
    const p = buildFillPlan({
      weeks: blockOf(3, [100, 130, 70]),
      templateDurationWeeks: 3,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: false,
    });
    expect(p.slots.map((s) => s.volumePct)).toEqual([0, 0, 0]);
    expect(p.slots.map((s) => s.loadPct)).toEqual([100, 130, 70]); // carried, not applied
    expect(p.notes.some((n) => n.includes("Campaign load is turned off"))).toBe(true);
  });
});

describe("buildFillPlan — degenerate input", () => {
  it("returns an empty plan rather than throwing on a zero-week template", () => {
    const p = buildFillPlan({
      weeks: blockOf(4),
      templateDurationWeeks: 0,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots).toEqual([]);
    expect(p.notes[0]).toContain("no weeks defined");
  });

  it("survives NaN duration", () => {
    const p = buildFillPlan({
      weeks: blockOf(4),
      templateDurationWeeks: NaN,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots).toEqual([]);
  });

  it("drops weeks with an unusable week_start instead of throwing", () => {
    const bad = [...blockOf(2), { ...week(3, "2026-11-"), weekNumber: 3 }];
    const p = buildFillPlan({
      weeks: bad,
      templateDurationWeeks: 3,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots).toHaveLength(2);
  });

  it("sorts unordered weeks before mapping", () => {
    const p = buildFillPlan({
      weeks: [week(3, MONDAYS[2]), week(1, MONDAYS[0]), week(2, MONDAYS[1])],
      templateDurationWeeks: 3,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(p.slots.map((s) => s.weekStart)).toEqual([MONDAYS[0], MONDAYS[1], MONDAYS[2]]);
  });
});

describe("applyFillPlan", () => {
  const START = "2026-09-14";
  const rawDrafts = [
    draft(1, 1, START, "Tue easy"),
    draft(1, 3, START, "Thu threshold"),
    draft(2, 1, START, "Tue easy"),
    draft(2, 3, START, "Thu threshold"),
  ];

  it("re-dates drafts onto their slot's week and renumbers to campaign weeks", () => {
    const plan = buildFillPlan({
      weeks: blockOf(2),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const { drafts } = applyFillPlan(rawDrafts, plan, START);
    expect(drafts.map((d) => d.session_date)).toEqual([
      "2026-09-15",
      "2026-09-17",
      "2026-09-22",
      "2026-09-24",
    ]);
    expect(drafts.map((d) => d.week_number)).toEqual([1, 1, 2, 2]);
  });

  it("emits a repeated template week twice, at different dates and loads", () => {
    const plan = buildFillPlan({
      weeks: blockOf(3, [100, 100, 120]),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const { drafts } = applyFillPlan(rawDrafts, plan, START);
    expect(drafts).toHaveLength(6); // 2 template weeks -> 3 campaign weeks
    // Week 3 repeats template week 1 at 120% — same shape, larger volume.
    const wk3 = drafts.filter((d) => d.week_number === 3);
    expect(wk3.map((d) => d.session_date)).toEqual(["2026-09-29", "2026-10-01"]);
    const wk1Work: any = drafts.find((d) => d.week_number === 1)!.steps[0];
    const wk3Work: any = wk3[0].steps[0];
    expect(wk3Work.target_distance_m).toBeGreaterThan(wk1Work.target_distance_m);
  });

  it("gives every emitted draft a unique tempId even across a repeat", () => {
    const plan = buildFillPlan({
      weeks: blockOf(4),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const { drafts } = applyFillPlan(rawDrafts, plan, START);
    expect(new Set(drafts.map((d) => d.tempId)).size).toBe(drafts.length);
  });

  it("emits nothing for slots left empty", () => {
    const plan = buildFillPlan({
      weeks: blockOf(4),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "leave_empty",
      applyCampaignLoad: true,
    });
    const { drafts } = applyFillPlan(rawDrafts, plan, START);
    expect(drafts.every((d) => d.week_number <= 2)).toBe(true);
  });

  it("returns empty rather than throwing on a partial start date", () => {
    const plan = buildFillPlan({
      weeks: blockOf(2),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    expect(applyFillPlan(rawDrafts, plan, "2026-09-").drafts).toEqual([]);
  });

  it("leaves an unscalable day untouched rather than dropping it", () => {
    const rest = { ...draft(1, 5, START, "Cross-train"), bucket: null };
    const plan = buildFillPlan({
      weeks: blockOf(1, [130]),
      templateDurationWeeks: 1,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const { drafts } = applyFillPlan([rest], plan, START);
    expect(drafts).toHaveLength(1);
    expect((drafts[0].steps[0] as any).target_distance_m).toBe(10000);
  });
});

describe("collisions", () => {
  const START = "2026-09-14";
  const plan = buildFillPlan({
    weeks: blockOf(2),
    templateDurationWeeks: 2,
    alignment: "head",
    shortfall: "repeat",
    applyCampaignLoad: true,
  });
  const { drafts } = applyFillPlan(
    [draft(1, 1, START, "Tue easy"), draft(1, 3, START, "Thu threshold"), draft(2, 1, START, "Tue easy")],
    plan,
    START,
  );

  it("finds only days that already have something on them", () => {
    const existing = new Map([["2026-09-15", ["Morning Run"]]]);
    const c = detectFillCollisions(drafts, existing);
    expect(c).toHaveLength(1);
    expect(c[0].date).toBe("2026-09-15");
    expect(c[0].existingTitles).toEqual(["Morning Run"]);
  });

  it("proceed keeps everything", () => {
    const c = detectFillCollisions(drafts, new Map([["2026-09-15", ["Morning Run"]]]));
    expect(applyCollisionPolicy(drafts, c, "proceed")).toHaveLength(drafts.length);
  });

  it("skip drops only the clashing day, not its week", () => {
    const c = detectFillCollisions(drafts, new Map([["2026-09-15", ["Morning Run"]]]));
    const kept = applyCollisionPolicy(drafts, c, "skip");
    expect(kept.map((d) => d.session_date)).toEqual(["2026-09-17", "2026-09-22"]);
  });
});

describe("computeCampaignWriteBacks", () => {
  const plan = buildFillPlan({
    weeks: blockOf(3, [100, 110, 115]),
    templateDurationWeeks: 3,
    alignment: "head",
    shortfall: "repeat",
    applyCampaignLoad: true,
  });

  it("reports only weeks the coach actually changed", () => {
    const out = computeCampaignWriteBacks(plan.slots, new Map([[2, 95], [3, 115]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ campaignWeekNumber: 2, fromLoadPct: 110, toLoadPct: 95 });
  });

  it("returns nothing when the coach changed nothing", () => {
    expect(computeCampaignWriteBacks(plan.slots, new Map())).toEqual([]);
  });

  it("ignores a slot that was left empty", () => {
    const empty = buildFillPlan({
      weeks: blockOf(3, [100, 110, 115]),
      templateDurationWeeks: 1,
      alignment: "head",
      shortfall: "leave_empty",
      applyCampaignLoad: true,
    });
    expect(computeCampaignWriteBacks(empty.slots, new Map([[3, 90]]))).toEqual([]);
  });
});

describe("buildFillRows", () => {
  it("emits one row per filled slot, snapshotting the load", () => {
    const plan = buildFillPlan({
      weeks: blockOf(3, [100, 110, 70]),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const rows = buildFillRows(plan.slots, "plan-1", "tmpl-1", "Base 4wk");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.template_week_number)).toEqual([1, 2, 1]);
    expect(rows.map((r) => r.is_repeat)).toEqual([false, false, true]);
    expect(rows.map((r) => r.load_pct_applied)).toEqual([100, 110, 70]);
  });

  it("records 100 when campaign load was ignored", () => {
    const plan = buildFillPlan({
      weeks: blockOf(2, [100, 130]),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: false,
    });
    const rows = buildFillRows(plan.slots, "plan-1", null, null);
    expect(rows.map((r) => r.load_pct_applied)).toEqual([100, 100]);
  });
});

// ---------------------------------------------------------------------------
// Fuzz. The generator shipped a `new Array(NaN)` RangeError past every
// hand-written case last session because `NaN < 3` is false, so a NaN sailed
// through the guard. Everything below is about not throwing.
// ---------------------------------------------------------------------------

describe("fuzz — buildFillPlan never throws", () => {
  const NASTY: any[] = [NaN, undefined, null, "", "abc", -1, 0, 0.5, 1, 3, 400, Infinity, -Infinity];
  const LOADS: any[] = [NaN, undefined, null, "", 30, 100, 150, -5, 1e9, Infinity];

  it("survives every combination of duration, alignment, shortfall and load", () => {
    let ran = 0;
    for (const duration of NASTY) {
      for (const alignment of ["head", "tail", undefined, "sideways"] as any[]) {
        for (const shortfall of ["repeat", "leave_empty", undefined, "?"] as any[]) {
          for (const load of LOADS) {
            for (const applyCampaignLoad of [true, false]) {
              const weeks = blockOf(3).map((w) => ({ ...w, loadPct: load }));
              expect(() =>
                buildFillPlan({ weeks, templateDurationWeeks: duration, alignment, shortfall, applyCampaignLoad }),
              ).not.toThrow();
              const p = buildFillPlan({
                weeks,
                templateDurationWeeks: duration,
                alignment,
                shortfall,
                applyCampaignLoad,
              });
              // Whatever comes out, a template week number must be a usable
              // 1-based index or an explicit null — never 0, never negative,
              // never NaN. This is the invariant the negative modulo protects.
              for (const s of p.slots) {
                if (s.templateWeekNumber !== null) {
                  expect(Number.isInteger(s.templateWeekNumber)).toBe(true);
                  expect(s.templateWeekNumber).toBeGreaterThanOrEqual(1);
                }
                expect(Number.isFinite(s.volumePct)).toBe(true);
              }
              ran++;
            }
          }
        }
      }
    }
    expect(ran).toBeGreaterThan(1000);
  });

  it("survives malformed week arrays", () => {
    const junk: any[] = [
      [],
      [null],
      [undefined],
      [{}],
      [{ weekNumber: NaN, weekStart: "2026-09-14", loadPct: 100 }],
      [{ weekNumber: 1, weekStart: null, loadPct: 100 }],
      [{ weekNumber: 1, weekStart: "2026-02-31", loadPct: 100 }],
      [{ weekNumber: 1, weekStart: "2026-09-14", loadPct: "lots" }],
    ];
    for (const weeks of junk) {
      expect(() =>
        buildFillPlan({
          weeks,
          templateDurationWeeks: 4,
          alignment: "head",
          shortfall: "repeat",
          applyCampaignLoad: true,
        }),
      ).not.toThrow();
    }
  });
});

describe("fuzz — applyFillPlan never throws", () => {
  it("survives malformed drafts", () => {
    const plan = buildFillPlan({
      weeks: blockOf(3),
      templateDurationWeeks: 2,
      alignment: "head",
      shortfall: "repeat",
      applyCampaignLoad: true,
    });
    const junk: any[] = [
      [],
      [null],
      [{ week_number: NaN, session_date: "2026-09-14", steps: [] }],
      [{ week_number: 1, session_date: "nope", steps: [] }],
      [{ week_number: 1, session_date: "2026-09-14", steps: null }],
      [{ week_number: -3, session_date: "2026-09-14", steps: [] }],
      // week_number and date disagreeing — the clamp path
      [{ week_number: 1, session_date: "2027-01-01", steps: [], bucket: "easy", title: "x" }],
    ];
    for (const drafts of junk) {
      expect(() => applyFillPlan(drafts, plan, "2026-09-14")).not.toThrow();
    }
  });
});
