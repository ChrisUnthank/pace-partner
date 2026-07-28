// Shared PB-status logic — used everywhere a performance list needs to
// show a PB-family badge (currently Profile's PBs card, the coach
// Overview page, and Races).
//
// is_pb / is_year_best / is_season_best / is_course_best are all
// maintained by a DB trigger (recompute_pb_after_perf_change, see
// migration_pb_recompute.sql + migration_pb_extensions.sql) — this file
// trusts those columns directly rather than recomputing "fastest time"
// client-side, same reasoning as before: a DB trigger can't drift out
// of sync with itself the way N different client call sites can.
//
// "Past PB" is the one exception with no stored equivalent — is_pb only
// ever reflects "fastest right now", not "used to be". That's
// reconstructed here by walking the athlete's full history in date
// order per (distance, race_type), same as before.

export type PbBadge = "pb" | "season_best" | "year_best" | "course_best" | "past_pb" | null;

export type PbStatus = {
  isCurrentPB: boolean;
  isSeasonBest: boolean;
  isYearBest: boolean;
  isCourseBest: boolean;
  isPastPB: boolean;
  // The single badge to actually show, per the established priority:
  // PB > Season Best > Year Best > Course Best > Past PB. A result can
  // technically qualify for more than one (e.g. current PB is
  // necessarily also this year's best) — only the highest shows.
  badge: PbBadge;
};

export type PbCandidate = {
  id: string;
  distance_m: number;
  race_type: string | null;
  time_seconds: number | null;
  performance_date: string;
  is_pb?: boolean | null;
  is_year_best?: boolean | null;
  is_season_best?: boolean | null;
  is_course_best?: boolean | null;
  excluded_from_pb?: boolean | null;
};

export function computePbStatus<T extends PbCandidate>(performances: T[]): Map<string, PbStatus> {
  const result = new Map<string, PbStatus>();
  const bestSoFar = new Map<string, number>();

  const timed = performances.filter((p) => p.time_seconds != null);
  const sorted = [...timed].sort((a, b) => a.performance_date.localeCompare(b.performance_date));

  for (const p of sorted) {
    const key = `${p.distance_m}-${p.race_type}`;
    const cur = bestSoFar.get(key);
    // Ties count as "was a PB at the time" too — matches how the DB
    // trigger treats an exact-time tie as PB on both rows. Excluded
    // rows never participate in this history at all — they were never
    // part of the distance-based PB conversation in the first place,
    // so they can't be a "past" PB either.
    const wasPbWhenSet = !p.excluded_from_pb && (cur == null || p.time_seconds! <= cur);

    if (!p.excluded_from_pb && (cur == null || p.time_seconds! < cur)) {
      bestSoFar.set(key, p.time_seconds!);
    }

    const isCurrentPB = !!p.is_pb;
    const isSeasonBest = !!p.is_season_best;
    const isYearBest = !!p.is_year_best;
    const isCourseBest = !!p.is_course_best;
    const isPastPB = wasPbWhenSet && !isCurrentPB;

    let badge: PbBadge = null;
    if (isCurrentPB) badge = "pb";
    else if (isSeasonBest) badge = "season_best";
    else if (isYearBest) badge = "year_best";
    else if (isCourseBest) badge = "course_best";
    else if (isPastPB) badge = "past_pb";

    result.set(p.id, { isCurrentPB, isSeasonBest, isYearBest, isCourseBest, isPastPB, badge });
  }

  return result;
}

// Convenience for a single row — callers already iterating a list should
// use computePbStatus once and look up by id instead of calling this
// per-row (that would redo the full history walk every time).
export function pbStatusFor(id: string, statusMap: Map<string, PbStatus>): PbStatus {
  return statusMap.get(id) ?? {
    isCurrentPB: false,
    isSeasonBest: false,
    isYearBest: false,
    isCourseBest: false,
    isPastPB: false,
    badge: null,
  };
}

export const PB_BADGE_LABEL: Record<Exclude<PbBadge, null>, string> = {
  pb: "PB",
  season_best: "Season Best",
  year_best: "Year Best",
  course_best: "Course Best",
  past_pb: "Past PB",
};

// Shared badge styling so PB/Season Best/Year Best/Course Best/Past PB
// look identical wherever they show up (Profile, Overview, Races).
export const PB_BADGE_CLASS: Record<Exclude<PbBadge, null>, string> = {
  pb: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200",
  season_best: "bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200",
  year_best: "bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200",
  course_best: "bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-cyan-200",
  past_pb: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200",
};
