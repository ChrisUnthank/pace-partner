import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { secToClock } from "@/lib/format";
import { ChevronLeft } from "lucide-react";

// Phase 14 — Race Day Mode. Deliberately NOT wrapped in AppShell — no
// sidebar, no header chrome, nothing to tap by accident with cold/sweaty
// hands. Just the goal, the splits, and the decision points, in as few
// large blocks as possible. This is the one screen in the whole feature
// designed to be read at a glance mid-race, not studied at a desk.

export const Route = createFileRoute("/_authenticated/app/race-tactics/$planId_/race-day")({
  component: RaceDayMode,
});

function RaceDayMode() {
  const { planId } = Route.useParams();

  const { data: plan, isLoading } = useQuery({
    queryKey: ["race-tactics-plan", planId],
    queryFn: async () => {
      const { data, error } = await supabase.from("race_tactics_plans" as any).select("*").eq("id", planId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: decisionPoints } = useQuery({
    queryKey: ["decision-points", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_tactics_decision_points" as any)
        .select("*")
        .eq("plan_id", planId)
        .order("distance_m", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (isLoading || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const splits = (plan.splits ?? []) as Array<{ cumulative_distance_m: number; cumulative_time_seconds: number }>;

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-6 max-w-md mx-auto">
      <Link to="/app/race-tactics/$planId" params={{ planId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ChevronLeft className="h-4 w-4" />
        Full plan
      </Link>

      <div className="text-center mb-8">
        <div className="text-sm uppercase tracking-widest text-muted-foreground">{plan.event_name}</div>
        <div className="text-xs text-muted-foreground mt-1">GOAL</div>
        <div className="text-6xl font-extrabold tabular-nums mt-1">{secToClock(plan.goal_time_seconds)}</div>
      </div>

      {splits.length > 0 && (
        <div className="mb-8">
          <div className="grid grid-cols-2 gap-3">
            {splits.map((s, i) => (
              <div key={i} className="rounded-lg border-2 py-3 text-center">
                <div className="text-xs text-muted-foreground tabular-nums">{s.cumulative_distance_m}m</div>
                <div className="text-2xl font-bold tabular-nums">{secToClock(s.cumulative_time_seconds)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(decisionPoints ?? []).length > 0 && (
        <div className="space-y-3">
          {(decisionPoints ?? []).map((p: any) => {
            const toGo = plan.race_distance_m - p.distance_m;
            return (
              <div key={p.id} className="rounded-lg bg-[var(--accent-red)] text-white px-4 py-4 text-center">
                <div className="text-sm font-semibold tabular-nums opacity-90">
                  {toGo > 0 ? `${toGo}m TO GO` : "FINISH"}
                </div>
                <div className="text-3xl font-extrabold uppercase tracking-wide mt-1">{p.action_text}</div>
                <div className="text-xs opacity-80 mt-1">if {p.trigger_text}</div>
              </div>
            );
          })}
        </div>
      )}

      {splits.length === 0 && (decisionPoints ?? []).length === 0 && (
        <p className="text-center text-sm text-muted-foreground">No splits or decision points on this plan yet.</p>
      )}
    </div>
  );
}
