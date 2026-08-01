import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireAi } from "./ai.functions";

// Phase 12 — AI-Assisted Race Strategy.
//
// Reuses the app's existing AI plumbing: same auth middleware, same daily
// quota (ai_consume_quota RPC via resolveAiAccess — coaches get 20/day by
// default paid by the app, athletes get 10/day gated by
// profiles.ai_subscription_active), same resolveChatModel routing (every
// user now goes through the Lovable AI Gateway — the athlete BYO-Anthropic
// path has been removed, see CHANGELOG).
//
// Structured output (generateObject) was tried first, since a race
// strategy suggestion needs to drive real Accept actions (set the plan's
// strategy, insert real decision-point rows) and so needs reliably
// parseable fields, not prose to scrape — but that mode wasn't reliably
// supported through the Lovable AI Gateway (repeated timeouts even at a
// generous budget). This now uses generateText — the same call every
// other AI feature in this app (chat, reviews, notes) already uses
// successfully — asking explicitly for JSON, then parsing/normalizing/
// validating that text with a deliberately lenient zod schema below.
//
// resolveAiAccess/consumeQuotaOrThrow are still not exported from
// ai.functions.ts (kept internal there), but requireAi now is — imported
// above instead of duplicated, so quota/subscription logic lives in
// exactly one place across every AI feature in the app.

const STRATEGY_ENUM = ["even_pace", "negative_split", "positive_split", "fast_start", "controlled_start"] as const;
type StrategyValue = (typeof STRATEGY_ENUM)[number];

// Coerces whatever the model actually returned (which — especially via
// the Gemini/gateway path coaches use by default — can drift from an
// exact literal like "negative_split" to "Negative Split" or similar)
// into a real strategy value, falling back to even_pace rather than
// failing the whole suggestion over one field.
function coerceStrategy(v: unknown): StrategyValue {
  const norm = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (STRATEGY_ENUM as readonly string[]).includes(norm) ? (norm as StrategyValue) : "even_pace";
}

// Deliberately z.string() rather than z.enum() for the two strategy
// fields — an enum makes the ENTIRE generation fail validation if the
// model's wording is even slightly off, which is exactly the failure
// mode being fixed here. coerceStrategy() above does the real
// enforcement, after generation, where a mismatch can be corrected
// instead of aborting everything.
//
// z.coerce.number() rather than z.number() on every numeric field below —
// models frequently return numbers as quoted strings ("300" instead of
// 300) in JSON output, which z.number() rejects outright and z.coerce
// silently fixes. Every field except primaryStrategyLabel/reasoning is
// optional with a default, since those two are the only ones actually
// essential to showing a suggestion at all — a missing "risks" or empty
// decision-points array shouldn't fail the whole thing.
const SuggestionSchema = z.object({
  primaryStrategy: z.string().default("even_pace").describe("Exactly one of: even_pace, negative_split, positive_split, fast_start, controlled_start"),
  primaryStrategyLabel: z.string().min(1).describe("Short human-readable name, e.g. 'Controlled Opening'"),
  reasoning: z.string().min(1).describe("Why this strategy fits this specific athlete and race, referencing the actual data given"),
  risks: z.string().default("").describe("Concrete risks of this strategy for this athlete"),
  alternativeStrategy: z.string().default("even_pace").describe("Exactly one of: even_pace, negative_split, positive_split, fast_start, controlled_start"),
  alternativeStrategyLabel: z.string().default(""),
  alternativeReasoning: z.string().default(""),
  suggestedSplits: z
    .array(z.object({ cumulativeDistanceM: z.coerce.number(), segmentTimeSeconds: z.coerce.number() }))
    .default([])
    .describe("A rough split shape illustrating the strategy — for illustration, not necessarily matching the plan's own split increment"),
  tacticalDecisionPoints: z
    .array(z.object({ distanceM: z.coerce.number(), trigger: z.string().default(""), action: z.string().default("") }))
    .max(6)
    .default([])
    .describe("2-6 concrete if/then tactical triggers appropriate to this exact race distance and athlete"),
});
type Suggestion = z.infer<typeof SuggestionSchema>;

// Some models nest the payload (e.g. {"suggestion": {...}}) or use
// snake_case despite instructions. Unwraps a single nesting level and
// remaps common snake_case variants to the camelCase keys the schema
// expects, before validation — cheap to try, and turns an otherwise
// total failure into a working suggestion.
function normalizeForSchema(input: unknown): unknown {
  if (input == null || typeof input !== "object") return input;
  let obj = input as Record<string, unknown>;
  const wrapperKeys = ["suggestion", "result", "data", "output"];
  for (const k of wrapperKeys) {
    if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
      obj = obj[k] as Record<string, unknown>;
      break;
    }
  }
  const keyMap: Record<string, string> = {
    primary_strategy: "primaryStrategy",
    primary_strategy_label: "primaryStrategyLabel",
    alternative_strategy: "alternativeStrategy",
    alternative_strategy_label: "alternativeStrategyLabel",
    alternative_reasoning: "alternativeReasoning",
    suggested_splits: "suggestedSplits",
    tactical_decision_points: "tacticalDecisionPoints",
  };
  const remapped: Record<string, unknown> = { ...obj };
  for (const [snake, camel] of Object.entries(keyMap)) {
    if (remapped[snake] !== undefined && remapped[camel] === undefined) {
      remapped[camel] = remapped[snake];
    }
  }
  return remapped;
}

const RACE_STRATEGY_SYSTEM_PROMPT = `You are an experienced middle-distance and distance running coach, specializing in race tactics and pacing strategy. You are given a specific race a coach is planning for one of their athletes, along with that athlete's performance history, strengths, physiological profile, Athlete DNA ratings (athleteDna/athleteDnaLegend), and race-tactical tendencies. Recommend one primary pacing strategy and one alternative, each with reasoning tied specifically to the data given — never generic advice that could apply to any athlete. Ground your reasoning in the athlete's actual DNA ratings where they're available (e.g. a low Speed score relative to Endurance supports a more controlled opening; a low Endurance score supports flagging late-race fade risk) rather than defaulting to physiologicalProfile alone. Flag concrete risks of the primary strategy. Suggest 2-6 tactical decision points (distance, trigger, action) appropriate to this exact race distance and this athlete's known tendencies. If the data given is sparse for a signal, say so plainly in your reasoning rather than inventing a pattern that isn't there.

For primaryStrategy and alternativeStrategy, output EXACTLY one of these five literal lowercase strings, with underscores, nothing else: even_pace, negative_split, positive_split, fast_start, controlled_start. Put the friendly name (e.g. "Controlled Opening") only in primaryStrategyLabel/alternativeStrategyLabel, never in the strategy fields themselves.`;

export const generateRaceStrategySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const access = await requireAi(sb, context.userId);

    const { data: plan, error: planError } = await sb
      .from("race_tactics_plans")
      .select("*, athletes(id, name)")
      .eq("id", data.planId)
      .single();
    if (planError || !plan) throw new Error("Race plan not found");

    const athleteId = plan.athlete_id;

    const [physioRes, strengthsRes, raceObsRes, zoneRes, perfRes, decisionRes, dnaRes] = await Promise.all([
      sb.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle(),
      sb.from("athlete_strengths_ratings").select("category, rating, note").eq("athlete_id", athleteId),
      sb
        .from("athlete_race_observations")
        .select("observation, source_type")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(6),
      sb.from("athlete_zone_profiles").select("pace_threshold_sec_per_km, hr_threshold, vdot").eq("athlete_id", athleteId).maybeSingle(),
      sb
        .from("performances")
        .select("distance_m, time_seconds, performance_date, event_name")
        .eq("athlete_id", athleteId)
        .order("time_seconds", { ascending: true })
        .limit(8),
      sb.from("race_tactics_decision_points").select("distance_m, trigger_text, action_text").eq("plan_id", data.planId),
      // Athlete DNA ratings (Update 23) — the same 5 data-backed 0-100
      // scores/buckets already fed to the AI Coach's other features
      // (`ai.functions.ts`). Race Tactics previously only read the older
      // `athlete_physio_profile` archetype/aerobic-split fields; this adds
      // the newer, more specific ratings alongside them rather than
      // replacing anything.
      sb
        .from("athlete_dna_ratings" as any)
        .select(
          "endurance_score, endurance_bucket, speed_score, speed_bucket, aerobic_capacity_score, aerobic_capacity_bucket, anaerobic_capacity_score, anaerobic_capacity_bucket, consistency_score, consistency_bucket, status",
        )
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);

    const physio = physioRes.data as any;
    const contextPayload = {
      race: {
        eventName: plan.event_name,
        raceType: plan.race_type,
        raceDistanceM: plan.race_distance_m,
        raceDate: plan.race_date,
        goalTimeSeconds: plan.goal_time_seconds,
        currentPbSeconds: plan.current_pb_seconds,
        targetPbSeconds: plan.target_pb_seconds,
        currentStrategy: plan.strategy,
        conditions: plan.conditions,
        eventTactics: plan.event_tactics,
      },
      athleteName: plan.athletes?.name,
      physiologicalProfile:
        physio && physio.status === "ok"
          ? {
              performanceType: physio.archetype_override ?? physio.archetype,
              aerobicPct: physio.aerobic_pct,
              anaerobicPct: physio.anaerobic_pct,
              speedReserveBucket: physio.speed_reserve_bucket,
            }
          : null,
      athleteDna: dnaRes.data ?? null,
      athleteDnaLegend:
        "0-100 scores with Low/Developing/Good/Excellent/Elite buckets across this athlete's 5 best-supported development categories (Endurance, Speed, Aerobic Capacity, Anaerobic Capacity, Consistency) — status 'insufficient_pbs' means not enough PBs logged yet to score, treat as no signal rather than a weakness. A low Speed score relative to Endurance supports a more conservative/controlled opening; a low Endurance score relative to Speed supports flagging late-race fade risk regardless of chosen strategy.",
      thresholds: zoneRes.data ?? null,
      strengths: (strengthsRes.data ?? []).filter((s: any) => s.rating !== "not_assessed"),
      raceProfileObservations: raceObsRes.data ?? [],
      recentPerformances: perfRes.data ?? [],
      existingDecisionPointsOnThisPlan: decisionRes.data ?? [],
    };

    const { generateText } = await import("ai");
    const { resolveChatModel } = await import("./ai-gateway.server");
    const model = resolveChatModel();
    const prompt = `Suggest a race strategy for this athlete. Data:\n${JSON.stringify(contextPayload)}`;

    const s = await generateSuggestion({ generateText, model, prompt });

    const { data: row, error } = await sb
      .from("race_tactics_ai_suggestions")
      .insert({
        plan_id: data.planId,
        primary_strategy: coerceStrategy(s.primaryStrategy),
        primary_strategy_label: s.primaryStrategyLabel,
        reasoning: s.reasoning,
        risks: s.risks,
        alternative_strategy: coerceStrategy(s.alternativeStrategy),
        alternative_strategy_label: s.alternativeStrategyLabel,
        alternative_reasoning: s.alternativeReasoning,
        suggested_splits: s.suggestedSplits,
        tactical_decision_points: s.tacticalDecisionPoints,
        status: "pending",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

// Always uses generateText, never generateObject — structured/tool-calling
// mode wasn't reliably supported through the Lovable AI Gateway (repeated
// timeouts even at generous budgets). This asks explicitly for JSON, then
// parses/normalizes/validates that text with the deliberately lenient
// schema above.
//
// The AI SDK retries a slow/failed call automatically by default (2 extra
// attempts on top of the first). If a single attempt is already
// borderline slow, 2-3 stacked attempts easily exceed any timeout — and
// worse, the Promise.race-based timeout this function used before never
// actually cancelled anything; it just gave up *waiting*, while the real
// request (and its retries) kept running in the background regardless of
// what ceiling was set. Two fixes here: maxRetries: 0 on the call itself,
// and a genuine AbortController tied to the timeout so a timed-out
// request is actually stopped, not just ignored.
async function generateSuggestion({
  generateText,
  model,
  prompt,
}: {
  generateText: typeof import("ai").generateText;
  model: any;
  prompt: string;
}): Promise<Suggestion> {
  const TIMEOUT_MS = 75_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let textResult;
  try {
    textResult = await generateText({
      model,
      system:
        RACE_STRATEGY_SYSTEM_PROMPT +
        `\n\nRespond with ONLY a single JSON object (no markdown code fences, no commentary before or after) with exactly these keys: primaryStrategy, primaryStrategyLabel, reasoning, risks, alternativeStrategy, alternativeStrategyLabel, alternativeReasoning, suggestedSplits (array of {cumulativeDistanceM, segmentTimeSeconds}), tacticalDecisionPoints (array of {distanceM, trigger, action}).`,
      prompt,
      maxRetries: 0,
      abortSignal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Generating the suggestion took too long (over ${Math.round(TIMEOUT_MS / 1000)}s) — the AI provider may be slow right now. Try again in a moment.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const cleaned = textResult.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`The AI's response wasn't valid JSON. Raw response (truncated): ${cleaned.slice(0, 300)}`);
  }

  const validated = SuggestionSchema.safeParse(normalizeForSchema(parsed));
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`The AI's response was missing required fields (${issues}). Raw response (truncated): ${cleaned.slice(0, 300)}`);
  }
  return validated.data;
}

export const listRaceStrategySuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("race_tactics_ai_suggestions")
      .select("*")
      .eq("plan_id", data.planId)
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

export const updateSuggestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { suggestionId: string; status: "accepted" | "rejected" }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("race_tactics_ai_suggestions")
      .update({ status: data.status })
      .eq("id", data.suggestionId);
    if (error) throw error;
    return { ok: true };
  });
