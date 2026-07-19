import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

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

function AthleteProfileIndexPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuthUser();
  const [checking, setChecking] = useState(true);
  const [needsCreate, setNeedsCreate] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      // Same self-service lookup app.profile.tsx already uses: the
      // logged-in athlete's own row, by user_id.
      const { data: athlete, error: athleteErr } = await (supabase as any)
        .from("athletes")
        .select("id, name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (athleteErr || !athlete) {
        setError(athleteErr?.message ?? "No athlete profile linked to this account yet.");
        setChecking(false);
        return;
      }
      setAthleteId(athlete.id);

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
      } else {
        setNeedsCreate(true);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, navigate]);

  async function createProfile() {
    if (!athleteId) return;
    setCreating(true);
    setError(null);

    const { data: athlete } = await (supabase as any).from("athletes").select("name").eq("id", athleteId).single();
    const base = slugFromName(athlete?.name || "athlete");
    const slug = `${base}-${Date.now()}`;

    const { error: insertErr } = await (supabase as any).from("athlete_profiles").insert({
      athlete_id: athleteId,
      slug,
    });
    if (insertErr) {
      setError(insertErr.message);
      setCreating(false);
      return;
    }
    navigate({ to: "/app/athlete/$slug", params: { slug }, replace: true });
  }

  return (
    <AppShell>
      <div className="max-w-md space-y-4">
        {checking && <p className="text-sm text-muted-foreground">Loading…</p>}
        {needsCreate && (
          <>
            <h1 className="text-2xl font-bold">Create your athlete page</h1>
            <Button onClick={createProfile} disabled={creating}>
              {creating ? "Creating…" : "Create Profile"}
            </Button>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
