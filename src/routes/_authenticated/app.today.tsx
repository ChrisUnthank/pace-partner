import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { ReadinessBadge } from "@/components/readiness-badge";

export const Route = createFileRoute("/_authenticated/app/today")({
  component: TodayPage,
});

function TodayPage() {
  const { data: athlete, isLoading } = useMyAthlete();
  const qc = useQueryClient();
  const today = todayISO();

  const { data: existing } = useQuery({
    queryKey: ["checkin-today", athlete?.id, today],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_checkins")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .eq("checkin_date", today)
        .maybeSingle();
      return data;
    },
  });

  const { data: todaysSession } = useQuery({
    queryKey: ["session-today", athlete?.id, today],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .eq("session_date", today)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: extLoad } = useQuery({
    queryKey: ["ext-load-today", athlete?.id, today],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("external_load")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .eq("load_date", today);
      return data ?? [];
    },
  });

  const { data: readiness } = useQuery({
    queryKey: ["readiness-today", athlete?.id, today],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("readiness_status, readiness_score, confidence, atl, ctl, load_ratio, checkin_score")
        .eq("athlete_id", athlete!.id)
        .eq("load_date", today)
        .maybeSingle();
      return data;
    },
  });

  const [sleepHours, setSleepHours] = useState(7.5);
  const [sleepQ, setSleepQ] = useState(3);
  const [soreness, setSoreness] = useState(2);
  const [stress, setStress] = useState(2);
  const [motivation, setMotivation] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [fuel, setFuel] = useState(3);
  const [injury, setInjury] = useState(false);
  const [injuryNotes, setInjuryNotes] = useState("");
  const [notes, setNotes] = useState("");

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete) return <AppShell><p className="text-sm">No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link> to set up.</p></AppShell>;

  async function saveCheckin() {
    const payload = {
      athlete_id: athlete!.id,
      checkin_date: today,
      sleep_hours: sleepHours,
      sleep_quality: sleepQ,
      soreness, stress, motivation, energy,
      fuel_score: fuel,
      injury_flag: injury,
      injury_notes: injury ? injuryNotes : null,
      notes,
    };
    const { error } = await supabase.from("daily_checkins").upsert(payload, { onConflict: "athlete_id,checkin_date" });
    if (error) toast.error(error.message); else {
      toast.success("Check-in saved");
      qc.invalidateQueries({ queryKey: ["checkin-today"] });
    }
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Today</h1>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Readiness</CardTitle>
              <CardDescription>
                {readiness?.confidence === "insufficient"
                  ? "Building baseline — log a few more days for a real score"
                  : readiness?.confidence
                    ? `Confidence: ${readiness.confidence}`
                    : "No data yet"}
              </CardDescription>
            </div>
            <ReadinessBadge
              status={readiness?.readiness_status as any}
              score={readiness?.readiness_score as any}
              confidence={readiness?.confidence as any}
            />
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="Acute (7d)" value={readiness?.atl} />
            <Stat label="Chronic (28d)" value={readiness?.ctl} />
            <Stat label="Ratio" value={readiness?.load_ratio} digits={2} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planned session</CardTitle>
            <CardDescription>{today}</CardDescription>
          </CardHeader>
          <CardContent>
            {todaysSession ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{todaysSession.title}</div>
                  <div className="text-xs text-muted-foreground">{sessionClassificationLabel(todaysSession as any)}</div>
                </div>
                <Link to="/app/sessions/$sessionId" params={{ sessionId: todaysSession.id }}>
                  <Button>Open</Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing planned. <Link to="/app/sessions/new" className="underline">Add a session</Link>.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily check-in {existing && <span className="text-xs text-emerald-600 font-normal ml-2">saved earlier</span>}</CardTitle>
            <CardDescription>How are you feeling today?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <NumberRow label="Sleep hours" value={sleepHours} min={0} max={12} step={0.25} onChange={setSleepHours} />
            <SliderRow label="Sleep quality" value={sleepQ} onChange={setSleepQ} hint="1 = terrible · 5 = great" />
            <SliderRow label="Soreness" value={soreness} onChange={setSoreness} hint="1 = none · 5 = severe" />
            <SliderRow label="Stress" value={stress} onChange={setStress} hint="1 = low · 5 = very high" />
            <SliderRow label="Motivation" value={motivation} onChange={setMotivation} hint="1 = flat · 5 = fired up" />
            <SliderRow label="Energy" value={energy} onChange={setEnergy} hint="1 = drained · 5 = fresh" />
            <SliderRow label="Fuel / nutrition" value={fuel} onChange={setFuel} hint="1 = poor · 5 = excellent" />
            <div className="flex items-center justify-between">
              <Label>Injury concern?</Label>
              <Switch checked={injury} onCheckedChange={setInjury} />
            </div>
            {injury && <Textarea placeholder="What's bothering you?" value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} />}
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={saveCheckin} className="w-full">Save check-in</Button>
          </CardContent>
        </Card>

        <ExternalLoadCard athleteId={athlete.id} date={today} existing={extLoad ?? []} />
      </div>
    </AppShell>
  );
}

function Stat({ label, value, digits = 0 }: { label: string; value?: number | null; digits?: number }) {
  return (
    <div className="rounded border py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value == null ? "—" : Number(value).toFixed(digits)}</div>
    </div>
  );
}

function SliderRow({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><Label>{label}</Label><span className="text-muted-foreground tabular-nums">{value}</span></div>
      <Slider min={1} max={5} step={1} value={[value]} onValueChange={(v) => onChange(v[0])} className="mt-2" />
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
function NumberRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2" />
    </div>
  );
}

function ExternalLoadCard({ athleteId, date, existing }: { athleteId: string; date: string; existing: any[] }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"work" | "gym" | "other_sport" | "school" | "travel" | "other">("gym");
  const [intensity, setIntensity] = useState(3);
  const [duration, setDuration] = useState(60);
  const [desc, setDesc] = useState("");

  async function add() {
    const { error } = await supabase.from("external_load").insert({
      athlete_id: athleteId, load_date: date, load_kind: kind,
      intensity, duration_minutes: duration, description: desc || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Activity added");
      setDesc("");
      qc.invalidateQueries({ queryKey: ["ext-load-today"] });
    }
  }

  async function remove(id: string) {
    await supabase.from("external_load").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["ext-load-today"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Other activities today</CardTitle>
        <CardDescription>Work, gym, school, other sport — anything beyond running.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {existing.length > 0 && (
          <div className="divide-y border rounded">
            {existing.map((e) => (
              <div key={e.id} className="flex justify-between items-center px-3 py-2 text-sm">
                <div>
                  <span className="capitalize font-medium">{e.load_kind.replace("_", " ")}</span>
                  <span className="text-muted-foreground"> · {e.duration_minutes ?? "—"} min · intensity {e.intensity ?? "—"}</span>
                  {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(e.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="work">Work</SelectItem>
                <SelectItem value="gym">Gym / strength</SelectItem>
                <SelectItem value="other_sport">Other sport</SelectItem>
                <SelectItem value="school">School activity</SelectItem>
                <SelectItem value="travel">Travel</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Duration (min)</Label>
            <Input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Intensity: {intensity}/5</Label>
            <Slider value={[intensity]} min={1} max={5} step={1} onValueChange={(v) => setIntensity(v[0])} className="mt-2" />
          </div>
          <div className="col-span-2">
            <Label>Description (optional)</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1" placeholder="e.g. rugby practice, leg day" />
          </div>
        </div>
        <Button onClick={add} variant="outline" className="w-full"><Plus className="h-4 w-4 mr-1" /> Add activity</Button>
      </CardContent>
    </Card>
  );
}