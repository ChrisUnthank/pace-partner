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
  if (cad < 120) return cad * 2;
  return cad;
}

type ParsedPoint = {
  timestamp: string | null;
  elapsed_s: number;
  distance_m?: number | null;
  lat?: number;
  lng?: number;
  elevation_m?: number;
  hr?: number;
  cadence?: number | null;
  pace_sec_per_km?: number | null;
  stride_length_m?: number | null;
  vertical_oscillation_cm?: number | null;
  ground_contact_time_ms?: number | null;
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
      timestamp: p.time ?? null,
      elapsed_s: elapsed,
      distance_m: totalDist,
      lat: p.lat,
      lng: p.lng,
      elevation_m: p.ele,
      hr: p.hr,
      cadence: normalizeCadence(p.cad),
      pace_sec_per_km: pace,
      vertical_oscillation_cm: null,
      ground_contact_time_ms: null,
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

      const points: ParsedPoint[] = records.map((r: any) => ({
        timestamp: r.timestamp ?? null,
        elapsed_s: r.elapsed_time ?? (r.timestamp ? (new Date(r.timestamp).getTime() - t0) / 1000 : 0),
        distance_m: r.distance ?? null,
        lat: r.position_lat,
        lng: r.position_long,
        elevation_m: r.altitude,
        hr: r.heart_rate,
        cadence: normalizeCadence(r.cadence),
        pace_sec_per_km: r.speed && r.speed > 0.1 ? 1000 / r.speed : null,
        stride_length_m:
          r.speed && normalizeCadence(r.cadence) ? r.speed / ((normalizeCadence(r.cadence) as number) / 60) : null,
        vertical_oscillation_cm: r.vertical_oscillation ?? null,
        ground_contact_time_ms: r.stance_time ?? null,
      }));

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

function classifyLaps(laps: ParsedLap[]): ParsedLap[] {
  if (!Array.isArray(laps) || laps.length === 0) return [];

  const valid = laps.filter((l) => l.total_distance > 0 && l.total_elapsed_time > 0);
  if (valid.length === 0) return laps.map((l) => ({ ...l, kind: "work" }));

  // If only a couple of laps exist, treat them all as work
  if (laps.length < 4) {
    return laps.map((l) => ({ ...l, kind: "work" }));
  }

  // Trust explicit rest intensity when present
  const nonRestCandidates = laps.filter((l) => l.intensity !== "rest" && l.total_distance > 20 && l.total_elapsed_time > 8);

  // Determine dominant repeating "work" distance cluster
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

  const tolerance = Math.max(15, dominantDistance * 0.25);

  let classified = laps.map((lap) => {
    if (lap.intensity === "rest") {
      return { ...lap, kind: "recovery" as const };
    }

    if (dominantDistance > 0) {
      const isWork = Math.abs(lap.total_distance - dominantDistance) <= tolerance && lap.total_elapsed_time >= 8;
      return { ...lap, kind: isWork ? ("work" as const) : ("recovery" as const) };
    }

    return { ...lap, kind: "work" as const };
  });

  // Reclassify non-work laps before/after the main work block as warmup/cooldown
  const workIdxs = classified.map((l, i) => (l.kind === "work" ? i : -1)).filter((i) => i >= 0);

  if (workIdxs.length > 0) {
    const firstWork = workIdxs[0];
    const lastWork = workIdxs[workIdxs.length - 1];

    classified = classified.map((lap, idx): ParsedLap => {
      if (lap.kind === "work") return lap;
      if (idx < firstWork) return { ...lap, kind: "warmup" as const };
      if (idx > lastWork) return { ...lap, kind: "cooldown" as const };
      return lap; // keep recovery between work reps
    });
  }

  return classified;
}

function findLapKindForPoint(timestamp: string | null, laps: ParsedLap[]): "warmup" | "work" | "recovery" | "cooldown" {
  if (!timestamp) return "work";
  const t = new Date(timestamp).getTime();
  const lap = laps.find((l) => l.startMs && l.endMs && t >= l.startMs && t < l.endMs);
  return (lap?.kind as "warmup" | "work" | "recovery" | "cooldown") ?? "work";
}

function summarizeImportedPoints(points: ParsedPoint[]) {
  const hrs = points.map((p) => p.hr).filter((x): x is number => typeof x === "number");
  const paces = points
    .map((p) => p.pace_sec_per_km)
    .filter((x): x is number => typeof x === "number" && x > 0 && x <= 600);
  const cads = points.map((p) => p.cadence).filter((x): x is number => typeof x === "number" && x > 0);

  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const avgPace = paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null;
  const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;

  return { avgHr, maxHr, avgPace, avgCad };
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
      const { data: existing, error: fetchErr } = await sb.from("sessions").select("*").eq("id", data.sessionId).single();
      if (fetchErr || !existing) {
        throw fetchErr ?? new Error("Session not found");
      }
      sess = existing;
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

    // Duplicate guard using existing columns (no schema change required)
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

    const classifiedLaps = classifyLaps(parsed.laps ?? []);
    const workLaps = classifiedLaps.filter((l) => l.kind === "work");
    const warmupLaps = classifiedLaps.filter((l) => l.kind === "warmup");
    const cooldownLaps = classifiedLaps.filter((l) => l.kind === "cooldown");
    const isIntervals = classifiedLaps.length > 2 && workLaps.length > 1;

    if (parsed.points.length) {
      const rows = parsed.points.map((p) => ({
        session_id: sess.id,
        file_id: fileRow.id,
        segment_type: findLapKindForPoint(p.timestamp ?? null, classifiedLaps),
        elapsed_s: p.elapsed_s,
        distance_m: p.distance_m ?? null,
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

      const { avgHr, maxHr, avgPace, avgCad } = summarizeImportedPoints(parsed.points);

      const workDistance = isIntervals
        ? workLaps.reduce((sum, lap) => sum + Number(lap.total_distance ?? 0), 0)
        : parsed.totalDistanceM;
      const workTime = isIntervals
        ? workLaps.reduce((sum, lap) => sum + Number(lap.total_elapsed_time ?? 0), 0)
        : parsed.totalTimeS;

      // Recompute session totals from all attached files on this session
      const { data: allFiles } = await sb
        .from("session_files")
        .select("total_distance_m, total_time_s")
        .eq("session_id", sess.id);

      const sessionTotalDistance = (allFiles ?? []).reduce((sum, f: any) => sum + Number(f.total_distance_m ?? 0), 0);
      const sessionTotalTime = (allFiles ?? []).reduce((sum, f: any) => sum + Number(f.total_time_s ?? 0), 0);

      await sb
        .from("sessions")
        .update({
          total_distance_m: sessionTotalDistance || parsed.totalDistanceM || null,
          total_time_seconds: sessionTotalTime || parsed.totalTimeS || null,
          avg_hr: avgHr,
          max_hr: maxHr,
          completion_pct: 100,
          work_distance_m: workDistance || null,
          work_time_s: workTime || null,
          work_avg_hr: avgHr,
          work_avg_pace_sec_per_km: avgPace,
          work_avg_cadence: avgCad,
          structure: isIntervals ? "intervals" : "continuous",
          intent: "aerobic",
          needs_review: isIntervals,
        } as any)
        .eq("id", sess.id);

      // Only synthesize structure when there are no existing planned steps
      const { data: existingSteps } = await sb.from("steps").select("id").eq("session_id", sess.id).limit(1);

      if (!existingSteps || existingSteps.length === 0) {
        const stepsToInsert: any[] = [];
        let stepOrder = 1;

        const warmupDistance = warmupLaps.reduce((sum, lap) => sum + Number(lap.total_distance ?? 0), 0);
        const warmupTime = warmupLaps.reduce((sum, lap) => sum + Number(lap.total_elapsed_time ?? 0), 0);
        const cooldownDistance = cooldownLaps.reduce((sum, lap) => sum + Number(lap.total_distance ?? 0), 0);
        const cooldownTime = cooldownLaps.reduce((sum, lap) => sum + Number(lap.total_elapsed_time ?? 0), 0);

        if (warmupTime > 0 || warmupDistance > 0) {
          stepsToInsert.push({
            session_id: sess.id,
            step_order: stepOrder++,
            kind: "warmup",
            reps: 1,
            set_count: 1,
            target_kind: warmupDistance > 0 ? "distance" : "time",
            target_distance_m: warmupDistance > 0 ? warmupDistance : null,
            target_time_seconds: warmupTime > 0 ? warmupTime : null,
            counts_toward_distance: true,
          });
        }

        stepsToInsert.push({
          session_id: sess.id,
          step_order: stepOrder++,
          kind: "work",
          reps: isIntervals ? workLaps.length : 1,
          set_count: 1,
          target_kind:
            isIntervals && workLaps.length > 0
              ? "distance"
              : parsed.totalDistanceM > 0
                ? "distance"
                : "time",
          target_distance_m:
            isIntervals && workLaps.length > 0
              ? Math.round(workLaps.reduce((sum, l) => sum + Number(l.total_distance ?? 0), 0) / workLaps.length)
              : parsed.totalDistanceM > 0
                ? parsed.totalDistanceM
                : null,
          target_time_seconds:
            !isIntervals && parsed.totalTimeS > 0
              ? parsed.totalTimeS
              : null,
          counts_toward_distance: true,
        });

        if (cooldownTime > 0 || cooldownDistance > 0) {
          stepsToInsert.push({
            session_id: sess.id,
            step_order: stepOrder++,
            kind: "cooldown",
            reps: 1,
            set_count: 1,
            target_kind: cooldownDistance > 0 ? "distance" : "time",
            target_distance_m: cooldownDistance > 0 ? cooldownDistance : null,
            target_time_seconds: cooldownTime > 0 ? cooldownTime : null,
            counts_toward_distance: true,
          });
        }

        const { data: insertedSteps, error: stepsErr } = await sb.from("steps").insert(stepsToInsert as any).select();

        if (!stepsErr && insertedSteps && insertedSteps.length > 0) {
          const workStep = insertedSteps.find((s: any) => s.kind === "work");

          if (workStep) {
            if (isIntervals && workLaps.length > 0) {
              const intervalRows = workLaps.map((lap, idx) => ({
                step_id: workStep.id,
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
                cadence: lap.avg_cadence ?? null,
              }));

              await sb.from("interval_results").insert(intervalRows as any);
            } else {
              const actualPace =
                parsed.totalDistanceM > 0 && parsed.totalTimeS > 0
                  ? (parsed.totalTimeS / parsed.totalDistanceM) * 1000
                  : null;

              await sb.from("interval_results").insert({
                step_id: workStep.id,
                set_number: 1,
                rep_number: 1,
                actual_time_seconds: parsed.totalTimeS || null,
                actual_distance_m: parsed.totalDistanceM || null,
                actual_pace_sec_per_km: actualPace,
                hr_avg: avgHr,
                hr_max: maxHr,
                cadence: avgCad,
              } as any);
            }
          }
        }
      }
    }

    return {
      file: fileRow,
      points: parsed.points.length,
      lapCount: parsed.laps.length,
      workLaps: classifiedLaps.filter((l) => l.kind === "work").length,
      recoveryLaps: classifiedLaps.filter((l) => l.kind === "recovery").length,
      structure: isIntervals ? "intervals" : "continuous",
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
