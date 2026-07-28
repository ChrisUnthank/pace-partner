import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyLinkedAthletes } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { Globe } from "lucide-react";

const searchSchema = z.object({
  // Present when arriving via the athlete-context tab strip (a specific
  // athlete doesn't have a page yet) — narrows "Athlete pages you manage"
  // down to just that athlete instead of the whole roster.
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/athlete/")({
  validateSearch: searchSchema,
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
  const search = Route.useSearch();
  const filterAthleteId = search.athleteId;
  const { user, loading } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");
  // A parent only ever gets a read-only link to an already-published page —
  // creating/managing a page stays a coach or athlete action, so this
  // branch never offers a "Create page" button, only "View page" once one
  // exists.
  const isParent = rawRoles.includes("parent") && !isCoach;
  const { data: linkedAthletesRaw } = useMyLinkedAthletes();
  const [parentPages, setParentPages] = useState<{ athlete_id: string; name: string; slug: string | null }[]>([]);

  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Self-service path: the logged-in user has their own athlete row.
  const [selfAthlete, setSelfAthlete] = useState<{ id: string; name: string } | null>(null);
  // Coach path: no self athlete row (or has one, doesn't matter — coaches
  // can still manage pages for athletes they coach) — offer their roster.
  const [roster, setRoster] = useState<
    { athlete_id: string; name: string; hasPage: boolean; slug: string | null; profile_image_url: string | null }[]
  >([]);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  // Parent path: resolve whichever of the linked children already have a
  // published page. Runs independently of the self/coach effect below —
  // a parent has neither a self athlete row nor a coach roster, so it'd
  // never populate anything on its own.
  useEffect(() => {
    if (!isParent || !linkedAthletesRaw) return;
    let cancelled = false;
    (async () => {
      const athletes = (linkedAthletesRaw ?? []).map((r: any) => r.athletes).filter(Boolean);
      const athleteIds = athletes.map((a: any) => a.id);
      if (athleteIds.length === 0) {
        if (!cancelled) setParentPages([]);
        return;
      }
      const { data: pages } = await (supabase as any)
        .from("athlete_profiles")
        .select("athlete_id, slug")
        .in("athlete_id", athleteIds);
      const slugByAthlete = new Map((pages ?? []).map((p: any) => [p.athlete_id, p.slug]));
      if (!cancelled) {
        setParentPages(
          athletes.map((a: any) => ({ athlete_id: a.id, name: a.name, slug: slugByAthlete.get(a.id) ?? null })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isParent, linkedAthletesRaw]);

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
        // Only auto-redirect the self-service path when there's no
        // specific athlete being targeted — arriving here via the tab
        // strip for a *different* athlete on the roster shouldn't get
        // hijacked into the logged-in coach's own page.
        if (page?.slug && !filterAthleteId) {
          navigate({ to: "/app/athlete/$slug", params: { slug: page.slug }, replace: true });
          return;
        }
        if (!filterAthleteId || filterAthleteId === athlete.id) {
          setSelfAthlete(athlete);
        }
      }

      // Also offer the coach-roster path whenever the account has the
      // coach/manager role — a coach who's *also* an athlete themselves
      // still benefits from seeing "set up a page for someone I coach"
      // rather than only their own.
      if (isCoach) {
        const { data: links } = await (supabase as any)
          .from("coach_athletes")
          .select("athlete_id, athletes ( id, name, profile_image_url )")
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
              profile_image_url: a.profile_image_url ?? null,
            }));
          if (!cancelled) setRoster(rows);
        }
      }

      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, isCoach, navigate, filterAthleteId]);

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

  // When arriving for a specific athlete, narrow the roster list down to
  // just them — a coach who clicked the "Athlete Page" tab from a
  // specific athlete's context wants that athlete's page, not a reminder
  // of everyone else's.
  const displayedRoster = filterAthleteId ? roster.filter((r) => r.athlete_id === filterAthleteId) : roster;
  const filteredAthleteName = filterAthleteId
    ? roster.find((r) => r.athlete_id === filterAthleteId)?.name ??
      (selfAthlete?.id === filterAthleteId ? selfAthlete.name : undefined)
    : undefined;
  // Shape roster needs for the shared picker — this page's own roster
  // state carries extra fields (hasPage/slug) the picker doesn't need.
  const pickerRoster = useMemo(
    () => roster.map((r) => ({ id: r.athlete_id, name: r.name, profile_image_url: r.profile_image_url })),
    [roster],
  );

  return (
    <AppShell fullWidth>
      <div className="max-w-lg space-y-6">
        {isCoach && filterAthleteId && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <Link to="/app/athletes" className="hover:text-foreground">
                  Athletes
                </Link>
                <span className="text-border">/</span>
                <Link to="/app/athletes/$athleteId" params={{ athleteId: filterAthleteId }} className="hover:text-foreground">
                  {filteredAthleteName ?? "Athlete"}
                </Link>
              </div>
              <CoachAthletePicker
                roster={pickerRoster}
                value={filterAthleteId}
                onChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
              />
            </div>
            <AthleteSubnav athleteId={filterAthleteId} active="athlete-page" />
          </>
        )}

        {checking && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!checking && selfAthlete && (!filterAthleteId || filterAthleteId === selfAthlete.id) && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
                style={{ background: "var(--accent-red)" }}
              >
                <Globe className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Community</div>
                <h1 className="text-2xl font-bold leading-tight">Create your athlete page</h1>
              </div>
            </div>
            <Button onClick={createSelfProfile} disabled={creatingId === selfAthlete.id}>
              {creatingId === selfAthlete.id ? "Creating…" : "Create Profile"}
            </Button>
          </div>
        )}

        {!checking && isParent && parentPages.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Athlete page{parentPages.length > 1 ? "s" : ""}</CardTitle>
              <CardDescription>
                {parentPages.length > 1
                  ? "Public pages for your linked athletes."
                  : `${parentPages[0].name}'s public page.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {parentPages.map((p) => (
                <div key={p.athlete_id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>{p.name}</span>
                  {p.slug ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/athlete/$slug" params={{ slug: p.slug }}>
                        View page
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No public page yet</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!checking && isParent && parentPages.length === 0 && (
          <p className="text-sm text-muted-foreground">No linked athletes found on your account yet.</p>
        )}

        {!checking && displayedRoster.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {filterAthleteId ? "Athlete page" : "Athlete pages you manage"}
              </CardTitle>
              <CardDescription>
                {filterAthleteId ? (
                  <>
                    Set up or open {filteredAthleteName ?? "this athlete"}'s public page.{" "}
                    <Link to="/app/athlete" className="underline">
                      View all athlete pages
                    </Link>
                  </>
                ) : (
                  "Set up or open a public page for an athlete you coach — useful for anyone without their own Strider login."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {displayedRoster.map((r) => (
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

        {!checking && filterAthleteId && !selfAthlete && displayedRoster.length === 0 && roster.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Couldn't find that athlete on your roster.{" "}
            <Link to="/app/athlete" className="underline">
              View all athlete pages
            </Link>
            .
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
