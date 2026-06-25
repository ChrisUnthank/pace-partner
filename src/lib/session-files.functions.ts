import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Map FIT sport field to app activity_type enum */
function mapFitSport(sport?: string): string {
  if (!sport) return "run";
  const s = sport.toLowerCase();
  if (s.includes("cycling") || s.includes("bike") || s.includes("ride")) return "ride";
  if (s.includes("swim")) return "swim";
  if (s.includes("training") || s.includes("gym") || s.includes("strength")) return "gym";
  if (s.includes("track")) return "track";
  return "run";
}

function normalizeCadence(cad?: number): number | null {
  if (!cad || cad <= 0) return null;

  // filter obvious garbage
  if (cad > 260) return null;

  // detect strides vs steps
  if (cad < 120) return cad * 2;

  return cad;
}

type BlockType = "warmup" | "work" | "cooldown" | "unknown";
type SegmentType = "warmup" | "work" | "recovery" | "cooldown";

type ParsedPoint = {
  elapsed_s: number;
  timestamp_ms?: number | null;
  lat?: number | null;
  lng?: number | null;
  elevation_m?: number | null;
  hr?: number | null;
  cadence?: number | null;
  pace_sec_per_km?: number | null;
  stride_length_m?: number | null;
  vertical_oscillation_cm?: number | null;
  ground_contact_time_ms?: number | null;
};

type ParsedLap = {
  index: number;
  start_ms: number | null;
  end_ms: number | null;
  duration_s: number | null;
  distance_m: number | null;
  intensity: string | null;
  segment_type: "work" | "recovery";
};

type ParsedActivity = {
  points: ParsedPoint[];
  laps: ParsedLap[];
  lapIntensityPresent: boolean;
  totalDistanceM: number;
  totalTimeS: number;
  startedAt: string | null;
  sport: string | null;
};

function parseTimeMs(value: any): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function meanNumber(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function classifyLapIntensity(lap: any, index: number): "work" | "recovery" {
  const intensity = String(lap?.intensity ?? "").toLowerCase();
  if (intensity) {
    if (intensity.includes("rest") || intensity.includes("recovery")) return "recovery";
    return "work";
  }
  return index % 2 === 0 ? "work" : "recovery";
}

function normalizeLaps(rawLaps: any[]): { laps: ParsedLap[]; lapIntensityPresent: boolean } {
  const lapIntensityPresent = rawLaps.some((lap) => lap?.intensity != null);
  const laps = rawLaps
    .map((lap, index): ParsedLap => {
      const startMs = parseTimeMs(lap?.start_time ?? lap?.timestamp);
      const duration = Number(lap?.total_timer_time ?? lap?.total_elapsed_time ?? 0) || null;
      return {
        index: index + 1,
        start_ms: startMs,
        end_ms: startMs != null && duration != null ? startMs + duration * 1000 : null,
        duration_s: duration,
        distance_m: Number(lap?.total_distance ?? 0) || null,
        intensity: lap?.intensity != null ? String(lap.intensity) : null,
        segment_type: classifyLapIntensity(lap, index),
      };
    })
    .filter((lap) => lap.duration_s != null || lap.distance_m != null || lap.start_ms != null);
  return { laps, lapIntensityPresent };
}

function segmentForPoint(point: ParsedPoint, laps: ParsedLap[], fallback: SegmentType): SegmentType {
  if (!laps.length) return fallback;
  const byTime =
    point.timestamp_ms != null
      ? laps.find((lap) => lap.start_ms != null && lap.end_ms != null && point.timestamp_ms! >= lap.start_ms && point.timestamp_ms! < lap.end_ms)
      : null;
  if (byTime) return byTime.segment_type;

  const byElapsed = laps.find((lap, index) => {
    const start = laps.slice(0, index).reduce((sum, item) => sum + Number(item.duration_s ?? 0), 0);
    const end = start + Number(lap.duration_s ?? 0);
    return point.elapsed_s >= start && point.elapsed_s < end;
  });
  return byElapsed?.segment_type ?? fallback;
}

function statsForPoints(points: ParsedPoint[]) {
  const hrs = points.map((p) => p.hr).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const paces = points
    .map((p) => p.pace_sec_per_km)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 600);
  const cads = points.map((p) => p.cadence).filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return {
    avgHr: hrs.length ? Math.round(meanNumber(hrs)!) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgPace: paces.length ? meanNumber(paces) : null,
    avgCad: cads.length ? Math.round(meanNumber(cads)!) : null,
  };
}

function lapWindowPoints(points: ParsedPoint[], lap: ParsedLap) {
  if (lap.start_ms != null && lap.end_ms != null) {
    const byTime = points.filter((p) => p.timestamp_ms != null && p.timestamp_ms >= lap.start_ms! && p.timestamp_ms < lap.end_ms!);
    if (byTime.length) return byTime;
  }
  const started = points.find((p) => p.timestamp_ms != null)?.timestamp_ms ?? null;
  if (started != null && lap.start_ms != null && lap.duration_s != null) {
    const startElapsed = (lap.start_ms - started) / 1000;
    return points.filter((p) => p.elapsed_s >= startElapsed && p.elapsed_s < startElapsed + lap.duration_s!);
  }
  return [];
}

function fileSummary(parsed: ParsedActivity) {
  const workLapCount = parsed.laps.filter((lap) => lap.segment_type === "work").length;
  const recoveryLapCount = parsed.laps.filter((lap) => lap.segment_type === "recovery").length;
  return {
    lap_count: parsed.laps.length,
    work_lap_count: workLapCount,
    recovery_lap_count: recoveryLapCount,
    lap_intensity_present: parsed.lapIntensityPresent,
    interval_auto_detected: parsed.laps.length > 2,
    parse_summary: {
      lap_count: parsed.laps.length,
      work_lap_count: workLapCount,
      recovery_lap_count: recoveryLapCount,
      lap_intensity_present: parsed.lapIntensityPresent,
    },
  };
}

function zoneFromHr(hr: number, zp: any): "z1" | "z2" | "z3" | "z4" | "z5" | null {
  if (zp?.hr_z1_max == null) return null;
  if (hr <= Number(zp.hr_z1_max)) return "z1";
  if (zp.hr_z2_max != null && hr <= Number(zp.hr_z2_max)) return "z2";
  if (zp.hr_z3_max != null && hr <= Number(zp.hr_z3_max)) return "z3";
  if (zp.hr_z4_max != null && hr <= Number(zp.hr_z4_max)) return "z4";
  return "z5";
}

function zoneFromPace(pace: number, zp: any): "z1" | "z2" | "z3" | "z4" | "z5" | null {
  const p5k = zp?.pace_5k_sec_per_km != null ? Number(zp.pace_5k_sec_per_km) : null;
  if (p5k == null || !Number.isFinite(p5k) || pace > 600) return null;
  if (pace >= p5k + 90) return "z1";
  if (pace >= p5k + 45) return "z2";
  if (pace >= p5k + 15) return "z3";
  if (pace >= p5k - 14) return "z4";
  return "z5";
}

async function rebuildZoneTimeFromRaw(sb: any, sessionId: string, athleteId: string) {
  const { data: zp } = await sb.from("athlete_zone_profiles").select("*").eq("athlete_id", athleteId).maybeSingle();
  const { data: pts } = await sb
    .from("raw_session_points")
    .select("elapsed_s, hr, pace_sec_per_km")
    .eq("session_id", sessionId)
    .order("elapsed_s");

  await sb.from("session_zone_time").delete().eq("session_id", sessionId);
  if (!zp || !Array.isArray(pts) || pts.length < 2) return false;

  const buckets = new Map<string, { seconds: number; meters: number; source: "hr" | "pace"; zone: string }>();
  for (let i = 0; i < pts.length - 1; i++) {
    const current = pts[i];
    const next = pts[i + 1];
    const delta = Math.max(0, Math.min(60, Number(next.elapsed_s ?? 0) - Number(current.elapsed_s ?? 0)));
    if (!delta) continue;
    const hr = current.hr != null ? Number(current.hr) : null;
    const pace = current.pace_sec_per_km != null ? Number(current.pace_sec_per_km) : null;
    const hrZone = hr != null ? zoneFromHr(hr, zp) : null;
    const paceZone = pace != null ? zoneFromPace(pace, zp) : null;
    if (hrZone) {
      const key = `hr:${hrZone}`;
      const row = buckets.get(key) ?? { seconds: 0, meters: 0, source: "hr" as const, zone: hrZone };
      row.seconds += delta;
      buckets.set(key, row);
    }
    if (paceZone && pace && pace > 0) {
      const key = `pace:${paceZone}`;
      const row = buckets.get(key) ?? { seconds: 0, meters: 0, source: "pace" as const, zone: paceZone };
      row.seconds += delta;
      row.meters += (delta / pace) * 1000;
      buckets.set(key, row);
    }
  }

  const now = new Date().toISOString();
  const rows = [...buckets.values()].map((r) => ({
    session_id: sessionId,
    athlete_id: athleteId,
    zone: r.zone,
    source: r.source,
    seconds: r.seconds,
    meters: r.meters,
    pace_5k_sec_per_km: zp.pace_5k_sec_per_km,
    hr_z1_max: zp.hr_z1_max,
    hr_z2_max: zp.hr_z2_max,
    hr_z3_max: zp.hr_z3_max,
    hr_z4_max: zp.hr_z4_max,
    boundaries_computed_at: now,
  }));
  if (rows.length) await sb.from("session_zone_time").insert(rows as any);
  await sb.from("session_files").update({ zone_time_rebuilt_at: now }).eq("session_id", sessionId);
  return rows.length > 0;
}

async function parseStoredFile(sb: any, file: any): Promise<ParsedActivity> {
  const { data, error } = await sb.storage.from("session-files").download(file.storage_path);
  if (error || !data) throw error ?? new Error("Unable to read stored file");
  const buffer = await data.arrayBuffer();
  return file.file_kind === "gpx" ? parseGPX(new TextDecoder().decode(new Uint8Array(buffer))) : await parseFIT(buffer);
}

async function rebuildSessionFromFiles(sb: any, sessionId: string) {
  const { data: session } = await sb.from("sessions").select("*").eq("id", sessionId).single();
  if (!session) throw new Error("Session not found");
  const { data: fileRows } = await sb
    .from("session_files")
    .select("*")
    .eq("session_id", sessionId)
    .is("parse_error", null)
    .order("started_at", { ascending: true });
  const files = Array.isArray(fileRows) ? fileRows : [];
  if (!files.length) return { primaryFileId: null, zoneTimeRebuilt: false };

  const parsedByFile = new Map<string, ParsedActivity>();
  for (const file of files) {
    const parsed = await parseStoredFile(sb, file);
    parsedByFile.set(file.id, parsed);
    await sb.from("session_files").update(fileSummary(parsed) as any).eq("id", file.id);
  }

  const workCandidates = files.filter((f) => (parsedByFile.get(f.id)?.laps.length ?? 0) > 2);
  const primary = [...workCandidates].sort((a, b) => {
    const ap = parsedByFile.get(a.id)!;
    const bp = parsedByFile.get(b.id)!;
    return bp.laps.length - ap.laps.length || Number(bp.totalDistanceM ?? 0) - Number(ap.totalDistanceM ?? 0);
  })[0];
  const primaryStart = primary?.started_at ? new Date(primary.started_at).getTime() : null;

  await sb.from("session_files").update({ is_primary_workout: false }).eq("session_id", sessionId);
  for (const file of files) {
    const parsed = parsedByFile.get(file.id)!;
    const fileStart = file.started_at ? new Date(file.started_at).getTime() : null;
    let blockType: BlockType = "unknown";
    if (file.id === primary?.id) blockType = "work";
    else if (parsed.laps.length > 2) blockType = "work";
    else if (primaryStart != null && fileStart != null && fileStart < primaryStart) blockType = "warmup";
    else if (primaryStart != null && fileStart != null && fileStart > primaryStart) blockType = "cooldown";
    await sb.from("session_files").update({ block_type: blockType, is_primary_workout: file.id === primary?.id } as any).eq("id", file.id);
    (file as any).block_type = blockType;
  }

  await sb.from("raw_session_points").delete().eq("session_id", sessionId);
  await sb.from("steps").delete().eq("session_id", sessionId);
  await sb.from("session_zone_time").delete().eq("session_id", sessionId);
  await sb.from("session_fatigue").delete().eq("session_id", sessionId);

  const sortedFiles = [...files].sort((a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime());
  const sessionStarted = sortedFiles[0]?.started_at ? new Date(sortedFiles[0].started_at).getTime() : null;
  let totalDistance = 0;
  let totalTime = 0;
  const allHrs: Array<number | null | undefined> = [];
  const allCads: Array<number | null | undefined> = [];
  const allPaces: Array<number | null | undefined> = [];

  for (const file of sortedFiles) {
    const parsed = parsedByFile.get(file.id)!;
    totalDistance += Number(parsed.totalDistanceM ?? 0);
    totalTime += Number(parsed.totalTimeS ?? 0);
    allHrs.push(...parsed.points.map((p) => p.hr));
    allCads.push(...parsed.points.map((p) => p.cadence));
    allPaces.push(...parsed.points.map((p) => p.pace_sec_per_km));
    const fileStart = file.started_at ? new Date(file.started_at).getTime() : null;
    const offset = sessionStarted != null && fileStart != null ? Math.max(0, (fileStart - sessionStarted) / 1000) : 0;
    const fallbackSegment = (file as any).block_type === "warmup" || (file as any).block_type === "cooldown" ? ((file as any).block_type as SegmentType) : "work";
    const rows = parsed.points.map((p) => ({
      session_id: sessionId,
      file_id: file.id,
      segment_type: segmentForPoint(p, parsed.laps, fallbackSegment),
      elapsed_s: offset + Number(p.elapsed_s ?? 0),
      lat: p.lat,
      lng: p.lng,
      hr: p.hr,
      pace_sec_per_km: p.pace_sec_per_km,
      cadence: p.cadence,
      elevation_m: p.elevation_m,
      vertical_oscillation_cm: p.vertical_oscillation_cm ?? null,
      ground_contact_time_ms: p.ground_contact_time_ms ?? null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await sb.from("raw_session_points").insert(rows.slice(i, i + 500) as any);
    }
  }

  const primaryParsed = primary ? parsedByFile.get(primary.id)! : null;
  const intervalDetected = !!primaryParsed && primaryParsed.laps.length > 2;
  const workLaps = primaryParsed?.laps.filter((lap) => lap.segment_type === "work") ?? [];
  const recoveryLaps = primaryParsed?.laps.filter((lap) => lap.segment_type === "recovery") ?? [];
  const workDistance = workLaps.reduce((sum, lap) => sum + Number(lap.distance_m ?? 0), 0);
  const workTime = workLaps.reduce((sum, lap) => sum + Number(lap.duration_s ?? 0), 0);

  for (let index = 0; index < sortedFiles.length; index++) {
    const file = sortedFiles[index];
    if (file.id === primary?.id) continue;
    const kind = (file as any).block_type;
    if (kind !== "warmup" && kind !== "cooldown") continue;
    const parsed = parsedByFile.get(file.id)!;
    const stats = statsForPoints(parsed.points);
    const { data: blockStep, error: blockStepErr } = await sb
      .from("steps")
      .insert({
        session_id: sessionId,
        step_order: index + 1,
        kind,
        reps: 1,
        set_count: 1,
        target_kind: parsed.totalDistanceM > 0 ? "distance" : "time",
        target_distance_m: parsed.totalDistanceM > 0 ? parsed.totalDistanceM : null,
        target_time_seconds: parsed.totalDistanceM > 0 ? null : parsed.totalTimeS,
        counts_toward_distance: true,
      } as any)
      .select()
      .single();
    if (blockStepErr) throw blockStepErr;
    await sb.from("session_files").update({ mapped_step_id: blockStep.id }).eq("id", file.id);
    await sb.from("interval_results").insert({
      step_id: blockStep.id,
      set_number: 1,
      rep_number: 1,
      actual_time_seconds: parsed.totalTimeS || null,
      actual_distance_m: parsed.totalDistanceM || null,
      actual_pace_sec_per_km:
        parsed.totalDistanceM > 0 && parsed.totalTimeS > 0 ? (parsed.totalTimeS / parsed.totalDistanceM) * 1000 : stats.avgPace,
      hr_avg: stats.avgHr,
      hr_max: stats.maxHr,
      cadence: stats.avgCad,
    } as any);
  }

  let workStep: any = null;
  if (primaryParsed && workLaps.length) {
    const primaryOrder = Math.max(1, sortedFiles.findIndex((file) => file.id === primary?.id) + 1);
    const firstDistance = workLaps.find((lap) => lap.distance_m != null)?.distance_m ?? null;
    const firstDuration = workLaps.find((lap) => lap.duration_s != null)?.duration_s ?? null;
    const { data: stepRow, error: stepErr } = await sb
      .from("steps")
      .insert({
        session_id: sessionId,
        step_order: primaryOrder,
        kind: "work",
        reps: workLaps.length,
        set_count: 1,
        target_kind: firstDistance ? "distance" : "time",
        target_distance_m: firstDistance,
        target_time_seconds: firstDistance ? null : firstDuration,
        recovery_between_reps_seconds: recoveryLaps.length ? Math.round(meanNumber(recoveryLaps.map((lap) => lap.duration_s)) ?? 0) || null : null,
        recovery_between_reps_mode: recoveryLaps.length ? "jog" : null,
        counts_toward_distance: true,
      } as any)
      .select()
      .single();
    if (stepErr) throw stepErr;
    workStep = stepRow;
    await sb.from("session_files").update({ mapped_step_id: workStep.id }).eq("id", primary.id);

    const resultRows = workLaps.map((lap, idx) => {
      const pts = lapWindowPoints(primaryParsed.points, lap);
      const stats = statsForPoints(pts);
      const distance = lap.distance_m ?? null;
      const duration = lap.duration_s ?? null;
      return {
        step_id: workStep.id,
        set_number: 1,
        rep_number: idx + 1,
        actual_time_seconds: duration,
        actual_distance_m: distance,
        actual_pace_sec_per_km: distance && duration ? (duration / distance) * 1000 : stats.avgPace,
        hr_avg: stats.avgHr,
        hr_max: stats.maxHr,
        hr_end: pts.length ? pts[pts.length - 1]?.hr ?? null : null,
        cadence: stats.avgCad,
      };
    });
    if (resultRows.length) await sb.from("interval_results").insert(resultRows as any);
  } else if (primaryParsed || files.length) {
    const target = primaryParsed ?? parsedByFile.get(sortedFiles[0].id)!;
    const stats = statsForPoints(target.points);
    const { data: stepRow, error: stepErr } = await sb
      .from("steps")
      .insert({
        session_id: sessionId,
        step_order: 1,
        kind: "work",
        reps: 1,
        set_count: 1,
        target_kind: target.totalDistanceM > 0 ? "distance" : "time",
        target_distance_m: target.totalDistanceM > 0 ? target.totalDistanceM : null,
        target_time_seconds: target.totalDistanceM > 0 ? null : target.totalTimeS,
        counts_toward_distance: true,
      } as any)
      .select()
      .single();
    if (stepErr) throw stepErr;
    const distance = target.totalDistanceM || null;
    const duration = target.totalTimeS || null;
    await sb.from("interval_results").insert({
      step_id: stepRow.id,
      set_number: 1,
      rep_number: 1,
      actual_time_seconds: duration,
      actual_distance_m: distance,
      actual_pace_sec_per_km: distance && duration ? (duration / distance) * 1000 : stats.avgPace,
      hr_avg: stats.avgHr,
      hr_max: stats.maxHr,
      cadence: stats.avgCad,
    } as any);
  }

  const allStats = statsForPoints([{ elapsed_s: 0 }, ...allHrs.map((hr, idx) => ({ elapsed_s: idx, hr, cadence: allCads[idx], pace_sec_per_km: allPaces[idx] }))]);
  const workStats = primaryParsed ? statsForPoints(workLaps.flatMap((lap) => lapWindowPoints(primaryParsed.points, lap))) : allStats;
  await sb
    .from("sessions")
    .update({
      total_distance_m: totalDistance || null,
      total_time_seconds: totalTime || null,
      avg_hr: allStats.avgHr,
      max_hr: allStats.maxHr,
      completion_pct: 100,
      work_distance_m: workDistance || (primaryParsed?.totalDistanceM ?? null),
      work_time_s: workTime || (primaryParsed?.totalTimeS ?? null),
      work_avg_hr: workStats.avgHr,
      work_avg_pace_sec_per_km: workDistance && workTime ? (workTime / workDistance) * 1000 : workStats.avgPace,
      work_avg_cadence: workStats.avgCad,
      structure: intervalDetected ? "intervals" : "continuous",
      intent: "aerobic",
      needs_review: intervalDetected || session.needs_review,
      data_source: "fit_upload",
    } as any)
    .eq("id", sessionId);

  const zoneTimeRebuilt = await rebuildZoneTimeFromRaw(sb, sessionId, session.athlete_id);
  return { primaryFileId: primary?.id ?? null, zoneTimeRebuilt, intervalDetected };
}

/** Parse a GPX XML string into normalized samples. */
function parseGPX(xml: string): ParsedActivity {
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
    return { points: [], laps: [], lapIntensityPresent: false, totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
  }

  const t0 = trkpts[0].time ? new Date(trkpts[0].time).getTime() : 0;
  let totalDist = 0;

  const points = trkpts.map((p, i) => {
    if (i > 0) {
      const prev = trkpts[i - 1];
      const R = 6371000;
      const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
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
        Math.cos((prev.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      const dt = (new Date(p.time).getTime() - new Date(prev.time).getTime()) / 1000;
      if (d > 1 && dt > 0) pace = (dt / d) * 1000;
    }

    return {
      elapsed_s: elapsed,
      timestamp_ms: p.time ? new Date(p.time).getTime() : null,
      lat: p.lat,
      lng: p.lng,
      elevation_m: p.ele,
      hr: p.hr,
      cadence: normalizeCadence(p.cad),
      pace_sec_per_km: pace,
      vertical_oscillation_cm: undefined,
      ground_contact_time_ms: undefined,
    };
  });

  const totalTime =
    trkpts[trkpts.length - 1].time && trkpts[0].time
      ? (new Date(trkpts[trkpts.length - 1].time!).getTime() - t0) / 1000
      : 0;

  return {
    points,
    laps: [],
    lapIntensityPresent: false,
    totalDistanceM: totalDist,
    totalTimeS: totalTime,
    startedAt: trkpts[0].time ?? null,
    sport: null,
  };
}

async function parseFIT(buffer: ArrayBuffer) {
  const FitParser = (await import("fit-file-parser")).default as any;
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    elapsedRecordField: true,
  });

  return await new Promise<{
    points: ParsedPoint[];
    laps: ParsedLap[];
    lapIntensityPresent: boolean;
    totalDistanceM: number;
    totalTimeS: number;
    startedAt: string | null;
    sport: string | null;
  }>((resolve, reject) => {
    parser.parse(new Uint8Array(buffer), (err: any, data: any) => {
      if (err) return reject(err);

      const records: any[] = data?.records ?? [];
      if (!records.length) {
        return resolve({
          points: [],
          laps: [],
          lapIntensityPresent: false,
          totalDistanceM: 0,
          totalTimeS: 0,
          startedAt: null,
          sport: data?.sport?.sport ?? null,
        });
      }

      const t0 = records[0].timestamp ? new Date(records[0].timestamp).getTime() : 0;

      const points = records.map((r: any) => {
        const ts = parseTimeMs(r.timestamp);
        const cad = normalizeCadence(r.cadence);
        return {
          elapsed_s: r.elapsed_time ?? (ts != null && t0 ? (ts - t0) / 1000 : 0),
          timestamp_ms: ts,
          lat: r.position_lat,
          lng: r.position_long,
          elevation_m: r.altitude,
          hr: r.heart_rate,
          cadence: cad,
          pace_sec_per_km: r.speed && r.speed > 0.1 ? 1000 / r.speed : null,
          stride_length_m: r.speed && cad ? r.speed / (cad / 60) : null,
          vertical_oscillation_cm: r.vertical_oscillation ?? null,
          ground_contact_time_ms: r.stance_time ?? null,
        };
      });

      const sess = data?.sessions?.[0];
      const { laps, lapIntensityPresent } = normalizeLaps(Array.isArray(data?.laps) ? data.laps : []);
      resolve({
        points,
        laps,
        lapIntensityPresent,
        totalDistanceM: sess?.total_distance ?? 0,
        totalTimeS: sess?.total_timer_time ?? 0,
        startedAt: records[0].timestamp ?? null,
        sport: sess?.sport ?? data?.sport?.sport ?? null,
      });
    });
  });
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

    let parsed: ParsedActivity;
    let parseError: string | null = null;

    try {
      parsed = data.kind === "gpx" ? parseGPX(new TextDecoder().decode(buf)) : await parseFIT(arrayBuffer);
    } catch (e: any) {
      parseError = String(e?.message ?? e);
      parsed = {
        points: [],
        laps: [],
        lapIntensityPresent: false,
        totalDistanceM: 0,
        totalTimeS: 0,
        startedAt: null,
        sport: null,
      };
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
      const { data: sameDay } = await sb
        .from("sessions")
        .select("*")
        .eq("athlete_id", data.athleteId)
        .eq("session_date", sessionDate)
        .eq("day_type", "training")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (sameDay) {
        sess = sameDay;
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
            structure: parsed.laps.length > 2 ? "intervals" : "continuous",
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

    const storagePath = `${data.athleteId}/${Date.now()}-${data.filename}`;
    const { error: upErr } = await sb.storage.from("session-files").upload(storagePath, buf, {
      contentType: data.kind === "fit" ? "application/octet-stream" : "application/gpx+xml",
    });
    if (upErr) throw upErr;

    const summary = fileSummary(parsed);
    const preliminaryBlockType: BlockType = parsed.laps.length > 2 ? "work" : "unknown";

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
        block_type: preliminaryBlockType,
        ...summary,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    if (parseError) {
      return { file: fileRow, points: 0, error: parseError };
    }

    const rebuild = await rebuildSessionFromFiles(sb, sess.id);

    return {
      file: { ...fileRow, ...summary },
      sessionId: sess.id,
      points: parsed.points.length,
      lap_count: summary.lap_count,
      work_lap_count: summary.work_lap_count,
      recovery_lap_count: summary.recovery_lap_count,
      lap_intensity_present: summary.lap_intensity_present,
      primaryFileId: rebuild.primaryFileId,
      zoneTimeRebuilt: rebuild.zoneTimeRebuilt,
    };
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
