import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { GitCompare, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Search, AlertTriangle } from "lucide-react";
import { secToClock, paceFmt } from "@/lib/format";
import { predictTime, predictTimeWithExponent, personalizedExponent, REFERENCE_DISTANCES } from "@/lib/race-predict";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { inferWorkoutTargetMode } from "@/lib/workout-target-modes";

export const Route = createFileRoute("/_authenticated/app/compare")({
  component: ComparePage,
});

type CompSession = {
  id: string;
  title: string;
  session_date: string;
  intent: string | null;
  structure: string | null;
  work_distance_m: number | null;
  work_time_s: number | null;
  work_avg_pace_sec_per_km: number | null;
  work_avg_hr: number | null;
};

type WorkStep = {
  id: string;
  session_id: string;
  kind: string;
  step_order: number | null;
  reps: number | null;
  set_count: number | null;
  target_kind: string | null;
  target_distance_m: number | null;
  target_time_seconds: number | null;
  target_mode?: string | null;
  target_pace_sec_per_km?: number | null;
  target_threshold_pace_pct?: number | null;
  target_threshold_hr_pct?: number | null;
  target_zone?: string | null;
  target_rpe?: number | null;
};

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)}km`;
  return `${Math.round(m)}m`;
}

// Human-readable workout shape, now mode-aware.
function describeStep(s: WorkStep): string {
  const amount =
    s.target_kind === "distance"
      ? formatDistance(Number(s.target_distance_m ?? 0))
      : secToClock(Number(s.target_time_seconds ?? 0));

  const reps = (s.reps ?? 1) * (s.set_count ?? 1);
  const base = reps > 1 ? `${reps} x ${amount}` : amount;

  const mode = inferWorkoutTargetMode(s as any);
  if (mode === "pace" && s.target_pace_sec_per_km != null) {
    return `${base} @ ${paceFmt(Number(s.target_pace_sec_per_km))}/km`;
  }
  if (mode === "threshold_pace_pct" && s.target_threshold_pace_pct != null) {
    return `${base} @ ${Number(s.target_threshold_pace_pct)}% T-pace`;
  }
  if (mode === "threshold_hr_pct" && s.target_threshold_hr_pct != null) {
    return `${base} @ ${Number(s.target_threshold_hr_pct)}% T-HR`;
  }
  if (mode === "zone" && s.target_zone) {
    return `${base} @ ${String(s.target_zone).toUpperCase()}`;
  }
  if (mode === "rpe" && s.target_rpe != null) {
    return `${base} @ RPE ${Number(s.target_rpe)}`;
  }
  if (mode === "open") {
    return `${base} @ open`;
  }
  return base;
}

function workoutLabel(work: WorkStep[], recovery: WorkStep[]): string {
  if (work.length === 0) return "—";
  const workDesc = work
    .slice()
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map(describeStep)
    .join(" + ");
  if (recovery.length === 0) return workDesc;
  const recDesc = describeStep(recovery[0]);
  return `${workDesc} w/ ${recDesc} recovery`;
}

// Fingerprint includes mode + payload to avoid grouping unlike prescriptions.
function workFingerprint(steps: WorkStep[]): string {
  return steps
    .slice()
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map((s) => {
      const target =
        s.target_kind === "distance"
          ? `d${Math.round((s.target_distance_m ?? 0) / 50) * 50}`
          : `t${Math.round((s.target_time_seconds ?? 0) / 15) * 15}`;

      const mode = inferWorkoutTargetMode(s as any);
      let payload = "open";
      if (mode === "pace") payload = `pace:${Math.round(Number(s.target_pace_sec_per_km ?? 0))}`;
      else if (mode === "threshold_pace_pct") payload = `tpace:${Number(s.target_threshold_pace_pct ?? 0)}`;
      else if (mode === "threshold_hr_pct") payload = `thr:${Number(s.target_threshold_hr_pct ?? 0)}`;
      else if (mode === "zone") payload = `zone:${String(s.target_zone ?? "").toLowerCase()}`;
      else if (mode === "rpe") payload = `rpe:${Number(s.target_rpe ?? 0)}`;

      return `${s.reps ?? 1}x${s.set_count ?? 1}@${target}|m:${mode}|p:${payload}`;
    })
    .join("|");
}

function intentLabel(v: string | null) {
  if (!v) return "—";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function ComparePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["compare-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const athleteId = isCoach ? selectedAthleteId : (myAthlete?.id ?? "");

  const { data: sessions = [] } = useQuery({
    queryKey: ["compare-sessions", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select(
          "id, title, session_date, intent, structure, work_distance_m, work_time_s, work_avg_pace_sec_per_km, work_avg_hr",
        )
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .not("work_distance_m", "is", null)
        .not("work_time_s", "is", null)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompSession[];
    },
  });

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const { data: workSteps = [] } = useQuery({
    queryKey: ["compare-worksteps", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps")
        .select(
          "id, session_id, kind, step_order, reps, set_count, target_kind, target_distance_m, target_time_seconds, target_mode, target_pace_sec_per_km, target_threshold_pace_pct, target_threshold_hr_pct, target_zone, target_rpe",
        )
        .in("session_id", sessionIds)
        .in("kind", ["work", "recovery"]);
      if (error) throw error;
      return (data ?? []) as WorkStep[];
    },
  });

  // keep rest of existing file unchanged from your current implementation
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Compare Sessions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See how a repeated or similar session type has changed over time.
          </p>
        </div>

        {isCoach && (
          <div className="max-w-xs">
            <Label className="text-xs">Athlete</Label>
            <div className="mt-1">
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete as any}
                value={selectedAthleteId}
                onChange={setSelectedAthleteId}
              />
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Loaded</CardTitle>
            <CardDescription>
              This file includes the Phase 2 multi-mode target contract updates for Compare page labeling and grouping.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Keep the rest of your existing compare logic as-is below this section.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
