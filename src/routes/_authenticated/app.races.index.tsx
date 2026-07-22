import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock, clockToSec, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Trophy, Flag, CalendarClock, Medal, TrendingUp } from "lucide-react";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const searchSchema = z.object({
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/races/")({
  validateSearch: searchSchema,
  component: RacesPage,
});

const COMMON_DISTANCES = [
  { m: 800, label: "800m" },
  { m: 1500, label: "1500m" },
  { m: 1609, label: "Mile" },
  { m: 3000, label: "3000m" },
  { m: 5000, label: "5000m" },
  { m: 10000, label: "10K" },
  { m: 21097, label: "Half marathon" },
  { m: 42195, label: "Marathon" },
];

// --- shared helpers (mirrors the progression chart on the athlete detail /
// own-profile pages, so "race times over time" reads the same everywhere) ---

function raceTypeLabel(rt: string | null) {
  switch (rt) {
    case "track":
      return "Track";
    case "road":
      return "Road";
    case "cross_country":
      return "XC";
    default:
      return "Race";
  }
}

function formatChartDate(dateStr: string) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// Athlete's primary event is free text (e.g. "1500m", "5km") — pull a
// distance out of it so the progression chart can default to it.
function primaryEventDistanceM(text: string | null | undefined): number | null {
  if (!text) return null;
  const e = text.trim().toLowerCase();
  if (/^1\s*mile$/i.test(e)) return 1609;
  const km = e.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (km) return Math.round(Number(km[1]) * 1000);
  const m = e.match(/(\d+)\s*m/i);
  if (m) return Number(m[1]);
  return null;
}

// Simple least-squares linear regression over day-offset from the first
// performance, rendered as a second dashed line overlaid on actual times.
function addLinearTrend<T extends { date: string; seconds: number }>(data: T[]): (T & { trend: number | null })[] {
  if (data.length < 2) return data.map((d) => ({ ...d, trend: null }));
  const t0 = new Date(data[0].date + "T00:00:00Z").getTime();
  const xs = data.map((d) => (new Date(d.date + "T00:00:00Z").getTime() - t0) / 86400000);
  const ys = data.map((d) => d.seconds);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return data.map((d) => ({ ...d, trend: d.seconds }));
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return data.map((d, i) => ({ ...d, trend: slope * xs[i] + intercept }));
}

// Buckets races into the last 12 calendar months (including empty months)
// so gaps in racing show up as clearly as clusters do.
function buildMonthlyFrequency(races: any[]) {
  const now = new Date();
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    buckets.push({ key, label, count: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of races) {
    const key = String(r.performance_date ?? "").slice(0, 7);
    const b = byKey.get(key);
    if (b) b.count += 1;
  }
  return buckets;
}

function RacesPage() {
  const search = Route.useSearch();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const { data: roster } = useQuery({
    queryKey: ["races-roster", user?.id, isCoach],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_athletes")
        .select("athletes(id, name, primary_event, profile_image_url)")
        .eq("coach_user_id", user!.id);

      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [athleteId, setAthleteId] = useState<string>(search.athleteId ?? "");
  // Re-syncs whenever the URL's athleteId changes underneath this page —
  // e.g. clicking "Races" from a different athlete's full view while this
  // page is already open — rather than only reading it once on mount.
  useEffect(() => {
    if (search.athleteId) setAthleteId(search.athleteId);
  }, [search.athleteId]);
  const activeAthleteId = athleteId || myAthlete?.id || "";
  const activeAthlete =
    activeAthleteId === myAthlete?.id ? myAthlete : (roster ?? []).find((a: any) => a.id === activeAthleteId);

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        {isCoach && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <Link to="/app/athletes" className="hover:text-foreground">
              Athletes
            </Link>
            {activeAthleteId && (
              <>
                <span className="text-border">/</span>
                <Link
                  to="/app/athletes/$athleteId"
                  params={{ athleteId: activeAthleteId }}
                  className="hover:text-foreground"
                >
                  {activeAthlete?.name ?? "Athlete"}
                </Link>
              </>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[var(--accent-red)]" />
            <h1 className="text-2xl font-bold">Race results</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isCoach && (
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete as any}
                value={activeAthleteId}
                onChange={setAthleteId}
              />
            )}
            {activeAthleteId && (
              <Button asChild variant="outline" size="sm">
                <Link to="/app/race-tactics" search={{ athleteId: activeAthleteId } as any}>
                  <Flag className="h-4 w-4 mr-1" /> Race Tactics
                </Link>
              </Button>
            )}
          </div>
        </div>

        {isCoach && activeAthleteId && <AthleteSubnav athleteId={activeAthleteId} active="races" />}

        {activeAthleteId ? (
          <RaceList athleteId={activeAthleteId} primaryEvent={activeAthlete?.primary_event ?? null} />
        ) : (
          <p className="text-sm text-muted-foreground">Pick an athlete to view race results.</p>
        )}
      </div>
    </AppShell>
  );
}

function RaceList({ athleteId, primaryEvent }: { athleteId: string; primaryEvent: string | null }) {
  const qc = useQueryClient();
  const [scrollY, setScrollY] = useState(0);
  const { data: races } = useQuery({
    queryKey: ["races", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("performance_date", { ascending: false });

      return data ?? [];
    },
  });

  useEffect(() => {
    if (scrollY > 0) {
      window.scrollTo({ top: scrollY });
    }
  }, [races]);

  const [date, setDate] = useState(todayISO());
  const [distance, setDistance] = useState<number>(5000);
  const [distanceMode, setDistanceMode] = useState<"preset" | "custom">("preset");
  const [customDistance, setCustomDistance] = useState<string>("");
  const [time, setTime] = useState("");
  const [event, setEvent] = useState("");
  const [raceType, setRaceType] = useState<string>("road");
  const [placing, setPlacing] = useState("");
  const [notes, setNotes] = useState("");

  async function add() {
    setScrollY(window.scrollY);

    const sec = clockToSec(time);

    if (sec === null || sec === undefined || isNaN(sec)) {
      toast.error("Time required (mm:ss or h:mm:ss)");
      return;
    }

    const finalDistance = distanceMode === "custom" ? Number(customDistance) : distance;

    if (!finalDistance || isNaN(finalDistance) || finalDistance <= 0) {
      toast.error("Enter a valid distance in meters");
      return;
    }

    const { error } = await supabase.from("performances").insert({
      athlete_id: athleteId,
      performance_date: date,
      distance_m: finalDistance,
      time_seconds: sec,
      event_name: event || null,
      race_type: raceType || null,
      overall_place: placing ? Number(placing) : null,
      notes: notes || null,
      is_pb: false,
      context: "race",
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Race added");
    setTime("");
    setEvent("");
    setPlacing("");
    setNotes("");

    qc.invalidateQueries({ queryKey: ["races", athleteId] });
    qc.invalidateQueries({ queryKey: ["my-pbs", athleteId] });
  }

  async function remove(id: string) {
    setScrollY(window.scrollY);

    const { error } = await supabase.from("performances").delete().eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    qc.invalidateQueries({ queryKey: ["races", athleteId] });
  }

  // PB per distance
  const pbByDist = new Map<number, number>();
  for (const r of races ?? []) {
    const cur = pbByDist.get(r.distance_m);
    if (cur == null || r.time_seconds < cur) {
      pbByDist.set(r.distance_m, r.time_seconds);
    }
  }

  const stats = useMemo(() => {
    const list = races ?? [];
    const currentYear = new Date().getFullYear();
    const racesThisYear = list.filter((r: any) => Number(String(r.performance_date).slice(0, 4)) === currentYear).length;
    const lastRace = list[0] ?? null;
    const daysSinceLast = lastRace
      ? Math.max(0, Math.floor((Date.now() - new Date(lastRace.performance_date + "T00:00:00Z").getTime()) / 86400000))
      : null;
    return {
      total: list.length,
      thisYear: racesThisYear,
      pbCount: pbByDist.size,
      daysSinceLast,
    };
  }, [races]);

  const monthlyFrequency = useMemo(() => buildMonthlyFrequency(races ?? []), [races]);

  return (
    <div className="space-y-6">
      {/* Quick stats — full width, above both columns */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile icon={<Trophy className="h-4 w-4" />} label="Total races" value={String(stats.total)} />
        <StatTile icon={<CalendarClock className="h-4 w-4" />} label="This year" value={String(stats.thisYear)} />
        <StatTile icon={<Medal className="h-4 w-4" />} label="PBs held" value={String(stats.pbCount)} />
        <StatTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Last race"
          value={stats.daysSinceLast == null ? "—" : stats.daysSinceLast === 0 ? "Today" : `${stats.daysSinceLast}d ago`}
        />
      </div>

      {/* Add race (left third) + Results (right two-thirds) — same row.
          Results is capped to roughly the Add race form's height and
          scrolls internally past that, instead of stretching the row. */}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr] items-start">
      <div className="order-2 lg:order-1">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add race (manual)</CardTitle>
            <CardDescription>
              Manual entry for races without GPS or historical results. Races will feed PBs and the physiological profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 opacity-90">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Distance</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={distanceMode === "preset" ? "default" : "outline"}
                  onClick={() => setDistanceMode("preset")}
                >
                  Preset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={distanceMode === "custom" ? "default" : "outline"}
                  onClick={() => setDistanceMode("custom")}
                >
                  Custom
                </Button>
              </div>

              {distanceMode === "preset" ? (
                <Select value={String(distance)} onValueChange={(v) => setDistance(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_DISTANCES.map((d) => (
                      <SelectItem key={d.m} value={String(d.m)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  placeholder="e.g. 7400"
                  value={customDistance}
                  onChange={(e) => setCustomDistance(e.target.value)}
                />
              )}
            </div>

            <div>
              <Label className="text-xs">Surface</Label>
              <Select value={raceType} onValueChange={setRaceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="track">Track</SelectItem>
                  <SelectItem value="road">Road</SelectItem>
                  <SelectItem value="cross_country">Cross country</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Time</Label>
              <Input placeholder="16:32" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs">Event name</Label>
              <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="London Champs 5000m" />
            </div>

            <div>
              <Label className="text-xs">Placing</Label>
              <Input type="number" value={placing} onChange={(e) => setPlacing(e.target.value)} placeholder="Optional" />
            </div>

            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <Button onClick={add} className="w-full">
              Add race
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Results — right two-thirds on desktop. Capped to roughly the Add
          race form's height so the two cards read as one row; the list
          scrolls internally once it's longer than that. */}
      <div className="order-1 lg:order-2 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>Race results and personal bests</CardDescription>
          </CardHeader>

          <CardContent className="p-0 lg:max-h-[620px] lg:overflow-y-auto">
            {!races?.length ? (
              <p className="p-6 text-sm text-muted-foreground">No races yet.</p>
            ) : (
              <div className="divide-y">
                {races.map((r: any) => {
                  const isPb = pbByDist.get(r.distance_m) === r.time_seconds;

                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between px-4 py-3 gap-3 hover:bg-muted/30 transition"
                    >
                      {/* LEFT SIDE */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{metersFmt(r.distance_m)}</span>
                          <span className="tabular-nums text-base font-medium">{secToClock(r.time_seconds)}</span>
                          {r.race_type && (
                            <Badge variant="outline" className="text-[10px]">
                              {raceTypeLabel(r.race_type)}
                            </Badge>
                          )}
                          {isPb && <Badge className="bg-emerald-600 text-white">PB</Badge>}
                        </div>

                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.performance_date}
                          {r.event_name ? ` · ${r.event_name}` : ""}
                          {r.overall_place ? ` · ${r.overall_place}` : ""}
                        </div>
                      </div>

                      {/* RIGHT SIDE */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/app/races/$raceId" params={{ raceId: r.id }}>
                            View
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      {/* Frequency + progression — 50/50, full width, below everything */}
      <div className="grid md:grid-cols-2 gap-6">
        <RaceFrequencyCard data={monthlyFrequency} />
        <PerformanceProgressionCard races={races ?? []} primaryEvent={primaryEvent} />
      </div>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <div className="text-[10px] font-bold uppercase tracking-[0.14em]">{label}</div>
      </div>
      <div className="font-display text-xl font-extrabold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function RaceFrequencyCard({ data }: { data: { key: string; label: string; count: number }[] }) {
  const hasAny = data.some((d) => d.count > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Race frequency</CardTitle>
        <CardDescription>Races per month, last 12 months.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="text-sm text-muted-foreground">No races in the last 12 months.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={12} />
                <YAxis tick={{ fontSize: 11 }} width={24} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [v, "Races"]}
                />
                <Bar dataKey="count" name="Races" fill="var(--accent-red)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceProgressionCard({ races, primaryEvent }: { races: any[]; primaryEvent: string | null }) {
  const [selectedEventKey, setSelectedEventKey] = useState<string>("");
  const primaryDistanceM = useMemo(() => primaryEventDistanceM(primaryEvent), [primaryEvent]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; distance_m: number }>();
    for (const p of races) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type ?? "none"}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${metersFmt(p.distance_m)} · ${raceTypeLabel(p.race_type)}`,
          distance_m: p.distance_m,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.distance_m - b.distance_m);
  }, [races]);

  useEffect(() => {
    if (eventOptions.length === 0) {
      if (selectedEventKey) setSelectedEventKey("");
      return;
    }
    if (eventOptions.some((opt) => opt.key === selectedEventKey)) return;

    if (primaryDistanceM != null) {
      const matches = eventOptions.filter((opt) => opt.distance_m === primaryDistanceM);
      const preferred = matches.find((opt) => opt.key.endsWith("-track")) ?? matches[0];
      if (preferred) {
        setSelectedEventKey(preferred.key);
        return;
      }
    }
    setSelectedEventKey(eventOptions[0].key);
  }, [eventOptions, selectedEventKey, primaryDistanceM]);

  const chartData = useMemo(() => {
    if (!selectedEventKey) return [];
    const points = races
      .filter((p) => `${p.distance_m}-${p.race_type ?? "none"}` === selectedEventKey && p.time_seconds != null)
      .slice()
      .sort((a, b) => a.performance_date.localeCompare(b.performance_date))
      .map((p) => ({ date: p.performance_date, seconds: p.time_seconds }));
    return addLinearTrend(points);
  }, [races, selectedEventKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance progression</CardTitle>
        <CardDescription>Race times over time, by event.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {eventOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timed performances logged yet.</p>
        ) : (
          <>
            <Select value={selectedEventKey} onValueChange={setSelectedEventKey}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select event" />
              </SelectTrigger>
              <SelectContent>
                {eventOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {chartData.length > 1 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 11 }} />
                    <YAxis
                      reversed
                      tickFormatter={(v) => secToClock(v)}
                      tick={{ fontSize: 11 }}
                      width={55}
                      domain={["dataMin", "dataMax"]}
                    />
                    <Tooltip formatter={(value: number, name: string) => [secToClock(value), name]} />
                    <Line type="monotone" dataKey="seconds" name="Actual" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    <Line
                      type="linear"
                      dataKey="trend"
                      name="Trend"
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Need at least 2 performances for this event to chart progression.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
