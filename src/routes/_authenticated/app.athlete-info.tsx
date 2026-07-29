import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";

// Fixed-URL entry point for the sidebar's "Athlete Info" link — an athlete
// doesn't have their own ID handy to put in a nav config, so this just
// resolves "my own athlete row" and forwards straight to the same
// Athlete Information / Physiological Metrics / Athlete DNA / Goals page
// a coach sees for any athlete on their roster, parameterized by this
// athlete's own ID. Same pattern already used for the athlete's public
// page (app.athlete.index.tsx) — a real ID-bearing route already exists
// and does everything needed; this just gets someone there without
// requiring the ID to be known ahead of time.
export const Route = createFileRoute("/_authenticated/app/athlete-info")({
  component: AthleteInfoRedirect,
});

function AthleteInfoRedirect() {
  const navigate = useNavigate();
  const { data: athlete, isLoading } = useMyAthlete();

  useEffect(() => {
    if (athlete?.id) {
      navigate({
        to: "/app/athletes/$athleteId/performance-profile",
        params: { athleteId: athlete.id },
        replace: true,
      });
    }
  }, [athlete, navigate]);

  // Only actually renders in the brief moment before the redirect fires,
  // or if this account has no linked athlete row at all (e.g. a role was
  // just added but the athlete record hasn't been created yet).
  return (
    <AppShell>
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {isLoading
            ? "Loading your athlete profile…"
            : athlete?.id
              ? "Redirecting to your Athlete Info…"
              : "No athlete profile is linked to your account yet."}
        </CardContent>
      </Card>
    </AppShell>
  );
}
