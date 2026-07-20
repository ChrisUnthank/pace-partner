import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

export type AppRole = "coach" | "athlete" | "manager" | "admin" | "parent";

// Raw roles as stored in the database (used by the Profile role-management UI).
export function useMyRawRoles() {
  const { user } = useAuthUser();
  return useQuery({
    queryKey: ["my-raw-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}

// Effective roles for UI gating: "manager" implicitly grants "coach" access
// so existing roles.includes("coach") checks throughout the app work for managers.
export function useMyRoles() {
  const q = useMyRawRoles();
  const raw = q.data ?? [];
  const effective = raw.includes("manager") && !raw.includes("coach") ? [...raw, "coach" as AppRole] : raw;
  return { ...q, data: effective };
}

// Coach roster scoped to the current user:
//  - manager: every athlete in the system
//  - coach:   athletes linked via coach_athletes
// Returns rows shaped like { athlete_id, athletes: { id, name, primary_event } }
// so existing consumers can keep their current accessor shape.
export function useCoachRoster() {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const isCoach = rawRoles.includes("coach") || isManager;
  return useQuery({
    queryKey: ["coach-roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data, error } = await supabase
          .from("athletes")
          .select("id, name, primary_event")
          .order("name");
        if (error) throw error;
        return (data ?? []).map((a) => ({ athlete_id: a.id, athletes: a }));
      }
      const { data, error } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, primary_event)")
        .eq("coach_user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyAthlete() {
  const { user } = useAuthUser();
  return useQuery({
    queryKey: ["my-athlete", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athletes")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Athletes a parent/guardian is actively linked to, via parent_athlete_links.
// Powers the Parent Portal's child-switcher — a parent with more than one
// child on the roster needs to pick which one they're viewing.
// Returns rows shaped like { athlete_id, athletes: {...} } to match the
// existing useCoachRoster() accessor shape so shared UI can consume either.
export function useMyLinkedAthletes() {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isParent = rawRoles.includes("parent");
  return useQuery({
    queryKey: ["my-linked-athletes", user?.id],
    enabled: !!user && isParent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parent_athlete_links")
        .select("athlete_id, athletes(*)")
        .eq("parent_user_id", user!.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
}
