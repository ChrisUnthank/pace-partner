import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trophy, ArrowLeft } from "lucide-react";
import { metersFmt, secToClock } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/races/$raceId/")({
  component: RaceDetailPage,
});

function RaceDetailPage() {
  const { raceId } = Route.useParams();

  const { data: race, isLoading } = useQuery({
    queryKey: ["race", raceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("performances")
        .select("*")
        .eq("id", raceId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string;
        distance_m: number | null;
        time_seconds: number | null;
        event_name: string | null;
        performance_date: string | null;
        overall_place: number | null;
        notes: string | null;
      } | null;
    },
  });

  const avgPace =
    race?.distance_m && race?.time_seconds
      ? (race.time_seconds / race.distance_m) * 1000
      : null;

  function paceFmt(secPerKm: number | null) {
    if (!secPerKm) return "--";
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, "0")}/km`;
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[var(--accent-red)]" />
            <div>
              <h1 className="text-2xl font-bold">{race?.event_name || "Race"}</h1>
              {race?.performance_date && (
                <p className="text-sm text-muted-foreground">{race.performance_date}</p>
              )}
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/races">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !race ? (
          <p className="text-sm text-muted-foreground">Race not found.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
                <CardDescription>Race result overview</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Distance" value={metersFmt(race.distance_m)} />
                <Stat label="Time" value={secToClock(race.time_seconds)} />
                <Stat label="Avg pace" value={paceFmt(avgPace)} />
                <Stat
                  label="Placing"
                  value={race.overall_place ? String(race.overall_place) : "--"}
                />
              </CardContent>
            </Card>

            {race.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{race.notes}</p>
                </CardContent>
              </Card>
            )}

            <div>
              <Button asChild>
                <Link to="/app/races/$raceId/analysis" params={{ raceId }}>
                  Race Analysis
                </Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}