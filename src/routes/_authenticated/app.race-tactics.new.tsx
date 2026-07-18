import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronLeft, Flag } from "lucide-react";
import { clockToSec, secToClock } from "@/lib/format";
import { predictTime } from "@/lib/race-predict";
import { generateEvenSplits, splitIncrementOptions } from "@/lib/race-tactics-calc";

export const Route = createFileRoute("/_authenticated/app/race-tactics/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    athleteId: typeof search.athleteId === "string" ? search.athleteId : undefined,
  }),
  component: NewRaceTacticsPlan,
});

const RACE_TYPE_OPTIONS = [
  { value: "track", label: "Track" },
  { value: "road", label: "Road" },
  { value: "cross_country", label: "Cross Country" },
];

// A handful of common race distances to save typing — "Custom" reveals a
// plain number input for anything else (relay legs, non-standard trail
// distances, etc).
const DISTANCE_PRESETS = [
  { label: "800m", m: 800 },
  { label: "1500m", m: 1500 },
  { label: "1 Mile", m: 1609 },
  { label: "3000m", m: 3000 },
  { label: "5000m", m: 5000 },
  { label: "10,000m", m: 10000 },
  { label: "Half Marathon", m: 21097 },
  { label: "Marathon", m: 42195 },
  { label: "Custom", m: null as number | null },
];

function NewRaceTacticsPlan() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["race-tactics-roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase.from("coach_athletes").select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [athleteId, setAthleteId] = useState(search.athleteId ?? (isCoach ? "" : myAthlete?.id ?? ""));
  useEffect(() => {
    if (!athleteId && !isCoach && myAthlete?.id) setAthleteId(myAthlete.id);
  }, [isCoach, myAthlete, athleteId]);

  const [eventName, setEventName] = useState("");
  const [raceType, setRaceType] = useState("track");
  const [distancePreset, setDistancePreset] = useState("1500");
  const [customDistance, setCustomDistance] = useState("1500");
  const [raceDate, setRaceDate] = useState("");
  const [goalTimeInput, setGoalTimeInput] = useState("");
  const [currentPbInput, setCurrentPbInput] = useState("");
  const [targetPbInput, setTargetPbInput] = useState("");
  const [splitIncrement, setSplitIncrement] = useState(300);
  const [temperature, setTemperature] = useState("");
  const [wind, setWind] = useState("");
  const [weather, setWeather] = useState("");
  const [surface, setSurface] = useState("");
  const [saving, setSaving] = useState(false);

  const raceDistanceM = useMemo(() => {
    const preset = DISTANCE_PRESETS.find((d) => String(d.m) === distancePreset);
    if (preset?.m != null) return preset.m;
    const n = Number(customDistance);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }, [distancePreset, customDistance]);

  const incrementOptions = useMemo(() => splitIncrementOptions(raceType), [raceType]);
  useEffect(() => {
    // Keep the selected increment valid whenever race type changes (track
    // vs road/XC have different allowed increment lists), and default to
    // the largest increment that still produces at least 2 splits.
    if (!incrementOptions.includes(splitIncrement)) {
      const fit = [...incrementOptions].reverse().find((inc) => inc < raceDistanceM) ?? incrementOptions[0];
      setSplitIncrement(fit);
    }
  }, [incrementOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-suggests Current PB from real logged performances at (close to)
  // this exact distance, and — if a goal time hasn't been typed yet —
  // suggests a goal time via the same Riegel prediction already used by
  // the Pace/Race Predictor calculator, rather than a second formula.
  const { data: nearestPb } = useQuery({
    queryKey: ["race-tactics-nearest-pb", athleteId, raceDistanceM],
    enabled: !!athleteId && raceDistanceM > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("distance_m, time_seconds")
        .eq("athlete_id", athleteId)
        .not("time_seconds", "is", null)
        .order("time_seconds", { ascending: true });
      if (!data || data.length === 0) return null;
      // Closest logged distance to the target race distance (by log-ratio,
      // matching the same distance-proximity logic app.compare.tsx uses
      // for its own race-calibration lookup).
      const nearest = data.reduce((best, r) => {
        const d = Math.abs(Math.log(Number(r.distance_m) / raceDistanceM));
        const bd = Math.abs(Math.log(Number(best.distance_m) / raceDistanceM));
        return d < bd ? r : best;
      }, data[0]);
      return nearest;
    },
  });

  useEffect(() => {
    if (!nearestPb || raceDistanceM <= 0) return;
    const predicted = predictTime(Number(nearestPb.time_seconds), Number(nearestPb.distance_m), raceDistanceM);
    if (!currentPbInput) setCurrentPbInput(secToClock(predicted));
    if (!goalTimeInput) setGoalTimeInput(secToClock(predicted));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearestPb, raceDistanceM]);

  async function save() {
    if (!athleteId) {
      toast.error("Choose an athlete");
      return;
    }
    if (!eventName.trim()) {
      toast.error("Enter an event name");
      return;
    }
    if (raceDistanceM <= 0) {
      toast.error("Enter a valid race distance");
      return;
    }
    const goalTimeSeconds = clockToSec(goalTimeInput);
    if (!goalTimeSeconds || goalTimeSeconds <= 0) {
      toast.error("Enter a goal time (mm:ss or h:mm:ss)");
      return;
    }

    const splits = generateEvenSplits(raceDistanceM, splitIncrement, goalTimeSeconds);
    const currentPbSeconds = currentPbInput ? clockToSec(currentPbInput) : null;
    const targetPbSeconds = targetPbInput ? clockToSec(targetPbInput) : null;
    const conditions =
      temperature || wind || weather || surface
        ? { temperature_c: temperature || null, wind: wind || null, weather: weather || null, surface: surface || null }
        : null;

    setSaving(true);
    const { data, error } = await supabase
      .from("race_tactics_plans" as any)
      .insert({
        athlete_id: athleteId,
        event_name: eventName.trim(),
        race_type: raceType,
        race_distance_m: raceDistanceM,
        race_date: raceDate || null,
        goal_time_seconds: goalTimeSeconds,
        current_pb_seconds: currentPbSeconds,
        target_pb_seconds: targetPbSeconds,
        split_increment_m: splitIncrement,
        splits: splits as any,
        conditions: conditions as any,
        status: "draft",
      })
      .select("id")
      .single();
    setSaving(false);

    if (error || !data) {
      toast.error(error?.message ?? "Failed to create plan");
      return;
    }

    toast.success("Race plan created");
    navigate({ to: "/app/race-tactics/$planId", params: { planId: (data as any).id } });
  }

  return (
    <AppShell>
      <div className="space-y-4 max-w-2xl">
        <Button asChild variant="ghost" size="sm">
          <Link to="/app/race-tactics">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Race Tactics
          </Link>
        </Button>

        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-5 w-5 text-[var(--accent-red)]" />
          New race plan
        </h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Race details</CardTitle>
            <CardDescription>Splits are generated evenly from the goal time — edit any of them afterward.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isCoach && (
              <div>
                <Label className="text-xs">Athlete</Label>
                <Select value={athleteId} onValueChange={setAthleteId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose an athlete" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roster ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Event name</Label>
                <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Regional Championships" />
              </div>
              <div>
                <Label className="text-xs">Race date (optional)</Label>
                <Input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Race type</Label>
                <Select value={raceType} onValueChange={setRaceType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RACE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Distance</Label>
                <Select value={distancePreset} onValueChange={setDistancePreset}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISTANCE_PRESETS.map((d) => (
                      <SelectItem key={d.label} value={d.m != null ? String(d.m) : "custom"}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {distancePreset === "custom" && (
                  <Input
                    type="number"
                    className="mt-2"
                    value={customDistance}
                    onChange={(e) => setCustomDistance(e.target.value)}
                    placeholder="Distance in meters"
                  />
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Goal time (mm:ss)</Label>
                <Input value={goalTimeInput} onChange={(e) => setGoalTimeInput(e.target.value)} placeholder="4:00" />
              </div>
              <div>
                <Label className="text-xs">Current PB (optional)</Label>
                <Input value={currentPbInput} onChange={(e) => setCurrentPbInput(e.target.value)} placeholder="4:05" />
              </div>
              <div>
                <Label className="text-xs">Target PB (optional)</Label>
                <Input value={targetPbInput} onChange={(e) => setTargetPbInput(e.target.value)} placeholder="3:55" />
              </div>
            </div>
            {nearestPb && (
              <p className="text-xs text-muted-foreground">
                Current PB and Goal time were pre-filled from this athlete's logged {nearestPb.distance_m}m result via the
                same prediction the Pace Predictor calculator uses — adjust either freely.
              </p>
            )}

            <div>
              <Label className="text-xs">Split every</Label>
              <Select value={String(splitIncrement)} onValueChange={(v) => setSplitIncrement(Number(v))}>
                <SelectTrigger className="mt-1 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {incrementOptions.map((inc) => (
                    <SelectItem key={inc} value={String(inc)}>
                      {inc}m
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Conditions (optional)</Label>
              <div className="grid sm:grid-cols-4 gap-2 mt-1">
                <Input value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="Temp" />
                <Input value={wind} onChange={(e) => setWind(e.target.value)} placeholder="Wind" />
                <Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="Weather" />
                <Input value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="Surface" />
              </div>
            </div>

            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Creating…" : "Create plan"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
