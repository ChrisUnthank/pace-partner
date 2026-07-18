import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ChevronLeft, IdCard } from "lucide-react";
import { GoalsCard } from "@/components/goals-card";
import { PhysiologicalTestingCard } from "@/components/physiological-testing-card";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId/performance-profile")({
  component: PerformanceProfilePage,
});

const ATHLETE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "injured", label: "Injured" },
  { value: "off_season", label: "Off-season" },
  { value: "on_hiatus", label: "On hiatus" },
  { value: "retired", label: "Retired" },
];

const ATHLETE_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  injured: "bg-rose-100 text-rose-700 border-rose-200",
  off_season: "bg-slate-100 text-slate-700 border-slate-200",
  on_hiatus: "bg-amber-100 text-amber-700 border-amber-200",
  retired: "bg-muted text-muted-foreground border-border",
};

function PerformanceProfilePage() {
  const { athleteId } = Route.useParams();
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

  const { data: athlete, isLoading } = useQuery({
    queryKey: ["athlete-profile-full", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).single();
      if (error) throw error;
      return data as any;
    },
  });

  // Rolling actuals instead of a hand-typed "current mileage" field — see
  // migration comment. Weekly mileage/time already live accurately on
  // `sessions`; re-asking a coach to retype it would just create a second,
  // easily-stale copy.
  const { data: last28d } = useQuery({
    queryKey: ["athlete-rolling-actuals", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("sessions")
        .select("total_distance_m, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .not("completed_at", "is", null);
      if (error) throw error;
      const totalM = (data ?? []).reduce((a: number, s: any) => a + (s.total_distance_m ?? 0), 0);
      return { totalKm: totalM / 1000, weeklyAvgKm: totalM / 1000 / 4, sessionCount: (data ?? []).length };
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 max-w-5xl">
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/athletes/$athleteId" params={{ athleteId }}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to profile
            </Link>
          </Button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <IdCard className="h-5 w-5 text-[var(--accent-red)]" />
            <h1 className="text-2xl font-bold">{athlete?.name} — Performance Profile</h1>
          </div>
          <Badge variant="outline" className={ATHLETE_STATUS_STYLES[athlete?.athlete_status ?? "active"]}>
            {ATHLETE_STATUS_OPTIONS.find((o) => o.value === athlete?.athlete_status)?.label ?? "Active"}
          </Badge>
        </div>

        <Tabs defaultValue="information" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="information">Athlete Information</TabsTrigger>
            <TabsTrigger value="physiological">Physiological Profile</TabsTrigger>
            <TabsTrigger value="performance">Performance Profile</TabsTrigger>
            <TabsTrigger value="training">Training Profile</TabsTrigger>
            <TabsTrigger value="strengths">Strengths & Development</TabsTrigger>
            <TabsTrigger value="race">Race Profile</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
          </TabsList>

          <TabsContent value="information" className="mt-4">
            <AthleteInformationCard
              athlete={athlete}
              athleteId={athleteId}
              isCoach={isCoach}
              rollingActuals={last28d}
              onSaved={() => qc.invalidateQueries({ queryKey: ["athlete-profile-full", athleteId] })}
            />
          </TabsContent>

          <TabsContent value="physiological" className="mt-4">
            <PhysiologicalTestingCard athleteId={athleteId} />
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <ComingSoonCard
              title="Performance Profile"
              body="Phase 2 — a performance curve across distances (PBs already tracked in Performances), plus relative-strength observations derived from it. The underlying PB data already exists; this tab will visualize it."
            />
          </TabsContent>

          <TabsContent value="training" className="mt-4">
            <ComingSoonCard
              title="Training Profile"
              body="Phase 3 — observed training-response patterns (e.g. typical recovery time after high-intensity sessions), built from existing session/load history."
            />
          </TabsContent>

          <TabsContent value="strengths" className="mt-4">
            <ComingSoonCard
              title="Strengths & Development Areas"
              body="Phase 4 — a coach-editable summary layered on top of the auto-computed archetype already shown on the main athlete profile (Aerobic Engine / Balanced / Speed-Dominant, with speed-reserve bucket)."
            />
          </TabsContent>

          <TabsContent value="race" className="mt-4">
            <ComingSoonCard
              title="Race Profile"
              body="Phase 6 — tactical observations (closing speed, pacing tendencies, box/tactical vulnerabilities), tagged by source: coach, athlete, data-derived, or AI-suggested."
            />
          </TabsContent>

          <TabsContent value="goals" className="mt-4">
            <GoalsCard athleteId={athleteId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ComingSoonCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Not built yet</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}

function AthleteInformationCard({
  athlete,
  athleteId,
  isCoach,
  rollingActuals,
  onSaved,
}: {
  athlete: any;
  athleteId: string;
  isCoach: boolean;
  rollingActuals?: { totalKm: number; weeklyAvgKm: number; sessionCount: number };
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [height, setHeight] = useState(athlete?.height_cm != null ? String(athlete.height_cm) : "");
  const [secondaryEvents, setSecondaryEvents] = useState((athlete?.secondary_events ?? []).join(", "));
  const [club, setClub] = useState(athlete?.club ?? "");
  const [status, setStatus] = useState(athlete?.athlete_status ?? "active");
  const [frequency, setFrequency] = useState(
    athlete?.typical_training_frequency != null ? String(athlete.typical_training_frequency) : "",
  );
  const [saving, setSaving] = useState(false);

  const ageYears = athlete?.dob
    ? Math.floor((Date.now() - new Date(athlete.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("athletes")
      .update({
        height_cm: height ? Number(height) : null,
        secondary_events: secondaryEvents
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        club: club.trim() || null,
        athlete_status: status,
        typical_training_frequency: frequency ? Number(frequency) : null,
      } as any)
      .eq("id", athleteId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Athlete information updated");
    setEditing(false);
    onSaved();
  }

  const rows: Array<[string, string]> = [
    ["Age", ageYears != null ? `${ageYears}y` : "—"],
    ["Date of birth", athlete?.dob ?? "—"],
    ["Sex", athlete?.sex ?? "—"],
    ["Height", athlete?.height_cm != null ? `${athlete.height_cm} cm` : "—"],
    ["Primary event", athlete?.primary_event ?? "—"],
    ["Secondary events", (athlete?.secondary_events ?? []).length ? athlete.secondary_events.join(", ") : "—"],
    ["Training age", athlete?.training_age_years != null ? `${athlete.training_age_years} yrs` : "—"],
    ["Typical training frequency", athlete?.typical_training_frequency != null ? `${athlete.typical_training_frequency}/week` : "—"],
    ["Club", athlete?.club ?? "—"],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Athlete Information</CardTitle>
          <CardDescription>
            Last 28 days actual:{" "}
            {rollingActuals ? `${rollingActuals.totalKm.toFixed(0)} km · ${rollingActuals.sessionCount} sessions (${rollingActuals.weeklyAvgKm.toFixed(0)} km/wk avg)` : "—"}
          </CardDescription>
        </div>
        {isCoach && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between border-b py-1">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums text-right">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Height (cm)</Label>
                <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Typical training frequency (sessions/week)</Label>
                <Input type="number" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Secondary events (comma-separated)</Label>
              <Input value={secondaryEvents} onChange={(e) => setSecondaryEvents(e.target.value)} placeholder="e.g. 800m, 3000m steeplechase" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Club</Label>
                <Input value={club} onChange={(e) => setClub(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATHLETE_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
