import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, IdCard } from "lucide-react";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { GoalsCard } from "@/components/goals-card";
import { PhysiologicalTestingCard } from "@/components/physiological-testing-card";
import { AthleteIdentityCard, ATHLETE_STATUS_OPTIONS, ATHLETE_STATUS_STYLES } from "@/components/athlete-identity-card";
import { PerformanceCurveCard } from "@/components/performance-curve-card";
import { TrainingResponseCard } from "@/components/training-response-card";
import { StrengthsDevelopmentCard } from "@/components/strengths-development-card";
import { RaceProfileCard } from "@/components/race-profile-card";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId_/performance-profile")({
  component: PerformanceProfilePage,
});

function PerformanceProfilePage() {
  const { athleteId } = Route.useParams();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const canEdit = isCoach || myAthlete?.id === athleteId;

  // Same ["athlete", athleteId] key the main profile page
  // (app.athletes.$athleteId.tsx) uses — both pages render the shared
  // AthleteIdentityCard, which invalidates this exact key on save, so
  // editing on either page refreshes both rather than the two silently
  // drifting apart the way the old separate query keys did.
  const { data: athlete, isLoading } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).single();
      if (error) throw error;
      return data as any;
    },
  });

  // Rolling actuals instead of a hand-typed "current mileage" field — see
  // migration comment. Weekly mileage/time already live accurately on
  // `sessions`; re-asking a coach to retype it would just create a second,
  // easily-stale copy.
  const { data: last28d } = useQuery({
    queryKey: ["athlete-rolling-actuals", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("sessions")
        .select("total_distance_m, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .not("completed_at", "is", null);
      if (error) throw error;
      const totalM = (data ?? []).reduce((a: number, s: any) => a + (s.total_distance_m ?? 0), 0);
      return { totalKm: totalM / 1000, weeklyAvgKm: totalM / 1000 / 4, sessionCount: (data ?? []).length };
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 max-w-5xl">
        <div className="flex items-center gap-2 flex-wrap">
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
                Back to profile
              </Link>
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <IdCard className="h-5 w-5 text-[var(--accent-red)]" />
            <h1 className="text-2xl font-bold">{athlete?.name} — Performance Profile</h1>
          </div>
          <Badge variant="outline" className={ATHLETE_STATUS_STYLES[athlete?.athlete_status ?? "active"]}>
            {ATHLETE_STATUS_OPTIONS.find((o) => o.value === athlete?.athlete_status)?.label ?? "Active"}
          </Badge>
        </div>

        {isCoach && <AthleteSubnav athleteId={athleteId} active="performance-profile" />}

        <Tabs defaultValue="information" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="information">Athlete Information</TabsTrigger>
            <TabsTrigger value="physiological">Physiological Profile</TabsTrigger>
            <TabsTrigger value="performance">Performance Profile</TabsTrigger>
            <TabsTrigger value="training">Training Profile</TabsTrigger>
            <TabsTrigger value="strengths">Strengths & Development</TabsTrigger>
            <TabsTrigger value="race">Race Profile</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
          </TabsList>

          <TabsContent value="information" className="mt-4">
            <AthleteIdentityCard athlete={athlete} athleteId={athleteId} canEdit={canEdit} rollingActuals={last28d} />
          </TabsContent>

          <TabsContent value="physiological" className="mt-4">
            <PhysiologicalTestingCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <PerformanceCurveCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="training" className="mt-4">
            <TrainingResponseCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="strengths" className="mt-4">
            <StrengthsDevelopmentCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="race" className="mt-4">
            <RaceProfileCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="goals" className="mt-4">
            <GoalsCard athleteId={athleteId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
