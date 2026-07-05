import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Trophy, Heart } from "lucide-react";
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
  const [localAdjustments, setLocalAdjustments] = useState<any[]>([]);
  const { data: session } = useQuery({
    queryKey: ["session", race?.session_id],
    enabled: !!race?.session_id,
    queryFn: async () => {
      if (!race?.session_id) return null;

      const { data, error } = await supabase.from("sessions").select("*").eq("id", race.session_id).single();

      if (error) throw error;

      return data as any;
    },
  });
  useEffect(() => {
    setLocalAdjustments(session?.distance_adjustments ?? []);
  }, [session?.distance_adjustments]);

  function smoothHrSeries(series: number[], windowSize = 5) {
    if (!series || series.length === 0) return series;

    const result: number[] = [];

    for (let i = 0; i < series.length; i++) {
      let sum = 0;
      let count = 0;

      for (let j = i - Math.floor(windowSize / 2); j <= i + Math.floor(windowSize / 2); j++) {
        if (j >= 0 && j < series.length) {
          sum += series[j];
          count++;
        }
      }

      result.push(sum / count);
    }

    return result;
  }
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

  const adjustedDistance = (session?.total_distance_m ?? 0) + (session?.distance_adjustment_m ?? 0);

  const avgPace = adjustedDistance && race?.time_seconds ? (race.time_seconds / adjustedDistance) * 1000 : null;

  // ✅ Determine split type FIRST
  const isTrackRace = race?.race_type === "track";
  const splitDistance = isTrackRace ? 400 : 1000;

  // ✅ Build splits
  const autoSplits = useMemo(() => {
    if (!rawPoints || rawPoints.length === 0 || !race) return [];
    if (!session) return [];

    // ✅ ✅ ONLY USE GPS DISTANCE
    const adjustedDistance = session?.total_distance_m ?? 0;

    const splits: Array<{ km: number; time: number; isPartial?: boolean }> = [];

    let nextDistanceMark = splitDistance;

    // ✅ MAIN LOOP — build full splits
    for (let i = 1; i < rawPoints.length; i++) {
      const prev = rawPoints[i - 1];
      const curr = rawPoints[i];

      if (prev?.distance_m == null || curr?.distance_m == null || prev?.elapsed_s == null || curr?.elapsed_s == null)
        continue;

      if (prev.distance_m < nextDistanceMark && curr.distance_m >= nextDistanceMark) {
        const distanceDiff = curr.distance_m - prev.distance_m;
        const timeDiff = curr.elapsed_s - prev.elapsed_s;

        const ratio = distanceDiff > 0 ? (nextDistanceMark - prev.distance_m) / distanceDiff : 0;

        const interpolatedTime = prev.elapsed_s + ratio * timeDiff;

        splits.push({
          km: splits.length + 1,
          time: interpolatedTime,
        });

        nextDistanceMark += splitDistance;
      }
    }

    // ✅ ✅ PARTIAL SPLIT USING TRUE (GPS) DISTANCE
    const coveredDistance = splits.length * splitDistance;

    if (adjustedDistance > coveredDistance) {
      const remaining = adjustedDistance - coveredDistance;

      if (remaining > splitDistance * 0.2) {
        const finalPoint = rawPoints[rawPoints.length - 1];

        splits.push({
          km: splits.length + 1,
          time: finalPoint?.elapsed_s ?? 0,
          isPartial: true,
        });
      }
    }

    // ✅ PROCESS SPLITS (HR + CLEAN ADJUSTMENTS)
    return splits.map((s, i) => {
      const prevTime = i === 0 ? 0 : splits[i - 1].time;

      const startDistance = i * splitDistance;
      const endDistance = (i + 1) * splitDistance;

      const pointsInSplit = rawPoints.filter(
        (p) => p.distance_m != null && p.hr != null && p.distance_m >= startDistance && p.distance_m < endDistance,
      );

      let avgHr: number | null = null;

      const hrSeries = pointsInSplit.map((p) => p.hr).filter((hr): hr is number => hr != null);

      if (pointsInSplit.length > 0) {
        const total = pointsInSplit.reduce((sum, p) => sum + (p.hr ?? 0), 0);

        avgHr = total / pointsInSplit.length;
      }

      // ✅ ✅ CORRECT SPLIT-LEVEL ADJUSTMENTS (ONLY SYSTEM NOW)
      const baseDistance = race?.distance_m ?? 1;

      const avgPacePerMeter = baseDistance > 0 ? (race?.time_seconds ?? 0) / baseDistance : 0;

      let adjustedTime = s.time;

      const splitAdjustments = session?.distance_adjustments ?? [];

      for (const adj of splitAdjustments) {
        if (Number(adj.split_km) === Number(s.km)) {
          adjustedTime += adj.meters * avgPacePerMeter;
        }
      }

      return {
        km: s.km,
        time: adjustedTime - prevTime,
        avgHr,
        hrSeries,
        isPartial: (s as any).isPartial,
      };
    });
  }, [rawPoints, splitDistance, race, session]);

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

    const firstSplit = times[0];
    const secondSplit = times[1];

    // ✅ detect unreliable first split (GPS lag / HR lag)
    const unreliableStart =
      firstSplit > secondSplit + 8 ||
      (autoSplits[0]?.avgHr != null && autoSplits[1]?.avgHr != null && autoSplits[0].avgHr < autoSplits[1].avgHr - 15);

    // ✅ only exclude first split if unreliable
    const validTimes = unreliableStart ? times.slice(1) : times;

    const overallAvg = avg(validTimes);

    // ✅ 1. Start analysis
    let startInsight = null;

    if (!unreliableStart) {
      const startDiff = firstSplit - overallAvg;

      if (startDiff < -3) {
        startInsight = "⚠️ Went out too fast";
      } else if (Math.abs(startDiff) <= 2) {
        startInsight = "✅ Controlled start";
      }
    }

    // ✅ 2. Severe fade detection (matches your RED bars)

    const lastTwo = validTimes.slice(-2);
    const lastAvg = avg(lastTwo);

    const severeFade = lastAvg - overallAvg > 8;

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
      <div className="space-y-6 max-w-6xl">
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

            {/* ✅ GPS summary (keep this first) */}
            {session?.distance_adjustment_m > 0 && (
              <div className="col-span-3">
                <p className="text-xs text-muted-foreground">
                  GPS: {metersFmt(session.total_distance_m)} · Adjusted:{" "}
                  {metersFmt((session.total_distance_m ?? 0) + (session.distance_adjustment_m ?? 0))}
                  (+{session.distance_adjustment_m}m, {session.distance_adjustment_mode})
                </p>
              </div>
            )}

            {/* ✅ ✅ SPLIT CORRECTIONS (PROPERLY SEPARATED) */}
            <div className="col-span-3 border-t pt-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Split corrections</Label>

              {localAdjustments.map((adj: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Km"
                    className="w-16"
                    value={adj.split_km ?? ""}
                    onChange={(e) => {
                      const updated = [...localAdjustments];
                      updated[i].split_km = e.target.value === "" ? "" : Number(e.target.value);
                      setLocalAdjustments(updated);
                    }}
                    onBlur={async () => {
                      await supabase
                        .from("sessions")
                        .update({ distance_adjustments: localAdjustments })
                        .eq("id", session.id);
                    }}
                  />

                  <Input
                    type="number"
                    placeholder="+m"
                    className="w-20"
                    value={adj.meters ?? ""}
                    onChange={(e) => {
                      const updated = [...localAdjustments];
                      updated[i].meters = e.target.value === "" ? "" : Number(e.target.value);
                      setLocalAdjustments(updated);
                    }}
                    onBlur={async () => {
                      await supabase
                        .from("sessions")
                        .update({ distance_adjustments: localAdjustments })
                        .eq("id", session.id);
                    }}
                  />

                  <span className="text-xs text-muted-foreground">m</span>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const updated = localAdjustments.filter((_: any, idx: number) => idx !== i);

                      setLocalAdjustments(updated);

                      await supabase.from("sessions").update({ distance_adjustments: updated }).eq("id", session.id);
                    }}
                  >
                    ✕
                  </Button>
                </div>
              ))}

              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const updated = [...localAdjustments, { split_km: "", meters: "" }];

                  setLocalAdjustments(updated);

                  await supabase.from("sessions").update({ distance_adjustments: updated }).eq("id", session.id);
                }}
              >
                + Add correction
              </Button>
            </div>
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

                  const range = max - min;

                  if (range > 0) {
                    width = ((s.time - min) / range) * 100;
                  } else {
                    width = 100;
                  }

                  // ✅ prevent tiny invisible bars
                  width = Math.max(width, 8);
                }

                // ✅ colour logic (unchanged but cleaner block)
                let color = "bg-blue-500";

                if (adjustedDistance && race?.time_seconds) {
                  const avgPace = (race.time_seconds / adjustedDistance) * 1000;
                  const targetSplitTime = (avgPace / 1000) * splitDistance;

                  const diff = s.time - targetSplitTime;

                  if (Math.abs(diff) <= 2) {
                    color = "bg-green-500";
                  } else if (diff < -2) {
                    color = "bg-blue-500";
                  } else if (diff > 2 && diff <= 5) {
                    color = "bg-yellow-400";
                  } else if (diff > 5 && diff <= 10) {
                    color = "bg-orange-500";
                  } else if (diff > 10) {
                    color = "bg-red-500";
                  }
                }

                // ✅ PRECOMPUTE HR SERIES ONCE (IMPORTANT)
                const hasHrSeries = Array.isArray(s.hrSeries) && s.hrSeries.length >= 5;

                const smoothed = hasHrSeries ? smoothHrSeries(s.hrSeries, 3) : [];

                const points = hasHrSeries
                  ? smoothed
                      .map((hr, i) => {
                        const x = (i / (smoothed.length - 1)) * 100;

                        const minHr = 120;
                        const maxHr = 190;

                        const y = 100 - ((hr - minHr) / (maxHr - minHr)) * 100;

                        return `${x},${y}`;
                      })
                      .join(" ")
                  : undefined;

                return (
                  <div key={s.km} className="space-y-1">
                    {/* ✅ label row */}
                    <div className="flex justify-between text-xs border rounded px-2 py-1">
                      <span className="text-muted-foreground">
                        {(s as any).isPartial ? `Km ${s.km} (partial)` : isTrackRace ? `Lap ${s.km}` : `Km ${s.km}`}
                      </span>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-blue-400">{s.avgHr ? `${Math.round(s.avgHr)} bpm` : "--"}</span>

                        <span className="font-medium flex items-center gap-1">
                          {secToClock(s.time)}
                          {(session?.distance_adjustment_m ?? 0) !== 0 && (
                            <span
                              className="text-[10px] text-muted-foreground"
                              title="Time adjusted due to distance correction"
                            >
                              *
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* ✅ BAR + HR */}
                    <div className="relative h-6 bg-gray-800 rounded overflow-hidden">
                      {/* ✅ Pace bar */}
                      <div className={`absolute left-0 top-0 h-full rounded ${color}`} style={{ width: `${width}%` }} />

                      {/* ✅ HR LINE */}
                      {hasHrSeries ? (
                        <div
                          className="absolute left-0 top-0 h-full"
                          style={{ width: `${width}%`, overflow: "hidden" }}
                        >
                          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <>
                              {/* ✅ glow */}
                              <polyline
                                points={points}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth="5"
                                strokeOpacity="0.25"
                              />

                              {/* ✅ main line */}
                              <polyline
                                points={points}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth="3"
                                strokeOpacity="1"
                                strokeLinecap="round"
                              />
                            </>
                          </svg>
                        </div>
                      ) : s.avgHr ? (
                        <div
                          className="absolute top-1/2 -translate-y-1/2"
                          style={{
                            left: `${Math.min(Math.max((s.avgHr - 120) / (190 - 120), 0), 1) * 100}%`,
                          }}
                        >
                          <Heart className="h-3 w-3 text-[var(--accent-red)] fill-[var(--accent-red)]" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
                ``;
              })}

              {/* ✅ explanation */}
              {(session?.distance_adjustment_m ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  * Split times adjusted to account for GPS distance error
                </p>
              )}
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
