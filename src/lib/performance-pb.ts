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
// "Past PB" is the one exception with no stored equivalent, and means
// exactly one thing: the single fastest result that ISN'T the current PB,
// per (distance, race_type) — i.e. the athlete's outright runner-up. Not
// "every result that was once a PB before being superseded" (that would
// tag one row per rung of an athlete's whole improvement history, which
// is what this used to do and is not what the badge is for). Recomputed
// fresh from the current data every time this runs, so it moves
// automatically as new results come in — nothing about it is stored.

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

  const eligible = performances.filter((p) => p.time_seconds != null && !p.excluded_from_pb);

  // Group eligible results by event category — each (distance, race_type)
  // runs its own completely independent PB/runner-up, same as the DB
  // trigger already does for is_pb itself (a track 5000m and a road 5km
  // are different record categories, not the same "5k").
  const byKey = new Map<string, T[]>();
  for (const p of eligible) {
    const key = `${p.distance_m}-${p.race_type}`;
    const list = byKey.get(key) ?? [];
    list.push(p);
    byKey.set(key, list);
  }

  // For each category, find the fastest result that ISN'T the current PB
  // — that one result is "Past PB". Everything else that used to hold the
  // PB before being superseded gets no special badge once something else
  // has taken over as the outright 2nd-best.
  const runnerUpIdByKey = new Map<string, string>();
  for (const [key, list] of byKey) {
    const candidates = list.filter((p) => !p.is_pb);
    if (candidates.length === 0) continue;
    const fastest = [...candidates].sort((a, b) => {
      if (a.time_seconds !== b.time_seconds) return a.time_seconds! - b.time_seconds!;
      // Tie-break on equal times: earliest date wins the runner-up slot,
      // so a tie never leaves the "correct" answer ambiguous.
      return a.performance_date.localeCompare(b.performance_date);
    })[0];
    runnerUpIdByKey.set(key, fastest.id);
  }

  for (const p of performances) {
    const isCurrentPB = !!p.is_pb;
    const isSeasonBest = !!p.is_season_best;
    const isYearBest = !!p.is_year_best;
    const isCourseBest = !!p.is_course_best;
    const key = `${p.distance_m}-${p.race_type}`;
    const isPastPB = p.time_seconds != null && !p.excluded_from_pb && runnerUpIdByKey.get(key) === p.id;

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
