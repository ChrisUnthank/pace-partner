import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, TestTube2 } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export const Route = createFileRoute("/_authenticated/app/lactate")({
  component: LactatePage,
});

function LactatePage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell fullWidth><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <TestTube2 className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
            <h1 className="text-2xl font-bold leading-tight">Lactate</h1>
            <p className="text-sm text-muted-foreground">
              Readings taken during sessions, plus standalone spot checks — all in one place.
            </p>
          </div>
        </div>
        <BucketTabStrip items={HEALTH_TABS} active="/app/lactate" />
        <LactateCurveCard athleteId={athlete.id} />
        <NewSpotCheckForm athleteId={athlete.id} />
        <LactateHistory athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// Session-derived readings — reads the EXISTING interval_results lactate
// fields (lactate_taken / lactate_mmol / lactate_timing), joined up through
// steps -> sessions the same way the session detail page's own queries do
// (fetch ids at each level, then .in() the next), rather than a deep
// nested-filter query. Shared by both the curve chart and the history list
// below, so it's one query, not two.
// ----------------------------------------------------------------------------

export function useLactateSessionPoints(athleteId: string) {
  return useQuery({
    queryKey: ["lactate-points", athleteId],
    queryFn: async () => {
      const { data: sessions, error: sessErr } = await supabase
        .from("sessions")
        .select("id, session_date, title")
        .eq("athlete_id", athleteId);
      if (sessErr) throw sessErr;
      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (sessionIds.length === 0) return [];
      const sessionById = new Map((sessions ?? []).map((s: any) => [s.id, s]));

      const { data: steps, error: stepsErr } = await supabase
        .from("steps")
        .select("id, session_id")
        .in("session_id", sessionIds);
      if (stepsErr) throw stepsErr;
      const stepIds = (steps ?? []).map((s) => s.id);
      if (stepIds.length === 0) return [];
      const sessionIdByStep = new Map((steps ?? []).map((s: any) => [s.id, s.session_id]));

      const { data: results, error: resultsErr } = await supabase
        .from("interval_results")
        .select("id, step_id, rep_number, set_number, lactate_mmol, lactate_timing, actual_pace_sec_per_km")
        .in("step_id", stepIds)
        .eq("lactate_taken", true)
        .not("lactate_mmol", "is", null);
      if (resultsErr) throw resultsErr;

      return (results ?? [])
        .map((r: any) => {
          const sessionId = sessionIdByStep.get(r.step_id);
          const session = sessionId ? sessionById.get(sessionId) : null;
          const speedKmh = r.actual_pace_sec_per_km ? 3600 / Number(r.actual_pace_sec_per_km) : null;
          return {
            id: r.id as string,
            mmol: Number(r.lactate_mmol),
            speedKmh,
            sessionDate: (session as any)?.session_date ?? null,
            sessionTitle: (session as any)?.title ?? "Session",
            rep: r.rep_number as number,
            set: r.set_number as number,
            timing: r.lactate_timing as string | null,
          };
        })
        .filter((p) => p.speedKmh != null);
    },
  });
}

export function useLactateSpotChecks(athleteId: string) {
  return useQuery({
    queryKey: ["lactate-spot-checks", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lactate_spot_checks")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("check_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ----------------------------------------------------------------------------
// Curve: every rep reading ever recorded, plotted against speed — the
// shape a formal step test would produce, just built from whichever
// sessions happened to have lactate taken rather than one dedicated test.
// ----------------------------------------------------------------------------

function LactateCurveCard({ athleteId }: { athleteId: string }) {
  const { data: points, isLoading } = useLactateSessionPoints(athleteId);

  if (isLoading) return null;
  if (!points || points.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lactate curve</CardTitle>
        <CardDescription>Every rep reading recorded on a session, plotted against speed.</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="speedKmh"
                name="Speed"
                unit=" km/h"
                domain={["dataMin - 0.5", "dataMax + 0.5"]}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="number" dataKey="mmol" name="Lactate" unit=" mmol" tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const p: any = payload[0].payload;
                  return (
                    <div className="bg-background border border-border rounded-md p-2 text-xs shadow-md">
                      <div className="font-medium">{p.sessionTitle}</div>
                      {p.sessionDate && <div className="text-muted-foreground">{p.sessionDate}</div>}
                      <div>
                        {p.speedKmh.toFixed(1)} km/h · {p.mmol.toFixed(1)} mmol
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter data={points} fill="#ef4444" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Spot check form — for a reading taken outside a structured session.
// ----------------------------------------------------------------------------

function NewSpotCheckForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [mmol, setMmol] = useState("");
  const [context, setContext] = useState("");
  const [notes, setNotes] = useState("");

  async function save() {
    if (mmol === "") {
      toast.error("Lactate value is required");
      return;
    }
    const payload = {
      athlete_id: athleteId,
      check_date: date,
      mmol: Number(mmol),
      context: context || null,
      notes: notes || null,
    };
    const { error } = await supabase.from("lactate_spot_checks").insert(payload as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Spot check logged");
    setMmol("");
    setContext("");
    setNotes("");
    qc.invalidateQueries({ queryKey: ["lactate-spot-checks", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a spot check</CardTitle>
        <CardDescription>For a reading taken outside a structured session — e.g. at rest or after an easy run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Lactate (mmol)</Label>
            <Input type="number" step="0.1" value={mmol} onChange={(e) => setMmol(e.target.value)} placeholder="1.2" />
          </div>
          <div>
            <Label className="text-xs">Context</Label>
            <Input value={context} onChange={(e) => setContext(e.target.value)} placeholder="e.g. rest, post-easy-run" />
          </div>
        </div>
        <Textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} className="w-full">
          Save spot check
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Combined history — session-derived readings and spot checks together,
// most recent first.
// ----------------------------------------------------------------------------

function LactateHistory({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: points } = useLactateSessionPoints(athleteId);
  const { data: spotChecks } = useLactateSpotChecks(athleteId);

  const combined = useMemo(() => {
    const fromSessions = (points ?? []).map((p) => ({
      kind: "session" as const,
      date: p.sessionDate as string | null,
      label: p.sessionTitle as string,
      detail: `${(p.set ?? 1) > 1 ? `S${p.set} ` : ""}Rep ${p.rep}${p.timing === "end_of_recovery" ? " · rec" : ""} · ${p.speedKmh!.toFixed(1)} km/h`,
      mmol: p.mmol,
      id: `session-${p.id}`,
      rawId: null as string | null,
    }));
    const fromSpot = (spotChecks ?? []).map((s: any) => ({
      kind: "spot" as const,
      date: s.check_date as string,
      label: s.context || "Spot check",
      detail: s.notes ?? "",
      mmol: Number(s.mmol),
      id: `spot-${s.id}`,
      rawId: s.id as string,
    }));
    return [...fromSessions, ...fromSpot]
      .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1))
      .slice(0, 40);
  }, [points, spotChecks]);

  async function removeSpotCheck(id: string) {
    const { error } = await supabase.from("lactate_spot_checks").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["lactate-spot-checks", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Session readings and spot checks together, most recent first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {combined.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lactate readings yet.</p>
        ) : (
          combined.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{row.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {row.date &&
                    new Date(row.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {row.detail && ` · ${row.detail}`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-semibold tabular-nums">{row.mmol.toFixed(1)} mmol</span>
                {row.kind === "spot" && (
                  <Button variant="ghost" size="icon" onClick={() => removeSpotCheck(row.rawId!)} aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
