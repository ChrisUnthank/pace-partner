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

/** Parse a GPX XML string into normalized samples. */
function parseGPX(xml: string) {
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
    return { points: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
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
      lat: p.lat,
      lng: p.lng,
      elevation_m: p.ele,
      hr: p.hr,
      cadence: p.cad,
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
    points: any[];
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
          totalDistanceM: 0,
          totalTimeS: 0,
          startedAt: null,
          sport: data?.sport?.sport ?? null,
        });
      }

      const t0 = records[0].timestamp ? new Date(records[0].timestamp).getTime() : 0;

      const points = records.map((r: any) => ({
        elapsed_s: r.elapsed_time ?? (r.timestamp ? (new Date(r.timestamp).getTime() - t0) / 1000 : 0),
        lat: r.position_lat,
        lng: r.position_long,
        elevation_m: r.altitude,
        hr: r.heart_rate,
        cadence: r.cadence,
        pace_sec_per_km: r.speed && r.speed > 0.1 ? 1000 / r.speed : null,
        vertical_oscillation_cm: r.vertical_oscillation ?? null,
        ground_contact_time_ms: r.stance_time ?? null,
      }));

      const sess = data?.sessions?.[0];
      resolve({
        points,
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
  .inputValidator((d: { athleteId: string; sessionId?: string; filename: string; kind: "fit" | "gpx"; fileBase64: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const buf = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    let parsed: {
      points: any[];
      totalDistanceM: number;
      totalTimeS: number;
      startedAt: string | null;
      sport: string | null;
    };
    let parseError: string | null = null;

    try {
      parsed = data.kind === "gpx" ? parseGPX(new TextDecoder().decode(buf)) : await parseFIT(arrayBuffer);
    } catch (e: any) {
      parseError = String(e?.message ?? e);
      parsed = { points: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
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

    if (parsed.points.length) {
      const rows = parsed.points.map((p) => ({
        session_id: sess.id,
        file_id: fileRow.id,
        segment_type: "work",
        elapsed_s: p.elapsed_s,
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
        await sb.from("raw_session_points").insert(rows.slice(i, i + 500));
      }

      const hrs = parsed.points.map((p) => p.hr).filter((x): x is number => typeof x === "number");
      const paces = parsed.points
        .map((p) => p.pace_sec_per_km)
        .filter((x): x is number => typeof x === "number" && x > 0);
      const cads = parsed.points.map((p) => p.cadence).filter((x): x is number => typeof x === "number" && x > 0);

      const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
      const maxHr = hrs.length ? Math.max(...hrs) : null;
      const avgPace = paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null;
      const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;

      await sb
        .from("sessions")
        .update({
          total_distance_m: parsed.totalDistanceM || null,
          total_time_seconds: parsed.totalTimeS || null,
          avg_hr: avgHr,
          max_hr: maxHr,
          completion_pct: 100,
          work_distance_m: parsed.totalDistanceM,
          work_time_s: parsed.totalTimeS,
          work_avg_hr: avgHr,
          work_avg_pace_sec_per_km: avgPace,
          work_avg_cadence: avgCad,
        } as any)
        .eq("id", sess.id);

      // Synthesise one work step + one interval_results row so the detail UI,
      // work-segment breakdown, completion %, zones, fatigue, and the analytics
      // "Volume by Session Component" chart light up for imported sessions.
      // Skip when the session already has structured steps (planned sessions).
      const { data: existingSteps } = await sb
        .from("steps")
        .select("id")
        .eq("session_id", sess.id)
        .limit(1);

      if (!existingSteps || existingSteps.length === 0) {
        const { data: stepRow, error: stepErr } = await sb
          .from("steps")
          .insert({
            session_id: sess.id,
            step_order: 1,
            kind: "work",
            reps: 1,
            set_count: 1,
            target_kind: parsed.totalDistanceM > 0 ? "distance" : "time",
            target_distance_m: parsed.totalDistanceM > 0 ? parsed.totalDistanceM : null,
            target_time_seconds: parsed.totalTimeS > 0 ? parsed.totalTimeS : null,
            counts_toward_distance: true,
          } as any)
          .select()
          .single();

        if (!stepErr && stepRow) {
          const actualPace =
            parsed.totalDistanceM > 0 && parsed.totalTimeS > 0
              ? (parsed.totalTimeS / parsed.totalDistanceM) * 1000
              : null;
          await sb.from("interval_results").insert({
            step_id: stepRow.id,
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

    return { file: fileRow, points: parsed.points.length };
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
