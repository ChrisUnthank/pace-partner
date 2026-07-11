import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ZoneBoundariesCard } from "@/components/zone-boundaries-card";
import { paceFmt, secToClock } from "@/lib/format";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/app/zones")({
  component: ZonesPage,
});

// Same palette as the Race Analysis replay page and the session Analysis
// page's ZonePanel, so a zone reads the same color everywhere in the app.
const ZONE_COLORS: Record<string, string> = {
  z1: "#34d399",
  z2: "#38bdf8",
  z3: "#fbbf24",
  z4: "#f97316",
  z5: "#ef4444",
};
const ZONE_LABELS: Record<string, string> = {
  z1: "Z1 Easy",
  z2: "Z2 Aerobic",
  z3: "Z3 Tempo",
  z4: "Z4 VO2/5K",
  z5: "Z5 Rep",
};
const ZONE_KEYS = ["z1", "z2", "z3", "z4", "z5"] as const;

const RANGES = {
  "3m": { days: 91, label: "3 months" },
  "6m": { days: 182, label: "6 months" },
  "12m": { days: 365, label: "12 months" },
} as const;
type RangeKey = keyof typeof RANGES;

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7); // YYYY-MM
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
function dayLabel(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ZonesPage() {
  const { data: athlete } = useMyAthlete();
  const [range, setRange] = useState<RangeKey>("6m");

  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", athlete?.id],
    enabled: !!athlete,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_zone_profiles")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Two-step fetch (sessions in range, then their zone-time rows) rather
  // than a filtered embedded join — session_zone_time has no session_date
  // column of its own, and this mirrors the same pattern already used for
  // the athlete page's volume-by-date query.
  const { data: zoneTimeRaw } = useQuery({
    queryKey: ["zone-time-history", athlete?.id, range],
    enabled: !!athlete,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - RANGES[range].days);
      const sinceStr = since.toISOString().slice(0, 10);

      const { data: sessions, error: sessErr } = await supabase
        .from("sessions")
        .select("id, session_date")
        .eq("athlete_id", athlete!.id)
        .gte("session_date", sinceStr)
        .order("session_date", { ascending: true });
      if (sessErr) throw sessErr;
      const ids = (sessions ?? []).map((s) => s.id);
      if (ids.length === 0) return [];

      const { data: rows, error: zoneErr } = await supabase
        .from("session_zone_time")
        .select("session_id, zone, source, seconds, pace_5k_sec_per_km, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max")
        .in("session_id", ids);
      if (zoneErr) throw zoneErr;

      const dateBySession = new Map((sessions ?? []).map((s) => [s.id, s.session_date as string]));
      return (rows ?? []).map((r) => ({ ...r, session_date: dateBySession.get(r.session_id) ?? null }));
    },
  });

  // Monthly time-in-zone, minutes per zone, split by source (pace vs HR).
  const monthly = useMemo(() => {
    const paceMap = new Map<string, Record<string, number>>();
    const hrMap = new Map<string, Record<string, number>>();
    for (const r of zoneTimeRaw ?? []) {
      if (!r.session_date) continue;
      const mk = monthKey(r.session_date);
      const target = r.source === "pace" ? paceMap : hrMap;
      if (!target.has(mk)) target.set(mk, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
      const bucket = target.get(mk)!;
      bucket[r.zone] = (bucket[r.zone] ?? 0) + Number(r.seconds ?? 0);
    }
    const toArray = (map: Map<string, Record<string, number>>) =>
      Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mk, zones]) => ({
          month: monthLabel(mk),
          ...Object.fromEntries(ZONE_KEYS.map((z) => [z, Math.round((zones[z] ?? 0) / 60)])),
        }));
    return { pace: toArray(paceMap), hr: toArray(hrMap) };
  }, [zoneTimeRaw]);

  // HR zone boundary drift — one point per distinct session date, showing
  // the Z1-Z4 boundaries that were in effect when that session was scored.
  // This doubles as the "how have my zones changed" view even though there's
  // no dedicated threshold-history table: recompute_session_zones snapshots
  // the boundaries onto every session_zone_time row at compute time, so the
  // history rides along with ordinary training data instead of needing a
  // separate log.
  const hrBoundaryHistory = useMemo(() => {
    const bySession = new Map<string, { date: string; z1: number | null; z2: number | null; z3: number | null; z4: number | null }>();
    for (const r of zoneTimeRaw ?? []) {
      if (r.source !== "hr" || !r.session_date || r.hr_z1_max == null) continue;
      bySession.set(r.session_date, {
        date: r.session_date,
        z1: r.hr_z1_max, z2: r.hr_z2_max, z3: r.hr_z3_max, z4: r.hr_z4_max,
      });
    }
    return Array.from(bySession.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, label: dayLabel(d.date) }));
  }, [zoneTimeRaw]);

  // Pace threshold drift — same idea, using the pace-source snapshot.
  // Note: this snapshot column is still named pace_5k_sec_per_km from
  // before the threshold-model migration; it now holds the threshold pace
  // value, not the raw 5K pace. Worth a follow-up migration to rename it
  // for clarity, but the data itself is correct.
  const paceThresholdHistory = useMemo(() => {
    const bySession = new Map<string, { date: string; threshold: number }>();
    for (const r of zoneTimeRaw ?? []) {
      if (r.source !== "pace" || !r.session_date || r.pace_5k_sec_per_km == null) continue;
      bySession.set(r.session_date, { date: r.session_date, threshold: Number(r.pace_5k_sec_per_km) });
    }
    return Array.from(bySession.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, label: dayLabel(d.date) }));
  }, [zoneTimeRaw]);

  const hasAnyZoneTime = (zoneTimeRaw ?? []).length > 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Zones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your training zones, how your time breaks down across them, and how your boundaries have shifted over time.
          </p>
        </div>

        {athlete ? (
          <>
            <ZoneBoundariesCard athleteId={athlete.id} profile={zoneProfile} />

            <div className="flex items-center justify-end gap-1">
              {(Object.keys(RANGES) as RangeKey[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    range === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  }`}
                >
                  {RANGES[r].label}
                </button>
              ))}
            </div>

            {!hasAnyZoneTime ? (
              <Card>
                <CardHeader>
                  <CardTitle>Time in zone</CardTitle>
                  <CardDescription>
                    No zone data yet for this period — complete a session with GPS pace or HR data to start building this up.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <div className="grid lg:grid-cols-2 gap-4">
                <TimeInZoneCard title="Time in zone — pace" data={monthly.pace} />
                <TimeInZoneCard title="Time in zone — heart rate" data={monthly.hr} />
              </div>
            )}

            {hrBoundaryHistory.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>HR zone boundaries over time</CardTitle>
                  <CardDescription>Z1–Z4 boundaries as they stood at each session — shows how thresholds have drifted.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hrBoundaryHistory} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} unit=" bpm" width={60} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          formatter={(v: number, name: string) => [`${v} bpm`, ZONE_LABELS[name] ?? name]}
                        />
                        <Legend
                          formatter={(name: string) => ZONE_LABELS[name] ?? name}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                        {(["z1", "z2", "z3", "z4"] as const).map((z) => (
                          <Line key={z} type="monotone" dataKey={z} stroke={ZONE_COLORS[z]} strokeWidth={2} dot={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {paceThresholdHistory.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Threshold pace over time</CardTitle>
                  <CardDescription>Your threshold pace as it stood at each session.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={paceThresholdHistory} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          width={64}
                          domain={["dataMin - 10", "dataMax + 10"]}
                          tickFormatter={(v: number) => secToClock(v)}
                          reversed
                        />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          formatter={(v: number) => [paceFmt(v), "Threshold pace"]}
                        />
                        <Line type="monotone" dataKey="threshold" stroke="var(--accent-red)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No athlete profile</CardTitle>
              <CardDescription>This page is for athletes — set up your athlete profile first.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function TimeInZoneCard({ title, data }: { title: string; data: any[] }) {
  const empty = data.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Minutes per month, stacked by zone.</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data for this range.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} unit="m" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number, name: string) => [`${v} min`, ZONE_LABELS[name] ?? name]}
                />
                <Legend formatter={(name: string) => ZONE_LABELS[name] ?? name} wrapperStyle={{ fontSize: 11 }} />
                {ZONE_KEYS.map((z) => (
                  <Bar key={z} dataKey={z} stackId="zones" fill={ZONE_COLORS[z]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
