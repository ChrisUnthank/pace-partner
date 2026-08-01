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
import { AthleteSeasonsCard } from "@/components/athlete-seasons-card";
import { PerformanceCurveCard } from "@/components/performance-curve-card";
import { TrainingResponseCard } from "@/components/training-response-card";
import { StrengthsDevelopmentCard } from "@/components/strengths-development-card";
import { RaceProfileCard } from "@/components/race-profile-card";
import { AthleteDnaRatingsCard } from "@/components/athlete-dna-ratings-card";
import { DevelopmentPotentialCard } from "@/components/development-potential-card";
import { EventSuitabilityCard } from "@/components/event-suitability-card";
import { DevelopmentTimelineCard } from "@/components/development-timeline-card";
import { RecordsMilestonesCard } from "@/components/records-milestones-card";
import { FitnessHistoryCard } from "@/components/fitness-history-card";

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
      <AppShell fullWidth>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-3 max-w-6xl">
        {/* Row 1 — breadcrumb + athlete subnav on the left (coach view) or
            a plain back button (self-service), athlete picker on the
            right. Same pattern as Calendar/Analytics/Health so a coach
            always finds the athlete switcher in the same spot. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {isCoach ? (
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
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
            {isCoach && <AthleteSubnav athleteId={athleteId} active="performance-profile" />}
          </div>
          {isCoach && (
            <div className="shrink-0">
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete as any}
                value={athleteId}
                onChange={(v) =>
                  navigate({ to: "/app/athletes/$athleteId/performance-profile", params: { athleteId: v } })
                }
              />
            </div>
          )}
        </div>

        {/* Row 2 — icon + eyebrow heading (always "Performance Profile",
            never the athlete's name) on the left, status badge on the
            right. */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <IdCard className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Profile</div>
              <h1 className="text-2xl font-bold leading-tight">Performance Profile</h1>
            </div>
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
            <TabsTrigger value="history">Athlete History</TabsTrigger>
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
            <DevelopmentTimelineCard athleteId={athleteId} />
            <DevelopmentPotentialCard athleteId={athleteId} />
            <EventSuitabilityCard athleteId={athleteId} />
            <PerformanceCurveCard athleteId={athleteId} />
            <TrainingResponseCard athleteId={athleteId} />
            <RaceProfileCard athleteId={athleteId} />
          </TabsContent>

          {/* Phase 2 of 3 — Fitness History (weekly/monthly volume + TSS
              rollup, TrainingPeaks-style) added alongside Records &
              Milestones. Race highlights (a small "pulled live, not
              copied" strip linking out to the full Races page) and the
              per-session activity log (All/Notable toggle) still land in
              a follow-up pass. */}
          <TabsContent value="history" className="mt-4 space-y-6">
            <FitnessHistoryCard athleteId={athleteId} />
            <RecordsMilestonesCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="goals" className="mt-4 space-y-6">
            <GoalsCard athleteId={athleteId} />
            {/* Moved here from the old Profile/Account page — season
                windows feed the PB/Season Best/Year Best/Course Best
                badges Races now owns, and belong with an athlete's other
                self-defined planning info rather than account settings. */}
            <AthleteSeasonsCard athleteId={athleteId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
