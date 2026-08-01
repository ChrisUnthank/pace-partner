import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAthletePayload } from "./ai.functions";

// resolveAiAccess isn't exported from ai.functions.ts, so it's duplicated
// here — same pattern already used in race-tactics-ai.functions.ts. Keeps
// this file's quota/limit in step with every other AI feature rather than
// the hardcoded limit=20 this file used to apply regardless of caller.
async function resolveAiAccess(sb: any, userId: string) {
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

export const generateAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; reviewType: ReviewType; customStart?: string; customEnd?: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");

    // Gate: coaches can generate a review for any athlete they coach
    // (RLS enforces this on the insert below via coach_athletes). An
    // athlete may also generate a review about themselves — same AI
    // access rules as everywhere else (subscription flag + daily quota).
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

    const period = periodFor(data.reviewType, data.customStart, data.customEnd);
    const { data: athlete } = await sb.from("athletes").select("name").eq("id", data.athleteId).maybeSingle();
    const payload = await buildAthletePayload({ data: { athleteId: data.athleteId } });
    // quota
    const { data: quotaOk, error: qErr } = await sb.rpc("ai_consume_quota", { _user_id: context.userId, _limit: access.limit });
    if (qErr) throw new Error(qErr.message);
    if (quotaOk === false) throw new Error(`Daily AI limit reached (${access.limit} calls). Try again tomorrow.`);

    const result = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: promptFor(data.reviewType, athlete?.name ?? "this athlete", period.label, payload),
    });

    const { data: row, error } = await sb.from("ai_reviews").insert({
      athlete_id: data.athleteId,
      coach_id: context.userId,
      review_type: data.reviewType,
      period_start: period.start,
      period_end: period.end,
      content_md: result.text,
    }).select().single();
    if (error) throw error;
    return row;
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

export const deleteAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_reviews").delete().eq("id", data.reviewId);
    if (error) throw error;
    return { ok: true };
  });
