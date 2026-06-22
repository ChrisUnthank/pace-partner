import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const MODALITIES = ["physio", "massage", "sauna", "compression", "ice_bath", "other"] as const;
type Modality = (typeof MODALITIES)[number];

export function VitalsPanel({ athleteId, readOnly = false }: { athleteId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const today = todayISO();

  const { data: history } = useQuery({
    queryKey: ["daily_vitals", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_vitals" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("vitals_date", { ascending: false })
        .limit(30);
      return (data as any[]) ?? [];
    },
  });

  const existingToday = history?.find((r: any) => r.vitals_date === today);

  const [sleepHours, setSleepHours] = useState<string>(existingToday?.sleep_hours ?? "");
  const [restingHr, setRestingHr] = useState<string>(existingToday?.resting_hr ?? "");
  const [weightKg, setWeightKg] = useState<string>(existingToday?.weight_kg ?? "");
  const [hydration, setHydration] = useState<number>(existingToday?.hydration ?? 3);
  const [modalities, setModalities] = useState<Modality[]>(existingToday?.recovery_modalities ?? []);
  const [notes, setNotes] = useState<string>(existingToday?.external_notes ?? "");

  async function save() {
    const payload: any = {
      athlete_id: athleteId,
      vitals_date: today,
      sleep_hours: sleepHours === "" ? null : Number(sleepHours),
      resting_hr: restingHr === "" ? null : Number(restingHr),
      weight_kg: weightKg === "" ? null : Number(weightKg),
      hydration,
      recovery_modalities: modalities,
      external_notes: notes || null,
    };
    const { error } = await supabase
      .from("daily_vitals" as any)
      .upsert(payload, { onConflict: "athlete_id,vitals_date" });
    if (error) toast.error(error.message);
    else {
      toast.success("Vitals saved");
      qc.invalidateQueries({ queryKey: ["daily_vitals", athleteId] });
      qc.invalidateQueries({ queryKey: ["latest_vitals", athleteId] });
    }
  }

  function toggleMod(m: Modality) {
    setModalities((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  const chartData = (history ?? [])
    .slice()
    .reverse()
    .map((r: any) => ({
      date: r.vitals_date,
      sleep: r.sleep_hours != null ? Number(r.sleep_hours) : null,
      rhr: r.resting_hr ?? null,
      weight: r.weight_kg != null ? Number(r.weight_kg) : null,
      hydration: r.hydration ?? null,
    }));

  return (
    <div className="space-y-4">
      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>Daily vitals · {today}{existingToday && <Badge variant="outline" className="ml-2 text-[10px]">Saved</Badge>}</CardTitle>
            <CardDescription>Objective measurements logged once per day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs">Sleep hours</Label><Input type="number" step="0.1" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="7.5" /></div>
              <div><Label className="text-xs">Resting HR (bpm)</Label><Input type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} placeholder="52" /></div>
              <div><Label className="text-xs">Weight (kg)</Label><Input type="number" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="64.5" /></div>
            </div>
            <div>
              <Label className="text-xs">Hydration: {hydration}/5</Label>
              <Slider min={1} max={5} step={1} value={[hydration]} onValueChange={(v) => setHydration(v[0])} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Recovery modalities used today</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {MODALITIES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMod(m)}
                    className={`px-2.5 py-1 text-xs rounded-md border capitalize transition-colors ${modalities.includes(m) ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {m.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">External load notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Long travel day, extra walking, etc." className="mt-1" />
            </div>
            <Button onClick={save} className="w-full">Save vitals</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vitals trend (last 30 days)</CardTitle>
          <CardDescription>Sleep, resting HR, weight & hydration.</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vitals logged yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <MiniChart title="Sleep (hrs)" data={chartData} dataKey="sleep" color="#60a5fa" />
              <MiniChart title="Resting HR (bpm)" data={chartData} dataKey="rhr" color="#FF004C" />
              <MiniChart title="Weight (kg)" data={chartData} dataKey="weight" color="#a78bfa" />
              <MiniChart title="Hydration (1–5)" data={chartData} dataKey="hydration" color="#34d399" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MiniChart({ title, data, dataKey, color }: { title: string; data: any[]; dataKey: string; color: string }) {
  const hasAny = data.some((d) => d[dataKey] != null);
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      <div className="h-32 w-full">
        {!hasAny ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground border rounded border-dashed">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} width={28} domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}