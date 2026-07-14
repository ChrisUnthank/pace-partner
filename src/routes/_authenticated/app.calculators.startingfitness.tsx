import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Gauge } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/calculators/starting-fitness")({
  component: StartingFitnessPage,
});

// Same RPE-equivalent values session_training_load() already uses server-side
// (day_type for non-training days, intent for training days) — kept in sync
// manually since this is a client-side estimate mirroring a DB function, not
// a shared library. If that function's table ever changes, update this too.
const CALC_OPTIONS = [
  { value: "rest", label: "Rest day", rpe: 0 },
  { value: "recovery", label: "Recovery", rpe: 2 },
  { value: "easy", label: "Easy", rpe: 3 },
  { value: "cross_training", label: "Cross-training", rpe: 4 },
  { value: "aerobic", label: "Aerobic / Long", rpe: 5 },
  { value: "tempo", label: "Tempo", rpe: 6 },
  { value: "threshold", label: "Threshold", rpe: 7 },
  { value: "vo2", label: "VO2 max", rpe: 8 },
  { value: "anaerobic", label: "Anaerobic", rpe: 8 },
  { value: "speed", label: "Speed / Reps", rpe: 8 },
  { value: "race", label: "Race", rpe: 9 },
] as const;

const RPE_BY_VALUE: Record<string, number> = Object.fromEntries(CALC_OPTIONS.map((o) => [o.value, o.rpe]));

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type DayRow = { kind: string; minutes: string };

function defaultRows(): DayRow[] {
  return DAYS.map(() => ({ kind: "easy", minutes: "45" }));
}

function StartingFitnessPage() {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["calc-fitness-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");
  const athleteId = isCoach ? selectedAthleteId : myAthlete?.id ?? "";

  const { data: athlete } = useQuery({
    queryKey: ["calc-fitness-athlete", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("athletes")
        .select("id, name, seed_ctl, seed_atl, seed_set_at")
        .eq("id", athleteId)
        .maybeSingle();
      return data;
    },
  });

  // Whether this athlete already has any tracked history — the seed only
  // takes effect on an athlete's very first tracked day, so once real data
  // exists, setting or changing it here wouldn't actually do anything to
  // history that's already been computed.
  const { data: historyCount } = useQuery({
    queryKey: ["calc-fitness-history-count", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { count } = await supabase
        .from("athlete_load_daily")
        .select("id", { count: "exact", head: true })
        .eq("athlete_id", athleteId)
        .not("combined_load", "is", null)
        .gt("combined_load", 0);
      return count ?? 0;
    },
  });

  const [rows, setRows] = useState<DayRow[]>(defaultRows());
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const estimate = useMemo(() => {
    const totals = rows.map((r) => {
      const rpe = RPE_BY_VALUE[r.kind] ?? 0;
      const minutes = r.kind === "rest" ? 0 : Number(r.minutes) || 0;
      return rpe * minutes;
    });
    const sum = totals.reduce((a, b) => a + b, 0);
    return Math.round(sum / DAYS.length);
  }, [rows]);

  const alreadyTracking = (historyCount ?? 0) > 0;
  const hasSeed = athlete?.seed_ctl != null;

  async function saveEstimate() {
    if (!athleteId) return;
    setSaving(true);
    const { error } = await supabase
      .from("athletes")
      .update({ seed_ctl: estimate, seed_atl: estimate, seed_set_at: new Date().toISOString() } as any)
      .eq("id", athleteId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Starting fitness saved");
    qc.invalidateQueries({ queryKey: ["calc-fitness-athlete", athleteId] });
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link
            to="/app/calculators"
            className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Calculators
          </Link>
          <h1 className="text-2xl font-bold mt-1 flex items-center gap-2">
            <Gauge className="h-5 w-5" /> Starting Fitness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A brand-new athlete profile starts Fitness/Fatigue at zero, even if they've actually been training for
            months or years. This gives them a real starting point instead.
          </p>
        </div>

        <Card className="bg-accent/30">
          <CardContent className="pt-6 text-sm space-y-2">
            <p>
              <strong>Best option first:</strong> if you can, backfill at least{" "}
              <strong>2 weeks of the athlete's actual recent training</strong> — uploaded FIT/GPX files are best,
              manual entry works too — dated in the past via the Calendar or Sessions page. Real logged sessions are
              always more accurate than any estimate, and this app already handles that directly with no separate
              tool needed.
            </p>
            <p>
              <strong>If that's not practical</strong>, use the quick estimate below instead — describe a typical
              recent training week and this gives Fitness/Fatigue a reasonable non-zero starting point.
            </p>
            <p className="text-muted-foreground">
              Either way: this only shapes the picture for roughly the first 3-4 months. The underlying calculation
              naturally lets a starting estimate fade as real training accumulates — it isn't a permanent number, just
              a better starting guess than zero.
            </p>
          </CardContent>
        </Card>

        {isCoach && (
          <div className="max-w-xs">
            <Label className="text-xs">Athlete</Label>
            <Select value={selectedAthleteId} onValueChange={setSelectedAthleteId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select an athlete" />
              </SelectTrigger>
              <SelectContent>
                {(roster ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!athleteId ? (
          <p className="text-sm text-muted-foreground">
            {isCoach ? "Select an athlete above to continue." : "No athlete profile linked."}
          </p>
        ) : alreadyTracking ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Already tracking</CardTitle>
              <CardDescription>
                {athlete?.name ?? "This athlete"} already has {historyCount} day{historyCount === 1 ? "" : "s"} of
                real tracked history.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A starting estimate only takes effect on an athlete's very first tracked day — it can't be applied
              retroactively from here now that real data exists. If the current Fitness/Fatigue picture looks wrong
              and needs correcting, that's a manual recompute rather than a self-service change on this page — let's
              talk through it directly if that's what's needed.
            </CardContent>
          </Card>
        ) : (
          <>
            {hasSeed && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">Current estimate: {athlete?.seed_ctl}</Badge>
                <span className="text-xs text-muted-foreground">
                  Set {athlete?.seed_set_at ? new Date(athlete.seed_set_at).toLocaleDateString() : ""} — saving below
                  will replace it.
                </span>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">A typical recent training week</CardTitle>
                <CardDescription>
                  For each day, pick what it usually looks like and roughly how long. Doesn't need to be exact — this
                  is a starting estimate, not a record.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {DAYS.map((day, i) => {
                  const row = rows[i];
                  const isRest = row.kind === "rest";
                  return (
                    <div key={day} className="grid grid-cols-[100px_1fr_110px] gap-2 items-center">
                      <span className="text-sm text-muted-foreground">{day}</span>
                      <Select value={row.kind} onValueChange={(v) => updateRow(i, { kind: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CALC_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        disabled={isRest}
                        value={isRest ? "" : row.minutes}
                        placeholder={isRest ? "—" : "min"}
                        onChange={(e) => updateRow(i, { minutes: e.target.value })}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Estimated starting Fitness &amp; Fatigue</p>
                  <p className="text-2xl font-bold tabular-nums">{estimate}</p>
                </div>
                <Button onClick={saveEstimate} disabled={saving || estimate === 0}>
                  {saving ? "Saving…" : hasSeed ? "Update estimate" : "Save as starting point"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
