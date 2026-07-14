import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { DailyLogSessions } from "@/components/daily-log-sessions";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/daily-log")({
  component: DailyLog,
});

const MODALITIES = ["physio", "massage", "sauna", "compression", "ice_bath", "other"] as const;

function DailyLog() {
  const { data: athlete, isLoading } = useMyAthlete();
  // Which day the Vitals/End-of-day sections are showing — previously always
  // hardcoded to today, so a missed day could never be filled in afterwards.
  // Defaults to today but can be moved back (or forward, up to today) via the
  // date nav below. "Today's sessions" further down deliberately stays
  // scoped to today — it has its own separate gap and other entry points
  // (Calendar's "+", bulk upload) already cover logging a session for a past day.
  const [logDate, setLogDate] = useState(todayISO());

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete) return <AppShell><p className="text-sm">No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.</p></AppShell>;
  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Daily Log</h1>
            <p className="text-sm text-muted-foreground">Vitals, sessions, and your end-of-day reflection — open this any time during the day.</p>
          </div>
          <DateNav date={logDate} onChange={setLogDate} />
        </div>
        <VitalsSection athleteId={athlete.id} date={logDate} />
        <SessionsSection athleteId={athlete.id} />
        <EndOfDaySection athleteId={athlete.id} date={logDate} />
      </div>
    </AppShell>
  );
}

function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const isToday = date === todayISO();
  function shift(days: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().slice(0, 10));
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous day">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        value={date}
        max={todayISO()}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="w-[150px]"
      />
      <Button variant="outline" size="icon" onClick={() => shift(1)} disabled={isToday} aria-label="Next day">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isToday && (
        <Button variant="ghost" size="sm" onClick={() => onChange(todayISO())}>
          Today
        </Button>
      )}
    </div>
  );
}

function VitalsSection({ athleteId, date }: { athleteId: string; date: string }) {
  const qc = useQueryClient();
  const { data: v } = useQuery({
    queryKey: ["dl-vitals", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase.from("daily_vitals").select("*").eq("athlete_id", athleteId).eq("vitals_date", date).maybeSingle();
      return (data as any) ?? null;
    },
  });
  const { data: c } = useQuery({
    queryKey: ["dl-checkin", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase.from("daily_checkins").select("*").eq("athlete_id", athleteId).eq("checkin_date", date).maybeSingle();
      return (data as any) ?? null;
    },
  });

  const [sleepHours, setSleepHours] = useState<string>(v?.sleep_hours ?? "");
  const [sleepQ, setSleepQ] = useState<number>(c?.sleep_quality ?? 3);
  const [restingHr, setRestingHr] = useState<string>(v?.resting_hr ?? "");
  const [weight, setWeight] = useState<string>(v?.weight_kg ?? "");
  const [hydration, setHydration] = useState<number>(v?.hydration ?? 3);
  const [soreness, setSoreness] = useState<number>(c?.soreness ?? 2);
  const [stress, setStress] = useState<number>(c?.stress ?? 2);
  const [motivation, setMotivation] = useState<number>(c?.motivation ?? 3);
  const [modalities, setModalities] = useState<string[]>(v?.recovery_modalities ?? []);
  const [injury, setInjury] = useState<boolean>(c?.injury_flag ?? false);
  const [injuryNotes, setInjuryNotes] = useState<string>(c?.injury_notes ?? "");

  useEffect(() => {
    setSleepHours(v?.sleep_hours != null ? String(v.sleep_hours) : "");
    setRestingHr(v?.resting_hr != null ? String(v.resting_hr) : "");
    setWeight(v?.weight_kg != null ? String(v.weight_kg) : "");
    setHydration(v?.hydration ?? 3);
    setModalities(Array.isArray(v?.recovery_modalities) ? v.recovery_modalities : []);
  }, [date, v]);
  useEffect(() => {
    setSleepQ(c?.sleep_quality ?? 3);
    setSoreness(c?.soreness ?? 2);
    setStress(c?.stress ?? 2);
    setMotivation(c?.motivation ?? 3);
    setInjury(!!c?.injury_flag);
    setInjuryNotes(c?.injury_notes ?? "");
  }, [date, c]);

  async function save() {
    const vitalsPayload = {
      athlete_id: athleteId,
      vitals_date: date,
      sleep_hours: sleepHours === "" ? null : Number(sleepHours),
      resting_hr: restingHr === "" ? null : Number(restingHr),
      weight_kg: weight === "" ? null : Number(weight),
      hydration,
      recovery_modalities: modalities,
    };
    const checkinPayload = {
      athlete_id: athleteId, checkin_date: date,
      sleep_quality: sleepQ, soreness, stress, motivation,
      injury_flag: injury, injury_notes: injury ? injuryNotes : null,
    };
    const [v1, c1] = await Promise.all([
      supabase.from("daily_vitals").upsert(vitalsPayload as any, { onConflict: "athlete_id,vitals_date" }),
      supabase.from("daily_checkins").upsert(checkinPayload as any, { onConflict: "athlete_id,checkin_date" }),
    ]);
    if (v1.error || c1.error) { toast.error(v1.error?.message ?? c1.error?.message ?? "Save failed"); return; }
    toast.success("Vitals saved");
    qc.invalidateQueries({ queryKey: ["dl-vitals", athleteId, date] });
    qc.invalidateQueries({ queryKey: ["dl-checkin", athleteId, date] });
  }

  function toggleMod(m: string) {
    setModalities((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }

  const isToday = date === todayISO();
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isToday ? "Today's vitals" : `Vitals — ${dateLabel}`} {v && <Badge variant="outline" className="ml-2 text-[10px]">Saved</Badge>}</CardTitle>
        <CardDescription>{isToday ? "Fill in the morning, editable any time." : "Backfilling a missed day — editable any time."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label className="text-xs">Sleep hours</Label><Input type="number" step="0.1" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="7.5" /></div>
          <div><Label className="text-xs">Resting HR</Label><Input type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} placeholder="52" /></div>
          <div><Label className="text-xs">Weight (kg)</Label><Input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="64.5" /></div>
        </div>
        <SliderRow label="Sleep quality" value={sleepQ} onChange={setSleepQ} />
        <SliderRow label="Hydration" value={hydration} onChange={setHydration} />
        <SliderRow label="Soreness" value={soreness} onChange={setSoreness} hint="1 = none · 5 = severe" />
        <SliderRow label="Stress" value={stress} onChange={setStress} />
        <SliderRow label="Motivation" value={motivation} onChange={setMotivation} />
        <div>
          <Label className="text-xs">Recovery modalities used today</Label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {MODALITIES.map((m) => (
              <button key={m} type="button" onClick={() => toggleMod(m)}
                className={`px-2.5 py-1 text-xs rounded-md border capitalize ${modalities.includes(m) ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {m.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between"><Label>Injury concern?</Label><Switch checked={injury} onCheckedChange={setInjury} /></div>
        {injury && <Textarea placeholder="Describe what's bothering you" value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} />}
        <Button onClick={save} className="w-full">Save vitals</Button>
      </CardContent>
    </Card>
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

function SessionsSection({ athleteId }: { athleteId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's sessions</CardTitle>
        <CardDescription>Add a block per session. Bulk-upload multiple files per block — files more than 90 min apart should go in separate blocks.</CardDescription>
      </CardHeader>
      <CardContent>
        <DailyLogSessions athleteId={athleteId} />
      </CardContent>
    </Card>
  );
}

function EndOfDaySection({ athleteId, date }: { athleteId: string; date: string }) {
  const qc = useQueryClient();
  const { data: anyInsight } = useQuery({
    queryKey: ["dl-eod", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase.from("session_insights")
        .select("id, session_id, end_of_day_note, sessions!inner(session_date, athlete_id)")
        .eq("sessions.athlete_id", athleteId).eq("sessions.session_date", date)
        .not("end_of_day_note", "is", null)
        .limit(1).maybeSingle();
      return data as any;
    },
  });
  const [note, setNote] = useState<string>("");
  useEffect(() => { setNote(anyInsight?.end_of_day_note ?? ""); }, [date, anyInsight]);
  async function save() {
    // attach to the most recent session_insight for today; create a placeholder if none
    const { data: latest } = await supabase.from("session_insights")
      .select("id, sessions!inner(session_date, athlete_id)")
      .eq("sessions.athlete_id", athleteId).eq("sessions.session_date", date)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) { toast.error("Save at least one session on this day first."); return; }
    const { error } = await supabase.from("session_insights").update({ end_of_day_note: note }).eq("id", (latest as any).id);
    if (error) { toast.error(error.message); return; }
    toast.success("End-of-day note saved");
    qc.invalidateQueries({ queryKey: ["dl-eod", athleteId, date] });
  }
  const isToday = date === todayISO();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isToday ? "End of day note" : "Day note"}</CardTitle>
        <CardDescription>Visible to you and your coach.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea placeholder={isToday ? "Anything else worth noting about today?" : "Anything else worth noting about this day?"} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button onClick={save}>Save note</Button>
      </CardContent>
    </Card>
  );
}
