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

export type AppRole = "coach" | "athlete" | "manager" | "admin";

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