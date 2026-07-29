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
import { computePbStatus, pbStatusFor, PB_BADGE_LABEL, PB_BADGE_CLASS } from "@/lib/performance-pb";
import { PerformanceEditDialog, type EditablePerformance } from "@/components/performance-edit-dialog";
import { Pencil } from "lucide-react";
import { parseBulkPerformances, performanceKey, distanceWithinTolerance, type BulkImportRow } from "@/lib/bulk-performance-import";
import { cn } from "@/lib/utils";

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

// Age as of a given race date — whole years, accounting for whether the
// birthday has actually passed yet that year, not just year subtraction.
// Powers the progression list's Age column (World Athletics-style
// year/age/mark progression table).
function ageAt(dob: string | null | undefined, dateStr: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  let age = target.getFullYear() - birth.getFullYear();
  const monthDiff = target.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) age--;
  return age;
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
    <AppShell fullWidth>
      <div className="space-y-6">
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
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <Trophy className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Performances</div>
              <h1 className="text-2xl font-bold leading-tight">Race results</h1>
            </div>
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

  // DOB for the progression list's Age column — fetched directly rather
  // than trusting a parent-passed athlete object, since the coach-roster
  // query that can supply activeAthlete only selects id/name/primary_event
  // (no dob), while the self-service athlete query does. This works
  // identically either way this page is reached.
  const { data: athleteDob } = useQuery({
    queryKey: ["athlete-dob", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data } = await supabase.from("athletes").select("dob").eq("id", athleteId).maybeSingle();
      return data?.dob as string | null;
    },
  });

  const { data: seasons } = useQuery({
    queryKey: ["athlete-seasons", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_seasons")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("start_date", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });

  // Results filters — all default to "all", purely client-side over the
  // already-fetched races list.
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterSeasonId, setFilterSeasonId] = useState<string>("all");
  const [filterBadge, setFilterBadge] = useState<string>("all");

  const [date, setDate] = useState(todayISO());
  const [distance, setDistance] = useState<number>(5000);
  const [distanceMode, setDistanceMode] = useState<"preset" | "custom">("preset");
  const [customDistance, setCustomDistance] = useState<string>("");
  const [time, setTime] = useState("");
  const [event, setEvent] = useState("");
  const [raceType, setRaceType] = useState<string>("road");
  const [placing, setPlacing] = useState("");
  const [notes, setNotes] = useState("");

  // Bulk import — moved here from the old Profile page's PBs card, merged
  // into the same "Add race" card rather than kept as a separate one.
  const [bulkText, setBulkText] = useState("");
  const [previewRows, setPreviewRows] = useState<BulkImportRow[]>([]);
  const [importing, setImporting] = useState(false);

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
      // is_pb omitted — a DB trigger recomputes it right after insert by
      // comparing against this athlete's actual history.
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

  // --- Bulk import (moved from the old Profile page PBs card) ---

  const existingKeys = useMemo(() => {
    return new Set((races ?? []).map((p: any) => performanceKey(p)));
  }, [races]);

  const duplicateCount = previewRows.filter((row) => row.duplicate).length;
  const errorCount = previewRows.filter((row) => row.error).length;
  const matchedCount = previewRows.filter((row) => row.matchedSessionId).length;
  const insertableRows = previewRows.filter((row) => !row.error && !row.duplicate);

  async function previewImport() {
    if (!bulkText.trim()) {
      toast.error("Paste performances first");
      return;
    }

    const parsed = parseBulkPerformances(bulkText, athleteId, races ?? []);

    const validDates = parsed.filter((r) => !r.error).map((r) => r.performance_date);
    let sessionsByDate = new Map<string, { id: string; total_distance_m: number | null }[]>();

    // Session matching — same athlete, same date, distance within
    // tolerance. Only sessions that don't already have a linked
    // performance are eligible, so this can't create a second race record
    // competing for the same session. Scoped to just the dates actually
    // present in this paste rather than the athlete's whole session
    // history.
    if (validDates.length > 0) {
      const minDate = validDates.reduce((a, b) => (a < b ? a : b));
      const maxDate = validDates.reduce((a, b) => (a > b ? a : b));
      const alreadyLinkedSessionIds = new Set((races ?? []).map((p: any) => p.session_id).filter(Boolean));

      const { data: candidateSessions } = await supabase
        .from("sessions")
        .select("id, session_date, total_distance_m")
        .eq("athlete_id", athleteId)
        .gte("session_date", minDate)
        .lte("session_date", maxDate);

      sessionsByDate = new Map();
      for (const s of candidateSessions ?? []) {
        if (alreadyLinkedSessionIds.has(s.id)) continue;
        const list = sessionsByDate.get(s.session_date) ?? [];
        list.push({ id: s.id, total_distance_m: s.total_distance_m });
        sessionsByDate.set(s.session_date, list);
      }
    }

    const rows = parsed.map((row) => {
      const duplicate = !row.error && existingKeys.has(performanceKey(row));

      let matchedSessionId: string | null = null;
      if (!row.error && !duplicate) {
        const candidates = sessionsByDate.get(row.performance_date) ?? [];
        // If more than one session on the same day is within tolerance,
        // take the closest distance match rather than just the first.
        let best: { id: string; diff: number } | null = null;
        for (const s of candidates) {
          if (s.total_distance_m == null) continue;
          if (!distanceWithinTolerance(row.distance_m, s.total_distance_m)) continue;
          const diff = Math.abs(row.distance_m - s.total_distance_m);
          if (!best || diff < best.diff) best = { id: s.id, diff };
        }
        matchedSessionId = best?.id ?? null;
      }

      return { ...row, duplicate, matchedSessionId };
    });

    setPreviewRows(rows);

    const errors = rows.filter((r) => r.error).length;
    const duplicates = rows.filter((r) => r.duplicate).length;
    const matched = rows.filter((r) => r.matchedSessionId).length;
    const insertable = rows.filter((r) => !r.error && !r.duplicate).length;

    if (rows.length === 0) {
      toast.error("No rows detected. Paste the AV results again, including dates.");
      return;
    }

    if (errors > 0) {
      toast.error(`Preview created with ${errors} row issue${errors === 1 ? "" : "s"}`);
    } else {
      toast.success(
        `Preview ready: ${insertable} to import (${matched} matched to an existing session), ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`,
      );
    }
  }

  async function bulkImport() {
    if (previewRows.length === 0) {
      previewImport();
      return;
    }

    if (errorCount > 0) {
      toast.error("Fix row errors before importing");
      return;
    }

    if (insertableRows.length === 0) {
      toast.error("No new performances to import");
      return;
    }

    const payload = insertableRows
      .filter((row): row is typeof row & { time_seconds: number } => row.time_seconds != null)
      .map((row) => ({
        athlete_id: row.athlete_id,
        performance_date: row.performance_date,
        distance_m: row.distance_m,
        time_seconds: row.time_seconds,
        // is_pb omitted — a DB trigger recomputes it right after insert
        // against the athlete's full history (previewRow.is_pb is only an
        // estimate shown before saving; the trigger has the final say).
        session_id: row.matchedSessionId ?? null,
        context: row.context,
        notes: row.notes,
        event_name: row.event_name,
        age_group: row.age_group,
        race_type: row.race_type,
        distance_adjustment_mode: row.distance_adjustment_mode,
      }));

    setImporting(true);

    const { error } = await supabase.from("performances").insert(payload);

    setImporting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Imported ${payload.length} performance${payload.length === 1 ? "" : "s"}`);
    setBulkText("");
    setPreviewRows([]);
    qc.invalidateQueries({ queryKey: ["races", athleteId] });
    qc.invalidateQueries({ queryKey: ["my-pbs", athleteId] });
  }

  function clearBulk() {
    setBulkText("");
    setPreviewRows([]);
  }

  // Current-PB / past-PB status for every race — shared with Profile's
  // PBs card and the coach Overview page. Replaces a distance-only Map
  // that didn't account for race_type, so a track 5000m and a road
  // 5000m were previously treated as competing for the same "PB".
  const pbStatusMap = useMemo(() => computePbStatus(races ?? []), [races]);
  const pbCount = useMemo(
    () => (races ?? []).filter((r: any) => pbStatusFor(r.id, pbStatusMap).isCurrentPB).length,
    [races, pbStatusMap],
  );

  const [editingRace, setEditingRace] = useState<EditablePerformance | null>(null);

  // Distinct years actually present in this athlete's results, newest
  // first — powers the Year filter dropdown.
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const r of races ?? []) years.add(String(r.performance_date).slice(0, 4));
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [races]);

  const filteredRaces = useMemo(() => {
    let list = races ?? [];

    if (filterYear !== "all") {
      list = list.filter((r: any) => String(r.performance_date).slice(0, 4) === filterYear);
    }

    if (filterSeasonId !== "all") {
      const season = (seasons ?? []).find((s: any) => s.id === filterSeasonId);
      if (season) {
        list = list.filter((r: any) => r.performance_date >= season.start_date && r.performance_date <= season.end_date);
      }
    }

    if (filterBadge !== "all") {
      list = list.filter((r: any) => pbStatusFor(r.id, pbStatusMap).badge === filterBadge);
    }

    return list;
  }, [races, filterYear, filterSeasonId, filterBadge, seasons, pbStatusMap]);

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
      pbCount,
      daysSinceLast,
    };
  }, [races, pbCount]);

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
          Grid columns stretch to equal height by default (no items-start),
          and both Cards below opt into that height via lg:h-full +
          flex flex-col, so Results is always exactly as tall as Add race
          renders to be, not an approximation of it. Results' CardContent
          is the flex-1 + min-h-0 child so it's the one that scrolls once
          content exceeds that height, instead of growing the row. */}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="order-2 lg:order-1 lg:h-full">
        <Card className="lg:h-full lg:flex lg:flex-col">
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

            <div className="space-y-3 border rounded p-3">
              <div>
                <Label className="text-sm font-medium">Bulk import performances</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste AV results exactly as copied, or use: YYYY-MM-DD | Event | Performance | Venue
                </p>
              </div>

              <textarea
                className="w-full min-h-40 rounded-md border bg-background px-3 py-2 text-sm font-mono"
                placeholder={`2026-06-28
7.4km (XC Relay)
21:44
Calder Park

2026-05-10
5km (Road)
14:41
Albert Park

2021-12-18
100m
13.22
(2.6)
Geelong`}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={previewImport} disabled={!bulkText.trim()}>
                  Preview import
                </Button>

                <Button
                  size="sm"
                  onClick={bulkImport}
                  disabled={importing || previewRows.length === 0 || insertableRows.length === 0 || errorCount > 0}
                >
                  {importing ? "Importing..." : `Import ${insertableRows.length} performances`}
                </Button>

                <Button size="sm" variant="ghost" onClick={clearBulk}>
                  Clear
                </Button>
              </div>

              {previewRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Detected: {previewRows.length} rows · {insertableRows.length} new · {duplicateCount} duplicate skipped ·{" "}
                    {matchedCount} matched to a session · {errorCount} issue{errorCount === 1 ? "" : "s"}
                  </div>

                  <div className="overflow-x-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Event</th>
                          <th className="px-2 py-2">Distance</th>
                          <th className="px-2 py-2">Original</th>
                          <th className="px-2 py-2">Seconds</th>
                          <th className="px-2 py-2">Venue</th>
                          <th className="px-2 py-2">Type</th>
                          <th className="px-2 py-2">PB</th>
                          <th className="px-2 py-2">Session</th>
                          <th className="px-2 py-2">Status</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y">
                        {previewRows.map((row, i) => (
                          <tr
                            key={`${row.performance_date}-${row.event_name}-${i}`}
                            className={row.error ? "bg-destructive/10" : row.duplicate ? "bg-muted/40" : ""}
                          >
                            <td className="px-2 py-2 whitespace-nowrap">{row.performance_date || "—"}</td>
                            <td className="px-2 py-2 min-w-36">{row.source_event || "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {row.distance_m ? metersFmt(row.distance_m) : "—"}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap tabular-nums">{row.source_perf || "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                              {row.time_seconds == null ? "—" : row.time_seconds}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.source_venue || "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.race_type}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.is_pb ? "Yes" : "No"}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {row.matchedSessionId ? (
                                <span className="text-emerald-600">Linked</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2 min-w-40">
                              {row.error ? (
                                <span className="text-destructive">{row.error}</span>
                              ) : row.duplicate ? (
                                <span className="text-muted-foreground">Duplicate skipped</span>
                              ) : row.notes ? (
                                <span className="text-muted-foreground">{row.notes}</span>
                              ) : (
                                <span className="text-emerald-600">Ready</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results — right two-thirds on desktop. Height now matches Add
          race exactly (see comment above) instead of a fixed max-height
          guess — this one grid's content is what determines the row
          height, and Results just fills + scrolls within it. */}
      <div className="order-1 lg:order-2 min-w-0 lg:h-full">
        <Card className="lg:h-full lg:flex lg:flex-col">
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>Race results and personal bests</CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger className="h-8 w-[110px] text-xs">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterSeasonId} onValueChange={setFilterSeasonId}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="Season" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All seasons</SelectItem>
                  {(seasons ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterBadge} onValueChange={setFilterBadge}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue placeholder="Badge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All results</SelectItem>
                  <SelectItem value="pb">PB</SelectItem>
                  <SelectItem value="season_best">Season Best</SelectItem>
                  <SelectItem value="year_best">Year Best</SelectItem>
                  <SelectItem value="course_best">Course Best</SelectItem>
                  <SelectItem value="past_pb">Past PB</SelectItem>
                </SelectContent>
              </Select>

              {(filterYear !== "all" || filterSeasonId !== "all" || filterBadge !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setFilterYear("all");
                    setFilterSeasonId("all");
                    setFilterBadge("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            {!filteredRaces?.length ? (
              <p className="p-6 text-sm text-muted-foreground">
                {!races?.length ? "No races yet." : "No races match these filters."}
              </p>
            ) : (
              <div className="divide-y">
                {filteredRaces.map((r: any) => {
                  const { badge } = pbStatusFor(r.id, pbStatusMap);

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
                          {badge && <Badge className={PB_BADGE_CLASS[badge]}>{PB_BADGE_LABEL[badge]}</Badge>}
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
                        {/* Edit only offered for standalone results (no linked
                            session) — a session-linked race's time/distance
                            should stay in sync with the session it came from,
                            so that one is still fixed via the session's own
                            page instead of drifting out of step here. This is
                            exactly the gap that previously left bulk-imported
                            and manually-entered results with no edit path at
                            all once saved. */}
                        {!r.session_id && (
                          <Button variant="ghost" size="sm" onClick={() => setEditingRace(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
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
        <PerformanceProgressionCard races={races ?? []} primaryEvent={primaryEvent} dob={athleteDob ?? null} />
      </div>

      <PerformanceEditDialog
        open={!!editingRace}
        onOpenChange={(o) => !o && setEditingRace(null)}
        performance={editingRace}
        onSaved={() => {
          setEditingRace(null);
          qc.invalidateQueries({ queryKey: ["races", athleteId] });
          qc.invalidateQueries({ queryKey: ["my-pbs", athleteId] });
        }}
      />
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

function PerformanceProgressionCard({
  races,
  primaryEvent,
  dob,
}: {
  races: any[];
  primaryEvent: string | null;
  dob: string | null;
}) {
  const [selectedEventKey, setSelectedEventKey] = useState<string>("");
  const [view, setView] = useState<"chart" | "list">("chart");
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

  // Year-by-year best progression — World Athletics-style "Progression"
  // table (year / age / mark). Reuses is_year_best directly rather than
  // recomputing "best per year" client-side — that flag is already
  // maintained by the same DB trigger the PB badges use, scoped to
  // exactly this distance + race_type combination, so it's already
  // exactly "this athlete's best result in that calendar year for this
  // event." Newest year first, matching the Results list's own default
  // order.
  const progressionRows = useMemo(() => {
    if (!selectedEventKey) return [];
    return races
      .filter((p) => `${p.distance_m}-${p.race_type ?? "none"}` === selectedEventKey && p.time_seconds != null && p.is_year_best)
      .slice()
      .sort((a, b) => b.performance_date.localeCompare(a.performance_date))
      .map((p) => ({
        year: String(p.performance_date).slice(0, 4),
        age: ageAt(dob, p.performance_date),
        mark: secToClock(p.time_seconds),
        date: p.performance_date,
        venue: p.event_name ?? null,
      }));
  }, [races, selectedEventKey, dob]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Performance progression</CardTitle>
          <CardDescription>
            {view === "chart" ? "Race times over time, by event." : "Best mark each year, by event — year and age."}
          </CardDescription>
        </div>
        {eventOptions.length > 0 && (
          <div className="flex items-center rounded-md border border-border p-0.5 text-xs font-medium shrink-0">
            <button
              type="button"
              onClick={() => setView("chart")}
              className={cn(
                "px-2.5 h-6 rounded transition-colors",
                view === "chart" ? "bg-[var(--accent-red)] text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Chart
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "px-2.5 h-6 rounded transition-colors",
                view === "list" ? "bg-[var(--accent-red)] text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              List
            </button>
          </div>
        )}
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

            {view === "chart" ? (
              chartData.length > 1 ? (
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
              )
            ) : progressionRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No year-best results logged yet for this event.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-1.5 pr-3 font-medium">Year</th>
                      <th className="py-1.5 pr-3 font-medium">Age</th>
                      <th className="py-1.5 pr-3 font-medium">Mark</th>
                      <th className="py-1.5 pr-3 font-medium">Date</th>
                      <th className="py-1.5 font-medium">Venue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {progressionRows.map((row) => (
                      <tr key={row.year}>
                        <td className="py-1.5 pr-3 font-semibold tabular-nums">{row.year}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.age ?? "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums font-medium">{row.mark}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{row.date}</td>
                        <td className="py-1.5 text-muted-foreground truncate max-w-[160px]">{row.venue ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
