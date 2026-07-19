// Public athlete profile route — NOT under /_authenticated. Reachable by
// logged-out visitors, same reasoning as src/routes/c.$slug.tsx for
// coaches. Lives at a different URL prefix (/a/$slug rather than
// /c/$slug) because coach_profiles.slug and athlete_profiles.slug are
// independently-unique columns in two different tables — the same slug
// string could theoretically be claimed by both a coach and an athlete,
// so they can't safely share one route/prefix.
//
// Suggested path in your router: src/routes/a.$slug.tsx

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { AthleteProfilePage } from "@/components/athlete-profile/AthleteProfilePage";
import {
  athleteRowToConfig,
  defaultAthleteConfig,
  type AthletePersonalBest,
  type AthleteRaceResult,
} from "@/components/athlete-profile/athlete-config";

export const Route = createFileRoute("/a/$slug")({
  component: PublicAthleteProfileRoute,
});

function useAthleteProfile(slug: string) {
  return useQuery({
    queryKey: ["athlete-profile-public", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_profiles")
        .select("*, athletes ( id, name, primary_event, profile_image_url, user_id )")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Race results: context = 'race' AND is_public = true (see this session's
// note on why context over round). personalBests is derived client-side
// as the best time per distance from that same result set, rather than a
// separate query — keeps "PB" here meaning "best public race result",
// consistent with what recentResults itself shows, rather than pulling
// is_pb from performances (which can be true for a non-race performance
// context and would then show a "PB" the athlete never opted into
// publishing).
function usePublicRaceResults(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-public-results", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("performances")
        .select("id, distance_m, time_seconds, event_name, performance_date, overall_place")
        .eq("athlete_id", athleteId)
        .eq("context", "race")
        .eq("is_public", true)
        .order("performance_date", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];

      const bestByDistance = new Map<number, any>();
      for (const r of rows) {
        const cur = bestByDistance.get(r.distance_m);
        if (!cur || r.time_seconds < cur.time_seconds) bestByDistance.set(r.distance_m, r);
      }
      const personalBests: AthletePersonalBest[] = [...bestByDistance.values()]
        .sort((a, b) => a.distance_m - b.distance_m)
        .map((r) => ({
          distanceM: r.distance_m,
          timeSeconds: r.time_seconds,
          eventName: r.event_name ?? undefined,
          performanceDate: r.performance_date ?? undefined,
        }));
      const pbIds = new Set([...bestByDistance.values()].map((r) => r.id));
      const recentResults: AthleteRaceResult[] = rows.slice(0, 10).map((r: any) => ({
        id: r.id,
        distanceM: r.distance_m,
        timeSeconds: r.time_seconds,
        eventName: r.event_name ?? undefined,
        performanceDate: r.performance_date,
        overallPlace: r.overall_place ?? undefined,
        isPb: pbIds.has(r.id),
      }));
      return { personalBests, recentResults };
    },
  });
}

// Only the primary active goal, and only the fields safe to show a
// stranger — deliberately not `notes`, which can carry private context
// (injury status, etc.) the athlete didn't necessarily mean to publish
// just by having an active goal.
function usePublicGoal(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-public-goal", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_goals")
        .select("title, race_date, distance_m, target_time_seconds")
        .eq("athlete_id", athleteId)
        .eq("is_primary", true)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        title: data.title,
        raceDate: data.race_date ?? undefined,
        distanceM: data.distance_m ?? undefined,
        targetTimeSeconds: data.target_time_seconds ?? undefined,
      };
    },
  });
}

// Auto-derived squad-mates (other athletes sharing any coach with this
// athlete) plus manual additions from athlete_profiles, minus any
// auto-derived entries the athlete chose to hide. Two sequential queries
// rather than one join — simpler than a raw SQL function for what's
// normally a handful of rows, and coach_athletes/athletes are already
// openly readable (same tables the coach page's public route already
// reads via the anon key today).
function useTrainingPartners(
  athleteId: string | undefined,
  manualAdded: { name: string; photoUrl?: string; event?: string }[],
  hiddenIds: string[],
) {
  return useQuery({
    queryKey: ["athlete-profile-public-training-partners", athleteId, manualAdded, hiddenIds],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data: myCoaches, error: e1 } = await (supabase as any)
        .from("coach_athletes")
        .select("coach_user_id")
        .eq("athlete_id", athleteId);
      if (e1) throw e1;
      const coachIds = [...new Set((myCoaches ?? []).map((r: any) => r.coach_user_id))];

      let squadMates: { id: string; name: string; event?: string; photoUrl?: string }[] = [];
      if (coachIds.length) {
        const { data: teammates, error: e2 } = await (supabase as any)
          .from("coach_athletes")
          .select("athlete_id, athletes ( id, name, primary_event, profile_image_url )")
          .in("coach_user_id", coachIds);
        if (e2) throw e2;
        const seen = new Set<string>();
        for (const row of teammates ?? []) {
          const a = row.athletes;
          if (!a || a.id === athleteId || seen.has(a.id) || hiddenIds.includes(a.id)) continue;
          seen.add(a.id);
          squadMates.push({
            id: a.id,
            name: a.name,
            event: a.primary_event ?? undefined,
            photoUrl: a.profile_image_url ?? undefined,
          });
        }
      }

      return [...squadMates, ...manualAdded];
    },
  });
}

function usePublicBlogPosts(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-public-blog", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_blog_posts")
        .select("*")
        .eq("athlete_id", athleteId)
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

// Is the current viewer allowed to see an unpublished page? Either the
// athlete themselves (athletes.user_id) or one of their coaches. Checked
// against coach_athletes directly rather than calling the is_coach_of()
// SECURITY DEFINER function from the client, since its exact RPC
// signature wasn't confirmed in this session — this is a one-row lookup
// against a table already known to be readable, so it's no less correct.
function useIsOwnerPreview(athleteId: string | undefined, athleteUserId: string | undefined, viewerId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-owner-check", athleteId, viewerId],
    enabled: !!athleteId && !!viewerId && viewerId !== athleteUserId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_athletes")
        .select("id")
        .eq("athlete_id", athleteId)
        .eq("coach_user_id", viewerId)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

function PublicAthleteProfileRoute() {
  const { slug } = useParams({ from: "/a/$slug" });
  const { data: row, isLoading, error } = useAthleteProfile(slug);
  const { user } = useAuthUser();

  const athlete = row?.athletes;
  const { data: results } = usePublicRaceResults(athlete?.id);
  const { data: goal } = usePublicGoal(athlete?.id);
  const manualAdded = row?.training_partners_added ?? [];
  const hiddenIds = row?.training_partners_hidden_ids ?? [];
  const { data: trainingPartners } = useTrainingPartners(athlete?.id, manualAdded, hiddenIds);
  const { data: blogPosts } = usePublicBlogPosts(athlete?.id);
  const { data: isCoachViewer } = useIsOwnerPreview(athlete?.id, athlete?.user_id, user?.id);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (error || !row || !athlete) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Athlete not found.
      </div>
    );
  }

  const config = athleteRowToConfig(row, athlete, {
    personalBests: results?.personalBests ?? [],
    recentResults: results?.recentResults ?? [],
    goal: goal ?? null,
    trainingPartners: trainingPartners ?? [],
    blogPosts: blogPosts ?? [],
  }) ?? defaultAthleteConfig;

  const isOwnerPreview = !!user && (user.id === athlete.user_id || !!isCoachViewer);

  return <AthleteProfilePage config={config} isOwnerPreview={isOwnerPreview} />;
}
