// compare-metrics.ts
// Pure logic behind the Compare Sessions page. Kept out of the route file
// so it can be reasoned about (and checked with plain node) on its own.
//
// IMPORTANT CHANGE OF APPROACH (vs the previous version of this page):
// we no longer project a race time out of a training session's total work
// distance/time. That was the source of the "predicted 5K is slower than
// the athlete's actual 5K PB" nonsense — and it was never a fixable
// tuning problem, it was the wrong model:
//
//   * A session's "work distance" is the SUM of reps, with recovery
//     removed. 8 x 1km with 90s jog is not a continuous 8km effort, so
//     treating it as an 8km time trial and shrinking it down to 5km via
//     Riegel is comparing two different things.
//   * Reps are run at a prescribed sub-maximal intent (threshold, VO2,
//     tempo). Race distance projection assumes a maximal effort. Feeding
//     a deliberately controlled pace into a race-equivalency formula
//     always returns a race time slower than the athlete can actually
//     run, which is exactly what was showing up.
//
// What replaces it: the athlete's REAL race result is the anchor, and the
// session is expressed relative to it ("these reps were run at 92% of
// 5000m race pace"). Riegel is still used, but only where it is valid —
// race-to-race, to convert one real result to the chosen reference event
// when the athlete has no result at that exact distance.

import { personalizedExponent, predictTimeWithExponent, RIEGEL_EXPONENT } from "./race-predict";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ComparePerformance {
  id: string;
  event_name: string | null;
  performance_date: string;
  distance_m: number;
  time_seconds: number;
  race_type: string | null;
  context: string | null;
  excluded_from_pb: boolean | null;
}

export interface CompareRep {
  step_id: string;
  set_number: number;
  rep_number: number;
  actual_distance_m: number | null;
  actual_time_seconds: number | null;
  actual_pace_sec_per_km: number | null;
  hr_avg: number | null;
  hr_end: number | null;
  hr_end_recovery: number | null;
  cadence: number | null;
}

export interface ReferencePace {
  /** Race pace at the chosen reference event, seconds per km. */
  paceSecPerKm: number;
  /** Equivalent finishing time at the chosen reference event. */
  equivalentTimeSeconds: number;
  targetKm: number;
  /** "exact" = a real result at this distance. "converted" = a real result at another distance, converted. */
  source: "exact" | "converted";
  basis: ComparePerformance;
  basisKm: number;
  exponent: number;
  exponentSource: "personal" | "standard";
  /** Older than STALE_MONTHS — still used, but flagged rather than silently trusted. */
  stale: boolean;
  monthsOld: number;
}

export interface RepMetrics {
  count: number;
  paces: number[];
  avgPace: number | null;
  bestPace: number | null;
  worstPace: number | null;
  /** Slowest rep vs fastest rep, as a % — how tightly the set held together. */
  spreadPct: number | null;
  /** Second half of the set vs first half, as a % — positive means faded. */
  fadePct: number | null;
  avgHr: number | null;
  /** Average bpm drop between end-of-rep HR and end-of-recovery HR. */
  avgHrDrop: number | null;
  avgCadence: number | null;
}

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

const STALE_MONTHS = 18;

// Physical plausibility rails, same spirit as the guards the old version
// of this page carried — a reference pace outside these isn't a usable
// anchor and should be refused rather than displayed.
const MIN_PLAUSIBLE_PACE_S_PER_KM = 100; // ~2:06/km — faster than any human race pace
const MAX_PLAUSIBLE_PACE_S_PER_KM = 900; // 15:00/km

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parseDate(iso: string): Date {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
}

function monthsOld(iso: string, now: Date = new Date()): number {
  const d = parseDate(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

/** How far apart two distances are, on a log scale — 800m→1500m is the
 *  same "distance apart" as 5K→9.4K, which is the right way to think
 *  about pace/distance relationships (they're multiplicative). */
function logGap(km: number, targetKm: number): number {
  return Math.abs(Math.log(km / targetKm));
}

/* ------------------------------------------------------------------ */
/* Reference pace resolution                                           */
/* ------------------------------------------------------------------ */

/**
 * Finds the athlete's real race pace at the chosen reference event.
 *
 * Order of preference:
 *   1. A real result AT that distance (within 2%) — used directly, no maths.
 *   2. The nearest real result at another distance, converted race-to-race.
 *      Refused entirely if the nearest result is more than 4x away from
 *      the target (e.g. only an 800m on file and the target is a
 *      marathon) — better to show nothing than a fabricated anchor.
 *
 * Returns null when there simply isn't a usable real result. The caller
 * is expected to show an honest empty state rather than substitute an
 * estimate.
 */
export function resolveReferencePace(
  performances: ComparePerformance[],
  targetKm: number,
  now: Date = new Date(),
): ReferencePace | null {
  if (!(targetKm > 0)) return null;

  const valid = performances.filter(
    (p) => Number(p.distance_m) > 0 && Number(p.time_seconds) > 0 && !p.excluded_from_pb,
  );
  // Prefer genuine races. Fall back to everything only if the athlete has
  // no row explicitly tagged as a race (older imports may have a null
  // context) — rather than returning nothing at all.
  const races = valid.filter((p) => p.context === "race");
  const pool = races.length > 0 ? races : valid;
  if (pool.length === 0) return null;

  // Best time per distance. Bucketed to 10m so 4998m and 5002m from two
  // different GPS-measured results don't count as two separate events.
  const byDistance = new Map<number, ComparePerformance>();
  for (const p of pool) {
    const key = Math.round(Number(p.distance_m) / 10) * 10;
    const current = byDistance.get(key);
    if (!current || Number(p.time_seconds) < Number(current.time_seconds)) byDistance.set(key, p);
  }
  const bests = Array.from(byDistance.entries()).map(([metres, p]) => ({ km: metres / 1000, p }));
  if (bests.length === 0) return null;

  const byProximity = bests.slice().sort((a, b) => logGap(a.km, targetKm) - logGap(b.km, targetKm));

  // Personalised Riegel exponent, fitted from the athlete's own two best
  // results closest to the target. Only used for the "converted" path.
  let exponent = RIEGEL_EXPONENT;
  let exponentSource: "personal" | "standard" = "standard";
  if (byProximity.length >= 2) {
    const [n1, n2] = byProximity;
    const k = personalizedExponent(Number(n1.p.time_seconds), n1.km, Number(n2.p.time_seconds), n2.km);
    if (k != null) {
      exponent = k;
      exponentSource = "personal";
    }
  }

  // 1. Exact match at the reference distance.
  const exact = bests
    .filter((b) => logGap(b.km, targetKm) < 0.02)
    .sort((a, b) => Number(a.p.time_seconds) - Number(b.p.time_seconds))[0];

  if (exact) {
    const t = Number(exact.p.time_seconds);
    const pace = t / targetKm;
    if (pace < MIN_PLAUSIBLE_PACE_S_PER_KM || pace > MAX_PLAUSIBLE_PACE_S_PER_KM) return null;
    const age = monthsOld(exact.p.performance_date, now);
    return {
      paceSecPerKm: pace,
      equivalentTimeSeconds: t,
      targetKm,
      source: "exact",
      basis: exact.p,
      basisKm: exact.km,
      exponent,
      exponentSource,
      stale: age > STALE_MONTHS,
      monthsOld: age,
    };
  }

  // 2. Convert the nearest real result.
  const nearest = byProximity[0];
  if (!nearest) return null;
  if (logGap(nearest.km, targetKm) > Math.log(4)) return null;

  const converted = predictTimeWithExponent(Number(nearest.p.time_seconds), nearest.km, targetKm, exponent);
  if (!Number.isFinite(converted) || converted <= 0) return null;
  const pace = converted / targetKm;
  if (pace < MIN_PLAUSIBLE_PACE_S_PER_KM || pace > MAX_PLAUSIBLE_PACE_S_PER_KM) return null;

  const age = monthsOld(nearest.p.performance_date, now);
  return {
    paceSecPerKm: pace,
    equivalentTimeSeconds: converted,
    targetKm,
    source: "converted",
    basis: nearest.p,
    basisKm: nearest.km,
    exponent,
    exponentSource,
    stale: age > STALE_MONTHS,
    monthsOld: age,
  };
}

/* ------------------------------------------------------------------ */
/* Per-session rep metrics                                             */
/* ------------------------------------------------------------------ */

export function repMetrics(reps: CompareRep[]): RepMetrics {
  const sorted = reps
    .slice()
    .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0) || (a.rep_number ?? 0) - (b.rep_number ?? 0));

  const paces = sorted
    .map((r) => (r.actual_pace_sec_per_km == null ? null : Number(r.actual_pace_sec_per_km)))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  const hrs = sorted
    .map((r) => (r.hr_avg == null ? null : Number(r.hr_avg)))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  const cadences = sorted
    .map((r) => (r.cadence == null ? null : Number(r.cadence)))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  const drops = sorted
    .filter((r) => r.hr_end != null && r.hr_end_recovery != null)
    .map((r) => Number(r.hr_end) - Number(r.hr_end_recovery))
    .filter((v) => Number.isFinite(v));

  const bestPace = paces.length > 0 ? Math.min(...paces) : null;
  const worstPace = paces.length > 0 ? Math.max(...paces) : null;
  const spreadPct = bestPace != null && worstPace != null && bestPace > 0 ? ((worstPace - bestPace) / bestPace) * 100 : null;

  // Fade: second half of the set against the first half. Halves rather
  // than "last rep vs first rep" because a single slightly-off rep at
  // either end shouldn't decide whether a whole session faded.
  let fadePct: number | null = null;
  if (paces.length >= 4) {
    const half = Math.floor(paces.length / 2);
    const firstAvg = mean(paces.slice(0, half));
    const secondAvg = mean(paces.slice(paces.length - half));
    if (firstAvg != null && secondAvg != null && firstAvg > 0) fadePct = ((secondAvg - firstAvg) / firstAvg) * 100;
  } else if (paces.length >= 2) {
    const firstPace = paces[0];
    const lastPace = paces[paces.length - 1];
    if (firstPace > 0) fadePct = ((lastPace - firstPace) / firstPace) * 100;
  }

  return {
    count: paces.length,
    paces,
    avgPace: mean(paces),
    bestPace,
    worstPace,
    spreadPct,
    fadePct,
    avgHr: mean(hrs),
    avgHrDrop: mean(drops),
    avgCadence: mean(cadences),
  };
}

/**
 * Metres covered per heartbeat — a simple, honest efficiency readout that
 * needs nothing but distance, time and average HR. Rising m/beat at the
 * same intent is one of the cleanest signals of aerobic improvement
 * available without lab testing.
 */
export function metresPerBeat(
  distanceM: number | null | undefined,
  timeSeconds: number | null | undefined,
  avgHr: number | null | undefined,
): number | null {
  const d = Number(distanceM);
  const t = Number(timeSeconds);
  const hr = Number(avgHr);
  if (!(d > 0) || !(t > 0) || !(hr > 0)) return null;
  const beats = hr * (t / 60);
  if (!(beats > 0)) return null;
  return d / beats;
}

/* ------------------------------------------------------------------ */
/* Verdict engine                                                      */
/* ------------------------------------------------------------------ */

export type VerdictTone = "positive" | "neutral" | "caution";

export interface VerdictLine {
  tone: VerdictTone;
  label: string;
  text: string;
}

/** Everything the verdict engine needs to know about one side of the comparison. */
export interface CompareSide {
  dateLabel: string;
  paceSecPerKm: number | null;
  avgHr: number | null;
  distanceM: number | null;
  timeSeconds: number | null;
  metresPerBeat: number | null;
  fadePct: number | null;
  spreadPct: number | null;
  hrDropBpm: number | null;
  efficiency: number | null;
  cadence: number | null;
  rpe: number | null;
  fitness: number | null;
  form: number | null;
  tempC: number | null;
  windKph: number | null;
  weather: string | null;
  terrain: string | null;
  altitudeM: number | null;
  relPctOfRacePace: number | null;
}

// A pace change only counts as real if it clears both a percentage and an
// absolute floor — 1s/km on a 3:00/km rep is inside GPS noise.
function paceIsMeaningful(from: number, delta: number): boolean {
  return Math.abs(delta) >= Math.max(2, from * 0.01);
}

const HR_MEANINGFUL_BPM = 3;

export interface Verdict {
  headline: VerdictLine;
  lines: VerdictLine[];
}

export function buildVerdict(a: CompareSide, b: CompareSide): Verdict {
  const lines: VerdictLine[] = [];

  const paceA = a.paceSecPerKm;
  const paceB = b.paceSecPerKm;
  const hrA = a.avgHr;
  const hrB = b.avgHr;

  // --- headline -----------------------------------------------------
  let headline: VerdictLine = {
    tone: "neutral",
    label: "Not enough to call it",
    text: "There isn't enough recorded pace data on both sessions to make a fair comparison.",
  };

  if (paceA != null && paceB != null && paceA > 0) {
    const paceDelta = paceB - paceA; // negative = faster
    const pacePct = (paceDelta / paceA) * 100;
    const paceMoved = paceIsMeaningful(paceA, paceDelta);
    const faster = paceMoved && paceDelta < 0;
    const slower = paceMoved && paceDelta > 0;

    const hrKnown = hrA != null && hrB != null;
    const hrDelta = hrKnown ? (hrB as number) - (hrA as number) : null;
    const hrLower = hrDelta != null && hrDelta <= -HR_MEANINGFUL_BPM;
    const hrHigher = hrDelta != null && hrDelta >= HR_MEANINGFUL_BPM;
    const hrFlat = hrDelta != null && !hrLower && !hrHigher;

    const paceWord = faster
      ? `${Math.abs(paceDelta).toFixed(0)}s/km faster`
      : slower
        ? `${Math.abs(paceDelta).toFixed(0)}s/km slower`
        : "essentially the same pace";
    const pctWord = paceMoved ? ` (${Math.abs(pacePct).toFixed(1)}%)` : "";

    if (!hrKnown) {
      headline = {
        tone: faster ? "positive" : slower ? "caution" : "neutral",
        label: faster ? "Faster" : slower ? "Slower" : "Held steady",
        text: `The later session was ${paceWord}${pctWord}. Heart rate wasn't recorded on both sessions, so there's no way to tell whether that came at a higher or lower physiological cost — pace alone can't separate a fitness gain from simply working harder.`,
      };
    } else if (faster && hrLower) {
      headline = {
        tone: "positive",
        label: "Genuine improvement",
        text: `${paceWord}${pctWord} at a heart rate ${Math.abs(hrDelta as number).toFixed(0)} bpm lower. Faster for less cost is the clearest single signal of real fitness improvement there is.`,
      };
    } else if (faster && hrFlat) {
      headline = {
        tone: "positive",
        label: "Improvement",
        text: `${paceWord}${pctWord} at effectively the same heart rate. More output for the same cost — a genuine step forward in what the athlete can hold at this intent.`,
      };
    } else if (faster && hrHigher) {
      headline = {
        tone: "neutral",
        label: "Faster, but harder",
        text: `${paceWord}${pctWord}, but at a heart rate ${(hrDelta as number).toFixed(0)} bpm higher. This reads more as a harder effort on the day than a clear fitness gain — worth confirming against a session run at matched heart rate before banking it.`,
      };
    } else if (!paceMoved && hrLower) {
      headline = {
        tone: "positive",
        label: "Same work, lower cost",
        text: `Effectively the same pace at a heart rate ${Math.abs(hrDelta as number).toFixed(0)} bpm lower. The same session is costing less — a real aerobic improvement, even though the pace number hasn't moved.`,
      };
    } else if (!paceMoved && hrHigher) {
      headline = {
        tone: "caution",
        label: "Same pace, higher cost",
        text: `Effectively the same pace, but at a heart rate ${(hrDelta as number).toFixed(0)} bpm higher. Worth checking accumulated fatigue, heat, illness, or hydration before reading it as anything else.`,
      };
    } else if (!paceMoved && hrFlat) {
      headline = {
        tone: "neutral",
        label: "A clean repeat",
        text: "Same pace, same heart rate — a straight repeat of the session at the same cost. Consistent, with no clear movement in either direction.",
      };
    } else if (slower && hrLower) {
      headline = {
        tone: "neutral",
        label: "A more controlled day",
        text: `${paceWord}${pctWord} at a heart rate ${Math.abs(hrDelta as number).toFixed(0)} bpm lower. That pattern reads as a deliberately easier or more controlled session rather than a decline in fitness.`,
      };
    } else {
      headline = {
        tone: "caution",
        label: "Slower at the same or higher cost",
        text: `${paceWord}${pctWord} at a heart rate ${(hrDelta as number) >= 0 ? "the same or higher" : "similar"}. Check conditions, freshness and the days leading in before treating this as a fitness drop — a single session rarely proves one.`,
      };
    }
  }

  // --- supporting lines --------------------------------------------

  // Durability across the set.
  if (a.fadePct != null && b.fadePct != null) {
    const delta = b.fadePct - a.fadePct;
    if (Math.abs(delta) >= 1) {
      lines.push({
        tone: delta < 0 ? "positive" : "caution",
        label: "Durability across the set",
        text:
          delta < 0
            ? `Held together better: the second half of the set was ${Math.abs(b.fadePct).toFixed(1)}% ${b.fadePct >= 0 ? "slower than" : "faster than"} the first, against ${Math.abs(a.fadePct).toFixed(1)}% before. Less fade at the same intent usually shows up before average pace does.`
            : `Faded more: the second half of the set dropped off ${b.fadePct.toFixed(1)}% against ${a.fadePct.toFixed(1)}% before. Often the first sign that a session is being started too fast, or that the athlete is carrying fatigue in.`,
      });
    } else {
      lines.push({
        tone: "neutral",
        label: "Durability across the set",
        text: `Fade across the set was essentially unchanged (${a.fadePct.toFixed(1)}% → ${b.fadePct.toFixed(1)}%).`,
      });
    }
  }

  // Rep-to-rep consistency.
  if (a.spreadPct != null && b.spreadPct != null) {
    const delta = b.spreadPct - a.spreadPct;
    if (Math.abs(delta) >= 1) {
      lines.push({
        tone: delta < 0 ? "positive" : "neutral",
        label: "Rep-to-rep consistency",
        text:
          delta < 0
            ? `Tighter set: the gap between fastest and slowest rep narrowed from ${a.spreadPct.toFixed(1)}% to ${b.spreadPct.toFixed(1)}%.`
            : `Looser set: the gap between fastest and slowest rep widened from ${a.spreadPct.toFixed(1)}% to ${b.spreadPct.toFixed(1)}%. Not automatically a problem — check whether it was a planned progression rather than drift.`,
      });
    }
  }

  // Recovery between reps.
  if (a.hrDropBpm != null && b.hrDropBpm != null) {
    const delta = b.hrDropBpm - a.hrDropBpm;
    if (Math.abs(delta) >= 3) {
      lines.push({
        tone: delta > 0 ? "positive" : "caution",
        label: "Recovery between reps",
        text:
          delta > 0
            ? `Heart rate came down faster in the recoveries (${a.hrDropBpm.toFixed(0)} → ${b.hrDropBpm.toFixed(0)} bpm average drop) — a straightforward aerobic-fitness marker.`
            : `Heart rate came down more slowly in the recoveries (${a.hrDropBpm.toFixed(0)} → ${b.hrDropBpm.toFixed(0)} bpm average drop). Check recovery duration was actually the same before reading anything into it.`,
      });
    }
  }

  // Metres per beat.
  if (a.metresPerBeat != null && b.metresPerBeat != null && a.metresPerBeat > 0) {
    const pct = ((b.metresPerBeat - a.metresPerBeat) / a.metresPerBeat) * 100;
    if (Math.abs(pct) >= 2) {
      lines.push({
        tone: pct > 0 ? "positive" : "caution",
        label: "Metres per heartbeat",
        text: `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% (${a.metresPerBeat.toFixed(2)} → ${b.metresPerBeat.toFixed(2)} m/beat) — how much ground each heartbeat bought. ${pct > 0 ? "Rising" : "Falling"} at the same intent is ${pct > 0 ? "a good aerobic sign" : "worth watching, though heat and fatigue both push it down temporarily"}.`,
      });
    }
  }

  // Cadence.
  if (a.cadence != null && b.cadence != null && Math.abs(b.cadence - a.cadence) >= 2) {
    lines.push({
      tone: "neutral",
      label: "Cadence",
      text: `${a.cadence.toFixed(0)} → ${b.cadence.toFixed(0)} spm. Worth noting alongside pace: a pace change carried by cadence alone is a different adaptation from one carried by stride length.`,
    });
  }

  // Perceived effort.
  if (a.rpe != null && b.rpe != null && Math.abs(b.rpe - a.rpe) >= 1) {
    const easier = b.rpe < a.rpe;
    lines.push({
      tone: easier ? "positive" : "neutral",
      label: "Perceived effort",
      text: `RPE ${a.rpe} → ${b.rpe}. ${easier ? "The athlete felt the later session was easier, which is worth as much as the objective numbers when the two agree." : "The athlete felt the later session was harder — worth cross-reading against the heart-rate picture above."}`,
    });
  }

  // Training-load context — plain-language names only.
  if (a.fitness != null && b.fitness != null) {
    const delta = b.fitness - a.fitness;
    const direction = delta > 1 ? "rose" : delta < -1 ? "fell" : "was flat";
    let text = `Fitness ${direction} across the window (${a.fitness.toFixed(0)} → ${b.fitness.toFixed(0)}).`;
    if (a.form != null && b.form != null) {
      text += ` Form went ${a.form.toFixed(0)} → ${b.form.toFixed(0)}, so the athlete arrived at the later session ${b.form > a.form + 3 ? "fresher" : b.form < a.form - 3 ? "carrying more fatigue" : "in a similar state of freshness"}.`;
    }
    lines.push({ tone: "neutral", label: "Training load context", text });
  }

  // Conditions — one combined line so it doesn't crowd out the physiology.
  const conditionNotes: string[] = [];
  if (a.tempC != null && b.tempC != null && Math.abs(b.tempC - a.tempC) >= 5) {
    conditionNotes.push(
      `temperature ${a.tempC.toFixed(0)}°C → ${b.tempC.toFixed(0)}°C (roughly 1–2s/km per °C above about 15°C, so this alone can account for a chunk of any pace difference)`,
    );
  }
  if (a.windKph != null && b.windKph != null && Math.abs(b.windKph - a.windKph) >= 10) {
    conditionNotes.push(`wind ${a.windKph.toFixed(0)} → ${b.windKph.toFixed(0)} kph`);
  }
  if (a.terrain && b.terrain && a.terrain !== b.terrain) {
    conditionNotes.push(`surface ${a.terrain} → ${b.terrain}`);
  }
  if (a.weather && b.weather && a.weather !== b.weather) {
    conditionNotes.push(`conditions ${a.weather} → ${b.weather}`);
  }
  if (a.altitudeM != null && b.altitudeM != null && Math.abs(b.altitudeM - a.altitudeM) >= 300) {
    conditionNotes.push(`altitude ${a.altitudeM.toFixed(0)}m → ${b.altitudeM.toFixed(0)}m`);
  }
  if (conditionNotes.length > 0) {
    lines.push({
      tone: "caution",
      label: "These sessions weren't run in the same conditions",
      text: `${conditionNotes.join("; ")}. Discount some of the pace difference above accordingly — this is not a like-for-like comparison.`,
    });
  }

  // Relative to race pace.
  if (a.relPctOfRacePace != null && b.relPctOfRacePace != null) {
    const delta = b.relPctOfRacePace - a.relPctOfRacePace;
    lines.push({
      tone: Math.abs(delta) < 0.5 ? "neutral" : delta > 0 ? "positive" : "neutral",
      label: "Relative to race pace",
      text: `Work pace moved from ${a.relPctOfRacePace.toFixed(1)}% to ${b.relPctOfRacePace.toFixed(1)}% of the reference race pace. This is a normalisation of the two sessions against a real result, not a prediction of a new one.`,
    });
  }

  return { headline, lines };
}
