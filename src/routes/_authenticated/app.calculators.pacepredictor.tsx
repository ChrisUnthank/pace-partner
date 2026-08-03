import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Timer, Star, ChevronDown } from "lucide-react";
import { clockToSec, secToClock, paceFmt } from "@/lib/format";
import { REFERENCE_DISTANCES } from "@/lib/race-predict";
import {
  predictAtDistance,
  PROFILE_META,
  PRIMARY_EVENTS,
  CONFIDENCE_META,
  type AthleteProfile,
  type DistancePrediction,
} from "@/lib/performance-predictor";

export const Route = createFileRoute("/_authenticated/app/calculators/pacepredictor")({
  component: PerformancePredictorPage,
});

const PROFILE_ORDER: AthleteProfile[] = ["speed_specialist", "middle_distance", "balanced", "distance", "road_marathon"];

function ConfidenceStars({ tier }: { tier: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${CONFIDENCE_META[tier].label} confidence`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3 w-3 ${n <= tier ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

function PerformancePredictorPage() {
  const [distanceKey, setDistanceKey] = useState<string>("5k");
  const [customKm, setCustomKm] = useState<string>("10");
  const [timeInput, setTimeInput] = useState<string>("22:00");
  const [primaryEventKm, setPrimaryEventKm] = useState<number>(1.5);
  const [profile, setProfile] = useState<AthleteProfile>("balanced");
  const [weeklyVolume, setWeeklyVolume] = useState<string>("");
  const [trainingAge, setTrainingAge] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

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

  const distanceKm = useMemo(() => {
    const opt = DISTANCE_OPTIONS.find((d) => d.value === distanceKey);
    if (opt?.km != null) return opt.km;
    const custom = Number(customKm);
    return Number.isFinite(custom) && custom > 0 ? custom : null;
  }, [distanceKey, customKm]);

  const timeSec = clockToSec(timeInput);

  const predictions: DistancePrediction[] | null = useMemo(() => {
    if (!distanceKm || !timeSec || timeSec <= 0) return null;
    const input = {
      recentDistanceKm: distanceKm,
      recentTimeSec: timeSec,
      primaryEventKm,
      profile,
      weeklyVolumeKm: weeklyVolume.trim() ? Number(weeklyVolume) : null,
      trainingAgeYears: trainingAge.trim() ? Number(trainingAge) : null,
    };
    return REFERENCE_DISTANCES.map((ref) => predictAtDistance(input, ref.label, ref.km)).filter(
      (p): p is DistancePrediction => p != null,
    );
  }, [distanceKm, timeSec, primaryEventKm, profile, weeklyVolume, trainingAge]);

  const shown = predictions?.filter((p) => p.tier >= 3) ?? [];
  const collapsed = predictions?.filter((p) => p.tier < 3) ?? [];

  // Training paces reuse this same profile-adjusted engine's own
  // predictions at fixed anchor distances, rather than a second,
  // separate calculation — so a speed specialist's or marathoner's
  // training paces are now shaped by their profile too, same as their
  // race predictions are, not left on the old one-size-fits-all model.
  const trainingPaces = useMemo(() => {
    if (!predictions) return null;
    const at = (km: number) => predictions.find((p) => Math.abs(p.km - km) < 0.01)?.paceSecPerKm ?? null;
    const thresholdPace = at(16.0934) ?? at(15);
    const marathonPace = at(42.195);
    const vo2Pace = at(5);
    const repPace = at(1.60934);
    if (!thresholdPace) return null;
    const rows: { name: string; low: number; high: number }[] = [
      { name: "Easy", low: thresholdPace * 1.18, high: thresholdPace * 1.3 },
    ];
    if (marathonPace) rows.push({ name: "Marathon", low: marathonPace * 0.99, high: marathonPace * 1.02 });
    rows.push({ name: "Threshold / Tempo", low: thresholdPace * 0.98, high: thresholdPace * 1.03 });
    if (vo2Pace) rows.push({ name: "Interval (VO2 max)", low: vo2Pace * 0.97, high: vo2Pace * 1.02 });
    if (repPace) rows.push({ name: "Repetition", low: repPace * 0.98, high: repPace * 1.03 });
    return rows;
  }, [predictions]);

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
              <h1 className="text-2xl font-bold leading-tight">Performance Predictor</h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            A recent race, read through this athlete's actual event specialty — not the same flat formula assuming
            every athlete trades speed for endurance identically.
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Athlete profile</CardTitle>
            <CardDescription>Shapes how this athlete's pace actually scales with distance — the core fix over a flat formula.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Primary event</Label>
                <Select value={String(primaryEventKm)} onValueChange={(v) => setPrimaryEventKm(Number(v))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIMARY_EVENTS.map((e) => (
                      <SelectItem key={e.label} value={String(e.km)}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Weekly running volume (optional, km)</Label>
                <Input type="number" min={0} className="mt-1" value={weeklyVolume} onChange={(e) => setWeeklyVolume(e.target.value)} placeholder="e.g. 60" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Athlete profile</Label>
              <div className="grid sm:grid-cols-2 gap-2 mt-1">
                {PROFILE_ORDER.map((p) => {
                  const meta = PROFILE_META[p];
                  const selected = profile === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setProfile(p)}
                      className={`text-left rounded-md border p-2.5 text-xs transition-colors hover:border-primary/50 ${
                        selected ? "border-[var(--accent-red)] bg-accent/30" : ""
                      }`}
                    >
                      <div className="font-semibold">{meta.label}</div>
                      <div className="text-muted-foreground mt-0.5">{meta.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sm:w-1/2">
              <Label className="text-xs">Training age (optional, years)</Label>
              <Input type="number" min={0} step={0.5} value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} placeholder="e.g. 4" />
            </div>
          </CardContent>
        </Card>

        {!predictions ? (
          <p className="text-sm text-muted-foreground">Enter a valid distance and time above to see predictions.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Predicted performances</CardTitle>
                <CardDescription>
                  Predictions are strongest around your primary event. Longer- and shorter-distance predictions
                  become less reliable unless supported by specific training.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {shown.map((p) => (
                    <PredictionRow key={p.label} p={p} />
                  ))}
                </div>
                {collapsed.length > 0 && (
                  <div className="border-t">
                    {!showAll ? (
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="h-3.5 w-3.5" /> Show {collapsed.length} lower-confidence prediction{collapsed.length === 1 ? "" : "s"}
                      </button>
                    ) : (
                      <div className="divide-y">
                        {collapsed.map((p) => (
                          <PredictionRow key={p.label} p={p} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {trainingPaces && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Training paces</CardTitle>
                  <CardDescription>Built from the same profile-adjusted predictions above, not a separate lookup table.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {trainingPaces.map((z) => (
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
            )}

            <p className="text-xs text-muted-foreground">
              Predictions combine the standard Riegel formula with an exponent shaped by the declared athlete
              profile — a speed-biased profile fades faster over distance than a flat formula assumes, an
              endurance-biased one holds pace better, in both directions (projecting up AND down in distance).
              Weekly volume only nudges Half Marathon/Marathon-length predictions, where aerobic durability
              actually matters most. None of this replaces real training-specific evidence at an unfamiliar
              distance — a range and a confidence rating, not a guarantee.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function PredictionRow({ p }: { p: DistancePrediction }) {
  const meta = CONFIDENCE_META[p.tier];
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{p.label}</span>
          {p.tier <= 2 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Lower confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <ConfidenceStars tier={p.tier} />
          <span className="text-[11px] text-muted-foreground">{meta.label}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="tabular-nums font-semibold">{secToClock(p.timeSec)}</div>
        <div className="tabular-nums text-xs text-muted-foreground">{paceFmt(p.paceSecPerKm)}</div>
        <div className="tabular-nums text-[11px] text-muted-foreground">
          {secToClock(p.lowSec)}–{secToClock(p.highSec)}
        </div>
      </div>
    </div>
  );
}
