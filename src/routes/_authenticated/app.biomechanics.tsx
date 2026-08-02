import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles } from "@/lib/use-auth";
import { useEffectiveRole } from "@/lib/view-mode";
import { AppShell } from "@/components/app-shell";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { BiomechanicsTrendCard } from "@/components/biomechanics-trend-card";
import { BiomechanicsScoresCard } from "@/components/biomechanics-scores-card";
import { SpeedEconomyCurveCard } from "@/components/speed-economy-curve-card";
import { PersonStanding } from "lucide-react";

// Basics pass — replaces the earlier "coming soon" placeholder. Covers
// per-running-session cadence/stride/vertical oscillation/ground contact
// time/HR drift trends. Training Volume by Sport (the multi-sport
// overview graph) lives on the Analytics page instead — that's where
// Training Load and the other whole-training-picture charts already
// are, so it fits better there than on a running-form-specific page.
// Left/right ground-contact balance from the original placeholder copy
// isn't included — no device data captures L/R split anywhere in the
// pipeline, so there was nothing real to build. A dedicated form tab on
// Session Analysis (also mentioned in the original placeholder) is a
// separate, later piece.
//
// Coach-landing behavior deliberately does NOT match Analytics/Zones'
// CoachRoster/CoachZonesRoster pattern (a full roster-level overview
// table) — per direct request this auto-defaults straight to the first
// roster athlete instead. A coach clicking "Biomechanics" in the
// sidebar with no athlete in context used to land on a dead-end "Select
// an athlete above" page; now they land directly on real data for
// someone, with the same CoachAthletePicker still available to switch.

const searchSchema = z.object({
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/biomechanics")({
  validateSearch: searchSchema,
  component: BiomechanicsPage,
});

function BiomechanicsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { isCoachView } = useEffectiveRole();
  const { data: myAthlete } = useMyAthlete();

  // Same resolution pattern as Analytics/Zones — an explicit athleteId in
  // the URL wins (a coach arriving via another page's link), otherwise a
  // non-coach-view user sees their own data.
  const selectedAthleteId = search.athleteId ?? (!isCoachView ? myAthlete?.id : undefined);

  const { data: roster, isLoading: rosterLoading } = useQuery({
    queryKey: ["biomechanics-roster"],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_athletes").select("athletes(id, name, profile_image_url)");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  const sortedRoster = useMemo(
    () => [...(roster ?? [])].sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "")),
    [roster],
  );

  // Auto-redirect to the first roster athlete (alphabetical, matching
  // every other roster list in the app) the moment we know there's no
  // athleteId in the URL and the roster has actually loaded. Only ever
  // fires once per landing — as soon as `search.athleteId` is set this
  // effect's dependency no longer matches its own trigger condition.
  useEffect(() => {
    if (isCoachView && !search.athleteId && sortedRoster.length > 0) {
      navigate({ search: { athleteId: sortedRoster[0].id } as any });
    }
  }, [isCoachView, search.athleteId, sortedRoster, navigate]);

  if (isCoachView && !selectedAthleteId) {
    // Roster still loading, or the redirect above is mid-flight — avoid
    // flashing the old dead-end "Select an athlete" copy in between.
    if (rosterLoading || sortedRoster.length > 0) {
      return (
        <AppShell fullWidth>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </AppShell>
      );
    }
    // Genuinely no athletes on this coach's roster yet — nothing to
    // redirect to, so this is the one case that still needs its own
    // real message rather than a spinner that never resolves.
    return (
      <AppShell fullWidth>
        <div className="space-y-6 max-w-6xl">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <PersonStanding className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
              <h1 className="text-2xl font-bold leading-tight">Biomechanics</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Running form metrics, pulled from the FIT/GPX files already uploaded.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">No athletes on your roster yet — add one from Manage Athletes.</p>
        </div>
      </AppShell>
    );
  }

  if (!selectedAthleteId) {
    return (
      <AppShell fullWidth>
        <p className="text-sm text-muted-foreground">No athlete profile yet.</p>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <PersonStanding className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
              <h1 className="text-2xl font-bold leading-tight">Biomechanics</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Running form metrics, pulled from the FIT/GPX files already uploaded.
              </p>
            </div>
          </div>
          {isCoach && (
            <CoachAthletePicker
              roster={roster ?? []}
              myAthlete={myAthlete as any}
              value={selectedAthleteId}
              onChange={(v) => navigate({ search: { athleteId: v } as any })}
            />
          )}
        </div>

        <AthleteSubnav athleteId={selectedAthleteId} active="biomechanics" />

        <BiomechanicsScoresCard athleteId={selectedAthleteId} />
        <SpeedEconomyCurveCard athleteId={selectedAthleteId} />
        <BiomechanicsTrendCard athleteId={selectedAthleteId} />
      </div>
    </AppShell>
  );
}
