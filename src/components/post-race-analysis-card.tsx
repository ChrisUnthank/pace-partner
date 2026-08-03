import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ClipboardCheck, Save, Link as LinkIcon, ExternalLink, Download } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { clockToSec, secToClock, paceFmt, metersFmt } from "@/lib/format";
import { averagePaceSecPerKm, interpolateActualSplitsFromGps, type SplitRow } from "@/lib/race-tactics-calc";
import { reconstructTrack } from "@/lib/gps-reconstruction";

// Phase 15 — Post-Race Analysis. Actual splits are entered against the
// plan's own existing split checkpoints (same cumulative_distance_m
// values already in the plan), so Planned vs Actual always compares like
// distances rather than needing a second independently-defined split
// schema. "Save to Performances" writes a real row into the athlete's
// permanent performance history — the same table Phase 2's performance
// curve reads from — so a completed race actually feeds forward into the
// rest of the athlete's profile, not just sitting inside this one plan.

export function PostRaceAnalysisCard({
  planId,
  athleteId,
  plan,
  plannedSplits,
}: {
  planId: string;
  athleteId: string;
  plan: any;
  plannedSplits: SplitRow[];
}) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const isSelf = myAthlete?.id === athleteId;
  const canEditShared = isCoach || isSelf;

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["post-race-analysis", planId],
    queryFn: async () => {
      const { data, error } = await supabase.from("race_tactics_post_race" as any).select("*").eq("plan_id", planId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: decisionPoints } = useQuery({
    queryKey: ["decision-points", planId],
    queryFn: async () => {
      const { data } = await supabase.from("race_tactics_decision_points" as any).select("*").eq("plan_id", planId).order("distance_m");
      return data ?? [];
    },
  });

  const [editingResults, setEditingResults] = useState(false);
  const [actualTimeInputs, setActualTimeInputs] = useState<string[]>([]);
  const [finishingPosition, setFinishingPosition] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [savingResults, setSavingResults] = useState(false);
  const [savingToPerformances, setSavingToPerformances] = useState(false);
  const [duplicateChoice, setDuplicateChoice] = useState<{
    existing: { id: string; performance_date: string; distance_m: number; time_seconds: number };
    finish: { cumulative_distance_m: number; cumulative_time_seconds: number };
  } | null>(null);

  // Candidate sessions to link this plan to — the athlete's own race-day
  // sessions (day_type = 'race', actually completed). Sorted so anything
  // dated the same as the plan's race_date surfaces first, since that's
  // overwhelmingly the one you want.
  const { data: candidateSessions } = useQuery({
    queryKey: ["race-session-candidates", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, session_date, total_distance_m, total_time_seconds")
        .eq("athlete_id", athleteId)
        .eq("day_type", "race")
        .not("completed_at", "is", null)
        .order("session_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  const sortedCandidates = useMemo(() => {
    return [...(candidateSessions ?? [])].sort((a, b) => {
      const aMatch = a.session_date === plan.race_date ? 0 : 1;
      const bMatch = b.session_date === plan.race_date ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [candidateSessions, plan.race_date]);

  const [linkingOpen, setLinkingOpen] = useState(false);
  const [pullingSplits, setPullingSplits] = useState(false);

  async function linkSession(sessionId: string) {
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ linked_session_id: sessionId === "none" ? null : sessionId })
      .eq("id", planId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLinkingOpen(false);
    toast.success(sessionId === "none" ? "Session unlinked" : "Linked to race session");
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  // Pulls real actual splits straight from the linked session's GPS
  // trace — same reconstruction pipeline (raw_session_points ->
  // reconstructTrack) the session's own Race Analysis page uses, just
  // interpolated at this plan's own checkpoint distances instead of a
  // fixed increment, so the result lines up with the existing Planned
  // vs Actual comparison below. Doesn't touch finishing_position or
  // decision_point_notes — only the splits themselves.
  async function pullSplitsFromSession() {
    if (!plan.linked_session_id) return;
    setPullingSplits(true);
    try {
      const PAGE_SIZE = 1000;
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("raw_session_points")
          .select("elapsed_s, distance_m")
          .eq("session_id", plan.linked_session_id)
          .eq("segment_type", "work")
          .order("elapsed_s")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      if (all.length < 2) {
        toast.error("That session has no GPS trace to pull splits from — enter actual results manually instead.");
        return;
      }

      const baseElapsed = Number(all[0].elapsed_s ?? 0);
      const baseDistance = Number(all[0].distance_m ?? 0);
      const rawPoints = all.map((p) => ({
        elapsed_s: Number(p.elapsed_s ?? 0) - baseElapsed,
        distance_m: p.distance_m != null ? Number(p.distance_m) - baseDistance : p.distance_m,
      }));

      const reconstruction = reconstructTrack(rawPoints, plan.race_distance_m);
      const targets = plannedSplits.map((ps) => ps.cumulative_distance_m);
      const pulled = interpolateActualSplitsFromGps(reconstruction.points, targets);

      if (pulled.length === 0) {
        toast.error("Couldn't match any checkpoint distances against that session's GPS trace.");
        return;
      }

      const { error: saveError } = await supabase.from("race_tactics_post_race" as any).upsert(
        {
          plan_id: planId,
          actual_splits: pulled as any,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "plan_id" },
      );
      if (saveError) throw saveError;

      toast.success(`Pulled ${pulled.length} of ${targets.length} checkpoint${targets.length === 1 ? "" : "s"} from the session's GPS data`);
      qc.invalidateQueries({ queryKey: ["post-race-analysis", planId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't pull splits from that session");
    } finally {
      setPullingSplits(false);
    }
  }

  const actualSplits: Array<{ cumulative_distance_m: number; cumulative_time_seconds: number }> = analysis?.actual_splits ?? [];
  const hasResults = actualSplits.length > 0;

  function startEditingResults() {
    setActualTimeInputs(
      plannedSplits.map((ps) => {
        const existing = actualSplits.find((a) => a.cumulative_distance_m === ps.cumulative_distance_m);
        return existing ? secToClock(existing.cumulative_time_seconds) : "";
      }),
    );
    setFinishingPosition(analysis?.finishing_position ?? "");
    setDecisionNotes(analysis?.decision_point_notes ?? {});
    setEditingResults(true);
  }

  async function saveResults() {
    const newActualSplits = plannedSplits
      .map((ps, i) => {
        const sec = clockToSec(actualTimeInputs[i] ?? "");
        return sec != null && sec > 0 ? { cumulative_distance_m: ps.cumulative_distance_m, cumulative_time_seconds: sec } : null;
      })
      .filter((s): s is { cumulative_distance_m: number; cumulative_time_seconds: number } => s != null);

    if (newActualSplits.length === 0) {
      toast.error("Enter at least one actual split time");
      return;
    }

    setSavingResults(true);
    const { error } = await supabase.from("race_tactics_post_race" as any).upsert(
      {
        plan_id: planId,
        actual_splits: newActualSplits as any,
        finishing_position: finishingPosition.trim() || null,
        decision_point_notes: decisionNotes as any,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "plan_id" },
    );
    setSavingResults(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Race results saved");
    setEditingResults(false);
    qc.invalidateQueries({ queryKey: ["post-race-analysis", planId] });
  }

  // A session marked "Race" (day_type = 'race') already auto-creates its
  // own performances row keyed by session_id — see createPerformanceRecord
  // in the session detail page. This button used to insert blindly with
  // no idea that row might already exist, which is exactly how a race
  // could end up counted twice in the athlete's PBs. Now it checks first
  // and, if found, asks rather than silently duplicating or silently
  // doing nothing.
  async function saveToPerformances() {
    if (actualSplits.length === 0) return;
    const finish = actualSplits.reduce((best, s) => (s.cumulative_distance_m > best.cumulative_distance_m ? s : best), actualSplits[0]);

    if (plan.linked_session_id) {
      const { data: existing } = await supabase
        .from("performances")
        .select("id, performance_date, distance_m, time_seconds")
        .eq("session_id", plan.linked_session_id)
        .maybeSingle();
      if (existing) {
        setDuplicateChoice({ existing: existing as any, finish });
        return;
      }
    }

    await insertNewPerformance(finish);
  }

  async function insertNewPerformance(finish: { cumulative_distance_m: number; cumulative_time_seconds: number }) {
    setSavingToPerformances(true);
    const { data: row, error } = await supabase
      .from("performances")
      .insert({
        athlete_id: athleteId,
        performance_date: plan.race_date ?? new Date().toISOString().slice(0, 10),
        distance_m: plan.race_distance_m,
        time_seconds: finish.cumulative_time_seconds,
        event_name: plan.event_name,
        race_type: plan.race_type,
        context: "race",
        session_id: plan.linked_session_id ?? null,
        notes: "Saved from Race Tactics post-race analysis",
      })
      .select("id")
      .single();
    if (error || !row) {
      setSavingToPerformances(false);
      toast.error(error?.message ?? "Failed to save");
      return;
    }
    await linkPerformance(row.id);
  }

  async function linkPerformance(performanceId: string) {
    const { error: linkError } = await supabase
      .from("race_tactics_post_race" as any)
      .update({ linked_performance_id: performanceId })
      .eq("plan_id", planId);
    setSavingToPerformances(false);
    if (linkError) {
      toast.error(linkError.message);
      return;
    }
    toast.success("Saved to Performances — this now counts toward the athlete's PBs and performance curve");
    qc.invalidateQueries({ queryKey: ["post-race-analysis", planId] });
  }

  // "Keep current" — the existing performances row (created when the
  // session was marked as Race) stays exactly as it is; this plan just
  // links to it rather than creating a second one.
  async function keepExistingPerformance() {
    if (!duplicateChoice) return;
    setSavingToPerformances(true);
    await linkPerformance(duplicateChoice.existing.id);
    setDuplicateChoice(null);
  }

  // "Overwrite" — updates that same existing row with these actual
  // splits instead of inserting a new one, so there's still only ever
  // one performances row for this race no matter which path created it
  // first.
  async function overwriteExistingPerformance() {
    if (!duplicateChoice) return;
    setSavingToPerformances(true);
    const { error } = await supabase
      .from("performances")
      .update({
        performance_date: plan.race_date ?? duplicateChoice.existing.performance_date,
        distance_m: plan.race_distance_m,
        time_seconds: duplicateChoice.finish.cumulative_time_seconds,
        event_name: plan.event_name,
        race_type: plan.race_type,
        notes: "Updated from Race Tactics post-race analysis",
      })
      .eq("id", duplicateChoice.existing.id);
    if (error) {
      setSavingToPerformances(false);
      toast.error(error.message);
      return;
    }
    await linkPerformance(duplicateChoice.existing.id);
    setDuplicateChoice(null);
  }

  const comparisonRows = useMemo(() => {
    return plannedSplits.map((ps) => {
      const actual = actualSplits.find((a) => a.cumulative_distance_m === ps.cumulative_distance_m);
      return {
        distance: ps.cumulative_distance_m,
        plannedTime: ps.cumulative_time_seconds,
        actualTime: actual?.cumulative_time_seconds ?? null,
        diff: actual ? actual.cumulative_time_seconds - ps.cumulative_time_seconds : null,
      };
    });
  }, [plannedSplits, actualSplits]);

  const chartData = useMemo(() => {
    let prevPlanned = 0;
    let prevActual = 0;
    let prevDist = 0;
    return plannedSplits.map((ps) => {
      const actual = actualSplits.find((a) => a.cumulative_distance_m === ps.cumulative_distance_m);
      const segDist = ps.cumulative_distance_m - prevDist;
      const plannedPace = ((ps.cumulative_time_seconds - prevPlanned) / segDist) * 1000;
      const actualPace = actual ? ((actual.cumulative_time_seconds - prevActual) / segDist) * 1000 : null;
      prevPlanned = ps.cumulative_time_seconds;
      if (actual) prevActual = actual.cumulative_time_seconds;
      prevDist = ps.cumulative_distance_m;
      return { label: `${ps.cumulative_distance_m}m`, plannedPace, actualPace, goalPace: averagePaceSecPerKm(plan.race_distance_m, Number(plan.goal_time_seconds)) };
    });
  }, [plannedSplits, actualSplits, plan.race_distance_m, plan.goal_time_seconds]);

  if (isLoading) return null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-[var(--accent-red)]" />
              Post-Race Analysis
            </CardTitle>
            <CardDescription>Planned vs actual, once the race has happened.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {plan.linked_session_id && (
              <Button asChild size="sm" variant="ghost">
                <Link to="/app/sessions/$sessionId/analysis" params={{ sessionId: plan.linked_session_id }}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Race analysis
                </Link>
              </Button>
            )}
            {canEditShared && !editingResults && (
              <Button size="sm" variant="outline" onClick={startEditingResults}>
                {hasResults ? "Edit results" : "Add actual results"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEditShared && (
            <div className="rounded border px-3 py-2 text-sm">
              {plan.linked_session_id ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    Linked to {sortedCandidates.find((s) => s.id === plan.linked_session_id)?.title ?? "a race session"}
                    {sortedCandidates.find((s) => s.id === plan.linked_session_id)?.session_date
                      ? ` · ${sortedCandidates.find((s) => s.id === plan.linked_session_id)?.session_date}`
                      : ""}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={pullSplitsFromSession} disabled={pullingSplits}>
                      <Download className="h-3.5 w-3.5 mr-1" /> {pullingSplits ? "Pulling…" : "Pull actual splits"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkingOpen((o) => !o)}>
                      Change
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <LinkIcon className="h-3.5 w-3.5" /> Not linked to a race session yet
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setLinkingOpen((o) => !o)}>
                    Link race session
                  </Button>
                </div>
              )}
              {linkingOpen && (
                <div className="mt-2 pt-2 border-t">
                  {sortedCandidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No completed race-day sessions found for this athlete yet — mark a session's day type as
                      "Race" once it's uploaded, then come back here to link it.
                    </p>
                  ) : (
                    <Select value={plan.linked_session_id ?? "none"} onValueChange={linkSession}>
                      <SelectTrigger><SelectValue placeholder="Pick a race session…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not linked</SelectItem>
                        {sortedCandidates.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.title ?? "Race"} · {s.session_date}
                            {s.session_date === plan.race_date ? " (matches plan date)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          )}
          {editingResults ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-2">
                {plannedSplits.map((ps, i) => (
                  <div key={i}>
                    <Label className="text-xs">
                      {ps.cumulative_distance_m}m actual (planned {secToClock(ps.cumulative_time_seconds)})
                    </Label>
                    <Input
                      value={actualTimeInputs[i] ?? ""}
                      onChange={(e) => setActualTimeInputs((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))}
                      placeholder="mm:ss"
                    />
                  </div>
                ))}
              </div>
              <div>
                <Label className="text-xs">Finishing position</Label>
                <Input value={finishingPosition} onChange={(e) => setFinishingPosition(e.target.value)} placeholder="e.g. 3rd" />
              </div>
              {(decisionPoints ?? []).length > 0 && (
                <div>
                  <Label className="text-xs">What actually happened at each decision point</Label>
                  <div className="space-y-2 mt-1">
                    {(decisionPoints ?? []).map((p: any) => (
                      <div key={p.id}>
                        <div className="text-xs text-muted-foreground">
                          {p.distance_m}m — if {p.trigger_text} → {p.action_text}
                        </div>
                        <Textarea
                          value={decisionNotes[p.id] ?? ""}
                          onChange={(e) => setDecisionNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                          rows={1}
                          placeholder="What actually happened here?"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={saveResults} disabled={savingResults}>
                  {savingResults ? "Saving…" : "Save results"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingResults(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : !hasResults ? (
            <p className="text-sm text-muted-foreground">No actual results recorded yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground text-left">
                      <th className="pb-1 pr-3">Distance</th>
                      <th className="pb-1 pr-3">Planned</th>
                      <th className="pb-1 pr-3">Actual</th>
                      <th className="pb-1">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((r) => (
                      <tr key={r.distance} className="border-t">
                        <td className="py-1 pr-3 tabular-nums">{r.distance}m</td>
                        <td className="py-1 pr-3 tabular-nums">{secToClock(r.plannedTime)}</td>
                        <td className="py-1 pr-3 tabular-nums">{r.actualTime != null ? secToClock(r.actualTime) : "—"}</td>
                        <td className={`py-1 tabular-nums ${r.diff != null && r.diff > 0 ? "text-rose-600" : r.diff != null && r.diff < 0 ? "text-emerald-600" : ""}`}>
                          {r.diff != null ? `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}s` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {analysis?.finishing_position && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Finishing position: </span>
                  {analysis.finishing_position}
                </p>
              )}

              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis reversed tickFormatter={(v) => secToClock(v)} tick={{ fontSize: 11 }} width={55} />
                    <Tooltip formatter={(value: number) => paceFmt(value)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="plannedPace" name="Planned" stroke="#94a3b8" strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="actualPace" name="Actual" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {(decisionPoints ?? []).some((p: any) => analysis?.decision_point_notes?.[p.id]) && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Tactical decisions — what actually happened</div>
                  <div className="space-y-1.5">
                    {(decisionPoints ?? []).map((p: any) =>
                      analysis?.decision_point_notes?.[p.id] ? (
                        <div key={p.id} className="text-sm">
                          <span className="text-muted-foreground">{p.distance_m}m: </span>
                          {analysis.decision_point_notes[p.id]}
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t">
                {analysis?.linked_performance_id ? (
                  <p className="text-xs text-muted-foreground">Saved to this athlete's Performances.</p>
                ) : (
                  canEditShared && (
                    <Button size="sm" variant="outline" onClick={saveToPerformances} disabled={savingToPerformances}>
                      <Save className="h-4 w-4 mr-1" />
                      {savingToPerformances ? "Saving…" : "Save to Performances"}
                    </Button>
                  )
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!duplicateChoice} onOpenChange={(o) => !o && setDuplicateChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This race already has a saved performance</DialogTitle>
            <DialogDescription>
              Marking the linked session as a Race already created a performance record for it — saving here again
              would count the same race twice toward this athlete's PBs. Keep the existing one, or overwrite it
              with these actual results?
            </DialogDescription>
          </DialogHeader>
          {duplicateChoice && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded border px-3 py-2">
                <div className="text-xs text-muted-foreground mb-1">Existing</div>
                <div className="tabular-nums">{metersFmt(duplicateChoice.existing.distance_m)}</div>
                <div className="tabular-nums">{secToClock(duplicateChoice.existing.time_seconds)}</div>
                <div className="text-xs text-muted-foreground">{duplicateChoice.existing.performance_date}</div>
              </div>
              <div className="rounded border px-3 py-2">
                <div className="text-xs text-muted-foreground mb-1">From this analysis</div>
                <div className="tabular-nums">{metersFmt(plan.race_distance_m)}</div>
                <div className="tabular-nums">{secToClock(duplicateChoice.finish.cumulative_time_seconds)}</div>
                <div className="text-xs text-muted-foreground">{plan.race_date ?? "—"}</div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDuplicateChoice(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={keepExistingPerformance} disabled={savingToPerformances}>
              Keep existing
            </Button>
            <Button onClick={overwriteExistingPerformance} disabled={savingToPerformances}>
              Overwrite with these results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Split out from PostRaceAnalysisCard so the parent page can lay these
// two out separately from the main results card (e.g. a 2/3-width
// column alongside Collaboration in the final third) instead of always
// stacking together. Self-contained — fetches its own copy of the
// analysis row (same query key, so it shares the cache with the main
// results card rather than double-fetching) and roles/athlete-identity,
// so the parent doesn't need to thread any of that through.
export function PostRaceReflectionCards({ planId, athleteId }: { planId: string; athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const isSelf = myAthlete?.id === athleteId;

  const { data: analysis } = useQuery({
    queryKey: ["post-race-analysis", planId],
    queryFn: async () => {
      const { data, error } = await supabase.from("race_tactics_post_race" as any).select("*").eq("plan_id", planId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const [coachDraft, setCoachDraft] = useState({ worked: "", didnt: "", change: "" });
  const [athleteDraft, setAthleteDraft] = useState({ felt: "", different: "", learned: "" });
  const [editingCoach, setEditingCoach] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState(false);

  async function saveReflection(kind: "coach" | "athlete") {
    const payload =
      kind === "coach"
        ? { coach_what_worked: coachDraft.worked.trim() || null, coach_what_didnt: coachDraft.didnt.trim() || null, coach_what_to_change: coachDraft.change.trim() || null }
        : { athlete_how_it_felt: athleteDraft.felt.trim() || null, athlete_what_different: athleteDraft.different.trim() || null, athlete_what_learned: athleteDraft.learned.trim() || null };

    const { error } = await supabase.from("race_tactics_post_race" as any).upsert(
      { plan_id: planId, ...payload, updated_at: new Date().toISOString() } as any,
      { onConflict: "plan_id" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    if (kind === "coach") setEditingCoach(false);
    else setEditingAthlete(false);
    qc.invalidateQueries({ queryKey: ["post-race-analysis", planId] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <CardTitle className="text-base">Coach reflection</CardTitle>
          {isCoach && !editingCoach && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCoachDraft({
                  worked: analysis?.coach_what_worked ?? "",
                  didnt: analysis?.coach_what_didnt ?? "",
                  change: analysis?.coach_what_to_change ?? "",
                });
                setEditingCoach(true);
              }}
            >
              {analysis?.coach_what_worked || analysis?.coach_what_didnt || analysis?.coach_what_to_change ? "Edit" : "Add"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingCoach ? (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">What worked?</Label>
                <Textarea value={coachDraft.worked} onChange={(e) => setCoachDraft((d) => ({ ...d, worked: e.target.value }))} rows={2} />
              </div>
              <div>
                <Label className="text-xs">What didn't?</Label>
                <Textarea value={coachDraft.didnt} onChange={(e) => setCoachDraft((d) => ({ ...d, didnt: e.target.value }))} rows={2} />
              </div>
              <div>
                <Label className="text-xs">What should change?</Label>
                <Textarea value={coachDraft.change} onChange={(e) => setCoachDraft((d) => ({ ...d, change: e.target.value }))} rows={2} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveReflection("coach")}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingCoach(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : analysis?.coach_what_worked || analysis?.coach_what_didnt || analysis?.coach_what_to_change ? (
            <div className="space-y-2 text-sm">
              {analysis.coach_what_worked && (
                <div>
                  <span className="text-muted-foreground">What worked: </span>
                  {analysis.coach_what_worked}
                </div>
              )}
              {analysis.coach_what_didnt && (
                <div>
                  <span className="text-muted-foreground">What didn't: </span>
                  {analysis.coach_what_didnt}
                </div>
              )}
              {analysis.coach_what_to_change && (
                <div>
                  <span className="text-muted-foreground">What to change: </span>
                  {analysis.coach_what_to_change}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not recorded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <CardTitle className="text-base">Athlete reflection</CardTitle>
          {isSelf && !editingAthlete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAthleteDraft({
                  felt: analysis?.athlete_how_it_felt ?? "",
                  different: analysis?.athlete_what_different ?? "",
                  learned: analysis?.athlete_what_learned ?? "",
                });
                setEditingAthlete(true);
              }}
            >
              {analysis?.athlete_how_it_felt || analysis?.athlete_what_different || analysis?.athlete_what_learned ? "Edit" : "Add"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingAthlete ? (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">How did the race feel?</Label>
                <Textarea value={athleteDraft.felt} onChange={(e) => setAthleteDraft((d) => ({ ...d, felt: e.target.value }))} rows={2} />
              </div>
              <div>
                <Label className="text-xs">What would you do differently?</Label>
                <Textarea value={athleteDraft.different} onChange={(e) => setAthleteDraft((d) => ({ ...d, different: e.target.value }))} rows={2} />
              </div>
              <div>
                <Label className="text-xs">What did you learn?</Label>
                <Textarea value={athleteDraft.learned} onChange={(e) => setAthleteDraft((d) => ({ ...d, learned: e.target.value }))} rows={2} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveReflection("athlete")}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingAthlete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : analysis?.athlete_how_it_felt || analysis?.athlete_what_different || analysis?.athlete_what_learned ? (
            <div className="space-y-2 text-sm">
              {analysis.athlete_how_it_felt && (
                <div>
                  <span className="text-muted-foreground">How it felt: </span>
                  {analysis.athlete_how_it_felt}
                </div>
              )}
              {analysis.athlete_what_different && (
                <div>
                  <span className="text-muted-foreground">Would do differently: </span>
                  {analysis.athlete_what_different}
                </div>
              )}
              {analysis.athlete_what_learned && (
                <div>
                  <span className="text-muted-foreground">Learned: </span>
                  {analysis.athlete_what_learned}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isSelf ? "Not recorded yet." : "The athlete hasn't added their reflection yet."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
