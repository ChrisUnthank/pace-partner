import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function createLovableAiGatewayProvider(lovableApiKey: string, initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let runIdResolved = false;
  const runIdReady = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });

  const publishRunId = (value?: string) => {
    const nextRunId = value?.trim() || undefined;
    if (!runId && nextRunId) runId = nextRunId;
    if (!runIdResolved) {
      runIdResolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publishRunId(runId);

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) {
        headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      }
      try {
        const response = await fetch(input, { ...init, headers });
        publishRunId(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publishRunId(undefined);
        throw error;
      }
    },
  });

  return Object.assign(provider, {
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : runIdReady),
  });
}

export const COACH_SYSTEM_PROMPT = `You are an experienced middle-distance running coach with deep expertise in physiology, periodization, and training-load management. You analyze an athlete's recent training data and reply with concise, specific, actionable guidance.

Style rules:
- Be direct and practical. No fluff, no caveats unless they matter.
- Reference specific numbers from the payload (CTL/ATL/TSB, readiness, RPE, vitals trends).
- Ground recommendations in this athlete's own physiological archetype, aerobic/anaerobic split, speed reserve, and Athlete DNA scores (payload.physio / payload.athlete_dna) rather than generic advice — e.g. "because your speed reserve is Low..." not "consider adding speed work."
- Suggest concrete adjustments (drop a session, swap intensity, push recovery, target a zone).
- When the data includes trend fields (e.g. payload.load_trend's ctl_trend/atl_trend/tsb_trend, or any *_trend / trajectory field), always read the trend direction over the window rather than judging a metric from its current-day value in isolation — a metric can be elevated in absolute terms while still clearly falling (or low while still climbing), and the direction usually matters more to the athlete than the isolated snapshot. Say which one you're using explicitly (e.g. "Fatigue is elevated but has been falling over the last two weeks").
- Markdown: short paragraphs, bullets for lists, **bold** for key recommendations.
- Never recommend medical action; flag concerning patterns and suggest the athlete consult a clinician.`;

/**
 * Resolve the chat model. Every AI call in the app — coach or athlete —
 * now routes through the Lovable AI Gateway (paid by the app, gated by
 * daily quota + the athlete subscription flag upstream in ai.functions.ts).
 *
 * Previously this branched to a direct Anthropic call when an athlete
 * had supplied their own API key (BYO key). That path has been removed:
 * athletes get the same gateway access as coaches now, subject to
 * ai_subscription_active on their profile. See CHANGELOG for the
 * BYO-key removal.
 */
export function resolveChatModel() {
  const gateway = createLovableAiGatewayProvider(process.env.LOVABLE_API_KEY!);
  return gateway("google/gemini-2.5-pro");
}
