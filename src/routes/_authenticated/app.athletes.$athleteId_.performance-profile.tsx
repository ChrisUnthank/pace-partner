import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, IdCard } from "lucide-react";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { GoalsCard } from "@/components/goals-card";
import { PhysiologicalTestingCard } from "@/components/physiological-testing-card";
import { AthleteIdentityCard, ATHLETE_STATUS_OPTIONS, ATHLETE_STATUS_STYLES } from "@/components/athlete-identity-card";
import { PerformanceCurveCard } from "@/components/performance-curve-card";
import { TrainingResponseCard } from "@/components/training-response-card";
import { StrengthsDevelopmentCard } from "@/components/strengths-development-card";
import { RaceProfileCard } from "@/components/race-profile-card";
import { AthleteDnaRatingsCard } from "@/components/athlete-dna-ratings-card";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId_/performance-profile")({
  component: PerformanceProfilePage,
});

function PerformanceProfilePage() {
  const { athleteId } = Route.useParams();
  const navigate = useNavigate();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const canEdit = isCoach || myAthlete?.id === athleteId;

  // Roster fetch for the athlete picker — this page is reached via a
  // route param (not a search param like most other coach-scoped pages),
  // so switching athletes here means navigating to a whole new URL rather
  // than just updating the current one.
  const { data: roster } = useQuery({
    queryKey: ["performance-profile-roster"],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_athletes").select("athletes(id, name, profile_image_url)");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  // Same ["athlete", athleteId] key the main profile page
  // (app.athletes.$athleteId.tsx) uses — both pages render the shared
  // AthleteIdentityCard, which invalidates this exact key on save, so
  // editing on either page refreshes both rather than the two silently
  // drifting apart the way the old separate query keys did.
  const { data: athlete, isLoading } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: last28d } = useQuery({
    queryKey: ["performance-profile-rolling", athleteId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 28);
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("training_load")
        .eq("athlete_id", athleteId)
        .gte("load_date", since.toISOString().slice(0, 10));
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <AppShell fullWidth>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/app/athletes" className="hover:underline flex items-center gap-1">
              <ChevronLeft className="h-4 w-4" />
              Athletes
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">{athlete?.name}</span>
            {isCoach && <AthleteSubnav athleteId={athleteId} active="performance-profile" />}
          </div>
          <div className="flex items-center gap-2">
            {isCoach && (
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete as any}
                value={athleteId}
                onChange={(v) =>
                  navigate({ to: "/app/athletes/$athleteId/performance-profile", params: { athleteId: v } })
                }
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-[var(--accent-red)]/10 text-[var(--accent-red)]">
            <IdCard className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Athlete Intelligence</div>
            <h1 className="text-2xl font-bold">Performance Profile</h1>
          </div>
          <Badge variant="outline" className={ATHLETE_STATUS_STYLES[athlete?.athlete_status ?? "active"]}>
            {ATHLETE_STATUS_OPTIONS.find((o) => o.value === athlete?.athlete_status)?.label ?? "Active"}
          </Badge>
        </div>

        <Tabs defaultValue="information" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="information">Athlete Information</TabsTrigger>
            <TabsTrigger value="physiological">Physiological Metrics</TabsTrigger>
            <TabsTrigger value="dna">Athlete DNA</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
          </TabsList>

          <TabsContent value="information" className="mt-4">
            <AthleteIdentityCard athlete={athlete} athleteId={athleteId} canEdit={canEdit} rollingActuals={last28d} />
          </TabsContent>

          {/* Section 1 — objective, measurable values. Unchanged from the
              existing card for now; the confidence/source/last-updated
              fields it already tracks per test just need a display pass
              in a later round. */}
          <TabsContent value="physiological" className="mt-4">
            <PhysiologicalTestingCard athleteId={athleteId} />
          </TabsContent>

          {/* Section 2 — AI interpretation, not raw numbers. Archetype +
              the new 10-category ratings up top, then the existing
              race-tactic and training-response cards folded in underneath
              as "Recommendations" rather than left as separate unrelated
              tabs. */}
          <TabsContent value="dna" className="mt-4 space-y-6">
            <StrengthsDevelopmentCard athleteId={athleteId} />
            <AthleteDnaRatingsCard athleteId={athleteId} />
            <PerformanceCurveCard athleteId={athleteId} />
            <TrainingResponseCard athleteId={athleteId} />
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
