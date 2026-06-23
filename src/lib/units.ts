import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";

export type Units = "metric" | "imperial";

const LS_KEY = "strider:units";

export function getStoredUnits(): Units {
  if (typeof window === "undefined") return "metric";
  const v = window.localStorage.getItem(LS_KEY);
  return v === "imperial" ? "imperial" : "metric";
}
export function setStoredUnits(u: Units) {
  if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, u);
}

export function useMyProfile() {
  const { user } = useAuthUser();
  return useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, units, timezone, full_name, email")
        .eq("id", user!.id)
        .maybeSingle();
      if (data?.units) setStoredUnits(data.units as Units);
      return data;
    },
  });
}

export function metersToDisplay(m?: number | null, units: Units = getStoredUnits()): string {
  if (m == null) return "—";
  if (units === "imperial") {
    const miles = m / 1609.344;
    if (miles >= 0.1) return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
    return `${Math.round(m * 1.09361)} yd`;
  }
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km`;
  return `${Math.round(m)} m`;
}

export function paceToDisplay(secPerKm?: number | null, units: Units = getStoredUnits()): string {
  if (!secPerKm) return "—";
  const secPerUnit = units === "imperial" ? secPerKm * 1.609344 : secPerKm;
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${units === "imperial" ? "mi" : "km"}`;
}