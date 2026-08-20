/**
 * Zone mix — how a week's or a block's time is distributed across zones.
 *
 * Two sources, and the difference between them matters enough that this
 * module never lets them be confused:
 *
 *   MEASURED   session_zone_time, written by the FIT ingest pipeline from
 *              real pace or HR against the athlete's own boundaries. This is
 *              where the athlete actually was.
 *
 *   PLANNED    derived here from a session's steps. A planned session has no
 *              measured anything — it has targets. Where a step names a zone
 *              that zone is used; otherwise it is inferred from the session's
 *              intent, which is a coach's label for a session, not a
 *              measurement of one.
 *
 * A planned mix is an INTENTION. It says what the session is meant to be, and
 * an athlete who runs the easy days too hard will produce a measured mix that
 * looks nothing like it — which is itself the most useful comparison this data
 * supports. Everything returned from here carries `basis` so the UI can label
 * which it is rather than drawing both the same way.
 */

import { assumedPaceSecPerKm, stepPaceSecPerKm } from "./session-volume";

// ---------------------------------------------------------------------------
// The vocabulary.
//
// zone_band is a Postgres enum of z1..z6. These were previously redeclared in
// app.zones.tsx, the race replay page and the session Analysis ZonePanel, with
// a comment in each asking that they be kept in step by hand. z6 had no label
// anywhere, so a session with sprint-band time rendered an undefined colour.
// ---------------------------------------------------------------------------
export const ZONE_KEYS = ["z1", "z2", "z3", "z4", "z5", "z6"] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

export const ZONE_COLORS: Record<ZoneKey, string> = {
  z1: "#34d399",
  z2: "#38bdf8",
  z3: "#fbbf24",
  z4: "#f97316",
  z5: "#ef4444",
  // Sprint band. Present in the enum and previously unlabelled and
  // uncoloured everywhere, so it rendered as a gap in every stacked chart.
  z6: "#a855f7",
};

export const ZONE_LABELS: Record<ZoneKey, string> = {
  z1: "Z1 Easy",
  z2: "Z2 Aerobic",
  z3: "Z3 Tempo/Threshold",
  z4: "Z4 VO2/5K",
  z5: "Z5 Rep",
  z6: "Z6 Sprint",
};

export function isZoneKey(v: unknown): v is ZoneKey {
  return typeof v === "string" && (ZONE_KEYS as readonly string[]).includes(v);
}

export type ZoneSeconds = Record<ZoneKey, number>;

export function emptyZoneSeconds(): ZoneSeconds {
  return { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0 };
}

export function addZoneSeconds(a: ZoneSeconds, b: ZoneSeconds): ZoneSeconds {
  const out = emptyZoneSeconds();
  for (const k of ZONE_KEYS) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  return out;
}

export function sumZoneSeconds(list: ZoneSeconds[]): ZoneSeconds {
  return (list ?? []).reduce<ZoneSeconds>((acc, z) => addZoneSeconds(acc, z), emptyZoneSeconds());
}

export function totalZoneSeconds(z: ZoneSeconds | null | undefined): number {
  if (!z) return 0;
  return ZONE_KEYS.reduce((a, k) => a + (Number(z[k]) || 0), 0);
}

/** Percentage of total per zone. All zeros when there is no time at all. */
export function zonePercentages(z: ZoneSeconds | null | undefined): Record<ZoneKey, number> {
  const total = totalZoneSeconds(z);
  const out = emptyZoneSeconds() as Record<ZoneKey, number>;
  if (total <= 0) return out;
  for (const k of ZONE_KEYS) out[k] = ((z![k] ?? 0) / total) * 100;
  return out;
}

// ---------------------------------------------------------------------------
// Intent -> zone.
//
// Deliberately collapses tempo and threshold onto z3. The zone bands come from
// the athlete's own pace boundaries, and tempo and threshold running both sit
// in the band between easy pace and 5k pace — there is no separate band to put
// them in. Splitting them here would invent a distinction the measured data
// cannot make, and the two would then never agree.
// ---------------------------------------------------------------------------
const INTENT_ZONE: Record<string, ZoneKey> = {
  easy: "z1",
  recovery: "z1",
  aerobic: "z2",
  tempo: "z3",
  threshold: "z3",
  vo2: "z4",
  time_trial: "z4",
  anaerobic: "z5",
  speed: "z5",
};

const DAYTYPE_ZONE: Record<string, ZoneKey> = {
  recovery: "z1",
  race: "z4",
};

/**
 * Which zone a single step is meant to sit in.
 *
 * Order matters. An explicitly named target zone is the coach's own answer and
 * always wins. Failing that, warmup, cooldown and recovery are easy running
 * whatever the session is built around — treating a threshold session's warmup
 * as threshold time is the single biggest way a planned mix goes wrong, and it
 * inflates exactly the zone a coach is watching for.
 */
export function zoneForStep(step: any, sessionIntent?: string | null, sessionDayType?: string | null): ZoneKey {
  if (step?.target_mode === "zone" && isZoneKey(step?.target_zone)) return step.target_zone;
  if (isZoneKey(step?.target_zone)) return step.target_zone;

  const kind = String(step?.kind ?? "");
  if (kind === "warmup" || kind === "cooldown" || kind === "recovery" || kind === "rest") return "z1";
  if (kind === "strides") return "z5";

  if (sessionDayType && DAYTYPE_ZONE[sessionDayType]) return DAYTYPE_ZONE[sessionDayType];
  if (sessionIntent && INTENT_ZONE[sessionIntent]) return INTENT_ZONE[sessionIntent];
  return "z1";
}

export interface ZoneMix {
  seconds: ZoneSeconds;
  totalSeconds: number;
  basis: "measured" | "planned" | "empty";
}

/**
 * Planned time-in-zone for one session, from its steps.
 *
 * Measured in SECONDS, matching session_zone_time, so a planned mix and a
 * measured one can be put side by side without a unit conversion in between.
 * A distance target is converted to time at the same assumed paces
 * session-volume.ts uses, so the two modules cannot disagree about how long a
 * given step is.
 *
 * Recovery between reps and between sets is counted as z1 time, because it is
 * time on the athlete's legs. It is excluded from Biomechanics scoring for
 * good reasons that do not apply here.
 */
export function plannedZoneMix(
  session: { intent?: string | null; day_type?: string | null } | null | undefined,
  steps: any[] | null | undefined,
  /**
   * Same resolver session-volume.ts takes. Without it a distance target is
   * converted at the population pace, which for a fast athlete overstates the
   * time and therefore overstates that zone's share of the week.
   */
  resolvePace?: (step: any) => [number, number] | null,
): ZoneMix {
  const seconds = emptyZoneSeconds();
  if (!steps || steps.length === 0) return { seconds, totalSeconds: 0, basis: "empty" };

  const intent = session?.intent ?? null;
  const dayType = session?.day_type ?? null;
  let sawAnything = false;

  for (const step of steps) {
    if (!step) continue;
    const reps = Math.max(1, Math.floor(Number(step.reps) || 1));
    const sets = Math.max(1, Math.floor(Number(step.set_count) || 1));
    const mult = reps * sets;

    const zone = zoneForStep(step, intent, dayType);
    const pace = stepPaceSecPerKm(
      step,
      zone === "z1" && step.kind !== "work" ? "easy" : (intent ?? "easy"),
      resolvePace,
    );

    const dist = Number(step.target_distance_m) || 0;
    const secs = Number(step.target_time_seconds) || 0;

    if (secs > 0) {
      seconds[zone] += secs * mult;
      sawAnything = true;
    } else if (dist > 0 && pace > 0) {
      seconds[zone] += (dist / 1000) * pace * mult;
      sawAnything = true;
    }

    // Recovery, always easy time.
    const betweenReps = Math.max(0, reps - 1) * sets;
    const betweenSets = Math.max(0, sets - 1);
    const recSecs = Number(step.recovery_target_seconds) || Number(step.recovery_between_reps_seconds) || 0;
    const recDist = Number(step.recovery_target_distance_m) || 0;
    if (step.recovery_target_kind === "distance" && recDist > 0) {
      seconds.z1 += (recDist / 1000) * assumedPaceSecPerKm("recovery") * betweenReps;
      sawAnything = true;
    } else if (recSecs > 0) {
      seconds.z1 += recSecs * betweenReps;
      sawAnything = true;
    }
    const setSecs = Number(step.recovery_between_sets_seconds) || 0;
    if (setSecs > 0 && betweenSets > 0) {
      seconds.z1 += setSecs * betweenSets;
      sawAnything = true;
    }
  }

  return {
    seconds,
    totalSeconds: totalZoneSeconds(seconds),
    basis: sawAnything ? "planned" : "empty",
  };
}

/**
 * Rows from session_zone_time (or athlete_zone_time_weekly) into a mix.
 *
 * A session can carry BOTH a pace-derived and an HR-derived breakdown of the
 * same minutes. Summing them double-counts every second, so one source is
 * chosen per group: pace where it exists, HR otherwise. Pace wins because the
 * zone boundaries elsewhere in the app are pace-first and an HR band lags the
 * effort it is measuring.
 */
export function measuredZoneMix(rows: { zone: string; seconds: number | string; source?: string }[]): ZoneMix {
  const seconds = emptyZoneSeconds();
  if (!rows || rows.length === 0) return { seconds, totalSeconds: 0, basis: "empty" };

  const hasPace = rows.some((r) => r?.source === "pace");
  const use = hasPace ? rows.filter((r) => r?.source === "pace") : rows;

  let sawAnything = false;
  for (const r of use) {
    if (!r || !isZoneKey(r.zone)) continue;
    const s = Number(r.seconds);
    if (!Number.isFinite(s) || s <= 0) continue;
    seconds[r.zone] += s;
    sawAnything = true;
  }

  return { seconds, totalSeconds: totalZoneSeconds(seconds), basis: sawAnything ? "measured" : "empty" };
}

// ---------------------------------------------------------------------------
// Reading the mix
// ---------------------------------------------------------------------------

/**
 * Share of total time spent at z3 and above.
 *
 * The number most coaching models actually watch. Polarised and pyramidal
 * approaches disagree about a great deal but agree that this figure sitting
 * around 20% or lower is the usual shape of a healthy aerobic block, and that
 * it drifting up without anyone deciding it should is the classic way a base
 * block quietly stops being one.
 *
 * Returned as a number, not a verdict. What counts as too much depends on the
 * phase, the athlete and the coach, and this module does not know any of them.
 */
export function hardSharePct(z: ZoneSeconds | null | undefined): number | null {
  const total = totalZoneSeconds(z);
  if (total <= 0) return null;
  const hard = (z!.z3 ?? 0) + (z!.z4 ?? 0) + (z!.z5 ?? 0) + (z!.z6 ?? 0);
  return (hard / total) * 100;
}

/** The zone holding the most time, or null when there is none. */
export function dominantZone(z: ZoneSeconds | null | undefined): ZoneKey | null {
  if (totalZoneSeconds(z) <= 0) return null;
  return ZONE_KEYS.reduce<ZoneKey>((best, k) => ((z![k] ?? 0) > (z![best] ?? 0) ? k : best), "z1");
}
