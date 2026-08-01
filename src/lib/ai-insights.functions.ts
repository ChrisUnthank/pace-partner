import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAthletePayload, requireAi } from "./ai.functions";

type InsightKind = "training_load" | "zone_distribution";

async function buildZoneDistribution(sb: any, athleteId: string) {
  const since = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
  const { data: sessions } = await sb.from("sessions").select("id").eq("athlete_id", athleteId).gte("session_date", since);
  const ids = (sessions ?? []).map((s: any) => s.id);
  if (ids.length === 0) return { window_days: 28, total_seconds: 0, by_zone: {} };

  const { data: rows } = await sb.from("session_zone_time").select("zone, seconds").in("session_id", ids);
  const byZone: Record<string, number> = {};
  let total = 0;
  for (const r of rows ?? []) {
    const z = r.zone ?? "unknown";
    byZone[z] = (byZone[z] ?? 0) + Number(r.seconds ?? 0);
    total += Number(r.seconds ?? 0);
  }
  const pctByZone: Record<string, number> = {};
  for (const [z, secs] of Object.entries(byZone)) {
    pctByZone[z] = total > 0 ? Math.round((secs / total) * 100) : 0;
  }
  return { window_days: 28, total_seconds: total, pct_by_zone: pctByZone };
}

function promptFor(kind: InsightKind, athleteName: string, payload: any) {
  if (kind === "training_load") {
    return `In under 150 words, explain this athlete's current Fitness (CTL), Fatigue (ATL), and Form (TSB) trend for ${athleteName} in plain coaching language — what it means right now and one concrete thing to watch or adjust. Don't just restate the numbers; interpret them. Data:\n${JSON.stringify(payload)}`;
  }
  return `In under 150 words, explain what this athlete's time-in-zone distribution over the last 28 days says about their training emphasis for ${athleteName} — is it aerobic-heavy, threshold-heavy, balanced — and whether that matches what their own physiological archetype/speed reserve would suggest they should be doing. Data:\n${JSON.stringify(payload)}`;
}

/**
 * Ephemeral "explain this chart" insight — deliberately not persisted like
 * ai_reviews/ai_athlete_notes. This is meant to be quick and regenerable,
 * closer to a single chat turn than an archived report; the person can
 * always hit Generate again if the underlying data has moved on.
 */
export const generateChartInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; kind: InsightKind }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await requireAi(sb, context.userId);

    const { data: athlete } = await sb.from("athletes").select("name").eq("id", data.athleteId).maybeSingle();
    const athleteName = athlete?.name ?? "this athlete";

    let payload: any;
    if (data.kind === "training_load") {
      const full = await buildAthletePayload({ data: { athleteId: data.athleteId } });
      payload = { readiness: full.readiness, load_trend: full.load_trend, athlete_dna: full.athlete_dna, physio: full.physio };
    } else {
      const [zoneDist, full] = await Promise.all([
        buildZoneDistribution(sb, data.athleteId),
        buildAthletePayload({ data: { athleteId: data.athleteId } }),
      ]);
      payload = { zone_time_28d: zoneDist, zones: full.zones, physio: full.physio };
    }

    const { resolveChatModel, COACH_SYSTEM_PROMPT } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const result = await generateText({
      model: resolveChatModel(),
      system: COACH_SYSTEM_PROMPT,
      prompt: promptFor(data.kind, athleteName, payload),
    });

    return { content: result.text };
  });
