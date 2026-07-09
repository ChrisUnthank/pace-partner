import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Trophy, Heart, AlertTriangle } from "lucide-react";
import { metersFmt, secToClock, clockToSec, paceFmt } from "@/lib/format";
import { reconstructTrack, buildSplitsFromCorrectedPoints, smoothSeries } from "@/lib/gps-reconstruction";

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

  const { data: rawPoints = [] } = useQuery({
    queryKey: ["raw-points", race?.session_id],
    enabled: !!race?.session_id,

    queryFn: async () => {
      if (!race?.session_id) return [];

      // See app.sessions.$sessionId.analysis.tsx for why this paginates
      // instead of using a single big .limit() — Supabase's server-side
      // max-rows cap silently overrides any client limit above it, which
      // was cutting off the tail end of longer races (finish-line splits,
      // final kick) without any visible error.
      const PAGE_SIZE = 1000;
      const all: any[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("raw_session_points")
          .select("*")
          .eq("session_id", race.session_id)
          // Race analysis should only ever cover the race itself — if this
          // session also has an attached warmup or cooldown, their points
          // must not inflate the race's distance/pace/graphs.
          .eq("segment_type", "work")
          .order("elapsed_s")
          .range(from, from + PAGE_SIZE - 1);

        if (error || !data || data.length === 0) break;

        all.push(...data);

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      if (all.length === 0) return all;

      // The GPS reconstruction and splits-building logic assumes a race
      // recording starts at elapsed_s=0 / distance_m=0 — true before
      // multi-file merging existed, but these points now carry whatever
      // offset they had within the whole merged session (e.g. starting at
      // elapsed_s=2853 if there was a ~48min warmup before it). Without
      // rebasing, that offset gets misread as GPS drift/dropout, wildly
      // inflating "reconstructed distance" and corrupting split times.
      const baseElapsed = Number(all[0].elapsed_s ?? 0);
      const baseDistance = Number(all[0].distance_m ?? 0);

      return all.map((p) => ({
        ...p,
        elapsed_s: Number(p.elapsed_s ?? 0) - baseElapsed,
        distance_m: p.distance_m != null ? Number(p.distance_m) - baseDistance : p.distance_m,
      }));
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

  const officialDistance = race?.distance_m ?? null;

  // ✅ Core reconstruction — detects dropouts/spikes/jitter, estimates the
  // distance lost or gained in each, and (if an official distance is known)
  // reconciles the total against it using a start/finish/distributed anchor
  // depending on where the GPS error actually occurred. See
  // src/lib/gps-reconstruction.ts for the full algorithm + rationale.
  const reconstruction = useMemo(() => {
    return reconstructTrack(rawPoints as any, officialDistance);
  }, [rawPoints, officialDistance]);

  const reconstructedDistance = reconstruction.reconstructedTotalDistanceM ?? 0;

  // ✅ final adjusted distance (used everywhere) — official distance when known,
  // otherwise the reconstructed (dropout-corrected) distance, otherwise raw GPS total.
  const adjustedDistance = reconstruction.finalTotalDistanceM || session?.total_distance_m || 0;

  const avgPace = adjustedDistance && race?.time_seconds ? (race.time_seconds / adjustedDistance) * 1000 : null;

  // ✅ Determine split type FIRST
  const isTrackRace = race?.race_type === "track";
  const splitDistance = isTrackRace ? 400 : 1000;

  // ✅ Build splits directly from the corrected per-point distance series,
  // so split boundaries land on real distance marks (not raw GPS marks),
  // and any remaining distance is always kept as a final partial split.
  const autoSplits = useMemo(() => {
    if (!reconstruction.points.length || !race || !session) return [];

    const rawSplits = buildSplitsFromCorrectedPoints(reconstruction.points, splitDistance);
    const avgPacePerMeter = officialDistance && officialDistance > 0 ? (race?.time_seconds ?? 0) / officialDistance : 0;
    const splitAdjustments = session?.distance_adjustments ?? [];

    // ✅ Manual coach overrides (distance_adjustments) still apply on top of
    // the automatic reconstruction — e.g. for known issues the algorithm
    // can't infer from the track alone (course cut, watch paused, etc).
    return rawSplits.map((s) => {
      let durationS = s.durationS;

      for (const adj of splitAdjustments) {
        if (Number(adj.split_km) === Number(s.index)) {
          durationS += adj.meters * avgPacePerMeter;
        }
      }

      return {
        km: s.index,
        time: durationS,
        rawTime: s.rawDurationS,
        avgHr: s.avgHr,
        hrSeries: s.hrSeries,
        isPartial: s.isPartial,
        hasAnomaly: s.hasAnomaly,
        startDistanceM: s.startDistanceM,
        endDistanceM: s.endDistanceM,
      };
    });
  }, [reconstruction.points, splitDistance, race, session, officialDistance]);

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

    // ✅ An unreliable-first-split call is now grounded in the reconstruction
    // itself (did we actually detect a dropout/spike touching this split?)
    // rather than guessing from time/HR heuristics alone.
    const unreliableStart = autoSplits[0]?.hasAnomaly === true;

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
    } else {
      startInsight = "ℹ️ Start split affected by GPS acquisition — pacing there was estimated, not measured";
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

    // ✅ 3. GPS data quality
    let gpsInsight = null;

    if (rawPoints.length < 50) {
      gpsInsight = "⚠️ GPS data low resolution — splits less reliable";
    } else if (reconstruction.anomalies.length > 0) {
      const totalAdj = reconstruction.anomalies.reduce((sum, a) => sum + Math.abs(a.adjustmentM), 0);
      gpsInsight = `⚠️ ${reconstruction.anomalies.length} GPS anomal${
        reconstruction.anomalies.length === 1 ? "y" : "ies"
      } detected and corrected (~${Math.round(totalAdj)}m)`;
    }

    return {
      start: startInsight,
      pacing: pacingSummary,
      gps: gpsInsight,
    };
  }, [autoSplits, rawPoints, reconstruction.anomalies]);

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
        {race.session_id && (
          <Link
            to="/app/sessions/$sessionId"
            params={{ sessionId: race.session_id }}
            className="text-sm text-muted-foreground underline"
          >
            ← Back to session
          </Link>
        )}
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

            <div className="col-span-3">
              <p className="text-xs text-muted-foreground">
                GPS: {metersFmt((session as any)?.work_distance_m ?? session?.total_distance_m ?? 0)} ·
                Reconstructed: {metersFmt(reconstructedDistance)} · Official: {metersFmt(race?.distance_m ?? 0)}
                {reconstruction.anomalies.length > 0 && (
                  <>
                    {" "}
                    · Anchor: <span className="font-medium">{reconstruction.anchor}</span>
                  </>
                )}
              </p>
            </div>

            {/* ✅ Data quality panel — transparency into what was auto-corrected */}
            {reconstruction.anomalies.length > 0 && (
              <div className="col-span-3 border rounded p-2 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  GPS corrections applied
                </div>
                {reconstruction.anomalies.map((a, i) => (
                  <div key={i} className="text-xs text-muted-foreground flex justify-between">
                    <span>
                      {secToClock(a.startElapsed)}–{secToClock(a.endElapsed)} · {a.type}
                    </span>
                    <span className="tabular-nums">
                      {a.rawDeltaM.toFixed(0)}m → {a.correctedDeltaM.toFixed(0)}m ({a.adjustmentM >= 0 ? "+" : ""}
                      {a.adjustmentM.toFixed(0)}m)
                    </span>
                  </div>
                ))}
                {reconstruction.genericSmoothingM !== 0 && (
                  <div className="text-xs text-muted-foreground">
                    General GPS-vs-course smoothing: {reconstruction.genericSmoothingM >= 0 ? "+" : ""}
                    {reconstruction.genericSmoothingM.toFixed(0)}m distributed across the whole race
                  </div>
                )}
              </div>
            )}

            {/* ✅ ✅ SPLIT CORRECTIONS (PROPERLY SEPARATED) */}
            <div className="col-span-3 border-t pt-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Manual split corrections</Label>

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
              <CardDescription>Generated from FIT data, GPS-corrected</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {autoSplits.map((s) => {
                // Bar width represents this split's actual distance relative
                // to a standard full split — a 400m partial (out of a 1000m
                // standard) should visually read as ~40% width, not be sized
                // by comparing elapsed time across splits.
                const splitOwnDistance = s.endDistanceM - s.startDistanceM;
                let width = splitDistance > 0 ? (splitOwnDistance / splitDistance) * 100 : 100;
                width = Math.min(100, Math.max(width, 8)); // clamp, and keep tiny splits visible

                // ✅ colour logic — target time now scales to this split's actual
                // distance, so partial splits are graded fairly instead of always
                // reading as "fast" relative to a full-length target.
                let color = "bg-blue-500";

                if (avgPace && splitOwnDistance > 0) {
                  const targetSplitTime = (avgPace / 1000) * splitOwnDistance;

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

                const smoothed = hasHrSeries ? smoothSeries(s.hrSeries, 3) : [];

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
                      <span className="text-muted-foreground flex items-center gap-1">
                        {s.isPartial
                          ? `${isTrackRace ? "Lap" : "Km"} ${s.km} (partial, ${metersFmt(splitOwnDistance)})`
                          : isTrackRace
                            ? `Lap ${s.km}`
                            : `Km ${s.km}`}
                        {s.hasAnomaly && (
                          <AlertTriangle
                            className="h-3 w-3 text-amber-500"
                            aria-label="GPS-corrected within this split"
                          />
                        )}
                      </span>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-blue-400">{s.avgHr ? `${Math.round(s.avgHr)} bpm` : "--"}</span>

                        <span className="font-medium flex items-center gap-1">
                          {secToClock(s.time)}
                          {s.hasAnomaly && (
                            <span
                              className="text-[10px] text-muted-foreground"
                              title={`Raw GPS would have shown ${secToClock(s.rawTime)} here — adjusted due to a detected GPS dropout/spike in this split`}
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
              })}

              {/* ✅ explanation */}
              {((session?.distance_adjustments ?? []).length > 0 || reconstruction.anomalies.length > 0) && (
                <p className="text-xs text-muted-foreground mt-2">
                  * Splits marked here were adjusted using GPS dropout/spike correction or a manual override — see the
                  corrections panel above for details.
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
