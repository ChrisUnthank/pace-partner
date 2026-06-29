import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock, clockToSec, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Trophy } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/app/races")({
  component: RacesPage,
});

const COMMON_DISTANCES = [
  { m: 800, label: "800m" },
  { m: 1500, label: "1500m" },
  { m: 1609, label: "Mile" },
  { m: 3000, label: "3000m" },
  { m: 5000, label: "5000m" },
  { m: 10000, label: "10K" },
  { m: 21097, label: "Half marathon" },
  { m: 42195, label: "Marathon" },
];

function RacesPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const { data: roster } = useQuery({
    queryKey: ["races-roster", user?.id, isCoach],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athletes(id, name)").eq("coach_user_id", user!.id);

      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [athleteId, setAthleteId] = useState<string>("");
  const activeAthleteId = athleteId || myAthlete?.id || "";

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[var(--accent-red)]" />
          <h1 className="text-2xl font-bold">Race results</h1>
        </div>

        {isCoach && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Athlete</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={activeAthleteId} onValueChange={setAthleteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick athlete" />
                </SelectTrigger>
                <SelectContent>
                  {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                  {(roster ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {activeAthleteId ? (
          <RaceList athleteId={activeAthleteId} />
        ) : (
          <p className="text-sm text-muted-foreground">Pick an athlete to view race results.</p>
        )}
      </div>
    </AppShell>
  );
}

function RaceList({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [scrollY, setScrollY] = useState(0);
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions-for-races", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, session_date, total_distance_m, total_time_seconds")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null);

      return data ?? [];
    },
  });
  function findMatchingSession(r: any) {
    return sessions.find((s: any) => {
      // Must match date
      if (s.session_date !== r.performance_date) return false;

      // Must be reasonably close distance (allow small GPS variation)
      const distDiff = Math.abs(Number(s.total_distance_m || 0) - Number(r.distance_m || 0));

      // Must be reasonably close time (±10s tolerance)
      const timeDiff = Math.abs(Number(s.total_time_seconds || 0) - Number(r.time_seconds || 0));

      return distDiff < 50 && timeDiff < 10;
    });
  }
  const { data: races } = useQuery({
    queryKey: ["races", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("performance_date", { ascending: false });

      return data ?? [];
    },
  });

  useEffect(() => {
    if (scrollY > 0) {
      window.scrollTo({ top: scrollY });
    }
  }, [races]);

  const [date, setDate] = useState(todayISO());
  const [distance, setDistance] = useState<number>(5000);
  const [distanceMode, setDistanceMode] = useState<"preset" | "custom">("preset");
  const [customDistance, setCustomDistance] = useState<string>("");
  const [time, setTime] = useState("");
  const [event, setEvent] = useState("");
  const [placing, setPlacing] = useState("");
  const [notes, setNotes] = useState("");

  async function add() {
    setScrollY(window.scrollY);

    const sec = clockToSec(time);

    if (sec === null || sec === undefined || isNaN(sec)) {
      toast.error("Time required (mm:ss or h:mm:ss)");
      return;
    }

    const finalDistance = distanceMode === "custom" ? Number(customDistance) : distance;

    if (!finalDistance || isNaN(finalDistance) || finalDistance <= 0) {
      toast.error("Enter a valid distance in meters");
      return;
    }

    const { error } = await supabase.from("performances").insert({
      athlete_id: athleteId,
      performance_date: date,
      distance_m: finalDistance,
      time_seconds: sec,
      event_name: event || null,
      overall_place: placing ? Number(placing) : null,
      notes: notes || null,
      is_pb: false,
      context: "race",
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Race added");
    setTime("");
    setEvent("");
    setPlacing("");
    setNotes("");

    qc.invalidateQueries({ queryKey: ["races", athleteId] });
    qc.invalidateQueries({ queryKey: ["my-pbs", athleteId] });
  }

  async function remove(id: string) {
    setScrollY(window.scrollY);

    const { error } = await supabase.from("performances").delete().eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    qc.invalidateQueries({ queryKey: ["races", athleteId] });
  }

  // PB per distance
  const pbByDist = new Map<number, number>();
  for (const r of races ?? []) {
    const cur = pbByDist.get(r.distance_m);
    if (cur == null || r.time_seconds < cur) {
      pbByDist.set(r.distance_m, r.time_seconds);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>Race results and personal bests</CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {!races?.length ? (
            <p className="p-6 text-sm text-muted-foreground">No races yet.</p>
          ) : (
            <div className="divide-y">
              {races.map((r: any) => {
                const isPb = pbByDist.get(r.distance_m) === r.time_seconds;

                return (
                  <div
  key={r.id}
  className="flex items-center justify-between px-4 py-3 gap-3 hover:bg-muted/30 transition"
>
  {/* LEFT SIDE */}
  <div className="min-w-0">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-semibold">
        {metersFmt(r.distance_m)}
      </span>

      <span className="tabular-nums text-base font-medium">
        {secToClock(r.time_seconds)}
      </span>

      {/* ✅ PB BADGE */}
      {isPb && (
        <Badge className="bg-emerald-600 text-white">PB</Badge>
      )}
    </div>

    <div className="text-xs text-muted-foreground truncate mt-0.5">
      {r.performance_date}
      {r.event_name ? ` · ${r.event_name}` : ""}
      {r.overall_place ? ` · ${r.overall_place}` : ""}
    </div>
  </div>

  {/* RIGHT SIDE */}
  <div className="flex items-center gap-2 shrink-0">
    {(() => {
      const match = findMatchingSession(r);

      if (!match) {
        return (
          <Button size="sm" variant="outline" disabled>
            Analysis
          </Button>
        );
      }

      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            (window.location.href = `/app/sessions/${match.id}/analysis`)
          }
        >
          Analysis
        </Button>
      );
    })()}

    <Button
      variant="ghost"
      size="sm"
      onClick={() => remove(r.id)}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
</div>

                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add race (manual)</CardTitle>

          <CardDescription>
            Manual entry for races without GPS or historical results. Races will feed PBs and the physiological profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-6 gap-2 opacity-90">
          <div className="sm:col-span-2">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="sm:col-span-2 space-y-2">
            <Label className="text-xs">Distance</Label>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={distanceMode === "preset" ? "default" : "outline"}
                onClick={() => setDistanceMode("preset")}
              >
                Preset
              </Button>

              <Button
                type="button"
                size="sm"
                variant={distanceMode === "custom" ? "default" : "outline"}
                onClick={() => setDistanceMode("custom")}
              >
                Custom
              </Button>
            </div>

            {/* Preset dropdown */}
            {distanceMode === "preset" ? (
              <Select value={String(distance)} onValueChange={(v) => setDistance(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_DISTANCES.map((d) => (
                    <SelectItem key={d.m} value={String(d.m)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              // Custom input
              <Input
                type="number"
                placeholder="e.g. 7400"
                value={customDistance}
                onChange={(e) => setCustomDistance(e.target.value)}
              />
            )}
          </div>

          <div className="sm:col-span-2">
            <Label className="text-xs">Time</Label>
            <Input placeholder="16:32" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div className="sm:col-span-3">
            <Label className="text-xs">Event name</Label>
            <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="London Champs 5000m" />
          </div>

          <div className="sm:col-span-1">
            <Label className="text-xs">Placing</Label>
            <Input type="number" value={placing} onChange={(e) => setPlacing(e.target.value)} placeholder="Optional" />
          </div>

          <div className="sm:col-span-6">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="sm:col-span-6">
            <Button onClick={add}>Add race</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
