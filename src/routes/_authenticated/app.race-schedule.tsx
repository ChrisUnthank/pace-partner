import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAi } from "./ai.functions";

export type ParsedRaceScheduleEntry = {
  name: string;
  // YYYY-MM-DD, or null if genuinely undeterminable from the source text —
  // left null rather than guessed, since every extracted row goes through
  // a review-and-edit preview before anything is saved (same "never show
  // a fabricated value" principle used elsewhere in this app).
  event_date: string | null;
  location: string | null;
  race_type: "track" | "road" | "cross_country" | null;
  events_offered: string[];
};

/**
 * Turns already-extracted plain text (from a PDF/DOCX/XLSX, via
 * document-text-extract.ts, or pasted directly) into candidate race
 * schedule entries. Returns a preview array — nothing is saved here;
 * bulkCreateRaceScheduleEntries below is the actual commit step, after a
 * coach has reviewed/edited what came out of this.
 */
export const parseRaceScheduleText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await requireAi(sb, context.userId);

    const { resolveChatModel } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");

    // Generous cap — a full season fixture calendar is a few thousand
    // words at most; this just guards against an accidental huge
    // paste/document blowing the model's context budget.
    const truncated = data.text.slice(0, 60000);

    const result = await generateText({
      model: resolveChatModel(),
      system:
        "You extract structured race-calendar data from messy source documents (PDF/Word/Excel text, or pasted text) for a running club's coach. You never invent races that aren't actually in the source text — if the text has 12 real fixtures, return exactly 12, not more, not fewer. Respond with ONLY a JSON array, no markdown fences, no commentary before or after.",
      prompt: `Extract every distinct race/meet fixture from the text below into a JSON array. Each item: {"name": string, "event_date": "YYYY-MM-DD" or null if the date genuinely can't be determined, "location": string or null, "race_type": "track"|"road"|"cross_country"|null, "events_offered": string[] (event/distance labels exactly as printed, e.g. "800m", "1500m", "3000m Steeplechase" — empty array if not listed)}. If the document states a season/year once near the top and individual fixture dates omit the year, apply that year to each. Today's date is ${new Date().toISOString().slice(0, 10)} for resolving any relative references. Source text:\n\n${truncated}`,
    });

    const raw = result.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Couldn't make sense of that document — try pasting the text directly instead, or check the file isn't a scanned image (no real text layer to read).",
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Unexpected response shape from extraction — try again, or paste the text directly instead.");
    }

    return parsed.slice(0, 200).map(
      (r: any): ParsedRaceScheduleEntry => ({
        name: String(r?.name ?? "Untitled race").slice(0, 200),
        event_date: typeof r?.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.event_date) ? r.event_date : null,
        location: r?.location ? String(r.location).slice(0, 200) : null,
        race_type: r?.race_type === "track" || r?.race_type === "road" || r?.race_type === "cross_country" ? r.race_type : null,
        events_offered: Array.isArray(r?.events_offered)
          ? r.events_offered.map((e: any) => String(e).slice(0, 60)).slice(0, 40)
          : [],
      }),
    );
  });
