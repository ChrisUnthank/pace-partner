import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- helpers ----
function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}
function weekStart(d = new Date()) {
  const x = new Date(d);
  const day = x.getUTCDay() || 7;
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1));
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

/**
 * Determine whether this user may invoke the AI. Coaches/managers always
 * have access (paid by the app via LOVABLE_API_KEY, 20 calls/day).
 * Athletes route through the same Lovable AI Gateway now — no more BYO
 * Anthropic key — gated by profiles.ai_subscription_active instead
 * (10 calls/day). That flag currently defaults true for every athlete
 * (no billing system exists yet); it's the hook a future paywall will
 * flip off per-athlete without any other code changes needed here.
 *
 * Returns:
 *   { allowed: false, reason: 'no_role' | 'subscription_required' }
 *   { allowed: true, role: 'coach', limit: 20 }
 *   { allowed: true, role: 'athlete', limit: 10 }
 */
export async function resolveAiAccess(sb: any, userId: string) {
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
  const roleList = (roles ?? []).map((r: any) => r.role);
  const isCoach = roleList.includes("coach") || roleList.includes("manager");
  if (isCoach) return { allowed: true as const, role: "coach" as const, limit: 20 };

  const isAthlete = roleList.includes("athlete");
  if (!isAthlete) return { allowed: false as const, reason: "no_role" as const };

  const { data: prof } = await sb.from("profiles").select("ai_subscription_active").eq("id", userId).maybeSingle();
  if (prof?.ai_subscription_active) return { allowed: true as const, role: "athlete" as const, limit: 10 };

  return { allowed: false as const, reason: "subscription_required" as const };
}

export async function consumeQuotaOrThrow(sb: any, userId: string, limit: number) {
  const { data, error } = await sb.rpc("ai_consume_quota", { _user_id: userId, _limit: limit });
  if (error) throw new Error(error.message);
  if (data === false) {
    throw new Error(`Daily AI limit reached (${limit} calls). Try again tomorrow.`);
  }
}

export async function requireAi(sb: any, userId: string) {
  const access = await resolveAiAccess(sb, userId);
  if (!access.allowed) {
    throw new Error(
      access.reason === "subscription_required"
        ? "AI requires an active subscription on your account."
        : "AI is not available for your account.",
    );
  }
  await consumeQuotaOrThrow(sb, userId, access.limit);
  return access;
}

/** Public-to-client status: { allowed, role, reason, used, limit } */
export const getAiAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await resolveAiAccess(context.supabase, context.userId);
    if (!access.allowed) {
      return { allowed: false, role: null, reason: access.reason, used: 0, limit: 0 };
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await context.supabase
      .from("ai_usage_daily")
      .select("call_count")
      .eq("user_id", context.userId)
      .eq("used_date", today)
      .maybeSingle();
    return {
      allowed: true,
      role: access.role,
      reason: null,
      used: usage?.call_count ?? 0,
      limit: access.limit,
    };
  });

/** Build a compact (<3KB) athlete payload for the AI. */
export const buildAthletePayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const today = new Date().toISOString().slice(0, 10);
    const since28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
    const since14 = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const since90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    // Load history needs a wider window than the rest of the payload — a
    // trend can't be judged from 14 days of near-flat averaging (see
    // load_trend below). 42 days gives enough runway to compare an early
    // portion of the window against a recent one and see real direction.
    const since42 = new Date(Date.now() - 42 * 86400_000).toISOString().slice(0, 10);
    const [athlete, sessions, load, vitals, insights, physio, zones, dna, upcomingRace, recentRace] = await Promise.all([
      sb.from("athletes").select("name, sex, primary_event, hr_max, hr_rest, training_age_years, weight, dob").eq("id", data.athleteId).maybeSingle(),
      sb.from("sessions").select("id, session_date, title, intent, day_type, rpe, completion_pct, total_distance_m, total_time_seconds, completed_at, time_of_day").eq("athlete_id", data.athleteId).gte("session_date", since28).order("session_date", { ascending: false }).order("time_of_day", { ascending: false }).limit(30),
      sb.from("athlete_load_daily").select("load_date, combined_load, ctl, atl, tsb, readiness_status, readiness_score").eq("athlete_id", data.athleteId).gte("load_date", since42).order("load_date", { ascending: false }),
      sb.from("daily_vitals").select("vitals_date, sleep_hours, resting_hr, weight_kg, hydration").eq("athlete_id", data.athleteId).gte("vitals_date", since14).order("vitals_date", { ascending: false }),
      sb.from("session_insights").select("created_at, feel_score, went_well, was_difficult, niggles").eq("athlete_id", data.athleteId).order("created_at", { ascending: false }).limit(5),
      // Was selecting vo2_max/lactate_threshold_pace/fatigue_resistance_score —
      // none of those columns exist on this table (real columns below).
      // PostgREST fails the whole query on an unknown column and this code
      // only ever checked `.data`, never `.error`, so this has been
      // silently sending `physio: {}` to the AI on every single call.
      sb.from("athlete_physio_profile").select("archetype, aerobic_pct, anaerobic_pct, speed_reserve_bucket, coaching_note, status").eq("athlete_id", data.athleteId).maybeSingle(),
      // Same bug — pace_z1_max etc. don't exist, real columns have a
      // _sec_per_km suffix. HR fields happened to already be correct.
      sb.from("athlete_zone_profiles").select("hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, pace_z1_max_sec_per_km, pace_z2_max_sec_per_km, pace_z3_max_sec_per_km, pace_z4_max_sec_per_km, vdot, pace_threshold_sec_per_km").eq("athlete_id", data.athleteId).maybeSingle(),
      // New — the 5 data-backed Athlete DNA ratings (Performance Profile
      // page). Gives the AI a real, current-data basis for "what should
      // this athlete work on" instead of a generic suggestion.
      sb.from("athlete_dna_ratings" as any).select("endurance_score, endurance_bucket, speed_score, speed_bucket, aerobic_capacity_score, aerobic_capacity_bucket, anaerobic_capacity_score, anaerobic_capacity_bucket, consistency_score, consistency_bucket, status").eq("athlete_id", data.athleteId).maybeSingle(),
      // Whether a race actually exists on the plan at all. Without this,
      // the model had zero race information and would still write "race
      // day" / taper / peaking language purely from generic coaching
      // patterns — inventing a race that was never scheduled. null here
      // is the signal to the model that there isn't one.
      sb.from("sessions").select("session_date, title").eq("athlete_id", data.athleteId).eq("day_type", "race").gte("session_date", today).order("session_date", { ascending: true }).limit(1).maybeSingle(),
      sb.from("sessions").select("session_date, title").eq("athlete_id", data.athleteId).eq("day_type", "race").gte("session_date", since90).lt("session_date", today).not("completed_at", "is", null).order("session_date", { ascending: false }).limit(1).maybeSingle(),
    ]);

    // Work-only distance per session — isolated to work/strides steps,
    // excluding warmup/recovery/cooldown. Without this, the only distance
    // figure available was total_distance_m (the whole session), which an
    // AI review or chat asked to discuss "work volume" would have no way
    // to distinguish from — silently reporting a session's full distance
    // (easy warmup/cooldown included) as if it were the hard-effort
    // portion alone. Same class of gap as the work_avg_pace_sec_per_km
    // fix elsewhere in this app (that one fell back to whole-session
    // blended pace for the same reason: no genuine work-only figure had
    // ever been computed).
    const sessionIds = (sessions.data ?? []).map((s: any) => s.id);
    const workDistanceBySession = new Map<string, number>();
    if (sessionIds.length > 0) {
      const { data: workSteps } = await sb
        .from("steps")
        .select("id, session_id")
        .in("session_id", sessionIds)
        .in("kind", ["work", "strides"]);
      const stepToSession = new Map<string, string>((workSteps ?? []).map((s: any) => [s.id, s.session_id]));
      const workStepIds = (workSteps ?? []).map((s: any) => s.id);
      if (workStepIds.length > 0) {
        const { data: workResults } = await sb
          .from("interval_results")
          .select("step_id, actual_distance_m")
          .in("step_id", workStepIds);
        for (const r of workResults ?? []) {
          const sid = stepToSession.get(r.step_id);
          if (!sid) continue;
          workDistanceBySession.set(sid, (workDistanceBySession.get(sid) ?? 0) + Number(r.actual_distance_m ?? 0));
        }
      }
    }

    const sList = (sessions.data ?? []).map((s: any) => ({
      d: s.session_date, t: s.title, i: s.intent, ty: s.day_type,
      rpe: s.rpe, c: s.completion_pct,
      km: s.total_distance_m ? Math.round(Number(s.total_distance_m) / 100) / 10 : null,
      work_km: workDistanceBySession.has(s.id) ? Math.round(workDistanceBySession.get(s.id)! / 100) / 10 : null,
      done: !!s.completed_at,
    }));
    const loadRows = load.data ?? [];
    const lastLoad = loadRows[0];

    // Trend, not just a snapshot. The old version of this payload only
    // sent a flat 14-day mean of CTL/ATL — that hides direction entirely.
    // An athlete's Fatigue (ATL) can be elevated in absolute terms while
    // still clearly falling day over day, and a flat mean gives the model
    // no way to see that; it ends up reading the single most-recent
    // CTL/ATL/TSB snapshot in isolation and guessing at a trend that may
    // be the opposite of what's actually happening. This compares the
    // early portion of the window against the most recent portion for
    // each metric and gives an explicit rising/falling/stable direction,
    // plus a sparse chronological sample so the model can see the actual
    // shape of the curve rather than inferring it from two numbers.
    const loadRowsAsc = [...loadRows].reverse(); // chronological, oldest first
    function trendFor(key: "ctl" | "atl" | "tsb") {
      const vals = loadRowsAsc.map((r: any) => Number(r[key] ?? 0));
      if (vals.length < 6) return { direction: "insufficient_data" as const, delta: null, early_mean: null, recent_mean: null };
      const third = Math.max(2, Math.floor(vals.length / 3));
      const early = vals.slice(0, third);
      const recent = vals.slice(-third);
      const earlyMean = early.reduce((a, b) => a + b, 0) / early.length;
      const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const delta = +(recentMean - earlyMean).toFixed(1);
      // TSB naturally sits closer to zero and swings more day-to-day, so
      // it needs a slightly wider dead zone before calling it "stable"
      // than CTL/ATL do.
      const deadZone = key === "tsb" ? 2 : 1.5;
      const direction = Math.abs(delta) < deadZone ? "stable" as const : delta > 0 ? "rising" as const : "falling" as const;
      return { direction, delta, early_mean: +earlyMean.toFixed(1), recent_mean: +recentMean.toFixed(1) };
    }
    const trajectoryStep = Math.max(1, Math.floor(loadRowsAsc.length / 10));
    // Renamed ctl/atl/tsb -> fitness/fatigue/form here at the boundary
    // going to the model. The DB columns stay ctl/atl/tsb (used all over
    // the rest of the app) — but a model handed a field literally named
    // "ctl" will parrot "CTL" straight back in its reply even when told
    // not to. Renaming the keys themselves is a much more reliable fix
    // than just instructing the model to avoid the jargon (that's also
    // done in COACH_SYSTEM_PROMPT as a second layer, but this is the one
    // that actually works).
    const trajectory = loadRowsAsc
      .filter((_: any, i: number) => i % trajectoryStep === 0)
      .map((r: any) => ({
        date: r.load_date,
        fitness: r.ctl != null ? Math.round(r.ctl) : null,
        fatigue: r.atl != null ? Math.round(r.atl) : null,
        form: r.tsb != null ? Math.round(r.tsb) : null,
      }));

    const vList = vitals.data ?? [];
    const meanSleep = vList.length ? +(vList.reduce((a, v: any) => a + (v.sleep_hours || 0), 0) / vList.length).toFixed(1) : null;
    const meanRhr = vList.length ? Math.round(vList.reduce((a, v: any) => a + (v.resting_hr || 0), 0) / vList.length) : null;

    const nextRace = upcomingRace.data as any;
    const lastRace = recentRace.data as any;
    const daysBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400_000);

    return {
      athlete: athlete.data ?? {},
      readiness: lastLoad ? { status: lastLoad.readiness_status, score: lastLoad.readiness_score, fitness: lastLoad.ctl, fatigue: lastLoad.atl, form: lastLoad.tsb } : null,
      load_trend: {
        window_days: loadRows.length,
        fitness_trend: trendFor("ctl"),
        fatigue_trend: trendFor("atl"),
        form_trend: trendFor("tsb"),
        trajectory,
      },
      load_trend_legend: "fitness_trend/fatigue_trend/form_trend compare the early portion of this window against the most recent portion — direction is 'rising'/'falling'/'stable', delta is recent_mean minus early_mean (positive = increasing). trajectory is a sparse chronological sample across the window so you can see the actual shape of the curve. Always weigh the trend direction here, not just the single current-day snapshot in `readiness` — a metric (e.g. Fatigue) can be elevated in absolute terms while still clearly falling, or low while still climbing, and that direction is usually more useful to the athlete than the isolated current value. Refer to these only as Fitness/Fatigue/Form in plain language — never by their underlying training-platform abbreviations.",
      upcoming_race: nextRace ? { date: nextRace.session_date, title: nextRace.title, days_away: daysBetween(nextRace.session_date, today) } : null,
      recent_race: lastRace ? { date: lastRace.session_date, title: lastRace.title, days_ago: daysBetween(today, lastRace.session_date) } : null,
      race_legend: "upcoming_race is the next dated race on this athlete's actual plan, or null if none is scheduled. Do not mention a race, race day, taper, peaking, or race-specific periodization anywhere in your response unless upcoming_race is non-null — if it's null, there is no race to reference, so don't invent or assume one. recent_race is the most recent completed race in the last 90 days, or null.",
      vitals_trend_14d: { sleep_h_mean: meanSleep, rhr_mean: meanRhr, sample_n: vList.length },
      physio: physio.data ?? {},
      zones: zones.data ?? {},
      athlete_dna: dna.data ?? {},
      recent_sessions_28d: sList,
      session_field_legend: "km = total session distance including warmup/cooldown. work_km = hard-effort portion only (work + strides steps), excludes warmup/recovery/cooldown. Use work_km, not km, for any question about work/quality volume. ty = day_type ('training'/'race'/'recovery'/'cross_training'/'rest') — this is the only reliable signal for whether a given past session was a race; it does not tell you about future races (see upcoming_race for that).",
      physio_field_legend: "archetype = this athlete's auto-computed performance-type label (e.g. 'Aerobic Engine, High Speed Reserve') — never a fixed identity, recalculates as new PBs are logged. aerobic_pct/anaerobic_pct = their own aerobic-vs-anaerobic development split (0-100, sums to 100). speed_reserve_bucket = Low/Moderate/High top-end speed relative to their own aerobic ability. Ground training advice in this athlete's actual archetype and speed reserve rather than generic guidance — but only frame it as race prep if upcoming_race is non-null.",
      athlete_dna_legend: "0-100 scores with Low/Developing/Good/Excellent/Elite buckets across this athlete's 5 best-supported development categories (Endurance, Speed, Aerobic Capacity, Anaerobic Capacity, Consistency) — status 'insufficient_pbs' means not enough PBs logged yet to score. Use the lowest-scoring category as the basis for 'what should this athlete work on' rather than a generic suggestion.",
      recent_insights: (insights.data ?? []).map((i: any) => ({ d: i.created_at?.slice(0, 10), feel: i.feel_score, well: i.went_well?.slice(0, 80), hard: i.was_difficult?.slice(0, 80), niggles: i.niggles?.slice(0, 80) })),
    };
  });

/** Rules-based proactive flags for the coach dashboard. */
export const findProactiveFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const today = new Date().toISOString().slice(0, 10);
    const { data: roster } = await sb.from("coach_athletes").select("athlete_id, athletes(name)").eq("coach_user_id", context.userId);
    if (!roster || roster.length === 0) return [];
    const ids = roster.map((r) => r.athlete_id);
    const since28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
    const [{ data: today_load }, { data: hist }] = await Promise.all([
      sb.from("athlete_load_daily").select("athlete_id, readiness_status, atl").in("athlete_id", ids).eq("load_date", today),
      sb.from("athlete_load_daily").select("athlete_id, atl").in("athlete_id", ids).gte("load_date", since28),
    ]);
    const histByAth = new Map<string, number[]>();
    (hist ?? []).forEach((r) => {
      const arr = histByAth.get(r.athlete_id) ?? [];
      arr.push(Number(r.atl || 0));
      histByAth.set(r.athlete_id, arr);
    });
    const flags: { athlete_id: string; name: string; reasons: string[] }[] = [];
    for (const r of roster) {
      const tl = today_load?.find((x) => x.athlete_id === r.athlete_id);
      const reasons: string[] = [];
      if (tl?.readiness_status === "red") reasons.push("Readiness RED");
      const series = histByAth.get(r.athlete_id) ?? [];
      if (series.length >= 7 && tl?.atl != null) {
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
        const sd = Math.sqrt(variance);
        if (Number(tl.atl) > mean + sd) reasons.push("ATL spiking (>+1σ)");
      }
      if (reasons.length) flags.push({ athlete_id: r.athlete_id, name: (r.athletes as any)?.name ?? "Athlete", reasons });
    }
    return flags;
  });

/** Lazy: get-or-generate weekly summary. */
export const generateWeeklySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; force?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const wk = weekStart();
    if (!data.force) {
      const { data: existing } = await sb.from("ai_weekly_summaries").select("*").eq("athlete_id", data.athleteId).eq("week_start", wk).maybeSingle();
      if (existing) return existing;
    }
    const access = await requireAi(sb, context.userId);
    const payload = await buildAthletePayload({ data: { athleteId: data.athleteId } });
    const { generateText } = await import("ai");
    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const result = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write the weekly training summary for ${(payload.athlete as any).name ?? "this athlete"}. Cover: training load trend, readiness, key sessions, fatigue or vitals concerns, and one focus area for next week. Keep it under 250 words. Data:\n${JSON.stringify(payload)}`,
    });
    const { data: row, error } = await sb.from("ai_weekly_summaries").upsert({ athlete_id: data.athleteId, week_start: wk, summary_md: result.text, generated_at: new Date().toISOString() }, { onConflict: "athlete_id,week_start" }).select().single();
    if (error) throw error;

    // Mirror into AI history. Weekly summaries are upserted by week
    // (force-regenerate replaces, doesn't pile up), so clear any existing
    // history row for this athlete+week before inserting the new one.
    const weekEnd = new Date(new Date(wk).getTime() + 6 * 86400_000).toISOString().slice(0, 10);
    await sb.from("ai_reviews" as any).delete().eq("athlete_id", data.athleteId).eq("source", "weekly_summary").eq("period_start", wk);
    await sb.from("ai_reviews" as any).insert({
      athlete_id: data.athleteId,
      coach_id: context.userId,
      source: "weekly_summary",
      review_type: null,
      title: null,
      period_start: wk,
      period_end: weekEnd,
      content_md: result.text,
    });

    return row;
  });

export const generateDailyAthleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const access = await requireAi(context.supabase, context.userId);
    const payload = await buildAthletePayload({ data: { athleteId: data.athleteId } });
    const { generateText } = await import("ai");
    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const r = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write a short (≤120 words) friendly daily reflection for the athlete based on their vitals and recent training. Focus on readiness, one positive trend, and one watch-out. Data:\n${JSON.stringify(payload)}`,
    });
    const today = new Date().toISOString().slice(0, 10);
    const { data: row, error } = await context.supabase.from("ai_athlete_notes").insert({ athlete_id: data.athleteId, note_date: today, kind: "daily", content: r.text }).select().single();
    if (error) throw error;

    // Mirror into AI history. One per athlete per day — clear any earlier
    // history row for today before inserting so re-generating doesn't
    // pile up duplicates.
    await context.supabase.from("ai_reviews" as any).delete().eq("athlete_id", data.athleteId).eq("source", "daily_note").eq("period_start", today);
    await context.supabase.from("ai_reviews" as any).insert({
      athlete_id: data.athleteId,
      coach_id: context.userId,
      source: "daily_note",
      review_type: null,
      title: null,
      period_start: today,
      period_end: today,
      content_md: r.text,
    });

    return row;
  });

export const generateSessionNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const access = await requireAi(sb, context.userId);
    const { data: sess } = await sb.from("sessions").select("athlete_id, title, intent, total_distance_m, total_time_seconds, avg_hr, rpe, completion_pct, session_date").eq("id", data.sessionId).single();
    if (!sess) throw new Error("Session not found");
    const { data: insight } = await sb.from("session_insights").select("feel_score, notes").eq("session_id", data.sessionId).maybeSingle();
    const { generateText } = await import("ai");
    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const r = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write a short (≤100 words) reflection on this completed session. Be specific. Session: ${JSON.stringify(sess)}. Athlete feel: ${JSON.stringify(insight ?? {})}.`,
    });
    const { data: row, error } = await sb.from("ai_athlete_notes").insert({ athlete_id: sess.athlete_id, note_date: sess.session_date, kind: "session", session_id: data.sessionId, content: r.text }).select().single();
    if (error) throw error;

    // Mirror into AI history. One per session — clear any earlier history
    // row for this session before inserting so re-generating doesn't pile
    // up duplicates.
    await sb.from("ai_reviews" as any).delete().eq("session_id", data.sessionId).eq("source", "session_note");
    await sb.from("ai_reviews" as any).insert({
      athlete_id: sess.athlete_id,
      coach_id: context.userId,
      source: "session_note",
      review_type: null,
      session_id: data.sessionId,
      title: sess.title ?? null,
      period_start: sess.session_date,
      period_end: sess.session_date,
      content_md: r.text,
    });

    return row;
  });

/** Continuous fatigue (drift) for continuous sessions. */
export const computeContinuousFatigue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: sess } = await sb.from("sessions").select("athlete_id, structure").eq("id", data.sessionId).single();
    if (!sess) return null;
    if (sess.structure !== "continuous") {
      await sb.from("session_fatigue").delete().eq("session_id", data.sessionId).eq("method", "continuous_drift");
      return null;
    }
    const { data: step } = await sb
      .from("steps")
      .select("id")
      .eq("session_id", data.sessionId)
      .order("step_order")
      .limit(1)
      .maybeSingle();
    if (!step?.id) return null;
    const { data: pts } = await sb.from("raw_session_points").select("elapsed_s, hr, pace_sec_per_km").eq("session_id", data.sessionId).order("elapsed_s");
    if (!pts || pts.length < 60) return null;
    const mid = pts[pts.length - 1].elapsed_s / 2;
    const first = pts.filter((p) => p.elapsed_s <= mid);
    const second = pts.filter((p) => p.elapsed_s > mid);
    const mean = (arr: any[], k: string) => {
      const xs = arr.map((a) => a[k]).filter((x) => x != null) as number[];
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const hr1 = mean(first, "hr"); const hr2 = mean(second, "hr");
    const p1 = mean(first, "pace_sec_per_km"); const p2 = mean(second, "pace_sec_per_km");
    if (hr1 == null || hr2 == null || p1 == null || p2 == null) return null;
    const hrDriftBpm = hr2 - hr1;
    const paceDriftPct = ((p2 - p1) / p1) * 100;
    // 100 = perfect (no drift). Penalize +1bpm HR drift = -1pt, +1% pace decay = -3pt.
    const score = Math.max(0, Math.min(100, Math.round(100 - hrDriftBpm - paceDriftPct * 3)));
    await sb.from("session_fatigue").delete().eq("session_id", data.sessionId).eq("method", "continuous_drift");
    const { data: row, error } = await sb.from("session_fatigue").insert({
      session_id: data.sessionId, step_id: step.id, athlete_id: sess.athlete_id, method: "continuous_drift",
      hr_drift_bpm: hrDriftBpm, pace_drift_pct: paceDriftPct, efficiency_score: score, rep_count: pts.length,
    } as any).select().maybeSingle();
    if (error) console.error(error);
    return row;
  });

/** Append assistant reply to thread (non-streaming for simplicity). */
export const coachChatSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { threadId: string; message: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const access = await requireAi(sb, context.userId);
    const { data: thread } = await sb.from("ai_chat_threads").select("*").eq("id", data.threadId).single();
    if (!thread) throw new Error("Thread not found");
    await sb.from("ai_chat_messages").insert({ thread_id: data.threadId, role: "user", content: data.message });
    const { data: history } = await sb.from("ai_chat_messages").select("role, content").eq("thread_id", data.threadId).order("created_at");
    const payload = thread.athlete_id ? await buildAthletePayload({ data: { athleteId: thread.athlete_id } }) : null;
    const { generateText } = await import("ai");
    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const sys = COACH_SYSTEM_PROMPT + (payload ? `\n\nAthlete data:\n${JSON.stringify(payload)}` : "");
    const r = await generateText({
      model: resolveChatModel(),
      system: sys,
      messages: (history ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    const { data: reply } = await sb.from("ai_chat_messages").insert({ thread_id: data.threadId, role: "assistant", content: r.text }).select().single();
    await sb.from("ai_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", data.threadId);

    // Mirror this thread into AI history (Reports -> AI Review) so coach
    // chats show up alongside generated reviews. One row per thread —
    // upserted on the thread's unique index every time a reply lands, with
    // the full transcript re-rendered each time, rather than a new history
    // row per message.
    if (thread.athlete_id) {
      const { data: fullHistory } = await sb
        .from("ai_chat_messages")
        .select("role, content, created_at")
        .eq("thread_id", data.threadId)
        .order("created_at");
      const rows = fullHistory ?? [];
      const transcriptMd = rows
        .filter((m: any) => m.role !== "system")
        .map((m: any) => `**${m.role === "user" ? "Coach" : "AI"}:** ${m.content}`)
        .join("\n\n");
      const firstDate = rows[0]?.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const lastDate = rows[rows.length - 1]?.created_at?.slice(0, 10) ?? firstDate;
      // A snippet of the first question is a far more useful history-list
      // title than a generic "Coaching chat" label would be — the athlete
      // name is already shown by the join in listAllReviewsForCoach.
      const firstUserMsg = rows.find((m: any) => m.role === "user")?.content ?? "";
      const titleSnippet = firstUserMsg.length > 80 ? `${firstUserMsg.slice(0, 79)}…` : firstUserMsg;
      await sb.from("ai_reviews" as any).upsert(
        {
          thread_id: data.threadId,
          athlete_id: thread.athlete_id,
          coach_id: context.userId,
          source: "chat",
          review_type: null,
          title: titleSnippet || null,
          period_start: firstDate,
          period_end: lastDate,
          content_md: transcriptMd,
        },
        { onConflict: "thread_id" },
      );
    }

    return reply!;
  });

export const getOrCreateAthleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: existing } = await sb.from("ai_chat_threads").select("*").eq("coach_id", context.userId).eq("athlete_id", data.athleteId).maybeSingle();
    if (existing) return existing;
    const { data: row, error } = await sb.from("ai_chat_threads").insert({ coach_id: context.userId, athlete_id: data.athleteId }).select().single();
    if (error) throw error;
    return row;
  });

/**
 * Wipes the running AI Coaching Assistant conversation for one athlete —
 * deletes the thread, which cascades to its messages (ai_chat_messages)
 * and its mirrored AI-history row (ai_reviews.thread_id) automatically via
 * their ON DELETE CASCADE foreign keys. The next message sent re-creates
 * a fresh thread through getOrCreateAthleteThread, same as a brand-new
 * conversation.
 */
export const clearAthleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_chat_threads")
      .delete()
      .eq("coach_id", context.userId)
      .eq("athlete_id", data.athleteId);
    if (error) throw error;
    return { ok: true };
  });

export const listThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { threadId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("ai_chat_messages").select("*").eq("thread_id", data.threadId).order("created_at");
    return rows ?? [];
  });

export const getLatestAthleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; kind: "daily" | "session"; sessionId?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("ai_athlete_notes").select("*").eq("athlete_id", data.athleteId).eq("kind", data.kind);
    if (data.sessionId) q = q.eq("session_id", data.sessionId);
    const { data: rows } = await q.order("created_at", { ascending: false }).limit(1);
    return rows?.[0] ?? null;
  });

// silence unused var warnings on unused helper
void pct;
