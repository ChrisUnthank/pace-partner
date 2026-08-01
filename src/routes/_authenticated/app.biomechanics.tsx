import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles } from "@/lib/use-auth";
import { useEffectiveRole } from "@/lib/view-mode";
import { AppShell } from "@/components/app-shell";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { BiomechanicsTrendCard } from "@/components/biomechanics-trend-card";
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

  const { data: roster } = useQuery({
    queryKey: ["biomechanics-roster"],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_athletes").select("athletes(id, name, profile_image_url)");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  if (isCoachView && !selectedAthleteId) {
    return (
      <AppShell fullWidth>
        <div className="max-w-md mx-auto mt-12 text-center space-y-4">
          <div
            className="h-10 w-10 mx-auto rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <PersonStanding className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <p className="text-sm text-muted-foreground">Select an athlete to view Biomechanics.</p>
          <CoachAthletePicker
            roster={roster ?? []}
            myAthlete={myAthlete as any}
            value={undefined}
            onChange={(v) => navigate({ search: { athleteId: v } as any })}
          />
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

        <BiomechanicsTrendCard athleteId={selectedAthleteId} />
      </div>
    </AppShell>
  );
}
