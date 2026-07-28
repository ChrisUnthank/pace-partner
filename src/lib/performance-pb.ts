// Shared PB-status logic — used everywhere a performance list needs to
// show "PB" / "Past PB" badges (currently Profile's PBsCard and the
// coach Overview page; previously each had its own slightly different
// copy of this).
//
// "Current PB" now just trusts performances.is_pb directly — a DB
// trigger (recompute_pb_after_perf_change, see migration_pb_recompute.sql)
// keeps that column correct across every insert/edit/delete path, so
// there's no need to recompute "fastest time per distance" client-side
// anymore.
//
// "Past PB" has no equivalent stored column — is_pb only ever reflects
// "is this the fastest right now", not "was this ever the fastest".
// That's reconstructed here by walking the athlete's full history in
// date order per (distance, race_type) and tracking whichever time was
// fastest-so-far at each point in time.

export type PbStatus = { isCurrentPB: boolean; isPastPB: boolean };

export type PbCandidate = {
  id: string;
  distance_m: number;
  race_type: string | null;
  time_seconds: number | null;
  performance_date: string;
  is_pb?: boolean | null;
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
    // trigger treats an exact-time tie as PB on both rows.
    const wasPbWhenSet = cur == null || p.time_seconds! <= cur;

    if (cur == null || p.time_seconds! < cur) {
      bestSoFar.set(key, p.time_seconds!);
    }

    const isCurrentPB = !!p.is_pb;
    result.set(p.id, { isCurrentPB, isPastPB: wasPbWhenSet && !isCurrentPB });
  }

  return result;
}

// Convenience for a single row — callers already iterating a list should
// use computePbStatus once and look up by id instead of calling this
// per-row (that would redo the full history walk every time).
export function pbStatusFor(id: string, statusMap: Map<string, PbStatus>): PbStatus {
  return statusMap.get(id) ?? { isCurrentPB: false, isPastPB: false };
}
