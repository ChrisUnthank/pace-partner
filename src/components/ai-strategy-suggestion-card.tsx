import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Check, X } from "lucide-react";
import { secToClock } from "@/lib/format";
import { STRATEGY_OPTIONS, type Strategy } from "@/lib/race-tactics-calc";
import { getAiAccessStatus } from "@/lib/ai.functions";
import { generateRaceStrategySuggestion, listRaceStrategySuggestions, updateSuggestionStatus } from "@/lib/race-tactics-ai.functions";

// Phase 12 — AI-Assisted Race Strategy.
//
// Nothing here ever touches the plan itself until "Accept & Apply" is
// clicked. Accepting does exactly two things: calls the same
// onApplyStrategy (= Phase 8's changeStrategy) the Strategy card already
// uses, and inserts whichever tactical decision points are checked as
// real rows via the normal insert path — same as if a coach had typed
// them into the Tactical Decision Points card by hand. A suggestion the
// coach never accepts has zero effect on the plan, forever.

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rejected: "bg-slate-100 text-slate-500 border-slate-200",
};

export function AiStrategySuggestionCard({
  planId,
  onApplyStrategy,
}: {
  planId: string;
  onApplyStrategy: (strategy: Strategy) => void;
}) {
  const qc = useQueryClient();
  const getAccess = useServerFn(getAiAccessStatus);
  const generate = useServerFn(generateRaceStrategySuggestion);
  const listSuggestions = useServerFn(listRaceStrategySuggestions);
  const setStatus = useServerFn(updateSuggestionStatus);
  const [generating, setGenerating] = useState(false);

  const { data: access } = useQuery({ queryKey: ["ai-access"], queryFn: () => getAccess() });
  const { data: suggestions = [] } = useQuery({
    queryKey: ["race-strategy-suggestions", planId],
    queryFn: () => listSuggestions({ data: { planId } }),
  });

  function invalidateSuggestions() {
    qc.invalidateQueries({ queryKey: ["race-strategy-suggestions", planId] });
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generate({ data: { planId } });
      invalidateSuggestions();
      qc.invalidateQueries({ queryKey: ["ai-access"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to generate a suggestion");
    } finally {
      setGenerating(false);
    }
  }

  if (access && !access.allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-[var(--accent-red)]" />
            AI Strategy Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          AI is available to coaches by default. Athletes can enable it by adding their own Anthropic API key on the
          Profile page.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-[var(--accent-red)]" />
            AI Strategy Assistant
          </CardTitle>
          <CardDescription>
            A suggestion only — nothing changes on this plan until you accept it.
            {generating && " This can take a couple of minutes — it's a longer, more detailed request than a quick chat reply."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {access && <span className="text-[10px] text-muted-foreground">{access.used}/{access.limit} today</span>}
          <Button size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? "Thinking…" : "Generate suggestion"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suggestions yet — generate one for a strategy recommendation reasoned from this athlete's profile
            (PBs, strengths, race observations, thresholds).
          </p>
        ) : (
          suggestions.map((s: any) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              planId={planId}
              onApplyStrategy={onApplyStrategy}
              setStatus={setStatus}
              onChanged={invalidateSuggestions}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionRow({
  suggestion,
  planId,
  onApplyStrategy,
  setStatus,
  onChanged,
}: {
  suggestion: any;
  planId: string;
  onApplyStrategy: (strategy: Strategy) => void;
  setStatus: (args: { data: { suggestionId: string; status: "accepted" | "rejected" } }) => Promise<any>;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const points: Array<{ distanceM: number; trigger: string; action: string }> = suggestion.tactical_decision_points ?? [];
  const [chosenStrategy, setChosenStrategy] = useState<Strategy>(suggestion.primary_strategy);
  const [checked, setChecked] = useState<boolean[]>(points.map(() => true));
  const [busy, setBusy] = useState(false);
  const pending = suggestion.status === "pending";

  async function acceptAndApply() {
    setBusy(true);
    try {
      onApplyStrategy(chosenStrategy);
      const toInsert = points.filter((_, i) => checked[i]);
      if (toInsert.length > 0) {
        const { error } = await supabase.from("race_tactics_decision_points" as any).insert(
          toInsert.map((p) => ({
            plan_id: planId,
            distance_m: Math.round(p.distanceM),
            trigger_text: p.trigger,
            action_text: p.action,
          })),
        );
        if (error) throw error;
        qc.invalidateQueries({ queryKey: ["decision-points", planId] });
      }
      await setStatus({ data: { suggestionId: suggestion.id, status: "accepted" } });
      toast.success("Strategy applied");
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to apply");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await setStatus({ data: { suggestionId: suggestion.id, status: "rejected" } });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-md border p-3 ${pending ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">
          Primary: {suggestion.primary_strategy_label}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({STRATEGY_OPTIONS.find((o) => o.value === suggestion.primary_strategy)?.label})
          </span>
        </div>
        <Badge variant="outline" className={STATUS_STYLES[suggestion.status] ?? ""}>
          {suggestion.status}
        </Badge>
      </div>

      <p className="text-sm mt-2">{suggestion.reasoning}</p>

      <div className="mt-2">
        <div className="text-xs text-muted-foreground">Risks</div>
        <p className="text-sm">{suggestion.risks}</p>
      </div>

      <div className="mt-2">
        <div className="text-xs text-muted-foreground">
          Alternative: {suggestion.alternative_strategy_label} (
          {STRATEGY_OPTIONS.find((o) => o.value === suggestion.alternative_strategy)?.label})
        </div>
        <p className="text-sm text-muted-foreground">{suggestion.alternative_reasoning}</p>
      </div>

      {points.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1">Suggested tactical decision points</div>
          <div className="space-y-1.5">
            {points.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {pending && (
                  <Checkbox
                    checked={checked[i]}
                    onCheckedChange={(v) => setChecked((c) => c.map((x, idx) => (idx === i ? !!v : x)))}
                    className="mt-0.5"
                  />
                )}
                <div>
                  <span className="tabular-nums font-medium">{Math.round(p.distanceM)}m</span>{" "}
                  <span className="text-muted-foreground">if</span> {p.trigger}{" "}
                  <span className="text-muted-foreground">then</span> {p.action}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {suggestion.suggested_splits?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1">Illustrative splits</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            {suggestion.suggested_splits.map((sp: any, i: number) => (
              <span key={i}>
                {Math.round(sp.cumulativeDistanceM)}m: {secToClock(sp.segmentTimeSeconds)}
              </span>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
          <Select value={chosenStrategy} onValueChange={(v) => setChosenStrategy(v as Strategy)}>
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={suggestion.primary_strategy}>
                Apply primary: {STRATEGY_OPTIONS.find((o) => o.value === suggestion.primary_strategy)?.label}
              </SelectItem>
              <SelectItem value={suggestion.alternative_strategy}>
                Apply alternative: {STRATEGY_OPTIONS.find((o) => o.value === suggestion.alternative_strategy)?.label}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={acceptAndApply} disabled={busy}>
            <Check className="h-4 w-4 mr-1" />
            Accept & apply
          </Button>
          <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
