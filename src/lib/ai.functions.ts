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
 * Determine whether this user may invoke the AI. Coaches/managers may always
 * use the AI (paid by app via LOVABLE_API_KEY). Athletes are opt-in: they
 * must save their own Anthropic API key on their profile, and AI calls then
 * route directly through Anthropic so they pay for their own usage.
 *
 * Returns:
 *   { allowed: false } when no access.
 *   { allowed: true, role: 'coach', anthropicKey: null }
 *   { allowed: true, role: 'athlete', anthropicKey: '<key>' }
 */
async function resolveAiAccess(sb: any, userId: string) {
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
  const roleList = (roles ?? []).map((r: any) => r.role);
  const isCoach = roleList.includes("coach") || roleList.includes("manager");
  if (isCoach) return { allowed: true as const, role: "coach" as const, anthropicKey: null as string | null, limit: 20 };

  const { data: prof } = await sb.from("profiles").select("anthropic_api_key").eq("id", userId).maybeSingle();
  const key = prof?.anthropic_api_key as string | null | undefined;
  if (key && key.trim()) return { allowed: true as const, role: "athlete" as const, anthropicKey: key, limit: 10 };

  return { allowed: false as const };
}

async function consumeQuotaOrThrow(sb: any, userId: string, limit: number) {
  const { data, error } = await sb.rpc("ai_consume_quota", { _user_id: userId, _limit: limit });
  if (error) throw new Error(error.message);
  if (data === false) {
    throw new Error(`Daily AI limit reached (${limit} calls). Try again tomorrow.`);
  }
}

async function requireAi(sb: any, userId: string) {
  const access = await resolveAiAccess(sb, userId);
  if (!access.allowed) {
    throw new Error("AI is not available for your account. Athletes must add an Anthropic API key in their profile to enable AI.");
  }
  await consumeQuotaOrThrow(sb, userId, access.limit);
  return access;
}

/** Public-to-client status: { allowed, role, hasOwnKey, used, limit } */
export const getAiAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await resolveAiAccess(context.supabase, context.userId);
    if (!access.allowed) {
      return { allowed: false, role: null, hasOwnKey: false, used: 0, limit: 0 };
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
      hasOwnKey: !!access.anthropicKey,
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
    const since28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
    const since14 = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const [athlete, sessions, load, vitals, insights, physio, zones] = await Promise.all([
      sb.from("athletes").select("name, sex, primary_event, hr_max, hr_rest, training_age_years, weight, dob").eq("id", data.athleteId).maybeSingle(),
      sb.from("sessions").select("session_date, title, intent, day_type, rpe, completion_pct, total_distance_m, total_time_seconds, completed_at").eq("athlete_id", data.athleteId).gte("session_date", since28).order("session_date", { ascending: false }).limit(30),
      sb.from("athlete_load_daily").select("load_date, combined_load, ctl, atl, tsb, readiness_status, readiness_score").eq("athlete_id", data.athleteId).gte("load_date", since14).order("load_date", { ascending: false }),
      sb.from("daily_vitals").select("vitals_date, sleep_hours, resting_hr, weight_kg, hydration").eq("athlete_id", data.athleteId).gte("vitals_date", since14).order("vitals_date", { ascending: false }),
      sb.from("session_insights").select("created_at, feel_score, went_well, was_difficult, niggles").eq("athlete_id", data.athleteId).order("created_at", { ascending: false }).limit(5),
      sb.from("athlete_physio_profile").select("vo2_max, lactate_threshold_pace, fatigue_resistance_score").eq("athlete_id", data.athleteId).maybeSingle(),
      sb.from("athlete_zone_profiles").select("hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, pace_z1_max, pace_z2_max, pace_z3_max, pace_z4_max").eq("athlete_id", data.athleteId).maybeSingle(),
    ]);

    const sList = (sessions.data ?? []).map((s) => ({
      d: s.session_date, t: s.title, i: s.intent, ty: s.day_type,
      rpe: s.rpe, c: s.completion_pct, km: s.total_distance_m ? Math.round(Number(s.total_distance_m) / 100) / 10 : null,
      done: !!s.completed_at,
    }));
    const loadRows = load.data ?? [];
    const lastLoad = loadRows[0];
    const meanCtl = loadRows.length ? Math.round(loadRows.reduce((a, r) => a + Number(r.ctl || 0), 0) / loadRows.length) : null;
    const meanAtl = loadRows.length ? Math.round(loadRows.reduce((a, r) => a + Number(r.atl || 0), 0) / loadRows.length) : null;
    const vList = vitals.data ?? [];
    const meanSleep = vList.length ? +(vList.reduce((a, v: any) => a + (v.sleep_hours || 0), 0) / vList.length).toFixed(1) : null;
    const meanRhr = vList.length ? Math.round(vList.reduce((a, v: any) => a + (v.resting_hr || 0), 0) / vList.length) : null;

    return {
      athlete: athlete.data ?? {},
      readiness: lastLoad ? { status: lastLoad.readiness_status, score: lastLoad.readiness_score, ctl: lastLoad.ctl, atl: lastLoad.atl, tsb: lastLoad.tsb } : null,
      load_trend: { ctl_mean_14d: meanCtl, atl_mean_14d: meanAtl, sample_n: loadRows.length },
      vitals_trend_14d: { sleep_h_mean: meanSleep, rhr_mean: meanRhr, sample_n: vList.length },
      physio: physio.data ?? {},
      zones: zones.data ?? {},
      recent_sessions_28d: sList,
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
      model: resolveChatModel(access.anthropicKey),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write the weekly training summary for ${(payload.athlete as any).name ?? "this athlete"}. Cover: training load trend, readiness, key sessions, fatigue or vitals concerns, and one focus area for next week. Keep it under 250 words. Data:\n${JSON.stringify(payload)}`,
    });
    const { data: row, error } = await sb.from("ai_weekly_summaries").upsert({ athlete_id: data.athleteId, week_start: wk, summary_md: result.text, generated_at: new Date().toISOString() }, { onConflict: "athlete_id,week_start" }).select().single();
    if (error) throw error;
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
      model: resolveChatModel(access.anthropicKey),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write a short (≤120 words) friendly daily reflection for the athlete based on their vitals and recent training. Focus on readiness, one positive trend, and one watch-out. Data:\n${JSON.stringify(payload)}`,
    });
    const today = new Date().toISOString().slice(0, 10);
    const { data: row, error } = await context.supabase.from("ai_athlete_notes").insert({ athlete_id: data.athleteId, note_date: today, kind: "daily", content: r.text }).select().single();
    if (error) throw error;
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
      model: resolveChatModel(access.anthropicKey),
      system: COACH_SYSTEM_PROMPT,
      prompt: `Write a short (≤100 words) reflection on this completed session. Be specific. Session: ${JSON.stringify(sess)}. Athlete feel: ${JSON.stringify(insight ?? {})}.`,
    });
    const { data: row, error } = await sb.from("ai_athlete_notes").insert({ athlete_id: sess.athlete_id, note_date: sess.session_date, kind: "session", session_id: data.sessionId, content: r.text }).select().single();
    if (error) throw error;
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
      model: resolveChatModel(access.anthropicKey),
      system: sys,
      messages: (history ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    const { data: reply } = await sb.from("ai_chat_messages").insert({ thread_id: data.threadId, role: "assistant", content: r.text }).select().single();
    await sb.from("ai_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", data.threadId);
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