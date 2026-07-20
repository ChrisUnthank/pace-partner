import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag, Plus } from "lucide-react";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { secToClock } from "@/lib/format";

const searchSchema = z.object({
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/race-tactics/")({
  validateSearch: searchSchema,
  component: RaceTacticsList,
});

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  coach_review: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-sky-100 text-sky-700 border-sky-200",
  race_ready: "bg-violet-100 text-violet-700 border-violet-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  coach_review: "Coach Review",
  approved: "Approved",
  race_ready: "Race Ready",
  completed: "Completed",
};

function RaceTacticsList() {
  const search = Route.useSearch();
  // Present when arriving from a specific athlete's full view (or any
  // other deep link) — narrows the list to just that athlete instead of
  // the coach's whole roster, and gets carried through to "New plan" too.
  const filterAthleteId = search.athleteId;

  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: filterAthlete } = useQuery({
    queryKey: ["race-tactics-filter-athlete", filterAthleteId],
    enabled: !!filterAthleteId,
    queryFn: async () => {
      const { data } = await supabase.from("athletes").select("id, name").eq("id", filterAthleteId!).maybeSingle();
      return data;
    },
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ["race-tactics-list", user?.id, isCoach, isManager, myAthlete?.id, filterAthleteId],
    enabled: !!user && (isCoach || !!myAthlete),
    queryFn: async () => {
      let query = supabase
        .from("race_tactics_plans" as any)
        .select("id, event_name, race_distance_m, race_type, race_date, goal_time_seconds, status, athlete_id, athletes(id, name)")
        .order("race_date", { ascending: true, nullsFirst: false });

      if (filterAthleteId) {
        query = query.eq("athlete_id", filterAthleteId);
      } else if (!isCoach && myAthlete) {
        query = query.eq("athlete_id", myAthlete.id);
      } else if (isCoach && !isManager) {
        const { data: links } = await supabase.from("coach_athletes").select("athlete_id").eq("coach_user_id", user!.id);
        const ids = (links ?? []).map((l: any) => l.athlete_id);
        if (ids.length === 0) return [];
        query = query.in("athlete_id", ids);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const newPlanSearch = filterAthleteId ? { athleteId: filterAthleteId } : undefined;

  return (
    <AppShell>
      <div className="space-y-4 max-w-4xl">
        {isCoach && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <Link to="/app/athletes" className="hover:text-foreground">
              Athletes
            </Link>
            {filterAthleteId && (
              <>
                <span className="text-border">/</span>
                <Link
                  to="/app/athletes/$athleteId"
                  params={{ athleteId: filterAthleteId }}
                  className="hover:text-foreground"
                >
                  {filterAthlete?.name ?? "Athlete"}
                </Link>
              </>
            )}
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flag className="h-5 w-5 text-[var(--accent-red)]" />
              Race Tactics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filterAthleteId ? (
                <>
                  Plans for <span className="font-medium text-foreground">{filterAthlete?.name ?? "this athlete"}</span>
                  {" · "}
                  <Link to="/app/race-tactics" className="underline">
                    View all plans
                  </Link>
                </>
              ) : (
                "Goal-time race plans with editable splits."
              )}
            </p>
          </div>
          <Button asChild>
            <Link to="/app/race-tactics/new" search={newPlanSearch as any}>
              <Plus className="h-4 w-4 mr-1" />
              New plan
            </Link>
          </Button>
        </div>

        {isCoach && filterAthleteId && <AthleteSubnav athleteId={filterAthleteId} active="races" />}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !plans || plans.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {filterAthleteId ? "No race plans yet for this athlete." : "No race plans yet."}
              </p>
              <Button asChild className="mt-3">
                <Link to="/app/race-tactics/new" search={newPlanSearch as any}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create the first one
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y border rounded-md">
            {plans.map((p) => (
              <Link
                key={p.id}
                to="/app/race-tactics/$planId"
                params={{ planId: p.id }}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {p.event_name} <span className="text-muted-foreground">· {p.race_distance_m}m</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {isCoach && !filterAthleteId ? `${p.athletes?.name ?? "—"} · ` : ""}
                    {p.race_date ?? "No date set"}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums text-muted-foreground">Goal {secToClock(p.goal_time_seconds)}</span>
                  <Badge variant="outline" className={STATUS_STYLES[p.status] ?? ""}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
