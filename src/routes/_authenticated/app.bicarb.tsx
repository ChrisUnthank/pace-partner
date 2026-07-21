import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, FlaskConical } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/bicarb")({
  component: BicarbPage,
});

function BicarbPage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Bicarb</h1>
          <p className="text-sm text-muted-foreground">
            Log sodium bicarbonate use, link it to a session, and see whether it's tracking with better sessions.
          </p>
        </div>
        <BucketTabStrip items={HEALTH_TABS} active="/app/bicarb" />
        <ComparisonCard athleteId={athlete.id} />
        <NewBicarbForm athleteId={athlete.id} />
        <BicarbHistory athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

function NewBicarbForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [dose, setDose] = useState("");
  const [product, setProduct] = useState("");
  const [timing, setTiming] = useState("");
  const [sessionId, setSessionId] = useState<string>("none");
  const [tolerance, setTolerance] = useState("");
  const [notes, setNotes] = useState("");

  // Sessions on the chosen date, so bicarb use can be linked to the
  // specific session it was taken for (rather than typed in freehand).
  const { data: sessionsOnDate } = useQuery({
    queryKey: ["bicarb-sessions-on-date", athleteId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title")
        .eq("athlete_id", athleteId)
        .eq("session_date", date)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Reset the session picker whenever the date changes — a session id
  // chosen for one day has no meaning once the date's moved to another.
  useEffect(() => {
    setSessionId("none");
  }, [date]);

  async function save() {
    const payload = {
      athlete_id: athleteId,
      log_date: date,
      dose_g: dose === "" ? null : Number(dose),
      product: product || null,
      timing_minutes_before: timing === "" ? null : Number(timing),
      session_id: sessionId === "none" ? null : sessionId,
      tolerance: tolerance === "" ? null : Number(tolerance),
      notes: notes || null,
    };
    const { error } = await supabase.from("bicarb_log").insert(payload as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bicarb use logged");
    setDose("");
    setProduct("");
    setTiming("");
    setSessionId("none");
    setTolerance("");
    setNotes("");
    qc.invalidateQueries({ queryKey: ["bicarb-history", athleteId] });
    qc.invalidateQueries({ queryKey: ["bicarb-comparison", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log bicarb use</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Dose (g)</Label>
            <Input type="number" step="0.1" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="20" />
          </div>
          <div>
            <Label className="text-xs">Product (optional)</Label>
            <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Maurten Bicarb System" />
          </div>
          <div>
            <Label className="text-xs">Minutes before session</Label>
            <Input type="number" value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="90" />
          </div>
          <div>
            <Label className="text-xs">Link to a session on this date</Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {(sessionsOnDate ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title ?? "Session"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">GI tolerance (1–5, optional)</Label>
            <Input type="number" min={1} max={5} value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="4" />
          </div>
        </div>
        <Textarea placeholder="Any GI symptoms or other notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} className="w-full">
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function BicarbHistory({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: rows } = useQuery({
    queryKey: ["bicarb-history", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bicarb_log")
        .select("*, sessions(title)")
        .eq("athlete_id", athleteId)
        .order("log_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function remove(id: string) {
    const { error } = await supabase.from("bicarb_log").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["bicarb-history", athleteId] });
    qc.invalidateQueries({ queryKey: ["bicarb-comparison", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Last 30 entries.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!rows || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bicarb use logged yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {r.dose_g != null ? `${r.dose_g}g` : "Dose not logged"}
                  {r.product && ` · ${r.product}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.log_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {r.timing_minutes_before != null && ` · ${r.timing_minutes_before} min before`}
                  {r.sessions?.title && ` · ${r.sessions.title}`}
                  {r.tolerance != null && ` · tolerance ${r.tolerance}/5`}
                </div>
                {r.notes && <div className="text-xs text-muted-foreground mt-1">{r.notes}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(r.id)} aria-label="Delete">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonCard({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["bicarb-comparison", athleteId],
    queryFn: async () => {
      // Every bicarb entry that's linked to a session, so we know which
      // sessions had it.
      const { data: linked, error: linkedErr } = await supabase
        .from("bicarb_log")
        .select("session_id")
        .eq("athlete_id", athleteId)
        .not("session_id", "is", null);
      if (linkedErr) throw linkedErr;
      const bicarbSessionIds = new Set((linked ?? []).map((r: any) => r.session_id));

      // Feel score for every session with a reflection — reuses the
      // existing session_insights.feel_score rather than introducing a
      // new performance metric just for this comparison.
      const { data: insights, error: insightsErr } = await supabase
        .from("session_insights")
        .select("session_id, feel_score, sessions!inner(athlete_id)")
        .eq("sessions.athlete_id", athleteId)
        .not("feel_score", "is", null);
      if (insightsErr) throw insightsErr;

      const withBicarb = (insights ?? []).filter((i: any) => bicarbSessionIds.has(i.session_id));
      const without = (insights ?? []).filter((i: any) => !bicarbSessionIds.has(i.session_id));

      const avg = (rows: any[]) => (rows.length ? rows.reduce((sum, r) => sum + Number(r.feel_score), 0) / rows.length : null);

      return {
        withBicarbAvg: avg(withBicarb),
        withBicarbCount: withBicarb.length,
        withoutAvg: avg(without),
        withoutCount: without.length,
      };
    },
  });

  if (!data || (data.withBicarbCount === 0 && data.withoutCount === 0)) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--accent-red)]" /> Is it helping?
        </CardTitle>
        <CardDescription>Average "how did it feel" score, sessions with bicarb vs without.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">With bicarb</div>
            <div className="text-lg font-semibold tabular-nums">
              {data.withBicarbAvg != null ? data.withBicarbAvg.toFixed(1) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.withBicarbCount} session{data.withBicarbCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Without</div>
            <div className="text-lg font-semibold tabular-nums">
              {data.withoutAvg != null ? data.withoutAvg.toFixed(1) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.withoutCount} session{data.withoutCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        {data.withBicarbCount < 5 && (
          <p className="text-xs text-muted-foreground mt-3">
            Still early — a handful of entries isn't enough to draw a real conclusion yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
