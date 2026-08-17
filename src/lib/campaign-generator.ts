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
  /** Not set by the generator — carried on weeks loaded from the database, so
   *  the timeline can mark weeks a coach has edited and regeneration can skip
   *  them. Present here so one type serves both a freshly generated preview
   *  and a saved campaign. */
  isLocked?: boolean;
  /** Database id, on saved weeks only. */
  id?: string;
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
  const resetWeeks = settings.resetWeeks ?? 0;
  const keyTaper = settings.keyTaperWeeks ?? 1;
  const postPeak = settings.postPeakRecoveryWeeks ?? 1;
  const deloadsOn = settings.deloadsEnabled !== false && settings.deloadWeeks > 0;
  const taperFloor = settings.taperFloorPct ?? 55;
  const taperShape = settings.taperShape ?? "linear";

  /**
   * Load for a taper week, `weeksOut` weeks before the race.
   *
   * Curved via an exponent on the normalised position rather than by special
   * cases: one expression covers all three shapes and any taper length, and
   * the floor is hit exactly in race week whatever the shape.
   */
  function taperLoad(weeksOut: number, len: number, peakLoad: number): number {
    const p = (weeksOut - 1) / Math.max(1, len); // 1 at the start, 0 at the race
    const exp = taperShape === "gentle" ? 0.55 : taperShape === "steep" ? 1.8 : 1;
    return Math.round(taperFloor + (peakLoad - taperFloor) * Math.pow(p, exp));
  }

  const startMonday = mondayOf(settings.startsOn);
  const targets = [...settings.targets].filter((t) => !!t.raceDate).sort((a, b) => a.raceDate.localeCompare(b.raceDate));

  if (targets.length === 0) {
    return { blocks: [], weeks: [], notes: ["No target races set — a campaign needs at least one."] };
  }

  const lastTarget = targets[targets.length - 1];
  const lastRaceIdx = weeksBetween(startMonday, mondayOf(lastTarget.raceDate));
  const totalWeeks = lastRaceIdx + 1 + (settings.transitionWeeks ?? 0);

  if (totalWeeks < 3) {
    return {
      blocks: [],
      weeks: [],
      notes: ["Less than three weeks to the first race — too short to structure. Plan these weeks directly."],
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
    const taperLen = t.priority === "peak" ? settings.taperWeeks : t.priority === "key" ? keyTaper : 0;
    for (let i = 1; i <= taperLen; i++) {
      const idx = raceIdx - i;
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
      let peakIdx = raceIdx - settings.taperWeeks - 1;
      while (peakIdx >= resetWeeks && (raceAt.has(peakIdx) || phases[peakIdx] === "taper")) peakIdx -= 1;
      if (peakIdx >= resetWeeks) {
        phases[peakIdx] = "peak";
        peakIdxs.push(peakIdx);
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
      if (deloadsOn && sinceDeload > settings.loadWeeks) {
        isDeload = true;
        if (sinceDeload >= settings.loadWeeks + settings.deloadWeeks) sinceDeload = 0;
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
      const weeksOut = nextRace - i;
      const t = raceAt.get(nextRace);
      const len = t?.priority === "peak" ? settings.taperWeeks : keyTaper;
      loadPct = taperLoad(weeksOut, len, L.peak);
    } else if (phase === "race_week") {
      // A race week is NOT a deload. A training race often keeps its volume
      // entirely and only changes session type; the reduction is the coach's
      // setting, applied to a normal week rather than dropped to a deload.
      const normal = L.buildTop;
      loadPct =
        race?.priority === "peak"
          ? taperFloor
          : race?.priority === "key"
            ? Math.round(normal * (1 - (L.raceWeekReduction + 10) / 100))
            : race?.priority === "tune_up"
              ? Math.round(normal * (1 - L.raceWeekReduction / 100))
              : Math.round(normal * (1 - Math.max(0, L.raceWeekReduction - 10) / 100));
    } else if (phase === "build") loadPct = rampe(L.buildStart, L.buildTop, "build");
    else loadPct = rampe(L.baseStart, L.baseTop, "base");

    weeks.push({
      weekNumber: i + 1,
      weekStart,
      phase,
      loadPct: Math.max(30, Math.min(150, loadPct)),
      isDeload,
      raceName: race?.name ?? null,
      racePriority: race?.priority ?? null,
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
    const baseLabel =
      phase === "race_week"
        ? weeks[cursor].raceName || "Race week"
        : phase === "reset"
          ? "Down period"
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

  return { blocks, weeks, notes };
}
