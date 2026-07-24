import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { BodyMapPicker } from "@/components/body-map";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/daily-log")({
  component: DailyLog,
});

// Same modality set the Recovery tab's own Type dropdown uses — a tag
// tapped here now inserts directly into recovery_sessions (the Recovery
// tab's own table), so this list has to stay literally in sync, not just
// vocabulary-similar the way it was before.
const MODALITIES = ["physio", "massage", "sauna", "compression", "ice_bath", "active_recovery", "foam_rolling", "percussion_therapy", "stretching", "other"] as const;

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
        <BucketTabStrip items={HEALTH_TABS} active="/app/daily-log" />
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
  const navigate = useNavigate();
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
  // Which recovery modalities already have a recovery_sessions row logged
  // today — reads the Recovery tab's own table directly rather than a
  // separate array on daily_checkins, so there's exactly one place this
  // data lives, not two that can drift apart.
  const { data: todayRecovery } = useQuery({
    queryKey: ["dl-recovery-today", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase.from("recovery_sessions").select("id, modality").eq("athlete_id", athleteId).eq("session_date", date);
      return (data ?? []) as any[];
    },
  });
  const loggedModalities = new Set((todayRecovery ?? []).map((r: any) => r.modality));

  const [sleepHours, setSleepHours] = useState<string>(v?.sleep_hours ?? "");
  const [sleepQ, setSleepQ] = useState<number>(c?.sleep_quality ?? 3);
  const [restingHr, setRestingHr] = useState<string>(v?.resting_hr ?? "");
  const [weight, setWeight] = useState<string>(v?.weight_kg ?? "");
  const [hydration, setHydration] = useState<number>(v?.hydration ?? 3);
  const [soreness, setSoreness] = useState<number>(c?.soreness ?? 2);
  const [stress, setStress] = useState<number>(c?.stress ?? 2);
  const [motivation, setMotivation] = useState<number>(c?.motivation ?? 3);
  const [injury, setInjury] = useState<boolean>(c?.injury_flag ?? false);
  const [injuryNotes, setInjuryNotes] = useState<string>(c?.injury_notes ?? "");
  const [injuryBodyPart, setInjuryBodyPart] = useState<string>("");
  const [injuryRegion, setInjuryRegion] = useState<string | null>(null);
  const [loggingInjury, setLoggingInjury] = useState(false);

  useEffect(() => {
    setSleepHours(v?.sleep_hours != null ? String(v.sleep_hours) : "");
    setRestingHr(v?.resting_hr != null ? String(v.resting_hr) : "");
    setWeight(v?.weight_kg != null ? String(v.weight_kg) : "");
    setHydration(v?.hydration ?? 3);
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
    if (v1.error || c1.error) { toast.error(v1.error?.message ?? c1.error?.message ?? "Save failed"); return false; }
    toast.success("Vitals saved");
    qc.invalidateQueries({ queryKey: ["dl-vitals", athleteId, date] });
    qc.invalidateQueries({ queryKey: ["dl-checkin", athleteId, date] });
    return true;
  }

  // Recovery modality tags now write straight into recovery_sessions (the
  // Recovery tab's own table) instead of a disconnected array on
  // daily_checkins — a tap here shows up as a real entry on that tab, not
  // a second data point that only ever agreed with it by coincidence of
  // shared wording. Deliberately add-only: once a modality shows as logged
  // today, tapping it again does nothing — removing or editing the entry
  // happens on the Recovery tab itself, so a stray tap here can't silently
  // delete a detailed entry (duration/provider/notes) logged there.
  async function logModality(m: string) {
    if (loggedModalities.has(m)) return;
    const { error } = await supabase.from("recovery_sessions").insert({
      athlete_id: athleteId,
      session_date: date,
      modality: m,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.replace("_", " ")} logged`);
    qc.invalidateQueries({ queryKey: ["dl-recovery-today", athleteId, date] });
  }

  // "Yes" on the injury toggle now does something real: save whatever's
  // already in this form first (so flipping the switch and navigating away
  // can never strand unsaved sleep/soreness/etc — the exact concern this
  // was built to address), then create an actual injuries row, then hand
  // off to Injury Management to fill in the rest. Body part is required
  // there too, so it's asked for here rather than inserting a vague
  // placeholder row that would sit mislabeled until someone noticed.
  async function logInjuryAndGo() {
    if (!injuryBodyPart.trim()) {
      toast.error("Body part is required — e.g. Achilles, calf, hamstring");
      return;
    }
    setLoggingInjury(true);
    const savedOk = await save();
    if (!savedOk) { setLoggingInjury(false); return; }
    const { error } = await supabase.from("injuries").insert({
      athlete_id: athleteId,
      body_part: injuryBodyPart.trim(),
      body_region: injuryRegion,
      side: "n/a",
      status: "active",
      severity: null,
      onset_date: date,
      notes: injuryNotes || null,
    } as any);
    setLoggingInjury(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Injury logged");
    navigate({ to: "/app/injuries" });
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
            {MODALITIES.map((m) => {
              const logged = loggedModalities.has(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => logModality(m)}
                  disabled={logged}
                  title={logged ? "Already logged today — edit or remove from the Recovery tab" : `Log ${m.replace("_", " ")}`}
                  className={`px-2.5 py-1 text-xs rounded-md border capitalize ${logged ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)] cursor-default" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {m.replace("_", " ")}
                </button>
              );
            })}
          </div>
          {loggedModalities.size > 0 && (
            <Link to="/app/recovery" className="text-xs text-muted-foreground underline mt-1.5 inline-block">
              View or add detail on the Recovery tab →
            </Link>
          )}
        </div>
        <div className="flex items-center justify-between"><Label>Injury concern?</Label><Switch checked={injury} onCheckedChange={setInjury} /></div>
        {injury && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div>
              <Label className="text-xs">Tap the general area (optional)</Label>
              <div className="mt-2">
                <BodyMapPicker value={injuryRegion} onChange={setInjuryRegion} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Body part</Label>
              <Input value={injuryBodyPart} onChange={(e) => setInjuryBodyPart(e.target.value)} placeholder="e.g. Achilles, calf, hamstring" />
            </div>
            <Textarea placeholder="Describe what's bothering you" value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} />
            <Button size="sm" onClick={logInjuryAndGo} disabled={loggingInjury || !injuryBodyPart.trim()}>
              {loggingInjury ? "Saving…" : <>Log this injury <ArrowRight className="h-3.5 w-3.5 ml-1" /></>}
            </Button>
            <p className="text-xs text-muted-foreground">
              This saves your vitals below first, then opens the injury in Injury Management to add more detail.
            </p>
          </div>
        )}
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
        <CardDescription>Add a block per session — RPE, feel, and any reflection all live here now, not on the session page itself. Bulk-upload multiple files per block; files more than 90 min apart should go in separate blocks.</CardDescription>
      </CardHeader>
      <CardContent>
        <DailyLogSessions athleteId={athleteId} />
      </CardContent>
    </Card>
  );
}

function EndOfDaySection({ athleteId, date }: { athleteId: string; date: string }) {
  const qc = useQueryClient();
  // Lives on daily_checkins.notes — an existing column from the original
  // schema that was never actually wired up to anything. Correcting a
  // mistake from last round: I added a new day_note column via migration
  // when this one was already sitting there unused. Not attached to
  // "whichever session_insights row was most recently created today"
  // anymore either way — that guess broke as soon as a day had more than
  // one session, since which session's row silently absorbed the note
  // depended on save order. This is a genuinely day-level fact, so it
  // belongs on the day-level table, on the column that already existed for it.
  const { data: c } = useQuery({
    queryKey: ["dl-checkin", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase.from("daily_checkins").select("*").eq("athlete_id", athleteId).eq("checkin_date", date).maybeSingle();
      return (data as any) ?? null;
    },
  });
  const [note, setNote] = useState<string>("");
  useEffect(() => { setNote(c?.notes ?? ""); }, [date, c]);
  async function save() {
    const { error } = await supabase
      .from("daily_checkins")
      .upsert({ athlete_id: athleteId, checkin_date: date, notes: note } as any, { onConflict: "athlete_id,checkin_date" });
    if (error) { toast.error(error.message); return; }
    toast.success("End-of-day note saved");
    qc.invalidateQueries({ queryKey: ["dl-checkin", athleteId, date] });
  }
  const isToday = date === todayISO();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isToday ? "End of day note" : "Day note"}</CardTitle>
        <CardDescription>Visible to you and your coach — a day-level note, separate from any one session's own description.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea placeholder={isToday ? "Anything else worth noting about today?" : "Anything else worth noting about this day?"} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button onClick={save}>Save note</Button>
      </CardContent>
    </Card>
  );
}
