// campaign-generator.ts
//
// Lays out a season: blocks, phases and weekly load targets, between a start
// date and the last race.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// Produce sessions. Coaches work two ways — some build a whole season up front
// and adjust as they go, others sketch the structure and fill a block at a
// time. Generating sessions here would force a choice between them. The
// campaign asserts structure only; filling a block is a separate action using
// the plan templates and volume progression that already exist.
//
// It also doesn't emit kilometres. load_pct is relative — 100 is the athlete's
// normal loading week — because absolute volume depends on training history
// this generator can't see, and a number invented here would look authoritative
// while being a guess.
//
// WHY IT ISN'T "COUNT BACK FROM RACE DAY"
//
// That suits one marathon. A middle-distance season is a dozen races with a
// peak reserved for one or two and the rest run through or lightly freshened.
// So the generator lays out AROUND targets of differing priority rather than
// backwards from a single date.

export type Phase = "reset" | "base" | "build" | "peak" | "taper" | "transition" | "race_week";

/**
 * What a race is FOR, which decides what happens to the week around it.
 *
 *   peak     full taper, the season's target — Nationals
 *   key      short taper, races that matter — State champs and similar
 *   tune_up  a few days easier, no taper week
 *   training raced through; volume held, sessions moved away from lactic work
 *
 * 'key' exists because an AU track season has one or two races before
 * Christmas that matter, then State and several others, before a single true
 * peak. Forcing those into either tune_up or peak misrepresented both.
 */
export type TargetPriority = "peak" | "key" | "tune_up" | "training";

export interface CampaignTarget {
  raceDate: string; // ISO yyyy-mm-dd
  name?: string | null;
  priority: TargetPriority;
  /** Where this race came from, when it was picked rather than typed. The
   *  generator ignores both — they exist so the campaign can be saved with
   *  the link intact rather than duplicating a date that already exists as a
   *  goal or a calendar entry. */
  athleteGoalId?: string | null;
  raceScheduleEntryId?: string | null;
}

export interface CampaignSettings {
  startsOn: string;
  /** Weeks of loading between deloads. */
  loadWeeks: number;
  /** Deload weeks after each loading run. */
  deloadWeeks: number;
  /** Deloads on a fixed rhythm suit some coaches and not others. */
  deloadsEnabled?: boolean;
  /** Taper length before a `peak` target. */
  taperWeeks: number;
  /** Shorter taper before a `key` race. */
  keyTaperWeeks?: number;
  /**
   * Load in race week, as a percentage of a normal loading week.
   *
   * Was hardcoded at 55. That suits an athlete who sharpens on a deep taper
   * and is wrong for one who detrains on it — at a 90km baseline it is the
   * difference between 50km and 63km in race week.
   */
  taperFloorPct?: number;
  /**
   * How the taper gets to that floor.
   *   linear  even steps down
   *   gentle  holds load, then drops late — for athletes who need the work
   *   steep   sheds early and coasts in — for athletes who arrive tired
   */
  taperShape?: "linear" | "gentle" | "steep";
  /**
   * Taper length in DAYS. When set, overrides taperWeeks.
   *
   * Coaches taper in days — "ten days out" — and a week grid was forcing that
   * onto Mondays: a one-week taper gave eleven reduced days into a Thursday
   * race and fourteen into a Sunday one. With days, the taper starts on a
   * real date and each week's load is averaged across its own seven days, so
   * the same ten days produce different weeks depending on where the race
   * falls. Weeks remain the storage and display unit.
   */
  taperDays?: number | null;
  keyTaperDays?: number | null;
  /** 'flat' holds the block's top figure; deloads then provide the variation. */
  baseProgression?: "progressive" | "flat";
  buildProgression?: "progressive" | "flat";
  /**
   * Overload placement.
   *
   * weeksBefore is measured from the RACE, not from the taper, because what
   * matters is how long the athlete has to absorb the work. Placing it
   * against the taper made the taper shed the overload's fatigue and sharpen
   * at the same time, and the athlete arrives flat.
   */
  overloadWeeksBeforeRace?: number;
  overloadBlockWeeks?: number;
  /** Key races get their own overload block too, not just peaks. */
  overloadBeforeKey?: boolean;
  /**
   * How the taper week is STRUCTURED, as opposed to how much volume it holds.
   *
   * A traditional taper cuts days from the week; a short one keeps every day
   * and shortens each session. Same weekly volume, entirely different week —
   * and load_pct cannot tell them apart, so it's carried through as intent
   * for whoever fills the block rather than folded into a number.
   */
  taperFrequencyMode?: "fewer_days" | "same_days_shorter";
  /** Extra non-training days in a taper week, on top of normal rest. */
  taperRestDaysAdded?: number;
  /** How much each remaining session shortens. */
  taperSessionReduction?: "minimal" | "moderate" | "large";
  /** Set only when the coach wants a floor that differs from the structure. */
  taperFloorOverride?: boolean;
  /** Keep tone through the taper with frequent, very short speed inputs. */
  taperNeuromuscular?: boolean;
  /** Quality sessions per week. 0.5 = every second week. */
  baseQualityPerWeek?: number;
  buildQualityPerWeek?: number;
  /**
   * Explicit end date for the campaign.
   *
   * Without one the campaign ends at the last race, which has two problems: a
   * season that finishes with transition weeks can't be expressed at all, and
   * the whole shape shifts every time a race is added or moved. The window
   * should be the coach's decision, with races placed INSIDE it.
   *
   * Ignored if it falls before the last race — a campaign can't end before
   * the thing it's built around.
   */
  endsOn?: string | null;
  /** Down weeks at the START — the break after the previous season. */
  resetWeeks?: number;
  /** Recovery after a peak race before normal training resumes. */
  postPeakRecoveryWeeks?: number;
  /** Kept for campaigns created before the down period moved to the front. */
  transitionWeeks?: number;
  targets: CampaignTarget[];

  /**
   * Load levels, all overridable.
   *
   * Every one of these started as a constant and every one has turned out
   * wrong for some coach: race weeks were dropping to 85% when 10-20% off is
   * more typical, deloads were assumed on a fixed fourth week. A generator
   * that hard-codes these is asserting a coaching philosophy it has no
   * business asserting.
   */
  loads?: Partial<{
    deload: number;
    raceWeekReduction: number;
    peak: number;
    baseStart: number;
    baseTop: number;
    buildStart: number;
    buildTop: number;
    reset: number;
  }>;
}

export interface GeneratedWeek {
  weekNumber: number;
  weekStart: string;
  phase: Phase;
  loadPct: number;
  isDeload: boolean;
  /** Set when this week contains a target race. */
  raceName?: string | null;
  racePriority?: TargetPriority | null;
  /** Quality sessions planned this week, from the phase default. */
  qualitySessions?: number | null;
  /** Not set by the generator — carried on weeks loaded from the database, so
   *  the timeline can mark weeks a coach has edited and regeneration can skip
   *  them. Present here so one type serves both a freshly generated preview
   *  and a saved campaign. */
  isLocked?: boolean;
  /** Database id, on saved weeks only. */
  id?: string;
  /** Mon=1 .. Sun=7, on race weeks. Drives the part-week load below. */
  raceDayOfWeek?: number | null;
  /**
   * Reduced-load days actually leading into the race, counting the taper
   * weeks plus the pre-race part of race week.
   *
   * Weeks are Monday-based, so a race on Thursday means the athlete is down
   * for the whole taper week PLUS Mon-Thu — eleven days on what the settings
   * call a one-week taper. Surfaced rather than silently corrected, because
   * whether eleven days is too many depends on the athlete.
   */
  taperDaysIntoRace?: number | null;
}

export interface GeneratedBlock {
  blockOrder: number;
  phase: Phase;
  label: string;
  startsOn: string;
  endsOn: string;
  weeks: number;
}

export interface GeneratedCampaign {
  blocks: GeneratedBlock[];
  weeks: GeneratedWeek[];
  /** Things the coach should know about how this was laid out. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Load levels, as a percentage of a normal loading week.
//
// Chosen to be conservative and legible rather than precise: the campaign is a
// starting point a coach edits, so round numbers that are easy to reason about
// beat a curve that looks authoritative. A coach can see at a glance that a
// peak week is "about 15% up on normal" and disagree.
// ---------------------------------------------------------------------------
/**
 * True only for a complete, real yyyy-mm-dd.
 *
 * A date input emits PARTIAL values while being typed — "2026-11-" on the way
 * to "2026-11-26" — and every date helper here ends in toISOString(), which
 * throws RangeError on an invalid date. That throw lands mid-render, unmounts
 * the route and bounces the user off the page, which is exactly what happened
 * when a race date was being entered.
 *
 * Checked with a regex as well as a parse: `new Date("2026-13-45")` is invalid
 * as expected, but plenty of malformed strings parse to something plausible
 * and would pass a parse-only check.
 */
/**
 * Race-week volume implied by the STRUCTURE of the week.
 *
 * The structure is the real decision. A coach thinks "two days off, sessions
 * a bit shorter" — the percentage is what falls out of that, not a separate
 * choice to be reconciled against it.
 *
 * An earlier version had the coach set both and warned when they disagreed,
 * which put the burden the wrong way round: told that two days off implies
 * 64% rather than the 35% they typed, the answer is almost never "add a third
 * rest day". They know how many days off the athlete needs. The number should
 * follow.
 *
 * Session factors are deliberately coarse. They describe an intent — barely,
 * noticeably, substantially — and pretending to more precision than that
 * would be inventing it.
 */
export function deriveTaperFloor(
  restDaysAdded: number,
  sessionReduction: "minimal" | "moderate" | "large",
): number {
  const factor = { minimal: 0.9, moderate: 0.75, large: 0.55 }[sessionReduction] ?? 0.75;
  const rest = Math.max(0, Math.min(3, Math.round(restDaysAdded)));
  return Math.max(20, Math.min(95, Math.round(100 * ((7 - rest) / 7) * factor)));
}

export function isValidIsoDate(iso: string | null | undefined): boolean {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

/**
 * A yyyy-mm-dd as UTC midnight.
 *
 * ALL date arithmetic here is UTC, deliberately. Local dates break twice:
 *
 *   toISOString() on a local midnight returns the previous day in any UTC+
 *   zone, so Monday 14 September came back as the 13th;
 *
 *   and a span crossing a DST change is not a whole number of days. Melbourne
 *   to March is 174.958 days, so `Math.floor(days / 7)` gave 24 weeks instead
 *   of 25 and every date after the October change landed a week early.
 *
 * UTC has neither problem. These are calendar dates with no time component —
 * a training week starts on a Monday wherever the athlete is — so there is
 * nothing to gain from local time and two ways to get it wrong.
 */
function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * A Date back to yyyy-mm-dd, using its LOCAL components.
 *
 * toISOString() converts to UTC first, and every date here is constructed as
 * local midnight — which in any UTC+ zone is the previous afternoon in UTC.
 * In Melbourne that meant Monday 14 September came back as 13 September, and
 * because mondayOf() then walked back from a Sunday, whole weeks shifted.
 *
 * This is the `athletes.timezone` defaulting to UTC problem in a different
 * disguise: anything that round-trips a date through UTC is wrong for an
 * athlete who isn't in it.
 */
function isoOf(d: Date): string {
  // Safe now that every Date here is UTC midnight.
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

/** Monday of the week containing this date. Weeks are Monday-based throughout Strider. */
export function mondayOf(iso: string): string {
  // Returns the input unchanged rather than throwing on a partial date —
  // callers treat an unparseable value as "not ready yet".
  if (!isValidIsoDate(iso)) return iso;
  const d = toDate(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return isoOf(d);
}

function weeksBetween(startIso: string, endIso: string): number {
  const ms = toDate(endIso).getTime() - toDate(startIso).getTime();
  // ROUND, not floor. Both dates are Monday-aligned UTC midnights so the span
  // is already a whole number of weeks; rounding means a stray hour from any
  // future source can't silently drop one.
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Lays out the season.
 *
 * Approach: find the peak targets, work out where each one's taper must sit,
 * and fill everything before them with base and build blocks. What's left over
 * after the last target becomes transition.
 *
 * A short runway gets fewer phases, not a refusal — with six weeks to a race
 * there is no time for two base blocks, so it produces build and taper and
 * says so in the notes rather than declining to generate.
 */
export function generateCampaign(settings: CampaignSettings): GeneratedCampaign {
  const notes: string[] = [];
  const L = {
    deload: settings.loads?.deload ?? 70,
    raceWeekReduction: settings.loads?.raceWeekReduction ?? 15,
    peak: settings.loads?.peak ?? 115,
    baseStart: settings.loads?.baseStart ?? 85,
    baseTop: settings.loads?.baseTop ?? 100,
    buildStart: settings.loads?.buildStart ?? 95,
    buildTop: settings.loads?.buildTop ?? 110,
    reset: settings.loads?.reset ?? 50,
  };
  /**
   * Every numeric setting is coerced at the boundary.
   *
   * These come from number inputs, and an input mid-edit can hand over NaN or
   * undefined. Guarding each use site individually is how one gets missed —
   * clamping once, here, means nothing downstream has to think about it.
   */
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const resetWeeks = num(settings.resetWeeks, 0, 0, 12);
  const keyTaper = num(settings.keyTaperWeeks, 1, 0, 6);
  const postPeak = num(settings.postPeakRecoveryWeeks, 1, 0, 6);
  const deloadsOn = settings.deloadsEnabled !== false && num(settings.deloadWeeks, 1, 0, 4) > 0;
  // Derived from the structure unless the coach has overridden it. An
  // override is a deliberate act — "I want this deeper than the structure
  // suggests" — and is respected as stated.
  const taperFloor = settings.taperFloorOverride
    ? num(settings.taperFloorPct, 55, 20, 100)
    : deriveTaperFloor(num(settings.taperRestDaysAdded, 1, 0, 3), settings.taperSessionReduction ?? "moderate");
  const overloadBefore = num(settings.overloadWeeksBeforeRace, 3, 1, 8);
  const overloadLen = num(settings.overloadBlockWeeks, 1, 0, 3);
  const overloadForKey = settings.overloadBeforeKey !== false;
  // The remaining three, coerced once so no use site handles a raw value.
  // taperWeeks reached taperDaysFor() unclamped and Infinity * 7 produced a
  // date arithmetic throw further down — the last hole in the fuzz.
  const taperWeeks = num(settings.taperWeeks, 2, 0, 8);
  const loadWeeksN = num(settings.loadWeeks, 3, 1, 12);
  const deloadWeeksN = num(settings.deloadWeeks, 1, 0, 4);
  const taperShape = settings.taperShape ?? "linear";

  /**
   * Load for a taper week, `weeksOut` weeks before the race.
   *
   * Curved via an exponent on the normalised position rather than by special
   * cases: one expression covers all three shapes and any taper length, and
   * the floor is hit exactly in race week whatever the shape.
   */
  /** Mon=1 .. Sun=7 for an ISO date. */
  function dayOfWeek(iso: string): number {
    const d = toDate(iso);
    return ((d.getUTCDay() + 6) % 7) + 1;
  }

  function taperLoad(weeksOut: number, len: number, peakLoad: number): number {
    const p = (weeksOut - 1) / Math.max(1, len); // 1 at the start, 0 at the race
    const exp = taperShape === "gentle" ? 0.55 : taperShape === "steep" ? 1.8 : 1;
    return Math.round(taperFloor + (peakLoad - taperFloor) * Math.pow(p, exp));
  }

  /**
   * Quality sessions in a given week.
   *
   * Whole numbers pass straight through. A fraction below 1 is spread: 0.5
   * lands on every second week, 0.33 on every third, 0.25 on every fourth —
   * counted from the start of the campaign so the spacing stays even across
   * block boundaries rather than restarting and bunching two together.
   */
  function qualityForWeek(phase: Phase, weekIndex: number): number | null {
    const density =
      phase === "build" || phase === "peak"
        ? num(settings.buildQualityPerWeek, 2, 0, 5)
        : phase === "base"
          ? num(settings.baseQualityPerWeek, 0.5, 0, 5)
          : NaN;
    if (!Number.isFinite(density)) return null;
    if (density <= 0) return 0;
    if (density >= 1) return Math.round(density);
    const everyN = Math.round(1 / density); // 0.5 -> 2, 0.33 -> 3, 0.25 -> 4
    return weekIndex % everyN === 0 ? 1 : 0;
  }

  /** Ramp value for phase `ph` at week index `i`. */
  function rampeAt(from: number, to: number, ph: Phase, i: number): number {
    const total = phases.filter((p) => p === ph).length;
    const nth = phases.slice(0, i + 1).filter((p) => p === ph).length;
    return Math.round(from + ((to - from) * (nth - 1)) / Math.max(1, total - 1));
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const taperExp = taperShape === "gentle" ? 0.55 : taperShape === "steep" ? 1.8 : 1;

  /**
   * A week's load when the taper is measured in DAYS.
   *
   * Averages across the week's seven days, placing each one on the taper curve
   * individually: days before the taper starts sit at the pre-taper load, days
   * inside it follow the curve, days after the race ease back. A week that
   * straddles the taper start therefore comes out part-way, which is exactly
   * what happens in reality and what a week-index calculation could never
   * express.
   */
  function dayTaperWeekLoad(
    weekStartIso: string,
    raceIso: string,
    days: number,
    preTaperLoad: number,
    /** Overrides the campaign floor — used to solve for a target week load. */
    floorOverrideValue?: number,
  ): number {
    // preTaperLoad is the load the week would otherwise carry. Passing the
    // OVERLOAD figure here was the bug behind "race weeks at overload
    // volume": with a short taper the pre-taper days dominate the average, so
    // the week inherited 115% from a block it wasn't in.
    const race = toDate(raceIso).getTime();
    const taperStart = race - days * DAY_MS;
    const fl = floorOverrideValue ?? taperFloor;
    const postRaceLoad = fl * 1.15;
    const ws = toDate(weekStartIso).getTime();
    let sum = 0;
    for (let k = 0; k < 7; k++) {
      const day = ws + k * DAY_MS;
      if (day > race) {
        sum += postRaceLoad;
      } else if (day <= taperStart) {
        sum += preTaperLoad;
      } else {
        const p = (race - day) / DAY_MS / days; // 1 at taper start, 0 at race
        sum += fl + (preTaperLoad - fl) * Math.pow(p, taperExp);
      }
    }
    // Unrounded: the caller solves against this, and rounding here would put
    // a step in an otherwise linear relationship.
    return sum / 7;
  }

  const taperDays = settings.taperDays == null ? null : num(settings.taperDays, 14, 1, 60);
  const keyTaperDays = settings.keyTaperDays == null ? null : num(settings.keyTaperDays, 7, 1, 40);

  /** Taper length in days for a target, whichever unit was configured. */
  function taperDaysFor(t: CampaignTarget): number {
    if (t.priority === "peak") return taperDays ?? taperWeeks * 7;
    if (t.priority === "key") return keyTaperDays ?? keyTaper * 7;
    return 0;
  }

  if (!isValidIsoDate(settings.startsOn)) {
    return { blocks: [], weeks: [], notes: ["Pick a start date."] };
  }

  const startMonday = mondayOf(settings.startsOn);
  // Half-typed race dates are dropped rather than parsed. The alternative is
  // a RangeError from toISOString() during render, which takes the whole page
  // down while someone is simply entering a date.
  const targets = [...settings.targets]
    .filter((t) => isValidIsoDate(t.raceDate))
    .sort((a, b) => a.raceDate.localeCompare(b.raceDate));

  if (targets.length === 0) {
    const incomplete = settings.targets.length > 0;
    return {
      blocks: [],
      weeks: [],
      notes: [
        incomplete
          ? "Finish entering the race date to see the season laid out."
          : "No target races set — a campaign needs at least one.",
      ],
    };
  }

  const lastTarget = targets[targets.length - 1];
  const lastRaceIdx = weeksBetween(startMonday, mondayOf(lastTarget.raceDate));
  // The window is the coach's, not the last race's. An explicit end extends
  // the campaign past the final race; anything shorter than the races is
  // ignored rather than truncating them.
  const explicitEndIdx =
    settings.endsOn && isValidIsoDate(settings.endsOn)
      ? weeksBetween(startMonday, mondayOf(settings.endsOn))
      : null;
  const totalWeeks = Math.max(
    lastRaceIdx + 1 + num(settings.transitionWeeks, 0, 0, 12),
    explicitEndIdx != null ? explicitEndIdx + 1 : 0,
  );

  // NaN-safe. `NaN < 3` is FALSE, so a NaN sailed straight past a plain
  // less-than check and reached `new Array(NaN)`, which throws
  // "RangeError: Invalid array length" — mid-render, taking the page down.
  // A number field left empty for a moment while being retyped is enough to
  // produce one.
  if (!Number.isFinite(totalWeeks) || totalWeeks < 3) {
    return {
      blocks: [],
      weeks: [],
      notes: [
        Number.isFinite(totalWeeks)
          ? "Less than three weeks to the first race — too short to structure. Plan these weeks directly."
          : "Check the week and taper numbers — one of them isn't a value the season can be built from.",
      ],
    };
  }

  const phases: Phase[] = new Array(totalWeeks).fill("base");
  const raceAt = new Map<number, CampaignTarget>();
  for (const t of targets) {
    const idx = weeksBetween(startMonday, mondayOf(t.raceDate));
    if (idx >= 0 && idx < totalWeeks) raceAt.set(idx, t);
  }

  // Reset first — the down weeks after the previous season, at the head of
  // this campaign rather than the tail of the last one.
  for (let i = 0; i < Math.min(resetWeeks, totalWeeks); i++) phases[i] = "reset";

  // Everything after the final race is transition — the deliberate rest that
  // ends a season, and the reason an explicit end date is worth having.
  for (let i = lastRaceIdx + 1; i < totalWeeks; i++) phases[i] = "transition";

  // Tapers. Length depends on what the race is FOR: a full taper before a
  // peak, a short one before a key race, none before a tune-up or a training
  // race — those keep their volume and change session type instead, which is
  // a decision for whoever fills the block, not for the structure.
  const peakIdxs: number[] = [];
  for (const [raceIdx, t] of raceAt) {
    // Weeks to MARK as taper. With a day-based taper this is how many weeks
    // the day window touches, so a 10-day taper marks two weeks and each gets
    // its own day-averaged load below.
    const dList = taperDaysFor(t);
    const taperLen = dList > 0 ? Math.ceil(dList / 7) : 0;
    // Ceil can reach one week further back than the taper actually touches —
    // a 10-day taper into a Thursday race spans two weeks, but into a Sunday
    // race the earlier week holds only one taper day. Marking a week whose
    // load is still full peak as "taper" is misleading, so each candidate is
    // checked against the real day window.
    const raceMs = toDate(t.raceDate).getTime();
    const taperStartMs = raceMs - dList * DAY_MS;
    for (let i = 1; i <= taperLen; i++) {
      const idx = raceIdx - i;
      const wkStart = toDate(addDays(startMonday, idx * 7)).getTime();
      const wkEnd = wkStart + 6 * DAY_MS;
      // A week needs at least THREE tapering days to be called a taper week.
      //
      // Counting any overlap at all produced weeks labelled "Taper" sitting
      // at 114% — a 7-day taper into a Saturday race puts one tapering day in
      // the previous week, which averages out to barely a reduction. A block
      // labelled taper that isn't tapering is worse than no label.
      const taperDaysInWeek = Math.max(
        0,
        Math.min(7, Math.round((wkEnd - Math.max(wkStart, taperStartMs)) / DAY_MS)),
      );
      if (taperDaysInWeek < 3) continue;
      // A taper is never overwritten by another race's week — a club race
      // inside a Nationals taper doesn't cancel the taper, it just happens
      // during it. Without this, training races were eating taper weeks and
      // a requested 2-week taper came out as 1.
      if (idx >= resetWeeks && !raceAt.has(idx)) phases[idx] = "taper";
    }
    if (t.priority === "peak") {
      // Walk back to the first free week rather than giving up if a club race
      // happens to sit exactly where the peak week would go. Losing the peak
      // block entirely because a minor race landed on it was the wrong
      // trade — the peak is the point of the campaign.
      // Placement is handled below, for every target that earns one — not
      // just this peak, and not against the taper.
    }
  }

  // Overload blocks — one per peak, and per key race when enabled.
  //
  // Positioned `overloadBefore` weeks back from the RACE, so there are normal
  // training weeks between the block and the taper for the work to be
  // absorbed. Placing it against the taper asked the taper to shed that
  // fatigue and sharpen simultaneously.
  //
  // Skips any week already claimed by a taper, a race or another overload,
  // walking back until it finds a free one — two races close together
  // shouldn't produce overlapping hard blocks.
  if (overloadLen > 0) {
    for (const [raceIdx, t] of raceAt) {
      if (t.priority !== "peak" && !(t.priority === "key" && overloadForKey)) continue;
      let idx = raceIdx - overloadBefore;
      while (
        idx >= resetWeeks &&
        (raceAt.has(idx) || phases[idx] === "taper" || phases[idx] === "peak" || phases[idx] === "reset")
      ) {
        idx -= 1;
      }
      if (idx < resetWeeks) continue;
      for (let k = 0; k < overloadLen; k++) {
        const at = idx - k;
        if (at < resetWeeks) break;
        if (raceAt.has(at) || phases[at] === "taper" || phases[at] === "peak") continue;
        phases[at] = "peak";
        peakIdxs.push(at);
      }
    }
  }

  // Recovery after a peak race, before training resumes.
  for (const [raceIdx, t] of raceAt) {
    if (t.priority !== "peak") continue;
    for (let i = 1; i <= postPeak; i++) {
      const idx = raceIdx + i;
      if (idx < totalWeeks && phases[idx] !== "transition" && !raceAt.has(idx)) phases[idx] = "reset";
    }
  }

  for (const [idx] of raceAt) phases[idx] = "race_week";

  // Base / build split across each run-in to a peak, skipping anything
  // already fixed. Applied to every run-in, so an indoor-plus-outdoor season
  // gets a proper build before each peak rather than base straight into peak.
  const fixed = (p: Phase) => p === "race_week" || p === "taper" || p === "peak" || p === "reset" || p === "transition";
  const runInEnds = peakIdxs.length > 0 ? peakIdxs.slice().sort((a, b) => a - b) : [lastRaceIdx];
  const runInStarts = [resetWeeks, ...[...raceAt.entries()].filter(([, t]) => t.priority === "peak").map(([i]) => i + 1 + postPeak)].sort(
    (a, b) => a - b,
  );

  let shortRunIn = 0;
  for (const end of runInEnds) {
    const start = [...runInStarts].reverse().find((x) => x < end) ?? resetWeeks;
    const open: number[] = [];
    for (let i = start; i < end; i++) if (!fixed(phases[i])) open.push(i);
    if (open.length === 0) continue;
    if (open.length < 4) shortRunIn = open.length;
    const baseCount = open.length < 4 ? 0 : Math.round(open.length * 0.55);
    open.forEach((idx, n) => {
      phases[idx] = n < baseCount ? "base" : "build";
    });
  }
  if (shortRunIn > 0) {
    notes.push(
      `One run-in has only ${shortRunIn} open week${shortRunIn === 1 ? "" : "s"} before a peak, so there is no room for a base block there — that stretch is all build.`,
    );
  }

  // What each race week WOULD have been, had there been no race in it.
  //
  // Race-week load was calculated as a percentage off the build-top figure no
  // matter where the race fell, so a training race during a base block came
  // out at 105% — heavier than the 100% base weeks either side of it. A race
  // reduces the week it sits in; it does not replace it with a different
  // block's load.
  /** What a week's phase would carry, ignoring any race or taper in it. */
  function loadForPhase(ph: Phase, i: number): number {
    if (ph === "peak") return L.peak;
    if (ph === "reset" || ph === "transition") return L.reset;
    if (ph === "build") {
      return (settings.buildProgression ?? "progressive") === "flat"
        ? L.buildTop
        : rampeAt(L.buildStart, L.buildTop, "build", i);
    }
    return (settings.baseProgression ?? "progressive") === "flat"
      ? L.baseTop
      : rampeAt(L.baseStart, L.baseTop, "base", i);
  }

  const hostPhase: Phase[] = phases.map((p, i) => {
    if (p !== "race_week") return p;
    for (let k = i - 1; k >= 0; k--) if (phases[k] !== "race_week") return phases[k];
    for (let k = i + 1; k < phases.length; k++) if (phases[k] !== "race_week") return phases[k];
    return "base";
  });

  // ---- weeks -------------------------------------------------------------
  const weeks: GeneratedWeek[] = [];
  let sinceDeload = 0;

  for (let i = 0; i < totalWeeks; i++) {
    const phase = phases[i];
    const weekStart = addDays(startMonday, i * 7);
    const race = raceAt.get(i) ?? null;

    // Deloads only inside base and build. A peak runs straight through — that
    // is what makes it a peak — and a taper is already a reduction.
    let isDeload = false;
    if (phase === "base" || phase === "build") {
      sinceDeload += 1;
      if (deloadsOn && sinceDeload > loadWeeksN) {
        isDeload = true;
        if (sinceDeload >= loadWeeksN + deloadWeeksN) sinceDeload = 0;
      }
    } else {
      sinceDeload = 0;
    }

    const rampe = (from: number, to: number, ph: Phase) => rampeAt(from, to, ph, i);

    let loadPct: number;
    if (isDeload) loadPct = L.deload;
    else if (phase === "reset") loadPct = L.reset;
    else if (phase === "transition") loadPct = L.reset;
    else if (phase === "peak") loadPct = L.peak;
    else if (phase === "taper") {
      const nextRace = [...raceAt.keys()].filter((k) => k > i).sort((a, b) => a - b)[0] ?? i + 1;
      const t = raceAt.get(nextRace);
      const configuredDays = t ? taperDaysFor(t) : 0;
      const usingDays = t && (t.priority === "peak" ? taperDays != null : keyTaperDays != null);
      if (usingDays && t) {
        loadPct = Math.round(dayTaperWeekLoad(weekStart, t.raceDate, configuredDays, loadForPhase(hostPhase[i], i)));
      } else {
        const weeksOut = nextRace - i;
        const len = t?.priority === "peak" ? taperWeeks : keyTaper;
        loadPct = taperLoad(weeksOut, len, L.peak);
      }
    } else if (phase === "race_week") {
      // A race week is NOT a deload. A training race often keeps its volume
      // entirely and only changes session type; the reduction is the coach's
      // setting, applied to a normal week rather than dropped to a deload.
      // The load this week would have carried without the race in it.
      const host = hostPhase[i];
      const normal =
        host === "build" || host === "peak"
          ? ((settings.buildProgression ?? "progressive") === "flat"
              ? L.buildTop
              : rampe(L.buildStart, L.buildTop, "build"))
          : host === "reset" || host === "transition"
            ? L.reset
            : ((settings.baseProgression ?? "progressive") === "flat"
                ? L.baseTop
                : rampe(L.baseStart, L.baseTop, "base"));
      // For a PEAK race, blend across the week rather than holding the taper
      // floor for all seven days.
      //
      // A Sunday race is seven pre-race days and the floor is right for all
      // of them. A Thursday race is four pre-race days and three AFTER it,
      // and those three are recovery — lighter than normal but not still
      // tapering. Holding the floor across the whole week under-loaded the
      // back half of every midweek race week.
      const dow = race ? dayOfWeek(race.raceDate) : 7;
      const postRaceDays = 7 - dow;
      const postRaceLoad = Math.round(taperFloor * 1.15); // easing back in
      // KEY and TUNE-UP race weeks follow their own taper curve too.
      //
      // Only peak races did. Everything else got a flat percentage off a
      // normal week, which ignored the taper entirely — a key race with a
      // five-day taper came out at 83% of a build week, barely below the
      // block around it, because the five tapering days inside that week were
      // never counted. Any race with a taper should reflect it.
      const raceTaperDays = race ? taperDaysFor(race) : 0;
      // The figure the coach set is the WEEK's load, so solve for the race-day
      // value that makes the week average come out at it.
      //
      // Setting it as the race-day floor gave a week of 84% when 75% was
      // asked for — the week also holds pre-taper days and post-race days,
      // which pull the average up. The label says "race week load", so the
      // week is what it should mean.
      //
      // The week average is LINEAR in the floor (every term is either a
      // constant or a fixed fraction of it), so two evaluations locate the
      // answer exactly — no iteration.
      const solveFloorForWeek = (target: number): number => {
        const a0 = dayTaperWeekLoad(weekStart, race!.raceDate, raceTaperDays, normal, 0);
        const a100 = dayTaperWeekLoad(weekStart, race!.raceDate, raceTaperDays, normal, 100);
        if (Math.abs(a100 - a0) < 0.001) return taperFloor;
        return Math.max(0, Math.min(150, ((target - a0) / (a100 - a0)) * 100));
      };

      loadPct =
        race && raceTaperDays > 0
          ? Math.round(
              dayTaperWeekLoad(weekStart, race.raceDate, raceTaperDays, normal, solveFloorForWeek(taperFloor)),
            )
          : race?.priority === "peak"
            ? Math.round((dow * taperFloor + postRaceDays * postRaceLoad) / 7)
          : race?.priority === "key"
            ? Math.round(normal * (1 - (L.raceWeekReduction + 10) / 100))
            : race?.priority === "tune_up"
              ? Math.round(normal * (1 - L.raceWeekReduction / 100))
              : Math.round(normal * (1 - Math.max(0, L.raceWeekReduction - 10) / 100));
    } else if (phase === "build") {
      // 'flat' holds the top figure and lets the deloads do the varying —
      // some athletes want base and build steady at a sustainable number
      // rather than climbing, and a hardcoded ramp asserted one philosophy.
      loadPct =
        (settings.buildProgression ?? "progressive") === "flat"
          ? L.buildTop
          : rampe(L.buildStart, L.buildTop, "build");
    } else {
      loadPct =
        (settings.baseProgression ?? "progressive") === "flat"
          ? L.baseTop
          : rampe(L.baseStart, L.baseTop, "base");
    }

    const raceDow = race ? dayOfWeek(race.raceDate) : null;
    const taperDaysForRace = race ? taperDaysFor(race) : 0;

    weeks.push({
      weekNumber: i + 1,
      weekStart,
      phase,
      loadPct: Math.max(30, Math.min(150, loadPct)),
      isDeload,
      raceName: race?.name ?? null,
      racePriority: race?.priority ?? null,
      // A COUNT for this week, not an average.
      //
      // The density setting is per-week — 0.33 means every third week — but
      // storing 0.33 on every base week described something that never
      // happens: no week contains a third of a session. Fractional densities
      // are now distributed, so the weeks that carry quality say 1 and the
      // rest say 0. The timeline then marks the weeks that actually have hard
      // work in them, which is the question a coach is asking.
      qualitySessions: qualityForWeek(phase, i),
      raceDayOfWeek: raceDow,
      // With a day-based taper the answer is simply the configured days; with
      // weeks it is the taper weeks plus the pre-race part of race week, which
      // is the mismatch that prompted days in the first place.
      taperDaysIntoRace:
        race && taperDaysForRace > 0
          ? (race.priority === "peak" ? taperDays != null : keyTaperDays != null)
            ? taperDaysForRace
            : taperDaysForRace + (raceDow ?? 7)
          : null,
    });
  }

  // ---- blocks: contiguous runs of the same phase --------------------------
  // Blocks come from deriveBlocks — the SAME function the saved-campaign view
  // uses. There were two copies of this logic and they had already drifted:
  // the deload split landed in one and not the other, so a freshly generated
  // preview showed "Base 1 15wk" while the saved campaign showed proper
  // four-week blocks. One implementation, one answer.
  const blocks = deriveBlocks(weeks);

  if (!deloadsOn) {
    notes.push("Deloads are switched off, so loading weeks run continuously.");
  }

  // A peak taper with no peak race does nothing, and that is easy to miss —
  // the setting sits there looking as though it applies.
  if (targets.length > 0 && !targets.some((t) => t.priority === "peak")) {
    notes.push(
      "No race is marked Peak, so the peak taper setting isn't being used. Key races use the key taper; tune-ups and training races aren't tapered for.",
    );
  }

  // Overload placement and taper length can ask for the same week. They are
  // separate settings — one says how long the taper runs, the other how far
  // out the hard block sits — but if the block falls inside the taper it gets
  // pushed earlier, which is not what the number says.
  const peakTaperWeeks = Math.ceil((taperDays ?? taperWeeks * 7) / 7);
  if (overloadLen > 0 && overloadBefore <= peakTaperWeeks && targets.some((t) => t.priority === "peak")) {
    notes.push(
      `The overload is set ${overloadBefore} week${overloadBefore === 1 ? "" : "s"} before the race, but the taper already covers about ${peakTaperWeeks}. The block has been moved earlier to sit clear of it — set it further out if you want it where you asked.`,
    );
  }

  // Taper structure, stated rather than computed. The campaign sets the
  // volume; this says what the sessions inside it should look like, which is
  // the half of a taper that a percentage can't express.
  if (weeks.some((w) => w.phase === "taper")) {
    const rest = num(settings.taperRestDaysAdded, 1, 0, 3);
    const cut = settings.taperSessionReduction ?? "moderate";
    const cutWords = { minimal: "barely shorter", moderate: "noticeably shorter", large: "substantially shorter" }[cut];
    const restWords =
      rest === 0
        ? "Keep the usual number of training days"
        : `Add ${rest} rest day${rest === 1 ? "" : "s"} to the week`;
    const tone = settings.taperNeuromuscular
      ? " Hold neuromuscular tone with frequent, very short speed inputs."
      : " Let neuromuscular tone relax.";
    notes.push(`${restWords}, with each remaining session ${cutWords}.${tone}`);

    // Only worth a word when the coach has deliberately overridden the
    // derived figure. Without an override there is nothing to reconcile —
    // the number IS the structure.
    if (settings.taperFloorOverride) {
      const derived = deriveTaperFloor(rest, cut);
      if (Math.abs(derived - taperFloor) > 10) {
        notes.push(
          `Race week is set to ${taperFloor}% by hand; the week you've described works out closer to ${derived}%. That's fine if it's deliberate.`,
        );
      }
    }
  }

  // Flag races that fall MIDWEEK, where the taper runs materially longer than
  // the settings say.
  //
  // Weeks are Monday-based, so a taper always includes the whole week before
  // the race plus the pre-race part of race week. A Sunday race gets exactly
  // the intended stretch; a Wednesday race gets three days less of race week
  // but the same full taper week before it, so the athlete is down for ten
  // days on a "one week" taper.
  //
  // Reported, not corrected. Whether that extra stretch is a problem depends
  // on the athlete — the same split that made taper depth a setting — and the
  // only clean fixes are moving to day-level planning or shortening the taper
  // by a whole week, which is usually too blunt.
  const DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  for (const w of weeks) {
    if (!w.taperDaysIntoRace || !w.raceDayOfWeek) continue;
    const usesDays = w.racePriority === "peak" ? taperDays != null : keyTaperDays != null;
    if (usesDays) continue; // a day taper is exactly as long as it says
    const taperLen = w.racePriority === "peak" ? taperWeeks : keyTaper;
    const nominal = taperLen * 7;
    // Compared against what the SETTING implies, not against a Sunday race.
    // An earlier version compared midweek races to the Sunday case and so
    // reported them as shorter, which is the wrong way round: the concern is
    // that the reduced stretch is LONGER than the number of taper weeks
    // suggests, because race week is itself a reduced week on top of them.
    if (w.taperDaysIntoRace <= nominal + 2) continue;
    const extra = w.taperDaysIntoRace - nominal;
    notes.push(
      `${w.raceName ?? "A race"} is on a ${DAY[w.raceDayOfWeek]}. A ${taperLen}-week taper plus the reduced days of race week means ${w.taperDaysIntoRace} days of easier running into it — ${extra} more than the ${nominal} the setting implies. Drop a taper week if that is too long for this athlete.`,
    );
  }

  return { blocks, weeks, notes };
}

/**
 * Blocks derived from weeks, rather than read from storage.
 *
 * A block is nothing more than a contiguous run of weeks sharing a phase. Once
 * a single week can have its phase changed, stored blocks and actual weeks
 * drift apart — so the weeks are authoritative and this rebuilds the blocks
 * from them on read.
 *
 * The upshot is that overriding one week in the middle of a base block splits
 * it into three automatically, and clearing the override merges them back,
 * with no bookkeeping in between.
 *
 * Race weeks do NOT break a block unless the race is a peak: a club race
 * during a base block is an event inside the block, not an interruption to it.
 * Treating every race as its own block turned one real season into 23
 * one-week slivers.
 */
export function deriveBlocks(
  weeks: {
    weekNumber: number;
    weekStart: string;
    phase: Phase;
    isDeload?: boolean;
    raceName?: string | null;
    racePriority?: string | null;
  }[],
): GeneratedBlock[] {
  if (weeks.length === 0) return [];

  const blockPhase: Phase[] = weeks.map((w, i) => {
    if (w.phase !== "race_week") return w.phase;
    if (w.racePriority === "peak") return "race_week";
    for (let k = i - 1; k >= 0; k--) if (weeks[k].phase !== "race_week") return weeks[k].phase;
    for (let k = i + 1; k < weeks.length; k++) if (weeks[k].phase !== "race_week") return weeks[k].phase;
    return w.phase;
  });

  const LABEL: Partial<Record<Phase, string>> = { reset: "Down period", peak: "Overload" };
  const blocks: GeneratedBlock[] = [];
  const seen = new Map<Phase, number>();
  let order = 1;
  let cursor = 0;

  while (cursor < weeks.length) {
    const phase = blockPhase[cursor];
    let end = cursor;
    // A DELOAD ENDS A BLOCK.
    //
    // Without this, four-week cycles ran together into one bar — a "Build
    // 11wk" with two deloads hatched inside it, which is not how a coach
    // reads a season. Coaches think in 4-6 week blocks, and the deload is the
    // last week of one, not a dip in the middle.
    while (
      end + 1 < weeks.length &&
      blockPhase[end + 1] === phase &&
      !weeks[end].isDeload // stop AFTER a deload, so it closes the block it belongs to
    ) {
      end += 1;
    }

    const n = (seen.get(phase) ?? 0) + 1;
    seen.set(phase, n);
    const span = end - cursor + 1;
    const base =
      phase === "race_week"
        ? weeks[cursor].raceName || "Race week"
        : (LABEL[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1));
    const repeats = blockPhase.filter((p) => p === phase).length > span;

    blocks.push({
      blockOrder: order++,
      phase,
      label: repeats && phase !== "race_week" ? `${base} ${n}` : base,
      startsOn: weeks[cursor].weekStart,
      endsOn: weeks[end].weekStart,
      weeks: span,
    });
    cursor = end + 1;
  }
  return blocks;
}
