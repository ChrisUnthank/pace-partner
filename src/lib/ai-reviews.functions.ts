import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAthletePayload, resolveAiAccess } from "./ai.functions";

type ReviewType = "weekly" | "monthly" | "phase" | "yearly" | "custom";

function isoOffset(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function periodFor(type: ReviewType, customStart?: string, customEnd?: string) {
  const end = today();
  switch (type) {
    case "weekly":  return { start: isoOffset(7),   end, label: "the past 7 days" };
    case "monthly": return { start: isoOffset(30),  end, label: "the past 30 days" };
    case "yearly":  return { start: isoOffset(365), end, label: "the past 12 months" };
    case "phase":   return { start: isoOffset(60),  end, label: "the most recent training phase" };
    case "custom":  return { start: customStart || isoOffset(30), end: customEnd || end, label: `the period ${customStart} to ${customEnd}` };
  }
}

function promptFor(type: ReviewType, name: string, label: string, payload: any) {
  const focus: Record<ReviewType, string> = {
    weekly:  "Cover load and volume summary, dominant training intent, session quality (feel scores, rep performance), vitals trends, fatigue pattern, notable moments, and recommendations for the coming week.",
    monthly: "Cover load progression, fitness trend (CTL trajectory), training intent breakdown, zone time distribution, any PBs or notable performances, injury flags, and recommendations for the coming month.",
    phase:   "Assess whether load and intent matched the phase goal (e.g. base = volume, build = threshold), key performances during the phase, fatigue management, and what to adjust in the next phase.",
    yearly:  "Cover season arc (load build and taper), race results vs goals, fitness peak timing, injury history, training intent trends, and recommendations for the coming season.",
    custom:  "Cover load and intent for this window, session quality, vitals trends, notable moments, and recommendations going forward.",
  };
  return `Write a structured coaching review for ${name} covering ${label}. ${focus[type]} Use clear markdown headings. Keep under 350 words. Data:\n${JSON.stringify(payload)}`;
}

// Shared by the single-athlete path and the bulk (multi-athlete) path so
// there's exactly one place that builds the payload, calls the model, and
// writes the row — bulk generation used to mean either duplicating this or
// having one endpoint awkwardly call another createServerFn in a loop.
async function runIndividualReview(
  sb: any,
  requesterId: string,
  athleteId: string,
  reviewType: ReviewType,
  customStart: string | undefined,
  customEnd: string | undefined,
) {
  const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");

  const period = periodFor(reviewType, customStart, customEnd);
  const { data: athlete } = await sb.from("athletes").select("name").eq("id", athleteId).maybeSingle();
  const payload = await buildAthletePayload({ data: { athleteId } });

  const result = await generateText({
    model: resolveChatModel(),
    system: COACH_SYSTEM_PROMPT,
    prompt: promptFor(reviewType, athlete?.name ?? "this athlete", period.label, payload),
  });

  const { data: row, error } = await sb.from("ai_reviews").insert({
    athlete_id: athleteId,
    coach_id: requesterId,
    review_type: reviewType,
    period_start: period.start,
    period_end: period.end,
    content_md: result.text,
  }).select().single();
  if (error) throw error;
  return row;
}

async function consumeReviewQuotaOrThrow(sb: any, userId: string, limit: number) {
  const { data: quotaOk, error } = await sb.rpc("ai_consume_quota", { _user_id: userId, _limit: limit });
  if (error) throw new Error(error.message);
  if (quotaOk === false) throw new Error(`Daily AI limit reached (${limit} calls). Try again tomorrow.`);
}

// Lightweight per-athlete snapshot for the squad-wide narrative — deliberately
// NOT the full buildAthletePayload (that's sized for one athlete's deep-dive
// chat/review; pulling it per-athlete for a whole roster would be both slow
// and token-heavy). Just enough for the model to spot squad-wide patterns
// and flag standouts.
async function buildSquadSnapshot(sb: any, athleteId: string, since: string, until: string) {
  const [{ data: athlete }, { data: loadRows }, { data: sessions }] = await Promise.all([
    sb.from("athletes").select("name").eq("id", athleteId).maybeSingle(),
    sb.from("athlete_load_daily").select("readiness_status, ctl, atl, tsb").eq("athlete_id", athleteId).order("load_date", { ascending: false }).limit(1),
    sb.from("sessions").select("completion_pct, rpe, completed_at").eq("athlete_id", athleteId).gte("session_date", since).lte("session_date", until),
  ]);
  const rows = sessions ?? [];
  const completed = rows.filter((s: any) => s.completed_at);
  const withRpe = completed.filter((s: any) => s.rpe != null);
  const avgCompletion = completed.length ? Math.round(completed.reduce((a: number, s: any) => a + (s.completion_pct || 0), 0) / completed.length) : null;
  const avgRpe = withRpe.length ? +(withRpe.reduce((a: number, s: any) => a + s.rpe, 0) / withRpe.length).toFixed(1) : null;
  const latest = loadRows?.[0];
  return {
    name: athlete?.name ?? "Athlete",
    readiness: latest?.readiness_status ?? null,
    ctl: latest?.ctl != null ? Math.round(latest.ctl) : null,
    atl: latest?.atl != null ? Math.round(latest.atl) : null,
    tsb: latest?.tsb != null ? Math.round(latest.tsb) : null,
    sessions_planned: rows.length,
    sessions_completed: completed.length,
    avg_completion_pct: avgCompletion,
    avg_rpe: avgRpe,
  };
}

function squadPromptFor(type: ReviewType, label: string, snapshots: any[]) {
  return `Write a squad-wide coaching review covering ${label} for this group of athletes. Identify standout performances (positive and concerning), squad-wide load/readiness patterns, athletes who may need attention, and 2-3 recommendations for the group as a whole. Only call out an individual athlete by name where it's actually notable — otherwise speak to the group. Use clear markdown headings. Keep under 500 words. Athlete snapshots:\n${JSON.stringify(snapshots)}`;
}

/** Single-athlete review — a coach generating for any athlete they coach, or an athlete generating for themselves. */
export const generateAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; reviewType: ReviewType; customStart?: string; customEnd?: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const access = await resolveAiAccess(sb, context.userId);
    if (!access.allowed) {
      throw new Error(
        access.reason === "subscription_required"
          ? "AI requires an active subscription on your account."
          : "AI is not available for your account.",
      );
    }
    if (access.role === "athlete") {
      const { data: athleteRow } = await sb.from("athletes").select("user_id").eq("id", data.athleteId).maybeSingle();
      if (!athleteRow || athleteRow.user_id !== context.userId) {
        throw new Error("Athletes can only generate reviews for themselves.");
      }
    }

    await consumeReviewQuotaOrThrow(sb, context.userId, access.limit);
    return runIndividualReview(sb, context.userId, data.athleteId, data.reviewType, data.customStart, data.customEnd);
  });

/** Bulk individual reviews — coach picks any number of athletes from their roster, one review each. */
export const generateBulkAiReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteIds: string[]; reviewType: ReviewType; customStart?: string; customEnd?: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const access = await resolveAiAccess(sb, context.userId);
    if (!access.allowed) {
      throw new Error(
        access.reason === "subscription_required"
          ? "AI requires an active subscription on your account."
          : "AI is not available for your account.",
      );
    }
    if (access.role !== "coach") throw new Error("Only coaches can generate reviews for multiple athletes at once.");

    const { data: roster } = await sb.from("coach_athletes").select("athlete_id").eq("coach_user_id", context.userId);
    const rosterIds = new Set((roster ?? []).map((r: any) => r.athlete_id));
    const targetIds = data.athleteIds.filter((id) => rosterIds.has(id));
    if (targetIds.length === 0) throw new Error("No valid athletes selected.");

    const generated: any[] = [];
    const errors: { athleteId: string; message: string }[] = [];
    for (const athleteId of targetIds) {
      try {
        await consumeReviewQuotaOrThrow(sb, context.userId, access.limit);
        const row = await runIndividualReview(sb, context.userId, athleteId, data.reviewType, data.customStart, data.customEnd);
        generated.push(row);
      } catch (err: any) {
        const message: string = err?.message ?? "Failed";
        errors.push({ athleteId, message });
        // A "Daily AI limit reached" error means every subsequent athlete
        // will fail the same way — stop the loop instead of burning
        // through the rest with the same failure.
        if (message.startsWith("Daily AI limit reached")) break;
      }
    }
    return { generated, errors };
  });

/** Squad-wide narrative — one combined review across a coach-selected group (or the whole roster). */
export const generateSquadAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteIds: string[]; reviewType: ReviewType; customStart?: string; customEnd?: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const access = await resolveAiAccess(sb, context.userId);
    if (!access.allowed) {
      throw new Error(
        access.reason === "subscription_required"
          ? "AI requires an active subscription on your account."
          : "AI is not available for your account.",
      );
    }
    if (access.role !== "coach") throw new Error("Only coaches can generate a squad review.");

    const { data: roster } = await sb.from("coach_athletes").select("athlete_id").eq("coach_user_id", context.userId);
    const rosterIds = (roster ?? []).map((r: any) => r.athlete_id);
    // Empty athleteIds means "whole squad" — the UI's quick-select for that
    // just sends every roster id explicitly, but this also covers it if not.
    const targetIds = data.athleteIds.length > 0 ? data.athleteIds.filter((id) => rosterIds.includes(id)) : rosterIds;
    if (targetIds.length === 0) throw new Error("No athletes to include — add athletes to your roster first.");

    await consumeReviewQuotaOrThrow(sb, context.userId, access.limit);

    const period = periodFor(data.reviewType, data.customStart, data.customEnd);
    const snapshots = await Promise.all(targetIds.map((id: string) => buildSquadSnapshot(sb, id, period.start, period.end)));

    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const result = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: squadPromptFor(data.reviewType, period.label, snapshots),
    });

    const { data: row, error } = await sb.from("ai_squad_reviews" as any).insert({
      coach_id: context.userId,
      review_type: data.reviewType,
      period_start: period.start,
      period_end: period.end,
      athlete_ids: targetIds,
      content_md: result.text,
    }).select().single();
    if (error) throw error;
    return row;
  });

export const listSquadReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows } = await context.supabase
      .from("ai_squad_reviews" as any)
      .select("*")
      .eq("coach_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return rows ?? [];
  });

export const deleteSquadReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_squad_reviews" as any).delete().eq("id", data.reviewId);
    if (error) throw error;
    return { ok: true };
  });

export const listAthleteReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("ai_reviews")
      .select("*")
      .eq("athlete_id", data.athleteId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

export const listRecentReviewsForCoach = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: roster } = await sb.from("coach_athletes").select("athlete_id").eq("coach_user_id", context.userId);
    const ids = (roster ?? []).map((r: any) => r.athlete_id);
    if (ids.length === 0) return [];
    const { data: rows } = await sb.from("ai_reviews")
      .select("id, athlete_id, review_type, period_start, period_end, created_at, athletes(name, profile_image_url)")
      .in("athlete_id", ids)
      .order("created_at", { ascending: false })
      .limit(3);
    return rows ?? [];
  });

/** Fuller history for the Reports → AI Review page — every individual review across the coach's roster, not just the dashboard widget's latest 3. */
export const listAllReviewsForCoach = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: roster } = await sb.from("coach_athletes").select("athlete_id").eq("coach_user_id", context.userId);
    const ids = (roster ?? []).map((r: any) => r.athlete_id);
    if (ids.length === 0) return [];
    const { data: rows } = await sb.from("ai_reviews")
      .select("id, athlete_id, review_type, period_start, period_end, created_at, content_md, athletes(name, profile_image_url)")
      .in("athlete_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

export const deleteAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_reviews").delete().eq("id", data.reviewId);
    if (error) throw error;
    return { ok: true };
  });
