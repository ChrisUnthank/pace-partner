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

// Explicit-units-param versions of the *Fmt functions in format.ts — for
// call sites that already have a resolved Units value in hand (e.g. from
// a query result) rather than needing to re-read localStorage each time.
// format.ts's paceFmt/metersFmt/speedFmt/elevationFmt/tempFmt are the
// ones actually used across the app's 30+ display call sites; these do
// the identical conversion math and must be kept in sync if either side
// changes.

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

export function speedToDisplay(kmh?: number | null, units: Units = getStoredUnits()): string {
  if (kmh == null || !Number.isFinite(kmh)) return "—";
  if (units === "imperial") return `${(kmh / 1.609344).toFixed(1)} mph`;
  return `${kmh.toFixed(1)} km/h`;
}

export function elevationToDisplay(m?: number | null, units: Units = getStoredUnits()): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (units === "imperial") return `${Math.round(m * 3.28084)} ft`;
  return `${Math.round(m)} m`;
}

export function tempToDisplay(c?: number | null, units: Units = getStoredUnits()): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (units === "imperial") return `${Math.round((c * 9) / 5 + 32)}°F`;
  return `${c.toFixed(1)}°C`;
}
