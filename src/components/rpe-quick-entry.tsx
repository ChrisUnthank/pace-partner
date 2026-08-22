import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FeelFaces } from "@/components/feel-faces";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/**
 * RPE, entered where the session already is.
 *
 * The session detail page has had an RPE control all along — a slider, feel
 * faces and a note. It is not the control that was the problem, it is the
 * journey: recording RPE meant opening each session individually, so across
 * this squad 412 completed sessions carry 12 logged RPEs. Everything built on
 * subjective input — readiness, training load, the AI context, the Training
 * Response card — has been running on a fallback derived from session labels
 * ever since.
 *
 * Buttons rather than a slider, deliberately. A slider needs press, drag,
 * judge, release; a row of numbers is one tap, and one tap is the difference
 * between a habit and a chore. The slider stays on the detail page where
 * there is room and the athlete is already looking closely.
 *
 * Saves immediately on tap. No save button, because a save button on a
 * ten-item list is ten more taps and one more thing to forget.
 */
export function RpeQuickEntry({
  sessionId,
  athleteId,
  rpe,
  feel,
  compact = false,
  onSaved,
}: {
  sessionId: string;
  /** Required by session_insights, which is keyed on both. */
  athleteId: string;
  rpe?: number | null;
  feel?: number | null;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [localRpe, setLocalRpe] = useState<number | null>(rpe ?? null);
  const [localFeel, setLocalFeel] = useState<number | null>(feel ?? null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  /**
   * RPE and feel live in different tables.
   *
   * sessions.rpe, but feel is session_insights.feel_score, upserted on
   * session_id — the same split the detail page's complete() already writes
   * to. Matched rather than reinvented: a second convention for where feel
   * lives would mean the two pages disagreed about a value the athlete
   * entered once.
   */
  async function save(fields: { rpe?: number; feel_score?: number }) {
    setSaving(true);

    const error =
      fields.rpe != null
        ? (await supabase.from("sessions").update({ rpe: fields.rpe }).eq("id", sessionId)).error
        : (
            await supabase.from("session_insights").upsert(
              { session_id: sessionId, athlete_id: athleteId, feel_score: fields.feel_score } as any,
              { onConflict: "session_id" },
            )
          ).error;

    setSaving(false);

    if (error) {
      toast.error(error.message);
      // Rolled back so the buttons do not show a value the database rejected.
      setLocalRpe(rpe ?? null);
      setLocalFeel(feel ?? null);
      return;
    }

    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);

    // Session training load is RPE x duration, so a new RPE changes the load
    // for that day and every readiness figure computed from it. Invalidated
    // rather than left for the next reload, or the list would show an RPE
    // beside a load that predates it.
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["session", sessionId] });
    qc.invalidateQueries({ queryKey: ["sessions-week-summary"] });
    qc.invalidateQueries({ queryKey: ["session-feel", sessionId] });
    onSaved?.();
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", compact ? "text-xs" : "text-sm")}>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs shrink-0">RPE</span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              disabled={saving}
              onClick={() => {
                setLocalRpe(n);
                save({ rpe: n });
              }}
              className={cn(
                "h-6 w-6 rounded text-[11px] tabular-nums transition-colors",
                localRpe === n
                  ? "bg-foreground text-background font-medium"
                  : "border hover:bg-accent text-muted-foreground",
              )}
              aria-label={`RPE ${n}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs shrink-0">Feel</span>
        <FeelFaces
          value={localFeel}
          size="sm"
          onChange={(v) => {
            setLocalFeel(v);
            save({ feel_score: v });
          }}
        />
      </div>

      {justSaved && (
        <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-500">
          <Check className="h-3 w-3" /> Saved
        </span>
      )}
    </div>
  );
}
