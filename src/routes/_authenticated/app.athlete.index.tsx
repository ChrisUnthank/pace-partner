import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/app/athlete/")({
  component: AthleteProfileIndexPage,
});

function slugFromName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function createProfileFor(athleteId: string, athleteName: string) {
  const base = slugFromName(athleteName || "athlete");
  const slug = `${base}-${Date.now()}`;
  const { error } = await (supabase as any).from("athlete_profiles").insert({ athlete_id: athleteId, slug });
  if (error) throw error;
  return slug;
}

function AthleteProfileIndexPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");

  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Self-service path: the logged-in user has their own athlete row.
  const [selfAthlete, setSelfAthlete] = useState<{ id: string; name: string } | null>(null);
  // Coach path: no self athlete row (or has one, doesn't matter — coaches
  // can still manage pages for athletes they coach) — offer their roster.
  const [roster, setRoster] = useState<{ athlete_id: string; name: string; hasPage: boolean; slug: string | null }[]>(
    [],
  );
  const [creatingId, setCreatingId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      // Same self-service lookup app.profile.tsx already uses: the
      // logged-in athlete's own row, by user_id.
      const { data: athlete } = await (supabase as any)
        .from("athletes")
        .select("id, name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      if (athlete) {
        const { data: page, error: pageErr } = await (supabase as any)
          .from("athlete_profiles")
          .select("slug")
          .eq("athlete_id", athlete.id)
          .maybeSingle();
        if (cancelled) return;
        if (pageErr) {
          setError(pageErr.message);
          setChecking(false);
          return;
        }
        if (page?.slug) {
          navigate({ to: "/app/athlete/$slug", params: { slug: page.slug }, replace: true });
          return;
        }
        setSelfAthlete(athlete);
      }

      // Also offer the coach-roster path whenever the account has the
      // coach/manager role — a coach who's *also* an athlete themselves
      // still benefits from seeing "set up a page for someone I coach"
      // rather than only their own.
      if (isCoach) {
        const { data: links } = await (supabase as any)
          .from("coach_athletes")
          .select("athlete_id, athletes ( id, name )")
          .eq("coach_user_id", user.id);
        const athleteIds = [...new Set((links ?? []).map((l: any) => l.athlete_id))];
        if (athleteIds.length) {
          const { data: pages } = await (supabase as any)
            .from("athlete_profiles")
            .select("athlete_id, slug")
            .in("athlete_id", athleteIds);
          const pageByAthleteId = new Map((pages ?? []).map((p: any) => [p.athlete_id, p.slug]));
          const rows = (links ?? [])
            .map((l: any) => l.athletes)
            .filter(Boolean)
            .map((a: any) => ({
              athlete_id: a.id,
              name: a.name,
              hasPage: pageByAthleteId.has(a.id),
              slug: pageByAthleteId.get(a.id) ?? null,
            }));
          if (!cancelled) setRoster(rows);
        }
      }

      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, isCoach, navigate]);

  async function createSelfProfile() {
    if (!selfAthlete) return;
    setCreatingId(selfAthlete.id);
    try {
      const slug = await createProfileFor(selfAthlete.id, selfAthlete.name);
      navigate({ to: "/app/athlete/$slug", params: { slug }, replace: true });
    } catch (e: any) {
      setError(e.message);
      setCreatingId(null);
    }
  }

  async function openOrCreateForRosterAthlete(athleteId: string, name: string, existingSlug: string | null) {
    if (existingSlug) {
      navigate({ to: "/app/athlete/$slug", params: { slug: existingSlug } });
      return;
    }
    setCreatingId(athleteId);
    try {
      const slug = await createProfileFor(athleteId, name);
      navigate({ to: "/app/athlete/$slug", params: { slug } });
    } catch (e: any) {
      setError(e.message);
      setCreatingId(null);
    }
  }

  return (
    <AppShell>
      <div className="max-w-lg space-y-6">
        {checking && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!checking && selfAthlete && (
          <div className="space-y-3">
            <h1 className="text-2xl font-bold">Create your athlete page</h1>
            <Button onClick={createSelfProfile} disabled={creatingId === selfAthlete.id}>
              {creatingId === selfAthlete.id ? "Creating…" : "Create Profile"}
            </Button>
          </div>
        )}

        {!checking && roster.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Athlete pages you manage</CardTitle>
              <CardDescription>
                Set up or open a public page for an athlete you coach — useful for anyone without their own Strider
                login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {roster.map((r) => (
                <div key={r.athlete_id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>{r.name}</span>
                  <Button
                    size="sm"
                    variant={r.hasPage ? "outline" : "default"}
                    disabled={creatingId === r.athlete_id}
                    onClick={() => openOrCreateForRosterAthlete(r.athlete_id, r.name, r.slug)}
                  >
                    {creatingId === r.athlete_id ? "Creating…" : r.hasPage ? "Open page" : "Create page"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!checking && !selfAthlete && roster.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No athlete profile linked to your account, and no athletes on your roster yet.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
