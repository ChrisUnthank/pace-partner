// Public coach profile route — NOT under /_authenticated.
// This is the page a coach's inquiry link actually points to (app.co/c/marcus-webb),
// so it must be reachable by logged-out visitors.
//
// Suggested path in your router: src/routes/c.$slug.tsx

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoachProfilePage } from "@/components/coach-profile/CoachProfilePage";
import { coachRowToConfig, defaultCoachConfig } from "@/components/coach-profile/coach-config";

export const Route = createFileRoute("/c/$slug")({
  component: PublicCoachProfileRoute,
});

function useCoachProfile(slug: string) {
  return useQuery({
    queryKey: ["coach-profile-public", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_profiles").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function PublicCoachProfileRoute() {
  const { slug } = useParams({ from: "/c/$slug" });
  const { data: row, isLoading, error } = useCoachProfile(slug);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !row) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Coach not found.
      </div>
    );
  }

  const config = coachRowToConfig(row) ?? defaultCoachConfig;
  return <CoachProfilePage config={config} />;
}
