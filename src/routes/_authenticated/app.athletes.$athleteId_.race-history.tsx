import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronLeft, History, TrendingUp, Plus } from "lucide-react";
import { secToClock } from "@/lib/format";
import { STRATEGY_OPTIONS } from "@/lib/race-tactics-calc";

// Phase 16 — Historical Learning. Two conservative, rule-based patterns
// (same "state the method, gate on sample size" approach as Phase 3's
// Training Response) — not an attempt at every example pattern the spec
// names, since some of those (e.g. "struggled when boxed in during the
// final 500m") would need structured per-split position data this app
// doesn't collect yet; free-text decision-point notes can support a
// keyword scan, not that level of positional detail.
//
// "Feed back into the Athlete Performance Profile": each detected pattern
// gets an "Add to Race Profile" button that inserts directly into
// athlete_race_observations with source_type 'data_derived' — the exact
// table and source type built in Phase 6 and left unpopulated until now.

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId_/race-history")({
  component: RaceHistoryPage,
});

const MIN_RACES_FOR_PATTERN = 3;
const NOTE_KEYWORDS = ["boxed", "went out too fast", "faded", "couldn't respond", "unable to kick", "positioning"];

function RaceHistoryPage() {
  const { athleteId } = Route.useParams();
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const canAdd = isCoach || myAthlete?.id === athleteId;

  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athletes").select("name").eq("id", athleteId).single();
      return data;
    },
  });

  const { data: races, isLoading } = useQuery({
    queryKey: ["race-history", athleteId],
    queryFn: async () => {
      const { data: plans, error } = await supabase
        .from("race_tactics_plans" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("race_date", { ascending: false });
      if (error) throw error;
      const planIds = (plans ?? []).map((p: any) => p.id);
      if (planIds.length === 0) return [];
      const { data: analyses } = await supabase.from("race_tactics_post_race" as any).select("*").in("plan_id", planIds);
      const analysisByPlan = new Map((analyses ?? []).map((a: any) => [a.plan_id, a]));
      return (plans ?? [])
        .map((p: any) => ({ plan: p, analysis: analysisByPlan.get(p.id) }))
        .filter((r) => r.analysis && (r.analysis.actual_splits?.length ?? 0) > 0);
    },
  });

  async function addObservation(text: string) {
    const { error } = await supabase.from("athlete_race_observations" as any).insert({
      athlete_id: athleteId,
      observation: text,
      source_type: "data_derived",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Added to Race Profile");
    qc.invalidateQueries({ queryKey: ["race-observations", athleteId] });
  }

  const openingPacePattern = useMemo(() => {
    if (!races || races.length < MIN_RACES_FOR_PATTERN) return null;
    const points: Array<{ deviationPct: number; outcomePct: number }> = [];
    for (const { plan, analysis } of races) {
      const splits = plan.splits as Array<{ cumulative_distance_m: number; cumulative_time_seconds: number; distance_m: number }>;
      const actual = analysis.actual_splits as Array<{ cumulative_distance_m: number; cumulative_time_seconds: number }>;
      if (!splits?.length || !actual?.length) continue;
      const plannedFirst = splits[0];
      const actualFirst = actual.find((a) => a.cumulative_distance_m === plannedFirst.cumulative_distance_m);
      const finishPlanned = Number(plan.goal_time_seconds);
      const finishActual = actual.reduce((best, a) => (a.cumulative_distance_m > best.cumulative_distance_m ? a : best), actual[0]);
      if (!actualFirst || finishActual.cumulative_distance_m !== plan.race_distance_m) continue;
      const deviationPct = ((actualFirst.cumulative_time_seconds - plannedFirst.cumulative_time_seconds) / plannedFirst.cumulative_time_seconds) * 100;
      const outcomePct = ((finishActual.cumulative_time_seconds - finishPlanned) / finishPlanned) * 100;
      points.push({ deviationPct, outcomePct });
    }
    if (points.length < MIN_RACES_FOR_PATTERN) return null;
    const accurate = points.filter((p) => Math.abs(p.deviationPct) <= 3);
    const inaccurate = points.filter((p) => Math.abs(p.deviationPct) > 3);
    if (accurate.length < 2 || inaccurate.length < 2) return null;
    const avgAccurate = accurate.reduce((a, p) => a + p.outcomePct, 0) / accurate.length;
    const avgInaccurate = inaccurate.reduce((a, p) => a + p.outcomePct, 0) / inaccurate.length;
    if (avgInaccurate - avgAccurate < 1) return null;
    return {
      text: `Based on ${points.length} races with actual results, this athlete's finish time was on average ${avgAccurate.toFixed(1)}% off goal in races where their opening split was within 3% of planned pace, vs ${avgInaccurate.toFixed(1)}% off goal when the opening deviated more — opening pace accuracy appears linked to finishing close to goal.`,
      method: `Method: compares finish-time-vs-goal across ${points.length} races with logged actual results, grouped by whether the first split was within 3% of its planned pace.`,
    };
  }, [races]);

  const keywordPattern = useMemo(() => {
    if (!races || races.length < MIN_RACES_FOR_PATTERN) return null;
    const counts = new Map<string, number>();
    for (const { analysis } of races) {
      const text = [
        analysis.coach_what_didnt,
        analysis.athlete_how_it_felt,
        ...Object.values(analysis.decision_point_notes ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const kw of NOTE_KEYWORDS) {
        if (text.includes(kw)) counts.set(kw, (counts.get(kw) ?? 0) + 1);
      }
    }
    const recurring = Array.from(counts.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    if (recurring.length === 0) return null;
    const [topKeyword, topCount] = recurring[0];
    return {
      text: `"${topKeyword}" came up in post-race notes for ${topCount} of ${races.length} races with recorded results — worth a look as a recurring theme.`,
      method: `Method: keyword scan across coach/athlete post-race reflections and decision-point notes for ${races.length} races with actual results logged.`,
    };
  }, [races]);

  return (
    <AppShell fullWidth>
      <div className="space-y-4 max-w-3xl">
        {isCoach ? (
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <Link to="/app/athletes" className="hover:text-foreground">
              Athletes
            </Link>
            <span className="text-border">/</span>
            <Link to="/app/athletes/$athleteId" params={{ athleteId }} className="hover:text-foreground">
              {athlete?.name ?? "Athlete"}
            </Link>
          </div>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/athletes/$athleteId" params={{ athleteId }}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              {athlete?.name ?? "Athlete"}
            </Link>
          </Button>
        )}

        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <History className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Performances</div>
            <h1 className="text-2xl font-bold leading-tight">Race History</h1>
          </div>
        </div>

        {(openingPacePattern || keywordPattern) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-[var(--accent-red)]" />
                Recurring patterns
              </CardTitle>
              <CardDescription>Computed from races with recorded actual results — observations, not conclusions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[openingPacePattern, keywordPattern].filter(Boolean).map((p, i) => (
                <div key={i} className="rounded-md border p-3">
                  <p className="text-sm">{p!.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{p!.method}</p>
                  {canAdd && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 mt-2 text-xs" onClick={() => addObservation(p!.text)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add to Race Profile
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !races || races.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No completed races with recorded results yet. Add actual results on a race plan's Post-Race Analysis to
              see it here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {races.map(({ plan, analysis }: any) => {
              const actual = analysis.actual_splits as Array<{ cumulative_distance_m: number; cumulative_time_seconds: number }>;
              const finish = actual.reduce((best, a) => (a.cumulative_distance_m > best.cumulative_distance_m ? a : best), actual[0]);
              const diffSec = finish.cumulative_time_seconds - Number(plan.goal_time_seconds);
              return (
                <Link key={plan.id} to="/app/race-tactics/$planId" params={{ planId: plan.id }}>
                  <Card className="hover:bg-accent/40 transition-colors">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-medium">
                            {plan.event_name} <span className="text-muted-foreground text-sm">· {plan.race_distance_m}m</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{plan.race_date}</div>
                        </div>
                        <div className="text-right">
                          <div className="tabular-nums font-semibold">{secToClock(finish.cumulative_time_seconds)}</div>
                          <div className={`text-xs tabular-nums ${diffSec > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {diffSec > 0 ? "+" : ""}
                            {diffSec.toFixed(1)}s vs goal
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {STRATEGY_OPTIONS.find((o) => o.value === plan.strategy)?.label ?? plan.strategy}
                        </Badge>
                        {analysis.finishing_position && (
                          <Badge variant="outline" className="text-[10px]">
                            {analysis.finishing_position}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
