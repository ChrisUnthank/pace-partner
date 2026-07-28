import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Timer } from "lucide-react";
import { clockToSec, secToClock, paceFmt } from "@/lib/format";
import { predictTime, REFERENCE_DISTANCES } from "@/lib/race-predict";

export const Route = createFileRoute("/_authenticated/app/calculators/pacepredictor")({
  component: PacePredictorPage,
});

// Common race distances in km. "Custom" lets someone enter any distance —
// e.g. a road relay leg or a non-standard trail race.
const DISTANCE_OPTIONS = [
  { value: "1500", label: "1500m", km: 1.5 },
  { value: "mile", label: "1 Mile", km: 1.60934 },
  { value: "3k", label: "3K", km: 3 },
  { value: "5k", label: "5K", km: 5 },
  { value: "8k", label: "8K", km: 8 },
  { value: "10k", label: "10K", km: 10 },
  { value: "15k", label: "15K", km: 15 },
  { value: "10mile", label: "10 Mile", km: 16.0934 },
  { value: "half", label: "Half Marathon", km: 21.0975 },
  { value: "marathon", label: "Marathon", km: 42.195 },
  { value: "custom", label: "Custom distance", km: null },
] as const;

function PacePredictorPage() {
  const [distanceKey, setDistanceKey] = useState<string>("5k");
  const [customKm, setCustomKm] = useState<string>("10");
  const [timeInput, setTimeInput] = useState<string>("22:00");

  const distanceKm = useMemo(() => {
    const opt = DISTANCE_OPTIONS.find((d) => d.value === distanceKey);
    if (opt?.km != null) return opt.km;
    const custom = Number(customKm);
    return Number.isFinite(custom) && custom > 0 ? custom : null;
  }, [distanceKey, customKm]);

  const timeSec = clockToSec(timeInput);

  const results = useMemo(() => {
    if (!distanceKm || !timeSec || timeSec <= 0) return null;

    const equivalents = REFERENCE_DISTANCES.map((ref) => {
      const t = predictTime(timeSec, distanceKm, ref.km);
      return { ...ref, timeSec: t, paceSecPerKm: t / ref.km };
    });

    // Training paces, derived entirely from Riegel-predicted equivalent
    // paces at reference distances — not a reproduction of any specific
    // commercial system's exact numbers, just a self-contained model built
    // on the same public formula used above.
    const paceAt = (km: number) => predictTime(timeSec, distanceKm, km) / km;

    const thresholdPace = paceAt(16); // ~15-16K effort, a common tempo/threshold anchor
    const marathonPace = paceAt(42.195);
    const vo2Pace = paceAt(5);
    const repPace = paceAt(1.60934);

    const zones = [
      { name: "Easy", low: thresholdPace * 1.18, high: thresholdPace * 1.3 },
      { name: "Marathon", low: marathonPace * 0.99, high: marathonPace * 1.02 },
      { name: "Threshold / Tempo", low: thresholdPace * 0.98, high: thresholdPace * 1.03 },
      { name: "Interval (VO2 max)", low: vo2Pace * 0.97, high: vo2Pace * 1.02 },
      { name: "Repetition", low: repPace * 0.98, high: repPace * 1.03 },
    ];

    return { equivalents, zones };
  }, [distanceKm, timeSec]);

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link
            to="/app/calculators"
            className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Calculators
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <Timer className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
              <h1 className="text-2xl font-bold leading-tight">Pace / Race Predictor</h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Enter a recent race result to get equivalent times at other distances, plus training paces built from that
            same performance.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent race result</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance</Label>
              <Select value={distanceKey} onValueChange={setDistanceKey}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISTANCE_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {distanceKey === "custom" && (
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className="mt-2"
                  value={customKm}
                  onChange={(e) => setCustomKm(e.target.value)}
                  placeholder="Distance in km"
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Time (mm:ss or h:mm:ss)</Label>
              <Input
                className="mt-1"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                placeholder="22:00"
              />
            </div>
          </CardContent>
        </Card>

        {!results ? (
          <p className="text-sm text-muted-foreground">Enter a valid distance and time above to see predictions.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Equivalent race times</CardTitle>
                <CardDescription>
                  Predicted from your result using Riegel's formula (T2 = T1 × (D2/D1)^1.06).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {results.equivalents.map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="font-medium">{r.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {secToClock(r.timeSec)} <span className="ml-2">{paceFmt(r.paceSecPerKm)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Training paces</CardTitle>
                <CardDescription>
                  Built from the same predicted performance, not a separate lookup table.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {results.zones.map((z) => (
                    <div key={z.name} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="font-medium">{z.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {paceFmt(z.low)} – {paceFmt(z.high)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              These are estimates, most accurate for distances reasonably close to your entered result — a 5K predicts a
              10K well, but predicting a marathon from it leans heavily on the formula alone, since aerobic endurance
              and fueling matter more over that gap than any pace formula can know. Treat the marathon prediction
              especially as a rough guide, not a guarantee.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
