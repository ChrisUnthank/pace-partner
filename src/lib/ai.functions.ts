import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

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
- Markdown: short paragraphs, bullets for lists, **bold** for key recommendations.
- Never recommend medical action; flag concerning patterns and suggest the athlete consult a clinician.`;

/**
 * Resolve a chat model. If the user has supplied their own Anthropic API key
 * (athlete BYO key), route directly through Anthropic so usage is billed to
 * them. Otherwise fall back to the Lovable AI Gateway (coach default).
 */
export function resolveChatModel(userAnthropicKey: string | null | undefined) {
  if (userAnthropicKey && userAnthropicKey.trim()) {
    const anthropic = createAnthropic({ apiKey: userAnthropicKey.trim() });
    return anthropic("claude-3-5-sonnet-latest");
  }
  const gateway = createLovableAiGatewayProvider(process.env.LOVABLE_API_KEY!);
  return gateway("google/gemini-2.5-pro");
}
