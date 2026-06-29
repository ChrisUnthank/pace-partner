import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Trophy } from "lucide-react";
import { metersFmt, secToClock, clockToSec, paceFmt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/races/$raceId/analysis")({
  component: RaceAnalysisPage,
});

type Split = { id: string; distance: string; time: string };

function newSplit(): Split {
  return { id: crypto.randomUUID(), distance: "", time: "" };
}

function RaceAnalysisPage() {
  const { raceId } = Route.useParams();

  const { data: race, isLoading } = useQuery({
    queryKey: ["race", raceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("*")
        .eq("id", raceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [splits, setSplits] = useState<Split[]>([newSplit()]);

  function update(id: string, patch: Partial<Split>) {
    setSplits((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function remove(id: string) {
    setSplits((s) => (s.length === 1 ? [newSplit()] : s.filter((x) => x.id !== id)));
  }
  function add() {
    setSplits((s) => [...s, newSplit()]);
  }

  const avgPace =
    race?.distance_m && race?.time_seconds
      ? (race.time_seconds / race.distance_m) * 1000
      : null;

  const computed = splits.map((s) => {
    const d = Number(s.distance);
    const t = clockToSec(s.time);
    const pace = d > 0 && t != null ? (t / d) * 1000 : null;
    return { ...s, d, t, pace };
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[var(--accent-red)]" />
          <div>
            <h1 className="text-2xl font-bold">Race Analysis</h1>
            {race && (
              <p className="text-sm text-muted-foreground">
                {race.event_name || "Race"} · {race.performance_date}
              </p>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !race ? (
          <p className="text-sm text-muted-foreground">Race not found.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4">
                <Stat label="Distance" value={metersFmt(race.distance_m)} />
                <Stat label="Time" value={secToClock(race.time_seconds)} />
                <Stat label="Avg pace" value={paceFmt(avgPace)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Splits</CardTitle>
                <CardDescription>
                  Enter distance and time per split. Pace is computed live.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-[40px_1fr_1fr_110px_40px] gap-2 text-xs text-muted-foreground px-1">
                  <div>#</div>
                  <div>Distance (m)</div>
                  <div>Time (mm:ss)</div>
                  <div>Pace</div>
                  <div></div>
                </div>

                {computed.map((s, i) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-[40px_1fr_1fr_110px_40px] gap-2 items-center"
                  >
                    <div className="text-sm text-muted-foreground tabular-nums">{i + 1}</div>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={s.distance}
                      onChange={(e) => update(s.id, { distance: e.target.value })}
                    />
                    <Input
                      placeholder="3:00"
                      value={s.time}
                      onChange={(e) => update(s.id, { time: e.target.value })}
                    />
                    <div className="tabular-nums text-sm">
                      {s.pace ? paceFmt(s.pace) : "—"}
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <Button variant="outline" size="sm" onClick={add}>
                  <Plus className="h-4 w-4" /> Add split
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
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