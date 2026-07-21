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
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Droplet, Flame } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/diet-fuel")({
  component: DietFuel,
});

function DietFuel() {
  const { data: athlete, isLoading } = useMyAthlete();
  // Same date-nav pattern as Daily Log — defaults to today, can be moved
  // back to fill in a missed day. Nutrition below is keyed off this date;
  // the sessions list below it shows whatever sessions actually fall on
  // this date, same as how Daily Log's own sessions section works.
  const [logDate, setLogDate] = useState(todayISO());

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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Diet & Fuel</h1>
            <p className="text-sm text-muted-foreground">
              Daily nutrition totals, plus each session's fueling — fueling itself is logged on the session.
            </p>
          </div>
          <DateNav date={logDate} onChange={setLogDate} />
        </div>
        <BucketTabStrip items={HEALTH_TABS} active="/app/diet-fuel" />
        <NutritionSection athleteId={athlete.id} date={logDate} />
        <SessionsFuelingSection athleteId={athlete.id} date={logDate} />
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

function NutritionSection({ athleteId, date }: { athleteId: string; date: string }) {
  const qc = useQueryClient();
  const { data: n } = useQuery({
    queryKey: ["diet-nutrition", athleteId, date],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_nutrition")
        .select("*")
        .eq("athlete_id", athleteId)
        .eq("nutrition_date", date)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  const [calories, setCalories] = useState<string>("");
  const [protein, setProtein] = useState<string>("");
  const [carbs, setCarbs] = useState<string>("");
  const [fat, setFat] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    setCalories(n?.calories != null ? String(n.calories) : "");
    setProtein(n?.protein_g != null ? String(n.protein_g) : "");
    setCarbs(n?.carbs_g != null ? String(n.carbs_g) : "");
    setFat(n?.fat_g != null ? String(n.fat_g) : "");
    setNotes(n?.notes ?? "");
  }, [date, n]);

  async function save() {
    const payload = {
      athlete_id: athleteId,
      nutrition_date: date,
      calories: calories === "" ? null : Number(calories),
      protein_g: protein === "" ? null : Number(protein),
      carbs_g: carbs === "" ? null : Number(carbs),
      fat_g: fat === "" ? null : Number(fat),
      notes: notes || null,
    };
    const { error } = await supabase
      .from("daily_nutrition")
      .upsert(payload as any, { onConflict: "athlete_id,nutrition_date" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Nutrition saved");
    qc.invalidateQueries({ queryKey: ["diet-nutrition", athleteId, date] });
  }

  const isToday = date === todayISO();
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isToday ? "Today's nutrition" : `Nutrition — ${dateLabel}`}</CardTitle>
        <CardDescription>Daily totals — editable any time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Calories</Label>
            <Input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="2400" />
          </div>
          <div>
            <Label className="text-xs">Protein (g)</Label>
            <Input type="number" step="0.1" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="120" />
          </div>
          <div>
            <Label className="text-xs">Carbs (g)</Label>
            <Input type="number" step="0.1" value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="300" />
          </div>
          <div>
            <Label className="text-xs">Fat (g)</Label>
            <Input type="number" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="80" />
          </div>
        </div>
        <Textarea
          placeholder="Anything worth noting — appetite, meal timing, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button onClick={save} className="w-full">
          Save nutrition
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionsFuelingSection({ athleteId, date }: { athleteId: string; date: string }) {
  const { data: sessions } = useQuery({
    queryKey: ["diet-sessions", athleteId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, session_date, fueling_carbs_g, fueling_fluid_ml, fueling_sodium_mg, fueling_notes")
        .eq("athlete_id", athleteId)
        .eq("session_date", date)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session fueling</CardTitle>
        <CardDescription>Carbs, fluid, and sodium logged on each session — open a session to add or edit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!sessions || sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions logged on this day yet.</p>
        ) : (
          sessions.map((s) => {
            const hasFueling =
              s.fueling_carbs_g != null || s.fueling_fluid_ml != null || s.fueling_sodium_mg != null || s.fueling_notes;
            return (
              <Link
                key={s.id}
                to="/app/sessions/$sessionId"
                params={{ sessionId: s.id }}
                className="flex items-center justify-between gap-3 p-3 rounded-md border border-border hover:bg-sidebar-accent/40 transition-colors"
              >
                <span className="text-sm font-medium truncate">{s.title ?? "Session"}</span>
                {hasFueling ? (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    {s.fueling_carbs_g != null && (
                      <span className="flex items-center gap-1">
                        <Flame className="h-3 w-3" /> {s.fueling_carbs_g}g carbs
                      </span>
                    )}
                    {s.fueling_fluid_ml != null && (
                      <span className="flex items-center gap-1">
                        <Droplet className="h-3 w-3" /> {s.fueling_fluid_ml}ml
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0">Not logged</span>
                )}
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
