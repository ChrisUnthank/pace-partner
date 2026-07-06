import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/coach/")({
  component: CoachIndexPage,
});

function slugFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  return local.replace(/\./g, "-");
}

function CoachIndexPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuthUser();
  const [checking, setChecking] = useState(true);
  const [needsCreate, setNeedsCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("slug")
        .eq("coach_user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setChecking(false);
        return;
      }
      if (data?.slug) {
        navigate({ to: "/app/coach/$slug", params: { slug: data.slug }, replace: true });
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
    if (!user?.email) return;
    setCreating(true);
    setError(null);
    const slug = slugFromEmail(user.email);
    const { error } = await supabase.from("coach_profiles").insert({
      coach_user_id: user.id,
      slug,
      name: user.email,
    });
    if (error) {
      setError(error.message);
      setCreating(false);
      return;
    }
    navigate({ to: "/app/coach/$slug", params: { slug }, replace: true });
  }

  return (
    <AppShell>
      <div className="max-w-md space-y-4">
        {checking && <p className="text-sm text-muted-foreground">Loading…</p>}
        {needsCreate && (
          <>
            <h1 className="text-2xl font-bold">Create your coaching page</h1>
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