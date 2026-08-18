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
  /** Quality sessions per week. 0.5 = every second week. */
  baseQualityPerWeek?: number;
  buildQualityPerWeek?: number;
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
export function isValidIsoDate(iso: string | null | undefined): boolean {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** Monday of the week containing this date. Weeks are Monday-based throughout Strider. */
export function mondayOf(iso: string): string {
  // Returns the input unchanged rather than throwing on a partial date —
  // callers treat an unparseable value as "not ready yet".
  if (!isValidIsoDate(iso)) return iso;
  const d = toDate(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return isoOf(d);
}

function weeksBetween(startIso: string, endIso: string): number {
  const ms = toDate(endIso).getTime() - toDate(startIso).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
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
  const taperFloor = num(settings.taperFloorPct, 55, 20, 100);
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
    const d = new Date(`${iso}T00:00:00`);
    return ((d.getDay() + 6) % 7) + 1;
  }

  function taperLoad(weeksOut: number, len: number, peakLoad: number): number {
    const p = (weeksOut - 1) / Math.max(1, len); // 1 at the start, 0 at the race
    const exp = taperShape === "gentle" ? 0.55 : taperShape === "steep" ? 1.8 : 1;
    return Math.round(taperFloor + (peakLoad - taperFloor) * Math.pow(p, exp));
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
  ): number {
    const race = toDate(raceIso).getTime();
    const taperStart = race - days * DAY_MS;
    const postRaceLoad = Math.round(taperFloor * 1.15);
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
        sum += taperFloor + (preTaperLoad - taperFloor) * Math.pow(p, taperExp);
      }
    }
    return Math.round(sum / 7);
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
  const totalWeeks = lastRaceIdx + 1 + num(settings.transitionWeeks, 0, 0, 12);

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

  // Trailing transition, only for campaigns that still use it.
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

    const rampe = (from: number, to: number, ph: Phase) => {
      const total = phases.filter((p) => p === ph).length;
      const nth = phases.slice(0, i + 1).filter((p) => p === ph).length;
      return Math.round(from + ((to - from) * (nth - 1)) / Math.max(1, total - 1));
    };

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
        loadPct = dayTaperWeekLoad(weekStart, t.raceDate, configuredDays, L.peak);
      } else {
        const weeksOut = nextRace - i;
        const len = t?.priority === "peak" ? taperWeeks : keyTaper;
        loadPct = taperLoad(weeksOut, len, L.peak);
      }
    } else if (phase === "race_week") {
      // A race week is NOT a deload. A training race often keeps its volume
      // entirely and only changes session type; the reduction is the coach's
      // setting, applied to a normal week rather than dropped to a deload.
      const normal = L.buildTop;
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
      const raceUsesDays = race && (race.priority === "peak" ? taperDays != null : keyTaperDays != null);
      loadPct =
        race?.priority === "peak"
          ? raceUsesDays
            ? dayTaperWeekLoad(weekStart, race.raceDate, taperDaysFor(race), L.peak)
            : Math.round((dow * taperFloor + postRaceDays * postRaceLoad) / 7)
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
      qualitySessions:
        phase === "build"
          ? (settings.buildQualityPerWeek ?? 2)
          : phase === "base"
            ? (settings.baseQualityPerWeek ?? 0.5)
            : phase === "peak"
              ? (settings.buildQualityPerWeek ?? 2)
              : null,
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
  // Race weeks do NOT break a block.
  //
  // Treating every race as its own block produced 23 blocks for one track
  // season, most of them a single week: "Base 2 (1wk) | Club 1500 (1wk) |
  // Base 3 (1wk)". That is a list of weeks with labels, not a structure — and
  // it misrepresents the training, since a club race during a base block is
  // an event inside the block, not an interruption to it.
  //
  // Races are markers ON the timeline. Only a race that IS the point of a
  // phase — a peak, sitting after its own taper — stands alone.
  const blockPhase: Phase[] = weeks.map((w, i) => {
    if (w.phase !== "race_week") return w.phase;
    if (w.racePriority === "peak") return "race_week";
    // Inherit the surrounding phase, preferring what came before.
    for (let k = i - 1; k >= 0; k--) if (weeks[k].phase !== "race_week") return weeks[k].phase;
    for (let k = i + 1; k < weeks.length; k++) if (weeks[k].phase !== "race_week") return weeks[k].phase;
    return w.phase;
  });

  const blocks: GeneratedBlock[] = [];
  let order = 1;
  let cursor = 0;
  const phaseCounts = new Map<Phase, number>();

  while (cursor < weeks.length) {
    const phase = blockPhase[cursor];
    let end = cursor;
    while (end + 1 < weeks.length && blockPhase[end + 1] === phase) end += 1;

    const n = (phaseCounts.get(phase) ?? 0) + 1;
    phaseCounts.set(phase, n);
    const span = end - cursor + 1;
    // Labels are written out rather than derived from the phase name, because
    // two of them differ from it: 'reset' reads as "Down period", and 'peak'
    // reads as "Overload" — the block is the heaviest TRAINING, not the race
    // you're peaking for, and reusing the word for both confused exactly the
    // people this is built for.
    const baseLabel =
      phase === "race_week"
        ? weeks[cursor].raceName || "Race week"
        : phase === "reset"
          ? "Down period"
          : phase === "peak"
            ? "Overload"
            : phase.charAt(0).toUpperCase() + phase.slice(1);
    const willRepeat = blockPhase.filter((p) => p === phase).length > span;

    blocks.push({
      blockOrder: order++,
      phase,
      label: willRepeat && phase !== "race_week" ? `${baseLabel} ${n}` : baseLabel,
      startsOn: weeks[cursor].weekStart,
      endsOn: addDays(weeks[end].weekStart, 6),
      weeks: span,
    });
    cursor = end + 1;
  }

  if (!deloadsOn) {
    notes.push("Deloads are switched off, so loading weeks run continuously.");
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
