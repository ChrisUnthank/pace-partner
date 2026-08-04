import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAthletePayload, requireAi } from "./ai.functions";

type InsightKind = "training_load" | "zone_distribution";

// Coach-selectable angle for the insight — previously every chart insight
// was one fixed generic prompt per kind, which is how "explain the
// Fitness/Fatigue/Form chart" ended up just diffing the current CTL/ATL
// numbers instead of actually reading the trend. Letting the coach pick
// the angle (and always feeding the model real trend/trajectory data
// regardless of which angle is picked — see buildAthletePayload's
// load_trend) fixes both the narrowness and the "current value read in
// isolation" problem at once.
type InsightFocus = "trend" | "snapshot" | "risk" | "comparison";

const FOCUS_LABEL: Record<InsightFocus, string> = {
  trend: "Trend & trajectory",
  snapshot: "Current snapshot",
  risk: "Risks & watch-outs",
  comparison: "Vs this athlete's own targets",
};

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

// Focus-specific instruction layered on top of the kind's base subject —
// every combination still gets the same trend-rich payload, just asked to
// look at a different angle of it.
const FOCUS_INSTRUCTION: Record<InsightFocus, string> = {
  trend: "Focus on the trajectory over the analysis window — is it rising, falling, or stable, and for how long has that been true? Explicitly name the direction (e.g. 'Fatigue is elevated but has been falling for two weeks') rather than describing a single current value.",
  snapshot: "Focus on right now — what today's numbers mean for training in the next 24-48 hours specifically. You can mention the broader trend for context, but the point of this angle is a practical 'what do I do today' read.",
  risk: "Focus only on genuine watch-outs — things that look concerning or worth monitoring (overreaching, imbalance, a metric moving the wrong way fast). If nothing looks concerning, say so plainly rather than inventing a concern.",
  comparison: "Focus on how this compares to what this athlete's own physiological profile (archetype, aerobic/anaerobic split, speed reserve, Athlete DNA scores) suggests they should be doing, not a generic benchmark.",
};

function promptFor(kind: InsightKind, focus: InsightFocus, athleteName: string, payload: any) {
  const instruction = FOCUS_INSTRUCTION[focus];
  if (kind === "training_load") {
    return `In under 150 words, explain this athlete's Fitness, Fatigue, and Form for ${athleteName} in plain coaching language — never using training-platform abbreviations like CTL/ATL/TSB/TSS, just the plain-language terms already in the data. ${instruction} Don't just restate the numbers; interpret them. Only reference a race if payload.upcoming_race is present — otherwise talk about the training block on its own terms. Data:\n${JSON.stringify(payload)}`;
  }
  return `In under 150 words, explain what this athlete's time-in-zone distribution over the last 28 days says about their training emphasis for ${athleteName} — is it aerobic-heavy, threshold-heavy, balanced. ${instruction} Data:\n${JSON.stringify(payload)}`;
}

const KIND_LABEL: Record<InsightKind, string> = {
  training_load: "Fitness/Fatigue/Form",
  zone_distribution: "Zone distribution",
};

/**
 * "Explain this chart" insight. Now persisted into ai_reviews (source =
 * 'chart_insight') so it shows up in AI history on the Reports -> AI
 * Review page alongside everywhere else the app uses AI — previously this
 * was deliberately ephemeral and never saved anywhere. Still quick and
 * regenerable (hitting Generate again just adds a new history entry with
 * whatever angle is selected), it's just no longer invisible afterward.
 */
export const generateChartInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; kind: InsightKind; focus?: InsightFocus }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await requireAi(sb, context.userId);
    const focus: InsightFocus = data.focus ?? "trend";

    const { data: athlete } = await sb.from("athletes").select("name").eq("id", data.athleteId).maybeSingle();
    const athleteName = athlete?.name ?? "this athlete";

    let payload: any;
    if (data.kind === "training_load") {
      const full = await buildAthletePayload({ data: { athleteId: data.athleteId } });
      payload = {
        readiness: full.readiness,
        load_trend: full.load_trend,
        load_trend_legend: full.load_trend_legend,
        athlete_dna: full.athlete_dna,
        physio: full.physio,
        upcoming_race: full.upcoming_race,
        recent_race: full.recent_race,
        race_legend: full.race_legend,
      };
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
      prompt: promptFor(data.kind, focus, athleteName, payload),
    });

    const today = new Date().toISOString().slice(0, 10);
    await sb.from("ai_reviews" as any).insert({
      athlete_id: data.athleteId,
      coach_id: context.userId,
      source: "chart_insight",
      review_type: null,
      title: `${KIND_LABEL[data.kind]} (${FOCUS_LABEL[focus]})`,
      period_start: today,
      period_end: today,
      content_md: result.text,
    });

    return { content: result.text };
  });
