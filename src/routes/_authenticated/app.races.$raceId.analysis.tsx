import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Trophy } from "lucide-react";
import { metersFmt, secToClock, clockToSec, paceFmt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/races/$raceId/analysis")({
  component: RaceAnalysisPage,
});

type Split = { id: string; distance: string; time: string };

function newSplit(): Split {
  return { id: crypto.randomUUID(), distance: "", time: "" };
}

function RaceAnalysisPage() {
  const { raceId } = Route.useParams();

  const { data: race, isLoading } = useQuery({
    queryKey: ["race", raceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("performances").select("*").eq("id", raceId).maybeSingle();

      if (error) throw error;
      return data as any;
    },
  });

  const [splits, setSplits] = useState<Split[]>([newSplit()]);

  const { data: rawPoints = [] } = useQuery({
    queryKey: ["raw-points", race?.session_id],
    enabled: !!race?.session_id,

    queryFn: async () => {
      if (!race?.session_id) return [];

      const { data } = await supabase
        .from("raw_session_points")
        .select("*")
        .eq("session_id", race.session_id)
        .order("elapsed_s");

      return data ?? [];
    },
  });

  function update(id: string, patch: Partial<Split>) {
    setSplits((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function remove(id: string) {
    setSplits((s) => (s.length === 1 ? [newSplit()] : s.filter((x) => x.id !== id)));
  }

  function add() {
    setSplits((s) => [...s, newSplit()]);
  }

  const avgPace = race?.distance_m && race?.time_seconds ? (race.time_seconds / race.distance_m) * 1000 : null;

  // ✅ Determine split type FIRST
  const isTrackRace = race?.race_type === "track";
  const splitDistance = isTrackRace ? 400 : 1000;

  // ✅ Build splits
  const autoSplits = useMemo(() => {
    if (!rawPoints || rawPoints.length === 0 || !race) return [];

    const splits: Array<{ km: number; time: number }> = [];
    let nextDistanceMark = splitDistance;

    for (let i = 1; i < rawPoints.length; i++) {
      const prev = rawPoints[i - 1];
      const curr = rawPoints[i];

      if (prev?.distance_m == null || curr?.distance_m == null || prev?.elapsed_s == null || curr?.elapsed_s == null)
        continue;

      if (prev.distance_m < nextDistanceMark && curr.distance_m >= nextDistanceMark) {
        const distanceDiff = curr.distance_m - prev.distance_m;
        const timeDiff = curr.elapsed_s - prev.elapsed_s;

        const ratio = (nextDistanceMark - prev.distance_m) / distanceDiff;
        const interpolatedTime = prev.elapsed_s + ratio * timeDiff;

        splits.push({
          km: splits.length + 1,
          time: interpolatedTime,
        });

        nextDistanceMark += splitDistance;
      }
    }

    return splits.map((s, i) => {
      const prevTime = i === 0 ? 0 : splits[i - 1].time;

      const startDistance = i * splitDistance;
      const endDistance = (i + 1) * splitDistance;

      // ✅ get points within this split
      const pointsInSplit = rawPoints.filter(
        (p) => p.distance_m != null && p.hr != null && p.distance_m >= startDistance && p.distance_m < endDistance,
      );

      // ✅ calculate avg HR
      let avgHr: number | null = null;

      if (pointsInSplit.length > 0) {
        const total = pointsInSplit.reduce((sum, p) => sum + (p.hr ?? 0), 0);

        avgHr = total / pointsInSplit.length;
      }

      return {
        km: s.km,
        time: s.time - prevTime,
        avgHr,
      };
    });
  }, [rawPoints, splitDistance, race]);

  const isFitRace = autoSplits.length > 0;

  // ✅ Split range for bar scaling
  const splitTimes = autoSplits.map((s) => s.time);

  const maxSplit = splitTimes.length > 0 ? Math.max(...splitTimes) : null;
  const minSplit = splitTimes.length > 0 ? Math.min(...splitTimes) : null;

  // ✅ Combined race insight system
  const pacingInsight = useMemo(() => {
    if (!autoSplits || autoSplits.length < 2) return null;

    const times = autoSplits.map((s) => s.time);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const overallAvg = avg(times);
    const firstSplit = times[0];

    // ✅ 1. Start analysis
    const startDiff = firstSplit - overallAvg;
    let startInsight = null;

    if (startDiff < -3) {
      startInsight = "⚠️ Went out too fast";
    } else if (Math.abs(startDiff) <= 2) {
      startInsight = "✅ Controlled start";
    }

    // ✅ 2. Severe fade detection (matches your RED bars)
    const severeFade = times.some((t) => t - overallAvg > 10);
    let pacingSummary = null;

    if (severeFade) {
      pacingSummary = "🔴 Severe fade — major late race drop-off";
    } else {
      const halfway = Math.floor(times.length / 2);

      const firstHalf = times.slice(0, halfway);
      const secondHalf = times.slice(halfway);

      const firstAvg = avg(firstHalf);
      const secondAvg = avg(secondHalf);

      if (secondAvg < firstAvg * 0.98) {
        pacingSummary = "✅ Negative split — strong finish";
      } else if (secondAvg > firstAvg * 1.02) {
        pacingSummary = "⚠️ Fade — slowed in second half";
      } else {
        pacingSummary = "👍 Even pacing";
      }
    }

    // ✅ 3. GPS data quality (basic check for now)
    let gpsInsight = null;

    if (rawPoints.length < 50) {
      gpsInsight = "⚠️ GPS data low resolution — splits less reliable";
    }

    return {
      start: startInsight,
      pacing: pacingSummary,
      gps: gpsInsight,
    };
  }, [autoSplits, rawPoints]);

  if (isLoading) {
    return (
      <AppShell>
        <p>Loading race...</p>
      </AppShell>
    );
  }

  if (!race) {
    return (
      <AppShell>
        <p>Race not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[var(--accent-red)]" />
          <div>
            <h1 className="text-2xl font-bold">Race Analysis</h1>
            <p className="text-sm text-muted-foreground">
              {race.event_name || "Race"} · {race.performance_date}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Stat label="Distance" value={metersFmt(race.distance_m)} />
            <Stat label="Time" value={secToClock(race.time_seconds)} />
            <Stat label="Avg pace" value={paceFmt(avgPace)} />
          </CardContent>
        </Card>

        {pacingInsight && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Race Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {pacingInsight.start && <p>{pacingInsight.start}</p>}

              {pacingInsight.pacing && <p>{pacingInsight.pacing}</p>}

              {pacingInsight.gps && <p className="text-xs text-muted-foreground">{pacingInsight.gps}</p>}
            </CardContent>
          </Card>
        )}

        {isFitRace ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Splits (Auto)</CardTitle>
              <CardDescription>Generated from FIT data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {autoSplits.map((s) => {
                let width = 100;

                if (autoSplits.length > 1) {
                  const times = autoSplits.map((x) => x.time);
                  const max = Math.max(...times);
                  const min = Math.min(...times);

                  if (max !== min) {
                    width = ((max - s.time) / (max - min)) * 100;
                  }
                }

                let color = "bg-blue-500";

                if (race?.distance_m && race?.time_seconds) {
                  const avgPace = (race.time_seconds / race.distance_m) * 1000;
                  const targetSplitTime = (avgPace / 1000) * splitDistance;

                  const diff = s.time - targetSplitTime;

                  if (Math.abs(diff) <= 2) {
                    color = "bg-green-500"; // ✅ on pace
                  } else if (diff < -2) {
                    color = "bg-blue-500"; // ✅ faster
                  } else if (diff > 2 && diff <= 5) {
                    color = "bg-yellow-400"; // ✅ slightly slow
                  } else if (diff > 5 && diff <= 10) {
                    color = "bg-orange-500"; // ✅ moderate fade
                  } else if (diff > 10) {
                    color = "bg-red-500"; // 🔴 severe drop-off
                  }
                }

                return (
                  <div key={s.km} className="space-y-1">
                    {/* ✅ label + time */}
                    <div className="flex justify-between text-sm border rounded px-3 py-2">
                      <span className="text-muted-foreground">{isTrackRace ? `Lap ${s.km}` : `Km ${s.km}`}</span>

                      <div className="flex items-center gap-3">
                        {/* ✅ Placeholder for HR — will wire real data next */}
                        <span className="text-xs text-blue-400">{s.avgHr ? `${Math.round(s.avgHr)} bpm` : "--"}</span>

                        <span className="font-medium">{secToClock(s.time)}</span>
                      </div>
                    </div>

                    {/* ✅ coloured bar */}
                    <div className="relative h-2 bg-gray-200 rounded overflow-hidden">
                      {/* Pace bar */}
                      <div className={`absolute left-0 top-0 h-full rounded ${color}`} style={{ width: `${width}%` }} />

                      {/* HR marker */}
                      {s.avgHr && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--accent-red)] shadow"
                          style={{
                            left: `${Math.min(Math.max((s.avgHr - 120) / (190 - 120), 0), 1) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Splits</CardTitle>
              <CardDescription>Manual input</CardDescription>
            </CardHeader>
            <CardContent>
              <p>No FIT data available</p>
            </CardContent>
          </Card>
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
