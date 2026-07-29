import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { Trash2, Bath } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/recovery")({
  component: RecoveryPage,
});

// Same modality set the Daily Log tag list already uses — kept in sync so
// the two don't drift into different vocabularies for the same concept.
const MODALITIES = ["physio", "massage", "sauna", "compression", "ice_bath", "other"] as const;

function RecoveryPage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell fullWidth><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/account" className="underline">Account</Link>.
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
            <Bath className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
            <h1 className="text-2xl font-bold leading-tight">Recovery</h1>
            <p className="text-sm text-muted-foreground">
              Log physio, massage, and other recovery work to track what you're doing over time.
            </p>
          </div>
        </div>
        <BucketTabStrip items={HEALTH_TABS} active="/app/recovery" />
        <NewRecoveryForm athleteId={athlete.id} />
        <RecoveryHistory athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

function NewRecoveryForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [modality, setModality] = useState<string>("physio");
  const [duration, setDuration] = useState("");
  const [provider, setProvider] = useState("");
  const [feltAfter, setFeltAfter] = useState("");
  const [notes, setNotes] = useState("");

  async function save() {
    const payload = {
      athlete_id: athleteId,
      session_date: date,
      modality,
      duration_minutes: duration === "" ? null : Number(duration),
      provider: provider || null,
      felt_after: feltAfter === "" ? null : Number(feltAfter),
      notes: notes || null,
    };
    const { error } = await supabase.from("recovery_sessions").insert(payload as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Recovery session logged");
    setDuration("");
    setProvider("");
    setFeltAfter("");
    setNotes("");
    qc.invalidateQueries({ queryKey: ["recovery-history", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a recovery session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={modality} onValueChange={setModality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODALITIES.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">
                    {m.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Duration (min)</Label>
            <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="30" />
          </div>
          <div>
            <Label className="text-xs">Provider (optional)</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. clinic name" />
          </div>
        </div>
        <div>
          <Label className="text-xs">How did it feel afterwards? (1–5, optional)</Label>
          <Input
            type="number"
            min={1}
            max={5}
            value={feltAfter}
            onChange={(e) => setFeltAfter(e.target.value)}
            placeholder="4"
            className="w-20"
          />
        </div>
        <Textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} className="w-full">
          Save recovery session
        </Button>
      </CardContent>
    </Card>
  );
}

function RecoveryHistory({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: rows } = useQuery({
    queryKey: ["recovery-history", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recovery_sessions")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("session_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function remove(id: string) {
    const { error } = await supabase.from("recovery_sessions").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["recovery-history", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Last 30 entries.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!rows || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recovery sessions logged yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border">
              <div className="min-w-0">
                <div className="text-sm font-medium capitalize">{r.modality.replace("_", " ")}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.session_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {r.duration_minutes != null && ` · ${r.duration_minutes} min`}
                  {r.provider && ` · ${r.provider}`}
                  {r.felt_after != null && ` · felt ${r.felt_after}/5 after`}
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
