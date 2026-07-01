import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function mapFitSport(sport: string | null | undefined): string {
  const s = (sport ?? "").toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("training") || s.includes("gym") || s.includes("strength")) return "gym";
  if (s.includes("track")) return "track";
  return "run";
}

function normalizeCadence(cad?: number): number | null {
  if (!cad || cad <= 0) return null;
  if (cad > 260) return null;
  if (cad < 120) return cad * 2;
  return cad;
}

function safeParseJson(value: any) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stepIsLadder(step: any): boolean {
  const meta = safeParseJson(step?.metadata);
  return Boolean(
    step?.is_ladder ??
      step?.ladder ??
      step?.variable_reps ??
      meta?.is_ladder ??
      meta?.ladder ??
      meta?.variable_reps,
  );
}

function getPlannedWorkSteps(plannedSteps: any[]) {
  return [...plannedSteps]
    .filter((s) => s.kind === "work")
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0));
}

function getPlannedBlockRecoverySteps(plannedSteps: any[]) {
  return [...plannedSteps]
    .filter((s) => s.kind === "recovery")
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0));
}

type ParsedPoint = {
  timestamp: string | null;
  elapsed_s: number;
  distance_m?: number | null;
  lat?: number | null;
  lng?: number | null;
  elevation_m?: number | null;
  hr?: number | null;
  cadence?: number | null;
  pace_sec_per_km?: number | null;
  stride_length_m?: number | null;
  vertical_oscillation_cm?: number | null;
  ground_contact_time_ms?: number | null;
  temperature_c?: number | null;
};

type ParsedLap = {
  index: number;
  startMs: number | null;
  endMs: number | null;
  intensity: string | null;
  total_distance: number;
  total_elapsed_time: number;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  kind?: "warmup" | "work" | "recovery" | "cooldown";
};

type ParsedFile = {
  points: ParsedPoint[];
  laps: ParsedLap[];
  totalDistanceM: number;
  totalTimeS: number;
  startedAt: string | null;
  sport: string | null;
};

type WorkRecoveryPair = {
  work: ParsedLap;
  recovery: ParsedLap | null;
};

type MergedPoint = ParsedPoint & {
  file_id: string;
};

/** Parse a GPX XML string into normalized samples. */
function parseGPX(xml: string): ParsedFile {
  const trkpts: {
    lat: number;
    lng: number;
    ele?: number;
    time?: string;
    hr?: number;
    cad?: number;
  }[] = [];

  const ptRe = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = ptRe.exec(xml))) {
    const inner = m[3];
    const ele = /<ele>([^<]+)<\/ele>/.exec(inner);
    const time = /<time>([^<]+)<\/time>/.exec(inner);
    const hr = /<(?:gpxtpx:)?hr>([^<]+)<\/(?:gpxtpx:)?hr>/.exec(inner);
    const cad = /<(?:gpxtpx:)?cad>([^<]+)<\/(?:gpxtpx:)?cad>/.exec(inner);

    trkpts.push({
      lat: parseFloat(m[1]),
      lng: parseFloat(m[2]),
      ele: ele ? parseFloat(ele[1]) : undefined,
      time: time?.[1],
      hr: hr ? parseInt(hr[1], 10) : undefined,
      cad: cad ? parseInt(cad[1], 10) : undefined,
    });
  }

  if (trkpts.length === 0) {
    return { points: [], laps: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
  }

  const t0 = trkpts[0].time ? new Date(trkpts[0].time).getTime() : 0;
  let totalDist = 0;

  const points: ParsedPoint[] = trkpts.map((p, i) => {
    if (i > 0) {
      const prev = trkpts[i - 1];
      const R = 6371000;
      const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) *
          Math.cos((p.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      totalDist += 2 * R * Math.asin(Math.sqrt(a));
    }

    const elapsed = p.time ? (new Date(p.time).getTime() - t0) / 1000 : i;
    const prev = i > 0 ? trkpts[i - 1] : null;

    let pace: number | undefined;
    if (prev?.time && p.time) {
      const R = 6371000;
      const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) *
          Math.cos((p.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      const dt = (new Date(p.time).getTime() - new Date(prev.time).getTime()) / 1000;
      if (d > 1 && dt > 0) pace = (dt / d) * 1000;
    }

    return {
  timestamp: p.time ?? null,
  elapsed_s: elapsed,
  distance_m: totalDist,
  lat: p.lat,
  lng: p.lng,
  elevation_m: p.ele ?? null,
  hr: p.hr ?? null,
  cadence: normalizeCadence(p.cad),
  pace_sec_per_km: pace ?? null,
  vertical_oscillation_cm: null,
  ground_contact_time_ms: null,
  temperature_c: null,
};
  });

  const totalTime =
    trkpts[trkpts.length - 1].time && trkpts[0].time
      ? (new Date(trkpts[trkpts.length - 1].time!).getTime() - t0) / 1000
      : 0;

  return {
    points,
    laps: [],
    totalDistanceM: totalDist,
    totalTimeS: totalTime,
    startedAt: trkpts[0].time ?? null,
    sport: null,
  };
}

async function parseFIT(buffer: ArrayBuffer): Promise<ParsedFile> {
  const FitParser = (await import("fit-file-parser")).default as any;
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    elapsedRecordField: true,
  });

  return await new Promise<ParsedFile>((resolve, reject) => {
    parser.parse(new Uint8Array(buffer), (err: any, data: any) => {
      if (err) return reject(err);

      const records: any[] = data?.records ?? [];
      const laps: any[] = data?.laps ?? [];

      if (!records.length) {
        return resolve({
          points: [],
          laps: [],
          totalDistanceM: 0,
          totalTimeS: 0,
          startedAt: null,
          sport: data?.sport?.sport ?? null,
        });
      }

      const t0 = records[0].timestamp ? new Date(records[0].timestamp).getTime() : 0;

      const points: ParsedPoint[] = records.map((r: any) => {
        const speed = r.enhanced_speed ?? r.speed ?? null;
        const cadence = normalizeCadence(r.cadence);

        return {
          return {
  timestamp: r.timestamp ?? null,
  elapsed_s:
    r.elapsed_time ??
    (r.timestamp ? (new Date(r.timestamp).getTime() - t0) / 1000 : 0),
  distance_m: r.distance ?? null,
  lat: r.position_lat ?? null,
  lng: r.position_long ?? null,
  elevation_m: r.enhanced_altitude ?? r.altitude ?? null,
  hr: r.heart_rate ?? null,
  cadence,
  pace_sec_per_km: speed && speed > 0.1 ? 1000 / speed : null,
  stride_length_m: speed && cadence ? speed / (cadence / 60) : null,
  vertical_oscillation_cm: r.vertical_oscillation ?? r.vertical_oscillation_mm ?? null,
  ground_contact_time_ms: r.stance_time ?? r.ground_contact_time ?? null,
  temperature_c: r.temperature ?? null,
};
      });

      const normalizedLaps: ParsedLap[] = laps.map((lap: any, i: number, arr: any[]) => {
        const start = lap.start_time ? new Date(lap.start_time).getTime() : null;
        let end = lap.timestamp ? new Date(lap.timestamp).getTime() : null;

        if (!end && start && lap.total_elapsed_time) {
          end = start + Number(lap.total_elapsed_time) * 1000;
        }

        if (!end && arr[i + 1]?.start_time) {
          end = new Date(arr[i + 1].start_time).getTime();
        }

        return {
          index: i,
          startMs: start,
          endMs: end,
          intensity: lap.intensity ?? null,
          total_distance: Number(lap.total_distance ?? 0),
          total_elapsed_time: Number(lap.total_elapsed_time ?? 0),
          avg_heart_rate: lap.avg_heart_rate ?? null,
          max_heart_rate: lap.max_heart_rate ?? null,
          avg_cadence: normalizeCadence(lap.avg_cadence) ?? null,
        };
      });

      const sess = data?.sessions?.[0];
      resolve({
        points,
        laps: normalizedLaps,
        totalDistanceM: Number(sess?.total_distance ?? 0),
        totalTimeS: Number(sess?.total_timer_time ?? 0),
        startedAt: records[0].timestamp ?? null,
        sport: sess?.sport ?? data?.sport?.sport ?? null,
      });
    });
  });
}

function classifyLaps(laps: ParsedLap[], plannedSteps: any[] = []): ParsedLap[] {
  if (!Array.isArray(laps) || laps.length === 0) return [];

  const valid = laps.filter((l) => l.total_distance > 0 && l.total_elapsed_time > 0);
  if (valid.length === 0) {
    return laps.map((l) => ({ ...l, kind: "work" as const }));
  }

  const workSteps = getPlannedWorkSteps(plannedSteps);
  const hasPlannedWork = workSteps.length > 0;
  const hasLadderPlan = workSteps.some(stepIsLadder);

  if (hasPlannedWork) {
    let classified: ParsedLap[] = laps.map((lap) => {
      if (lap.intensity === "rest") {
        return { ...lap, kind: "recovery" as const };
      }

      const isWork =
        lap.total_distance >= 150 ||
        lap.total_elapsed_time >= 60;

      return { ...lap, kind: isWork ? ("work" as const) : ("recovery" as const) };
    });

    const workIdxs = classified
      .map((l, i) => (l.kind === "work" ? i : -1))
      .filter((i) => i >= 0);

    if (workIdxs.length > 0) {
      const firstWork = workIdxs[0];
      const lastWork = workIdxs[workIdxs.length - 1];

      classified = classified.map((lap, idx) => {
        if (lap.kind === "work") return lap;
        if (idx < firstWork) return { ...lap, kind: "warmup" as const };
        if (idx > lastWork) return { ...lap, kind: "cooldown" as const };
        return lap;
      });
    }

    if (hasLadderPlan) return classified;
    return classified;
  }

  if (laps.length < 4) {
    return laps.map((l) => ({ ...l, kind: "work" as const }));
  }

  const nonRestCandidates = laps.filter(
    (l) => l.intensity !== "rest" && l.total_distance > 50 && l.total_elapsed_time > 10,
  );

  const buckets = new Map<number, number>();
  for (const lap of nonRestCandidates) {
    const bucket = Math.round(lap.total_distance / 10) * 10;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  let dominantDistance = 0;
  let dominantCount = 0;
  for (const [bucket, count] of buckets.entries()) {
    if (count > dominantCount) {
      dominantDistance = bucket;
      dominantCount = count;
    }
  }

  const tolerance = Math.max(20, dominantDistance * 0.25);

  let classified: ParsedLap[] = laps.map((lap) => {
    if (lap.intensity === "rest") {
      return { ...lap, kind: "recovery" as const };
    }

    if (dominantDistance > 0) {
      const isWork =
        Math.abs(lap.total_distance - dominantDistance) <= tolerance &&
        lap.total_elapsed_time >= 20;

      return { ...lap, kind: isWork ? ("work" as const) : ("recovery" as const) };
    }

    return { ...lap, kind: "work" as const };
  });

  const workIdxs = classified
    .map((l, i) => (l.kind === "work" ? i : -1))
    .filter((i) => i >= 0);

  if (workIdxs.length > 0) {
    const firstWork = workIdxs[0];
    const lastWork = workIdxs[workIdxs.length - 1];

    classified = classified.map((lap, idx) => {
      if (lap.kind === "work") return lap;
      if (idx < firstWork) return { ...lap, kind: "warmup" as const };
      if (idx > lastWork) return { ...lap, kind: "cooldown" as const };
      return lap;
    });
  }

  return classified;
}

function findLapKindForPoint(
  timestamp: Date | string | null,
  laps: ParsedLap[],
): string {
  if (!timestamp) return "work";
  const t = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime();
  for (const lap of laps) {
    const start = lap.startMs ?? null;
    const end = getLapEndMs(lap);
    if (start != null && end != null && t >= start && t <= end) {
      return lap.kind ?? "work";
    }
  }
  return "work";
}

function buildWorkRecoveryPairs(classifiedLaps: ParsedLap[]): WorkRecoveryPair[] {
  const pairs: WorkRecoveryPair[] = [];

  for (let i = 0; i < classifiedLaps.length; i++) {
    const lap = classifiedLaps[i];
    if (lap.kind !== "work") continue;

    let recovery: ParsedLap | null = null;

    if (i + 1 < classifiedLaps.length) {
      const next = classifiedLaps[i + 1];
      if (next.kind === "recovery") {
        recovery = next;
      }
    }

    pairs.push({
      work: lap,
      recovery,
    });
  }

  return pairs;
}

function splitWorkPairsIntoBlocks(pairs: WorkRecoveryPair[], plannedSteps: any[]) {
  const recoverySteps = getPlannedBlockRecoverySteps(plannedSteps);

  if (recoverySteps.length === 0) {
    return [pairs];
  }

  const recoveryStep = recoverySteps[0];
  const plannedBlockRecoverySeconds = Number(
    recoveryStep?.recovery_target_seconds ?? recoveryStep?.target_time_seconds ?? 0,
  );

  const recoveryDurations = pairs
    .map((p) => Number(p.recovery?.total_elapsed_time ?? 0))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);

  const medianRecovery =
    recoveryDurations.length > 0 ? recoveryDurations[Math.floor(recoveryDurations.length / 2)] : 0;

  const longRecoveryThreshold =
    plannedBlockRecoverySeconds > 0
      ? plannedBlockRecoverySeconds * 0.7
      : medianRecovery > 0
        ? medianRecovery * 1.75
        : Infinity;

  const blocks: WorkRecoveryPair[][] = [];
  let currentBlock: WorkRecoveryPair[] = [];

  for (const pair of pairs) {
    currentBlock.push(pair);

    const recDur = Number(pair.recovery?.total_elapsed_time ?? 0);
    const isLongRecovery = recDur > 0 && recDur >= longRecoveryThreshold;

    if (isLongRecovery) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length > 0) blocks.push(currentBlock);

  return blocks.length > 0 ? blocks : [pairs];
}

function inferRecoveryMode(recoveryLap: ParsedLap | null): string | null {
  if (!recoveryLap) return null;

  const dist = Number(recoveryLap.total_distance ?? 0);
  const dur = Number(recoveryLap.total_elapsed_time ?? 0);

  if (dur <= 0) return null;

  const paceSecPerKm = dist > 0 ? (dur / dist) * 1000 : null;

  if (dist < 10) return "rest";
  if (paceSecPerKm != null && paceSecPerKm > 500) return "walk";
  return "jog";
}

function getLapEndMs(lap: ParsedLap | null): number | null {
  if (!lap) return null;
  if (lap.endMs != null) return lap.endMs;
  if (lap.startMs != null && lap.total_elapsed_time > 0) {
    return lap.startMs + lap.total_elapsed_time * 1000;
  }
  return null;
}

function getEndHrForLap(points: MergedPoint[], lap: ParsedLap | null): number | null {
  if (!lap) return null;

  if (!lap.startMs || !getLapEndMs(lap)) {
    return lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
  }

  const endMs = getLapEndMs(lap)!;

  const candidates = points
    .filter((p) => {
      if (!p.timestamp || p.hr == null) return false;
      const t = new Date(p.timestamp).getTime();
      return t >= lap.startMs! && t <= endMs;
    })
    .sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

  if (candidates.length === 0) {
    return lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
  }

  return candidates[candidates.length - 1].hr ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
}

function summarizeImportedPoints(points: ParsedPoint[]) {
  const hrs = points.map((p) => p.hr).filter((x): x is number => typeof x === "number");
  const paces = points
    .map((p) => p.pace_sec_per_km)
    .filter((x): x is number => typeof x === "number" && x > 0 && x <= 600);
  const cads = points
    .map((p) => p.cadence)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const temps = points
    .map((p) => p.temperature_c)
    .filter((x): x is number => typeof x === "number");

  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const avgPace = paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null;
  const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;
  const avgTemp =
    temps.length ? Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)) : null;

  return { avgHr, maxHr, avgPace, avgCad, avgTemp };
}

function summarizeLapsMetrics(laps: ParsedLap[], points: MergedPoint[]) {
  const totalDistance = laps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0);
  const totalTime = laps.reduce((s, l) => s + Number(l.total_elapsed_time ?? 0), 0);

  const hrWeighted = laps.reduce((s, l) => {
    if (l.avg_heart_rate == null) return s;
    return s + Number(l.avg_heart_rate) * Number(l.total_elapsed_time ?? 0);
  }, 0);

  const hrTime = laps.reduce((s, l) => {
    if (l.avg_heart_rate == null) return s;
    return s + Number(l.total_elapsed_time ?? 0);
  }, 0);

  const avgHr = hrTime > 0 ? Math.round(hrWeighted / hrTime) : null;
  const maxHr = laps.reduce((m, l) => Math.max(m, Number(l.max_heart_rate ?? 0)), 0) || null;

  const cadWeighted = laps.reduce((s, l) => {
    if (l.avg_cadence == null) return s;
    return s + Number(l.avg_cadence) * Number(l.total_elapsed_time ?? 0);
  }, 0);

  const cadTime = laps.reduce((s, l) => {
    if (l.avg_cadence == null) return s;
    return s + Number(l.total_elapsed_time ?? 0);
  }, 0);

  const avgCad = cadTime > 0 ? Math.round(cadWeighted / cadTime) : null;
  const endHr = laps.length > 0 ? getEndHrForLap(points, laps[laps.length - 1]) : null;

  return {
    distance: totalDistance || null,
    time: totalTime || null,
    avgHr,
    maxHr,
    avgCad,
    endHr,
  };
}

function sortFilesForRebuild(files: any[]) {
  return [...files].sort((a, b) => {
    const ta = a.started_at
      ? new Date(a.started_at).getTime()
      : a.created_at
        ? new Date(a.created_at).getTime()
        : 0;

    const tb = b.started_at
      ? new Date(b.started_at).getTime()
      : b.created_at
        ? new Date(b.created_at).getTime()
        : 0;

    return ta - tb;
  });
}

async function parseStoredFile(
  sb: any,
  file: { storage_path: string; file_kind: string },
): Promise<ParsedFile | null> {
  const { data: blob, error } = await sb.storage.from("session-files").download(file.storage_path);
  if (error || !blob) return null;
  const buf = await blob.arrayBuffer();

  try {
    if (file.file_kind === "gpx") {
      return parseGPX(new TextDecoder().decode(new Uint8Array(buf)));
    }
    return await parseFIT(buf);
  } catch {
    return null;
  }
}

function buildIntervalRowsFromPlan(
  workBlocks: WorkRecoveryPair[][],
  plannedSteps: any[],
  mergedPoints: MergedPoint[] = [],
) {
  const workSteps = getPlannedWorkSteps(plannedSteps);
  const rows: any[] = [];

  for (let blockIdx = 0; blockIdx < workBlocks.length; blockIdx++) {
    const pairs = workBlocks[blockIdx] ?? [];
    const workStep = workSteps[blockIdx] ?? workSteps[workSteps.length - 1];

    if (!workStep || pairs.length === 0) continue;

    const repsPerSet = Math.max(1, Number(workStep.reps ?? pairs.length));
    const setCount = Math.max(1, Number(workStep.set_count ?? 1));
    const ladder = stepIsLadder(workStep);

    let setNumber = 1;
    let repNumber = 0;

    for (let i = 0; i < pairs.length; i++) {
      repNumber += 1;

      if (!ladder && repNumber > repsPerSet) {
        setNumber += 1;
        repNumber = 1;
      }

      if (setNumber > setCount) setNumber = setCount;

      const pair = pairs[i];
      const lap = pair.work;
      const recovery = pair.recovery;

      rows.push({
        step_id: workStep.id,
        set_number: setNumber,
        rep_number: ladder ? i + 1 : repNumber,
        actual_time_seconds: lap.total_elapsed_time || null,
        actual_distance_m: lap.total_distance || null,
        actual_pace_sec_per_km:
          lap.total_distance > 0 && lap.total_elapsed_time > 0
            ? (lap.total_elapsed_time / lap.total_distance) * 1000
            : null,
        hr_avg: lap.avg_heart_rate ?? null,
        hr_max: lap.max_heart_rate ?? null,
        hr_end: getEndHrForLap(mergedPoints, lap) ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null,
        hr_end_recovery:
          getEndHrForLap(mergedPoints, recovery) ??
          recovery?.avg_heart_rate ??
          null,
        cadence: lap.avg_cadence ?? null,
      });
    }
  }

  return rows;
}

/**
 * Rebuild entire FIT/GPX-derived session from all attached files.
 * This is the single source of truth for raw_session_points / steps / interval_results.
 */
async function rebuildSessionFromAllFiles(sb: any, sessionId: string): Promise<void> {
  const { data: sess, error: sessErr } = await sb
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessErr || !sess) throw sessErr ?? new Error("Session not found for rebuild");

  const { data: files } = await sb
    .from("session_files")
    .select("id, storage_path, file_kind, started_at, total_distance_m, total_time_s, created_at")
    .eq("session_id", sessionId);

  const safeFiles = sortFilesForRebuild(files ?? []);

  await sb.from("session_zone_time").delete().eq("session_id", sessionId);
  await sb.from("session_fatigue").delete().eq("session_id", sessionId);
  await sb.from("raw_session_points").delete().eq("session_id", sessionId);

  const { data: existingSteps } = await sb
    .from("steps")
    .select("id")
    .eq("session_id", sessionId);

  const existingStepIds = (existingSteps ?? []).map((s: any) => s.id);

  const { data: plannedStepsAll } = await sb
    .from("steps")
    .select("*")
    .eq("session_id", sessionId)
    .order("step_order");

  const safePlannedSteps = plannedStepsAll ?? [];
  const hasManualPlan = Boolean(sess.is_planned) && safePlannedSteps.length > 0;

  if (existingStepIds.length > 0) {
    await sb.from("interval_results").delete().in("step_id", existingStepIds);
  }

  if (!hasManualPlan && existingStepIds.length > 0) {
    await sb.from("steps").delete().eq("session_id", sessionId);
  }

  if (safeFiles.length === 0) {
    await sb
  .from("sessions")
  .update({
    total_distance_m: null,
    total_time_seconds: null,
    work_distance_m: null,
    work_time_s: null,
    avg_hr: null,
    max_hr: null,
    average_temp_c: null,
    work_avg_hr: null,
    work_avg_pace_sec_per_km: null,
    work_avg_cadence: null,
    completion_pct: null,
    structure: hasManualPlan ? sess.structure : "continuous",
    needs_review: true,
  } as any)
  .eq("id", sessionId);

    return;
  }

  const parsedFiles: { file: any; parsed: ParsedFile }[] = [];
  for (const f of safeFiles) {
    const parsed = await parseStoredFile(sb, f);
    if (parsed) parsedFiles.push({ file: f, parsed });
  }

  if (parsedFiles.length === 0) {
    throw new Error("Rebuild failed: no attached file could be parsed");
  }

  const anchorMsList = parsedFiles
    .map((p) => {
      const rawStart = p.parsed.startedAt ?? p.file.started_at ?? p.file.created_at ?? null;
      return rawStart ? new Date(rawStart).getTime() : null;
    })
    .filter((x): x is number => x !== null);

  const anchorMs = anchorMsList.length > 0 ? Math.min(...anchorMsList) : 0;

  const mergedPoints: MergedPoint[] = [];
  let cumulativeDistanceOffset = 0;

  for (const { file, parsed } of parsedFiles) {
    const rawStart = parsed.startedAt ?? file.started_at ?? file.created_at ?? null;
    const fileStartMs = rawStart ? new Date(rawStart).getTime() : anchorMs;
    const offsetS = anchorMs > 0 ? (fileStartMs - anchorMs) / 1000 : 0;

    let fileMaxDistance = 0;

    for (const p of parsed.points) {
      const pointDistance = Number(p.distance_m ?? 0);
      if (pointDistance > fileMaxDistance) fileMaxDistance = pointDistance;

      mergedPoints.push({
        ...p,
        elapsed_s: Number(p.elapsed_s ?? 0) + offsetS,
        distance_m: p.distance_m != null ? Number(p.distance_m) + cumulativeDistanceOffset : null,
        file_id: file.id,
      });
    }

    cumulativeDistanceOffset += fileMaxDistance;
  }

  mergedPoints.sort((a, b) => a.elapsed_s - b.elapsed_s);

  const mergedLaps: ParsedLap[] = [];
  for (const { parsed } of parsedFiles) {
    for (const lap of parsed.laps) {
      mergedLaps.push({ ...lap });
    }
  }

  mergedLaps.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  mergedLaps.forEach((l, i) => {
    l.index = i;
  });

  const classifiedLaps = classifyLaps(mergedLaps, hasManualPlan ? safePlannedSteps : []);
  const pairs = buildWorkRecoveryPairs(classifiedLaps);

  const workLaps = classifiedLaps.filter((l) => l.kind === "work");
  const warmupLaps = classifiedLaps.filter((l) => l.kind === "warmup");
  const cooldownLaps = classifiedLaps.filter((l) => l.kind === "cooldown");

  const isIntervals = pairs.length > 1;

  const totalDistanceM =
    mergedPoints.length > 0
      ? Number(mergedPoints[mergedPoints.length - 1].distance_m ?? 0)
      : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalDistanceM ?? 0), 0);

  const totalTimeS =
    mergedPoints.length > 0
      ? Number(mergedPoints[mergedPoints.length - 1].elapsed_s ?? 0)
      : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalTimeS ?? 0), 0);

  const { avgHr, maxHr, avgPace, avgCad, avgTemp } = summarizeImportedPoints(mergedPoints);

  if (mergedPoints.length > 0) {
    const rows = mergedPoints.map((p) => ({
  session_id: sessionId,
  file_id: p.file_id,
  segment_type: findLapKindForPoint(p.timestamp ?? null, classifiedLaps),
  elapsed_s: p.elapsed_s,
  distance_m: p.distance_m ?? null,
  lat: p.lat ?? null,
  lng: p.lng ?? null,
  hr: p.hr ?? null,
  pace_sec_per_km: p.pace_sec_per_km ?? null,
  cadence: p.cadence ?? null,
  elevation_m: p.elevation_m ?? null,
  vertical_oscillation_cm: p.vertical_oscillation_cm ?? null,
  ground_contact_time_ms: p.ground_contact_time_ms ?? null,
  temperature_c: p.temperature_c ?? null,
}));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("raw_session_points").insert(rows.slice(i, i + 500) as any);
      if (error) throw error;
    }
  }

  if (hasManualPlan) {
    const workBlocks = splitWorkPairsIntoBlocks(pairs, safePlannedSteps);
    const intervalRows = buildIntervalRowsFromPlan(workBlocks, safePlannedSteps, mergedPoints);

    if (intervalRows.length > 0) {
      const { error } = await sb.from("interval_results").insert(intervalRows as any);
      if (error) throw error;
    }
  } else {
    const stepsToInsert: any[] = [];
    let stepOrder = 1;

    const warmupMetrics = summarizeLapsMetrics(warmupLaps, mergedPoints);
    const cooldownMetrics = summarizeLapsMetrics(cooldownLaps, mergedPoints);

    const hasWarmup =
      Number(warmupMetrics.time ?? 0) >= 120 ||
      Number(warmupMetrics.distance ?? 0) >= 200;

    const hasCooldown =
      Number(cooldownMetrics.time ?? 0) >= 120 ||
      Number(cooldownMetrics.distance ?? 0) >= 200;

    const recoveryDurations = pairs
      .map((p) => Number(p.recovery?.total_elapsed_time ?? 0))
      .filter((x) => x > 0);

    const sortedRec = [...recoveryDurations].sort((a, b) => a - b);
    const medianRec = sortedRec.length > 0 ? sortedRec[Math.floor(sortedRec.length / 2)] : 0;
    const betweenSetThreshold = medianRec > 0 ? medianRec * 1.75 : Infinity;

    const shortRecoveries = recoveryDurations.filter((x) => x > 0 && x < betweenSetThreshold);
    const recoveryForAvg = shortRecoveries.length > 0 ? shortRecoveries : recoveryDurations;

    const avgRecovery =
      recoveryForAvg.length > 0
        ? Math.round(recoveryForAvg.reduce((a, b) => a + b, 0) / recoveryForAvg.length)
        : null;

    const recoveryMode = inferRecoveryMode(
      pairs.find(
        (p) =>
          Number(p.recovery?.total_elapsed_time ?? 0) > 0 &&
          Number(p.recovery?.total_elapsed_time ?? 0) < betweenSetThreshold,
      )?.recovery ??
        pairs[0]?.recovery ??
        null,
    );

    const workBlocks: WorkRecoveryPair[][] = [];
    let currentBlock: WorkRecoveryPair[] = [];

    for (const pair of pairs) {
      currentBlock.push(pair);
      const recDur = Number(pair.recovery?.total_elapsed_time ?? 0);

      if (recDur >= betweenSetThreshold) {
        workBlocks.push(currentBlock);
        currentBlock = [];
      }
    }
    if (currentBlock.length > 0) workBlocks.push(currentBlock);

    const haveBetweenSet = workBlocks.length > 1;

    const isContinuous =
      pairs.length <= 1 &&
      !hasWarmup &&
      !hasCooldown;

    if (isContinuous) {
      stepsToInsert.push({
        session_id: sessionId,
        step_order: stepOrder++,
        kind: "work",
        reps: 1,
        set_count: 1,
        target_kind: totalDistanceM > 0 ? "distance" : "time",
        target_distance_m: totalDistanceM > 0 ? totalDistanceM : null,
        target_time_seconds: totalDistanceM > 0 ? null : totalTimeS > 0 ? totalTimeS : null,
        counts_toward_distance: true,
      });
    } else {
      if (hasWarmup) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "warmup",
          reps: 1,
          set_count: 1,
          target_kind: warmupMetrics.distance && warmupMetrics.distance > 0 ? "distance" : "time",
          target_distance_m: warmupMetrics.distance && warmupMetrics.distance > 0 ? warmupMetrics.distance : null,
          target_time_seconds: warmupMetrics.time && warmupMetrics.time > 0 ? warmupMetrics.time : null,
          counts_toward_distance: true,
        });
      }

      const pushWorkStep = (blockPairs: WorkRecoveryPair[]) => {
        const blockWorkLaps = blockPairs.map((p) => p.work);
        const blockDist = blockWorkLaps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0);
        const blockTime = blockWorkLaps.reduce((s, l) => s + Number(l.total_elapsed_time ?? 0), 0);

        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "work",
          reps: blockPairs.length,
          set_count: 1,
          target_kind: blockDist > 0 ? "distance" : "time",
          target_distance_m: blockDist > 0 ? Math.round(blockDist / Math.max(1, blockPairs.length)) : null,
          target_time_seconds:
            blockDist > 0 ? null : Math.round(blockTime / Math.max(1, blockPairs.length)),
          counts_toward_distance: true,
          recovery_between_reps_seconds: avgRecovery,
          recovery_between_reps_target_kind: avgRecovery != null ? "time" : null,
          recovery_between_reps_mode: recoveryMode,
        });
      };

      if (pairs.length > 0) {
        if (haveBetweenSet) {
          for (let bi = 0; bi < workBlocks.length; bi++) {
            pushWorkStep(workBlocks[bi]);

            if (bi < workBlocks.length - 1) {
              const blk = workBlocks[bi];
              const recLap = blk[blk.length - 1]?.recovery;
              const recDur = Number(recLap?.total_elapsed_time ?? 0);
              const recDist = Number(recLap?.total_distance ?? 0);

              stepsToInsert.push({
                session_id: sessionId,
                step_order: stepOrder++,
                kind: "recovery",
                reps: 1,
                set_count: 1,
                target_kind: recDist > 0 ? "distance" : "time",
                target_distance_m: recDist > 0 ? recDist : null,
                target_time_seconds: recDur > 0 ? recDur : null,
                counts_toward_distance: false,
              });
            }
          }
        } else {
          pushWorkStep(pairs);
        }
      } else if (workLaps.length > 0 || totalDistanceM > 0 || totalTimeS > 0) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "work",
          reps: 1,
          set_count: 1,
          target_kind: totalDistanceM > 0 ? "distance" : "time",
          target_distance_m: totalDistanceM > 0 ? totalDistanceM : null,
          target_time_seconds: totalDistanceM > 0 ? null : totalTimeS > 0 ? totalTimeS : null,
          counts_toward_distance: true,
        });
      }

      if (hasCooldown) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "cooldown",
          reps: 1,
          set_count: 1,
          target_kind: cooldownMetrics.distance && cooldownMetrics.distance > 0 ? "distance" : "time",
          target_distance_m:
            cooldownMetrics.distance && cooldownMetrics.distance > 0 ? cooldownMetrics.distance : null,
          target_time_seconds: cooldownMetrics.time && cooldownMetrics.time > 0 ? cooldownMetrics.time : null,
          counts_toward_distance: true,
        });
      }
    }

    if (stepsToInsert.length === 0) {
      throw new Error("Rebuild produced no steps from attached files");
    }

    const { data: insertedSteps, error: stepsErr } = await sb
      .from("steps")
      .insert(stepsToInsert as any)
      .select();

    if (stepsErr) throw stepsErr;
    if (!insertedSteps?.length) {
      throw new Error("No steps were inserted for uploaded session");
    }

    const workSteps = insertedSteps
      .filter((s: any) => s.kind === "work")
      .sort((a: any, b: any) => Number(a.step_order) - Number(b.step_order));

    const warmupStep = insertedSteps.find((s: any) => s.kind === "warmup");
    const cooldownStep = insertedSteps.find((s: any) => s.kind === "cooldown");
    const recoverySteps = insertedSteps
      .filter((s: any) => s.kind === "recovery")
      .sort((a: any, b: any) => Number(a.step_order) - Number(b.step_order));

    const intervalRows: any[] = [];

    if (hasWarmup && warmupStep) {
      intervalRows.push({
        step_id: warmupStep.id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: warmupMetrics.time,
        actual_distance_m: warmupMetrics.distance,
        actual_pace_sec_per_km:
          warmupMetrics.distance && warmupMetrics.time
            ? (Number(warmupMetrics.time) / Number(warmupMetrics.distance)) * 1000
            : null,
        hr_avg: warmupMetrics.avgHr,
        hr_max: warmupMetrics.maxHr,
        hr_end: warmupMetrics.endHr,
        hr_end_recovery: null,
        cadence: warmupMetrics.avgCad,
      });
    }

    if (pairs.length > 0) {
      if (workSteps.length === 0) {
        throw new Error("Uploaded session did not create a work step");
      }

      const blocksForReps = haveBetweenSet ? workBlocks : [pairs];

      for (let bi = 0; bi < blocksForReps.length; bi++) {
        const ws = workSteps[bi] ?? workSteps[workSteps.length - 1];
        const blk = blocksForReps[bi];

        blk.forEach((pair, idx) => {
          const lap = pair.work;
          const recovery = pair.recovery;

          intervalRows.push({
            step_id: ws.id,
            set_number: 1,
            rep_number: idx + 1,
            actual_time_seconds: lap.total_elapsed_time || null,
            actual_distance_m: lap.total_distance || null,
            actual_pace_sec_per_km:
              lap.total_distance > 0 && lap.total_elapsed_time > 0
                ? (lap.total_elapsed_time / lap.total_distance) * 1000
                : null,
            hr_avg: lap.avg_heart_rate ?? null,
            hr_max: lap.max_heart_rate ?? null,
            hr_end: getEndHrForLap(mergedPoints, lap) ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null,
            hr_end_recovery:
              getEndHrForLap(mergedPoints, recovery) ??
              recovery?.avg_heart_rate ??
              null,
            cadence: lap.avg_cadence ?? null,
          });
        });

        if (haveBetweenSet && bi < recoverySteps.length) {
          const recLap = blk[blk.length - 1]?.recovery;
          if (recLap) {
            intervalRows.push({
              step_id: recoverySteps[bi].id,
              set_number: 1,
              rep_number: 1,
              actual_time_seconds: recLap.total_elapsed_time || null,
              actual_distance_m: recLap.total_distance || null,
              actual_pace_sec_per_km:
                recLap.total_distance > 0 && recLap.total_elapsed_time > 0
                  ? (recLap.total_elapsed_time / recLap.total_distance) * 1000
                  : null,
              hr_avg: recLap.avg_heart_rate ?? null,
              hr_max: recLap.max_heart_rate ?? null,
              hr_end: getEndHrForLap(mergedPoints, recLap) ?? recLap.max_heart_rate ?? recLap.avg_heart_rate ?? null,
              hr_end_recovery: null,
              cadence: recLap.avg_cadence ?? null,
            });
          }
        }
      }
    } else if (workSteps.length > 0 && (totalDistanceM > 0 || totalTimeS > 0)) {
      const actualPace =
        totalDistanceM > 0 && totalTimeS > 0
          ? (totalTimeS / totalDistanceM) * 1000
          : null;

      intervalRows.push({
        step_id: workSteps[0].id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: totalTimeS || null,
        actual_distance_m: totalDistanceM || null,
        actual_pace_sec_per_km: actualPace,
        hr_avg: avgHr,
        hr_max: maxHr,
        hr_end: maxHr ?? avgHr,
        hr_end_recovery: null,
        cadence: avgCad,
      });
    }

    if (hasCooldown && cooldownStep) {
      intervalRows.push({
        step_id: cooldownStep.id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: cooldownMetrics.time,
        actual_distance_m: cooldownMetrics.distance,
        actual_pace_sec_per_km:
          cooldownMetrics.distance && cooldownMetrics.time
            ? (Number(cooldownMetrics.time) / Number(cooldownMetrics.distance)) * 1000
            : null,
        hr_avg: cooldownMetrics.avgHr,
        hr_max: cooldownMetrics.maxHr,
        hr_end: cooldownMetrics.endHr,
        hr_end_recovery: null,
        cadence: cooldownMetrics.avgCad,
      });
    }

    if (intervalRows.length > 0) {
      const { error } = await sb.from("interval_results").insert(intervalRows as any);
      if (error) throw error;
    }
  }

  const workDistance = isIntervals
    ? workLaps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0)
    : totalDistanceM;

  const workTime = isIntervals
    ? workLaps.reduce((s, l) => s + Number(l.total_elapsed_time ?? 0), 0)
    : totalTimeS;

  const { error: updErr } = await sb
  .from("sessions")
  .update({
    total_distance_m: totalDistanceM || null,
    total_time_seconds: totalTimeS || null,
    avg_hr: avgHr,
    max_hr: maxHr,
    average_temp_c: avgTemp,
    completion_pct: 100,
    work_distance_m: workDistance || null,
    work_time_s: workTime || null,
    work_avg_hr: avgHr,
    work_avg_pace_sec_per_km: avgPace,
    work_avg_cadence: avgCad,
    structure: isIntervals ? "intervals" : "continuous",
    needs_review: isIntervals,
  } as any)
  .eq("id", sessionId);

  if (updErr) throw updErr;
}

export const uploadAndParseSessionFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { athleteId: string; sessionId?: string; filename: string; kind: "fit" | "gpx"; fileBase64: string }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const buf = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    let parsed: ParsedFile;
    let parseError: string | null = null;

    try {
      parsed = data.kind === "gpx" ? parseGPX(new TextDecoder().decode(buf)) : await parseFIT(arrayBuffer);
    } catch (e: any) {
      parseError = String(e?.message ?? e);
      parsed = { points: [], laps: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
    }

    const activityType = mapFitSport(parsed.sport ?? undefined);
    const sessionDate = parsed.startedAt
      ? new Date(parsed.startedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    let sess: any;

    if (data.sessionId) {
      const { data: existing, error: fetchErr } = await sb
        .from("sessions")
        .select("*")
        .eq("id", data.sessionId)
        .single();

      if (fetchErr || !existing) {
        throw fetchErr ?? new Error("Session not found");
      }

      sess = existing;
    } else {
      const { data: existingSameDay } = await sb
        .from("sessions")
        .select("*")
        .eq("athlete_id", data.athleteId)
        .eq("session_date", sessionDate)
        .eq("source", "fit_import")
        .limit(1)
        .maybeSingle();

      if (existingSameDay) {
        sess = existingSameDay;
      } else {
        const { data: inserted, error: sessError } = await sb
          .from("sessions")
          .insert({
            athlete_id: data.athleteId,
            created_by: context.userId,
            session_date: sessionDate,
            title: data.filename.replace(/\.(fit|gpx)$/i, ""),
            day_type: "training",
            intent: "aerobic",
            structure: "continuous",
            is_planned: false,
            completed_at: new Date().toISOString(),
            source: "fit_import",
            data_source: data.kind === "fit" ? "fit_upload" : "gpx_upload",
            activity_type: activityType,
            needs_review: true,
          } as any)
          .select()
          .single();

        if (sessError || !inserted) {
          throw sessError ?? new Error("Failed to create session");
        }

        sess = inserted;
      }
    }

    const { data: duplicate } = await sb
      .from("session_files")
      .select("id")
      .eq("session_id", sess.id)
      .eq("original_filename", data.filename)
      .eq("started_at", parsed.startedAt ?? "")
      .eq("total_distance_m", parsed.totalDistanceM)
      .maybeSingle();

    if (duplicate) {
      throw new Error("This FIT file is already attached to this session.");
    }

    const storagePath = `${data.athleteId}/${Date.now()}-${data.filename}`;
    const { error: upErr } = await sb.storage.from("session-files").upload(storagePath, buf, {
      contentType: data.kind === "fit" ? "application/octet-stream" : "application/gpx+xml",
    });

    if (upErr) throw upErr;

    const { data: fileRow, error: insErr } = await sb
      .from("session_files")
      .insert({
        athlete_id: data.athleteId,
        session_id: sess.id,
        file_kind: data.kind,
        storage_path: storagePath,
        original_filename: data.filename,
        started_at: parsed.startedAt,
        total_distance_m: parsed.totalDistanceM,
        total_time_s: parsed.totalTimeS,
        parsed_at: parseError ? null : new Date().toISOString(),
        parse_error: parseError,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    if (parseError) {
      return { file: fileRow, points: 0, error: parseError };
    }

    await rebuildSessionFromAllFiles(sb, sess.id);

    return {
      file: fileRow,
      points: parsed.points.length,
      lapCount: parsed.laps.length,
    };
  });

export const deleteSessionFileBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionFileId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const { data: fileRow, error: fileErr } = await sb
      .from("session_files")
      .select("*")
      .eq("id", data.sessionFileId)
      .single();

    if (fileErr || !fileRow) {
      throw fileErr ?? new Error("Session file not found");
    }

    const sessionId = fileRow.session_id;
    if (!sessionId) throw new Error("Session file has no session_id");

    await sb.from("raw_session_points").delete().eq("file_id", fileRow.id);

    if (fileRow.storage_path) {
      await sb.storage.from("session-files").remove([fileRow.storage_path]);
    }

    const { error: delErr } = await sb.from("session_files").delete().eq("id", fileRow.id);
    if (delErr) throw delErr;

    await rebuildSessionFromAllFiles(sb, sessionId);

    const { count } = await sb
      .from("session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    return { ok: true, sessionId, remainingFiles: count ?? 0 };
  });

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sessionId } = data;

    const { data: steps } = await sb.from("steps").select("id").eq("session_id", sessionId);
    const stepIds = (steps ?? []).map((s: any) => s.id);

    if (stepIds.length > 0) {
      await sb.from("interval_results").delete().in("step_id", stepIds);
    }

    await sb.from("steps").delete().eq("session_id", sessionId);
    await sb.from("raw_session_points").delete().eq("session_id", sessionId);
    await sb.from("session_fatigue").delete().eq("session_id", sessionId);
    await sb.from("session_zone_time").delete().eq("session_id", sessionId);

    const { data: files } = await sb.from("session_files").select("storage_path").eq("session_id", sessionId);
    const paths = (files ?? []).map((f: any) => f.storage_path).filter(Boolean);

    if (paths.length > 0) {
      await sb.storage.from("session-files").remove(paths);
    }

    await sb.from("session_files").delete().eq("session_id", sessionId);
    await sb.from("session_insights").delete().eq("session_id", sessionId);

    const { error } = await sb.from("sessions").delete().eq("id", sessionId);
    if (error) throw error;

    return { ok: true };
  });

export const submitCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      athleteId: string;
      sessionInsights: {
        sessionId: string;
        feel: number;
        wentWell?: string;
        wasDifficult?: string;
        niggles?: string;
      }[];
      endOfDayNote?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    for (const ins of data.sessionInsights) {
      await sb.from("session_insights").upsert(
        {
          session_id: ins.sessionId,
          athlete_id: data.athleteId,
          feel_score: ins.feel,
          went_well: ins.wentWell,
          was_difficult: ins.wasDifficult,
          niggles: ins.niggles,
        } as any,
        { onConflict: "session_id" } as any,
      );
    }

    if (data.endOfDayNote) {
      const today = new Date().toISOString().slice(0, 10);
      await sb.from("daily_checkins").upsert(
        {
          athlete_id: data.athleteId,
          date: today,
          end_of_day_note: data.endOfDayNote,
        } as any,
        { onConflict: "athlete_id,date" } as any,
      );
    }

    await sb.from("athletes").update({ last_checkout_at: new Date().toISOString() }).eq("id", data.athleteId);

    return { ok: true };
  });

export const sendReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; kind: string; message?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("pending_reminders")
      .insert({
        athlete_id: data.athleteId,
        coach_id: context.userId,
        kind: data.kind,
        message: data.message,
      })
      .select()
      .single();

    if (error) throw error;
    return row;
  });

