import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useCoachRoster } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";
import { todayISO } from "@/lib/format";
import { AlertTriangle, Search } from "lucide-react";

const searchSchema = z.object({
  // Present when a coach arrives via a specific athlete's tab strip —
  // shows that athlete's own snapshot instead of the roster overview.
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/health")({
  validateSearch: searchSchema,
  component: HealthPage,
});

function daysAgo(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T00:00:00").getTime();
  const now = new Date(todayISO() + "T00:00:00").getTime();
  return Math.round((now - then) / 86400000);
}

function HealthPage() {
  const search = Route.useSearch();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

  // Coach arriving for a specific athlete (via that athlete's tab strip) —
  // same snapshot the athlete sees for themselves below, just
  // parameterized by the given athleteId instead of the logged-in user's
  // own athlete row, plus the AthleteSubnav for further navigation.
  if (isCoach && search.athleteId) {
    return (
      <AppShell>
        <CoachAthleteHealthView athleteId={search.athleteId} />
      </AppShell>
    );
  }

  // Coaches get a roster overview instead of the self-service snapshot
  // below — same page, same nav entry, branching by role like Zones and
  // Analytics already do.
  if (isCoach) {
    return (
      <AppShell>
        <CoachHealthRoster />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AthleteHealthView />
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// Shared: latest vitals + check-in snapshot for one athlete
// ----------------------------------------------------------------------------

function useLatestHealthSnapshot(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["latest-health-snapshot", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const [{ data: v, error: vErr }, { data: c, error: cErr }] = await Promise.all([
        supabase
          .from("daily_vitals")
          .select("*")
          .eq("athlete_id", athleteId!)
          .order("vitals_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("daily_checkins")
          .select("*")
          .eq("athlete_id", athleteId!)
          .order("checkin_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (vErr) throw vErr;
      if (cErr) throw cErr;
      return { vitals: v as any, checkin: c as any };
    },
  });
}

function HealthSnapshotCard({ snapshot }: { snapshot: { vitals: any; checkin: any } | undefined }) {
  const v = snapshot?.vitals;
  const c = snapshot?.checkin;
  const lastDate = [v?.vitals_date, c?.checkin_date].filter(Boolean).sort().pop();

  if (!lastDate) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">No vitals logged yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          Latest entry
          <span className="text-sm font-normal text-muted-foreground">
            {new Date(lastDate + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </CardTitle>
        <CardDescription>
          Pulled from Daily Log — this page will grow to cover diet/fuel, recovery, injuries, bicarb, and lactate too.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Sleep" value={v?.sleep_hours != null ? `${v.sleep_hours}h` : "—"} />
          <Stat label="Resting HR" value={v?.resting_hr != null ? `${v.resting_hr} bpm` : "—"} />
          <Stat label="Weight" value={v?.weight_kg != null ? `${v.weight_kg} kg` : "—"} />
          <Stat label="Soreness" value={c?.soreness != null ? `${c.soreness}/5` : "—"} />
        </div>
        {c?.injury_flag && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Injury concern flagged</p>
              {c.injury_notes && <p className="text-xs text-muted-foreground mt-0.5">{c.injury_notes}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Athlete self-service snapshot
// ----------------------------------------------------------------------------

function AthleteHealthView() {
  const { data: athlete } = useMyAthlete();
  const { data: snapshot, isLoading } = useLatestHealthSnapshot(athlete?.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Health & Vitals</h1>
        <p className="text-sm text-muted-foreground mt-1">Vitals, recovery, and injury status in one place.</p>
      </div>
      <BucketTabStrip items={HEALTH_TABS} active="/app/health" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <HealthSnapshotCard snapshot={snapshot} />}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">Log today's vitals, sessions, and end-of-day note.</p>
          <Link
            to="/app/daily-log"
            className="text-sm font-medium text-[var(--accent-red)] hover:underline whitespace-nowrap"
          >
            Open Daily Log →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Coach: one athlete's snapshot (arrived via AthleteSubnav)
// ----------------------------------------------------------------------------

function CoachAthleteHealthView({ athleteId }: { athleteId: string }) {
  const { data: athlete } = useQuery({
    queryKey: ["health-athlete-name", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").eq("id", athleteId).single();
      if (error) throw error;
      return data as any;
    },
  });
  const { data: snapshot, isLoading } = useLatestHealthSnapshot(athleteId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{athlete?.name ?? "Athlete"} — Health & Vitals</h1>
      </div>
      <AthleteSubnav athleteId={athleteId} active="health" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <HealthSnapshotCard snapshot={snapshot} />}
      {/* Daily Log itself is still self-service (athlete-only) — a coach
          view of another athlete's Daily Log entries is a follow-up piece,
          not yet built. This snapshot is read from the same daily_vitals /
          daily_checkins rows so it stays accurate without that. */}
      <p className="text-xs text-muted-foreground">
        Daily Log is still self-service for the athlete only, so it isn't linked from here yet — this snapshot reads
        the same underlying data.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Coach: roster overview
// ----------------------------------------------------------------------------

function CoachHealthRoster() {
  const { data: roster } = useCoachRoster();
  const [search, setSearch] = useState("");

  const athletes = useMemo(() => (roster ?? []).map((r: any) => r.athletes).filter(Boolean), [roster]);
  const athleteIds = useMemo(() => athletes.map((a: any) => a.id), [athletes]);

  const { data: vitalsRows } = useQuery({
    queryKey: ["roster-latest-vitals", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_vitals")
        .select("athlete_id, vitals_date")
        .in("athlete_id", athleteIds)
        .order("vitals_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: checkinRows } = useQuery({
    queryKey: ["roster-latest-checkins", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_checkins")
        .select("athlete_id, checkin_date, injury_flag")
        .in("athlete_id", athleteIds)
        .order("checkin_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Most recent log date (vitals or check-in, whichever is newer) and
  // whether the most recent check-in flagged an injury concern. Both
  // queries arrive newest-first, so the first check-in row seen per
  // athlete is their latest — later (older) rows for the same athlete are
  // ignored rather than overwriting the flag.
  const summaryByAthlete = useMemo(() => {
    const map = new Map<string, { lastDate: string | null; injuryFlag: boolean }>();
    for (const id of athleteIds) map.set(id, { lastDate: null, injuryFlag: false });
    for (const r of vitalsRows ?? []) {
      const cur = map.get(r.athlete_id);
      if (cur && (!cur.lastDate || r.vitals_date > cur.lastDate)) cur.lastDate = r.vitals_date;
    }
    const seenCheckin = new Set<string>();
    for (const r of checkinRows ?? []) {
      const cur = map.get(r.athlete_id);
      if (!cur) continue;
      if (!cur.lastDate || r.checkin_date > cur.lastDate) cur.lastDate = r.checkin_date;
      if (!seenCheckin.has(r.athlete_id)) {
        seenCheckin.add(r.athlete_id);
        cur.injuryFlag = !!r.injury_flag;
      }
    }
    return map;
  }, [vitalsRows, checkinRows, athleteIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? athletes.filter((a: any) => a.name?.toLowerCase().includes(q)) : athletes;
    return [...list].sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [athletes, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Health & Vitals</h1>
          <p className="text-sm text-muted-foreground mt-1">Latest log date and injury flags across your roster.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" className="pl-8 h-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              {athletes.length === 0 ? "No athletes on your roster yet." : "No athletes match that search."}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((a: any) => {
                const summary = summaryByAthlete.get(a.id);
                const age = daysAgo(summary?.lastDate ?? null);
                return (
                  <Link
                    key={a.id}
                    to="/app/health"
                    search={{ athleteId: a.id } as any}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-sidebar-accent/40 transition-colors"
                  >
                    <span className="font-medium text-sm">{a.name}</span>
                    <div className="flex items-center gap-2">
                      {summary?.injuryFlag && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" /> Injury
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {age === null ? "No entries yet" : age === 0 ? "Logged today" : `${age}d ago`}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
