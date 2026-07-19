// Public coach profile route — NOT under /_authenticated.
// This is the page a coach's inquiry link actually points to (app.co/c/marcus-webb),
// so it must be reachable by logged-out visitors.

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
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

function useVisibleAthletes(coachUserId: string | undefined) {
  return useQuery({
    queryKey: ["coach-profile-public-athletes", coachUserId],
    enabled: !!coachUserId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_athletes")
        .select("athletes ( name, primary_event, profile_image_url )")
        .eq("coach_user_id", coachUserId)
        .eq("visible_on_coach_page", true);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.athletes)
        .filter(Boolean)
        .map((a: any) => ({
          name: a.name,
          event: a.primary_event ?? undefined,
          photoUrl: a.profile_image_url ?? undefined,
        }));
    },
  });
}

// Only published posts, newest first — mirrors the editor's own ordering.
function usePublicBlogPosts(coachUserId: string | undefined) {
  return useQuery({
    queryKey: ["coach-profile-public-blog", coachUserId],
    enabled: !!coachUserId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_blog_posts")
        .select("*")
        .eq("coach_user_id", coachUserId)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        excerpt: p.excerpt,
        content: p.content,
        coverImageUrl: p.cover_image_url ?? undefined,
        publishedAt: p.created_at,
      }));
    },
  });
}

function PublicCoachProfileRoute() {
  const { slug } = useParams({ from: "/c/$slug" });
  const { data: row, isLoading, error } = useCoachProfile(slug);
  const { user } = useAuthUser();
  const { data: athletes } = useVisibleAthletes(row?.coach_user_id ?? undefined);
  const { data: blogPosts } = usePublicBlogPosts(row?.coach_user_id ?? undefined);

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

  const config = coachRowToConfig(row, athletes ?? [], blogPosts ?? []) ?? defaultCoachConfig;
  // A coach viewing their own (possibly unpublished) page while logged in
  // still sees the full page instead of the "not published yet"
  // placeholder — matched by comparing the logged-in user's id against
  // this row's owner, not by a flag a visitor could spoof.
  const isOwnerPreview = !!user && user.id === row.coach_user_id;

  return <CoachProfilePage config={config} isOwnerPreview={isOwnerPreview} />;
}
