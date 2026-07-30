import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, useId } from "react";
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
import { MapContainer, TileLayer, Polyline, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { RouteFlyoverMap } from "@/components/route-flyover-map";
import { useMyRoles } from "@/lib/use-auth";
import { AthleteSubnav } from "@/components/athlete-subnav";

export const Route = createFileRoute("/_authenticated/app/races/$raceId/analysis")({
  component: RaceAnalysisPage,
});

type Split = { id: string; distance: string; time: string };

function newSplit(): Split {
  return { id: crypto.randomUUID(), distance: "", time: "" };
}

function RaceAnalysisPage() {
  const { raceId } = Route.useParams();

  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

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

  // HR zone boundaries for this athlete — used to color the replay marker
  // by effort zone rather than a flat color, and to label the live zone in
  // the HUD readout.
  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", race?.athlete_id],
    enabled: !!race?.athlete_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_zone_profiles")
        .select("hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max, hr_z6_max")
        .eq("athlete_id", race.athlete_id)
        .maybeSingle();

      if (error) throw error;
      return data as any;
    },
  });

  // Zips lat/lng/elevation back onto the reconstructed (dropout/spike-
  // corrected) points for the replay map — reconstructTrack() sorts
  // rawPoints by elapsed_s internally and returns a 1:1 mapped array, so
  // re-sorting rawPoints the same way here keeps both arrays index-aligned.
  const replayPoints = useMemo(() => {
    const sorted = [...rawPoints].sort((a: any, b: any) => a.elapsed_s - b.elapsed_s);
    return reconstruction.points.map((rp, i) => ({
      lat: Number(sorted[i]?.lat),
      lng: Number(sorted[i]?.lng),
      elapsed_s: rp.elapsed_s,
      distance_m: rp.final_distance_m,
      hr: rp.hr ?? null,
      elev: sorted[i]?.elevation_m != null ? Number(sorted[i].elevation_m) : null,
    }));
  }, [rawPoints, reconstruction.points]);

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

  // Slowest *full* split's time — used to scale bar widths by relative pace
  // (slowest fills the bar, faster splits read visibly shorter). Kept
  // separate from partial splits, whose shorter raw time isn't a fair pace
  // comparison against a full km/lap.
  const fullSplitTimes = autoSplits.filter((s) => !s.isPartial).map((s) => s.time);
  const maxFullSplitTime = fullSplitTimes.length > 0 ? Math.max(...fullSplitTimes) : null;

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
        {isCoach && race.athlete_id && <AthleteSubnav athleteId={race.athlete_id} active="races" />}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2">
            <RaceMapPanel points={replayPoints} raceTimeSeconds={race?.time_seconds ?? null} zoneProfile={zoneProfile} />
          </div>

          {pacingInsight && (
            <div className="lg:col-span-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-base">Race Insights</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {pacingInsight.start && <p>{pacingInsight.start}</p>}

                  {pacingInsight.pacing && <p>{pacingInsight.pacing}</p>}

                  {pacingInsight.gps && <p className="text-xs text-muted-foreground">{pacingInsight.gps}</p>}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <ZoneGradientBar points={replayPoints} zoneProfile={zoneProfile} />

        {isFitRace ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Splits (Auto)</CardTitle>
              <CardDescription>Generated from FIT data, GPS-corrected</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {autoSplits.map((s) => {
                const splitOwnDistance = s.endDistanceM - s.startDistanceM;

                let width: number;
                if (s.isPartial) {
                  // Partial splits (e.g. a 400m tail on the finish) are sized
                  // by how much of a standard split they cover — comparing
                  // their shorter raw time to full splits wouldn't be a fair
                  // pace comparison.
                  width = splitDistance > 0 ? (splitOwnDistance / splitDistance) * 100 : 100;
                } else {
                  // Full splits are sized by pace relative to the *slowest*
                  // full split in the race — the slowest km fills the bar,
                  // faster splits read visibly shorter, so a glance shows
                  // where the race was toughest instead of every full split
                  // looking identical regardless of how fast it was run.
                  width = maxFullSplitTime && maxFullSplitTime > 0 ? (s.time / maxFullSplitTime) * 100 : 100;
                }
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

const SPEED_OPTIONS = [1, 2, 4] as const;

// Matches the zone colors used on the session Analysis page's ZonePanel,
// so a coach reads "red dot" the same way across both pages.
const ZONE_COLORS: Record<string, string> = {
  z1: "#34d399",
  z2: "#38bdf8",
  z3: "#fbbf24",
  z4: "#f97316",
  z5: "#ef4444",
  z6: "#9333ea",
};

const ZONE_LABELS: Record<string, string> = {
  z1: "Z1 Recovery",
  z2: "Z2 Easy/Aerobic",
  z3: "Z3 Steady/Tempo",
  z4: "Z4 Threshold",
  z5: "Z5 VO2",
  z6: "Z6 Anaerobic/Max",
};

type ZoneProfile = {
  hr_z1_max: number | null;
  hr_z2_max: number | null;
  hr_z3_max: number | null;
  hr_z4_max: number | null;
  hr_z5_max: number | null;
  hr_z6_max: number | null;
} | null | undefined;

function hrToZone(hr: number | null, profile: ZoneProfile): string | null {
  if (hr == null || !profile?.hr_z1_max) return null;
  if (hr <= profile.hr_z1_max) return "z1";
  if (profile.hr_z2_max != null && hr <= profile.hr_z2_max) return "z2";
  if (profile.hr_z3_max != null && hr <= profile.hr_z3_max) return "z3";
  if (profile.hr_z4_max != null && hr <= profile.hr_z4_max) return "z4";
  if (profile.hr_z5_max != null && hr <= profile.hr_z5_max) return "z5";
  return "z6";
}

function RaceMapPanel({
  points,
  raceTimeSeconds,
  zoneProfile,
}: {
  points: { lat: number; lng: number; elapsed_s: number; distance_m: number; hr: number | null; elev: number | null }[];
  raceTimeSeconds: number | null;
  zoneProfile: ZoneProfile;
}) {
  const safePoints = useMemo(
    () =>
      points.filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng) &&
          (Math.abs(p.lat) > 0.01 || Math.abs(p.lng) > 0.01),
      ),
    [points],
  );

  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [use3D, setUse3D] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  // How much playback time has elapsed so far, preserved across pauses so
  // resuming continues from the same spot instead of jumping back to 0.
  const elapsedMsRef = useRef(0);

  // Race replay needs to take longer than the fixed ~18s session replay —
  // scaled to actual race duration so detail is visible, capped so a
  // marathon doesn't take forever, floored so a short race isn't a blink.
  // Speed buttons then divide this base down for a faster watch.
  const baseDurationMs = useMemo(() => {
    const raceSec = raceTimeSeconds ?? 300;
    return Math.min(60000, Math.max(20000, raceSec * 50));
  }, [raceTimeSeconds]);

  const playbackDurationMs = baseDurationMs / speed;

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Pausing (not finishing) resets the frame-timestamp anchor so the
      // next resume recomputes it from elapsedMsRef instead of using a
      // stale timestamp from before the pause.
      startTimeRef.current = null;
      return;
    }

    function step(timestamp: number) {
      if (startTimeRef.current === null) startTimeRef.current = timestamp - elapsedMsRef.current;
      const elapsed = timestamp - startTimeRef.current;
      elapsedMsRef.current = elapsed;
      const progress = Math.min(1, elapsed / playbackDurationMs);
      const idx = Math.floor(progress * (safePoints.length - 1));
      setPlayIndex(idx);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setPlaying(false);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, safePoints.length, playbackDurationMs]);

  if (safePoints.length < 2) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle>Race replay</CardTitle>
          <CardDescription>No GPS data available for this race</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lats = safePoints.map((p) => p.lat);
  const lngs = safePoints.map((p) => p.lng);
  const center: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];
  const positions: [number, number][] = safePoints.map((p) => [p.lat, p.lng]);
  const current = safePoints[playIndex] ?? safePoints[0];

  // Live pace from a rolling ±15s window around the marker, not raw
  // point-to-point (too noisy off GPS) and not average-so-far (too sluggish
  // to show a surge or fade as it happens).
  const windowSec = 15;
  let winStartIdx = safePoints.findIndex((p) => p.elapsed_s >= current.elapsed_s - windowSec);
  if (winStartIdx === -1) winStartIdx = 0;
  let winEndIdx = safePoints.length - 1;
  for (let i = playIndex; i < safePoints.length; i++) {
    if (safePoints[i].elapsed_s >= current.elapsed_s + windowSec) {
      winEndIdx = i;
      break;
    }
  }
  const dDist = safePoints[winEndIdx].distance_m - safePoints[winStartIdx].distance_m;
  const dTime = safePoints[winEndIdx].elapsed_s - safePoints[winStartIdx].elapsed_s;
  const livePaceSecPerKm = dDist > 0 && dTime > 0 ? (dTime / dDist) * 1000 : null;

  const currentZone = hrToZone(current.hr, zoneProfile);
  const markerColor = currentZone ? ZONE_COLORS[currentZone] : "#3b82f6";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle>Race replay</CardTitle>
            <CardDescription>Route with live HR/pace, from GPS trace</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-1 text-xs ${
                    speed === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant={use3D ? "default" : "outline"}
              onClick={() => setUse3D((v) => !v)}
            >
              {use3D ? "2D Map" : "3D Flyover"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                } else {
                  const finished = playIndex >= safePoints.length - 1;
                  if (finished) {
                    setPlayIndex(0);
                    elapsedMsRef.current = 0;
                  }
                  setPlaying(true);
                }
              }}
            >
              {playing ? "Pause" : playIndex > 0 && playIndex < safePoints.length - 1 ? "▶ Resume" : "▶ Replay"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2">
        {zoneProfile?.hr_z1_max != null && (
          <div className="flex flex-wrap gap-3 text-xs -mt-1">
            {(["z1", "z2", "z3", "z4", "z5", "z6"] as const).map((z) => (
              <div key={z} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z] }} />
                <span className="text-muted-foreground">{ZONE_LABELS[z]}</span>
              </div>
            ))}
          </div>
        )}
        {(playing || playIndex > 0) && (
          <div className="flex gap-4 text-sm border rounded-md px-3 py-2 bg-muted/40 flex-wrap">
            <div>
              <span className="text-muted-foreground">Elapsed: </span>
              <span className="tabular-nums font-medium">{secToClock(current.elapsed_s)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Distance: </span>
              <span className="tabular-nums font-medium">{metersFmt(current.distance_m)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Pace: </span>
              <span className="tabular-nums font-medium">
                {livePaceSecPerKm ? paceFmt(livePaceSecPerKm) : "—"}
              </span>
            </div>
            {current.elev != null && (
              <div>
                <span className="text-muted-foreground">Elev: </span>
                <span className="tabular-nums font-medium">{Math.round(current.elev)}m</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" style={{ color: markerColor }} />
              <span className="tabular-nums font-medium">{current.hr ?? "—"}</span>
              {currentZone && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: markerColor, color: "#0a0a0a" }}
                >
                  {ZONE_LABELS[currentZone]}
                </span>
              )}
            </div>
          </div>
        )}

        {use3D ? (
          <RouteFlyoverMap
            points={safePoints}
            heightPx={450}
            pointColor={(p) => {
              const zone = hrToZone(p.hr ?? null, zoneProfile);
              return zone ? ZONE_COLORS[zone] : "#FF004C";
            }}
          />
        ) : (
        <div className="rounded overflow-hidden border" style={{ height: 450 }}>
          <MapContainer
            center={center}
            zoom={15}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
            ref={(map) => {
              // Leaflet measures its container at mount time. Inside a flex
              // layout, that measurement can happen before the container has
              // settled into its final size, leaving the map permanently
              // stuck at a stale/zero size (tiles never repaint, even though
              // the outer div is the right size). Forcing a re-measure one
              // tick later fixes it without needing a fixed non-flex parent.
              if (map) {
                setTimeout(() => map.invalidateSize(), 0);
              }
            }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            <Polyline positions={positions} pathOptions={{ color: "#ef4444", weight: 4 }} />
            <CircleMarker
              center={positions[0]}
              radius={6}
              pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 1 }}
            />
            <CircleMarker
              center={positions[positions.length - 1]}
              radius={6}
              pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }}
            />
            {(playing || playIndex > 0) && (
              <CircleMarker
                center={[current.lat, current.lng]}
                radius={8}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: markerColor, fillOpacity: 1 }}
              />
            )}
          </MapContainer>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

// A gray fallback for stretches with no HR reading (GPS dropout, sensor
// lost contact, etc.) — keeps the bar honest instead of guessing a zone.
const NO_HR_COLOR = "#475569";

const GRADIENT_STOPS = 160;

function ZoneGradientBar({
  points,
  zoneProfile,
}: {
  points: { elapsed_s: number; distance_m: number; hr: number | null }[];
  zoneProfile: ZoneProfile;
}) {
  const [xMode, setXMode] = useState<"distance" | "time">("distance");
  const gradientId = useId();

  const sorted = useMemo(
    () => [...points].filter((p) => Number.isFinite(p.elapsed_s)).sort((a, b) => a.elapsed_s - b.elapsed_s),
    [points],
  );

  // Sampled at a fixed number of evenly-spaced stops (not one stop per raw
  // GPS point) so zone transitions render as a genuine gradient fade across
  // a few percent of the bar's width, rather than a near-instant jump
  // between two adjacent, closely-spaced stops.
  const stops = useMemo(() => {
    if (sorted.length < 2) return [];
    const total = xMode === "distance" ? sorted[sorted.length - 1].distance_m : sorted[sorted.length - 1].elapsed_s;
    if (!total) return [];

    const out: { offset: number; color: string }[] = [];
    let idx = 0;
    for (let i = 0; i < GRADIENT_STOPS; i++) {
      const frac = i / (GRADIENT_STOPS - 1);
      const target = frac * total;
      while (idx < sorted.length - 1 && (xMode === "distance" ? sorted[idx].distance_m : sorted[idx].elapsed_s) < target) {
        idx++;
      }
      const p = sorted[idx];
      const zone = hrToZone(p?.hr ?? null, zoneProfile);
      out.push({ offset: frac, color: zone ? ZONE_COLORS[zone] : NO_HR_COLOR });
    }
    return out;
  }, [sorted, xMode, zoneProfile]);

  if (stops.length === 0) {
    return null;
  }

  const totalDistance = sorted[sorted.length - 1].distance_m;
  const totalTime = sorted[sorted.length - 1].elapsed_s;
  const hasZoneData = zoneProfile?.hr_z1_max != null;

  const tickFracs = [0, 0.25, 0.5, 0.75, 1];
  const tickLabel = (frac: number) =>
    xMode === "distance" ? metersFmt(frac * totalDistance) : secToClock(frac * totalTime);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">Effort by zone</CardTitle>
            <CardDescription>HR zone across the race, faded between zones as effort shifts</CardDescription>
          </div>
          <div className="flex rounded-md border overflow-hidden">
            {(["distance", "time"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setXMode(m)}
                className={`px-2 py-1 text-xs capitalize ${
                  xMode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasZoneData && (
          <p className="text-xs text-muted-foreground mb-2">
            No HR zone thresholds set for this athlete — showing raw HR as gray until zones are configured.
          </p>
        )}

        <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="w-full h-10 rounded overflow-hidden">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {stops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="16" fill={`url(#${gradientId})`} />
        </svg>

        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          {tickFracs.map((f) => (
            <span key={f}>{tickLabel(f)}</span>
          ))}
        </div>

        {hasZoneData && (
          <div className="flex flex-wrap gap-3 text-xs mt-3">
            {(["z1", "z2", "z3", "z4", "z5", "z6"] as const).map((z) => (
              <div key={z} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z] }} />
                <span className="text-muted-foreground">{ZONE_LABELS[z]}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: NO_HR_COLOR }} />
              <span className="text-muted-foreground">No HR</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
