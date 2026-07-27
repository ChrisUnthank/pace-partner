import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReadinessBadge } from "@/components/readiness-badge";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart as RLineChart,
  Line,
  Area,
  Bar,
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, ArrowRight, AlertTriangle } from "lucide-react";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { YearlyLoadStrip } from "@/components/yearly-load-strip";

const RANGES = {
  "4w": { days: 28, label: "4 weeks" },
  month: { days: null, label: "This month" },
  "3m": { days: 91, label: "3 months" },
  "6m": { days: 182, label: "6 months" },
  year: { days: null, label: "This year" },
  all: { days: 2000, label: "All time" },
} as const;
type RangeKey = keyof typeof RANGES;

const searchSchema = z.object({
  athleteId: z.string().optional(),
  range: z.enum(["4w", "month", "3m", "6m", "year", "all"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/analytics")({
  validateSearch: searchSchema,
  component: AnalyticsPage,
});

// `.toISOString()` always converts to UTC before formatting, so calling it
// on a Date built from local calendar fields (e.g. "midnight on this
// Monday") silently rolls the date back by however many hours the local
// timezone sits ahead of UTC — Monday 00:00 AEDT becomes Sunday 13:00 UTC,
// so `.toISOString().slice(0, 10)` reads "Sunday". This was why "this
// week" (and, less visibly, "this month"/"this year") boundaries below
// were landing a day early for anyone east of UTC. Same technique as
// todayISO() in lib/format.ts: build the string from the Date's own local
// getFullYear/getMonth/getDate rather than round-tripping through UTC.
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalISODate(d);
}

// Resolves a range key to its "since" date. "month"/"year" are calendar
// boundaries (start of the current month/year) rather than a fixed
// lookback window, so they can't go through the same days-based math as
// the other range keys.
function sinceForRange(range: RangeKey): string {
  const now = new Date();
  if (range === "month") return toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (range === "year") return toLocalISODate(new Date(now.getFullYear(), 0, 1));
  return isoDaysAgo(RANGES[range].days as number);
}

function isoWeekKey(dateStr: string) {
  // ISO year-week (YYYY-Www)
  const d = new Date(dateStr + "T00:00:00Z");
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

type GranularityKey = "week" | "month" | "year";

// Generic bucket key for grouping a date into a week/month/year, used by every
// trend chart below so switching the toggle re-buckets consistently everywhere.
function bucketKey(dateStr: string, granularity: GranularityKey) {
  if (granularity === "year") return dateStr.slice(0, 4);
  if (granularity === "month") return dateStr.slice(0, 7); // YYYY-MM
  return isoWeekKey(dateStr);
}

// Human-readable label for a bucket key, matching the chosen granularity.
function bucketLabel(key: string, granularity: GranularityKey) {
  if (granularity === "month") {
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return key; // week (YYYY-Www) and year (YYYY) keys are already readable as-is
}

function AnalyticsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const range: RangeKey = (search.range ?? "3m") as RangeKey;
  const customFrom = search.from;
  const customTo = search.to;

  // Athlete view if athleteId is set, or if user is athlete-only
  const selectedAthleteId = search.athleteId ?? (!isCoach ? myAthlete?.id : undefined);

  function setRange(r: RangeKey) {
    navigate({ search: (prev: any) => ({ ...prev, range: r, from: undefined, to: undefined }) });
  }
  function setCustomRange(from?: string, to?: string) {
    navigate({ search: (prev: any) => ({ ...prev, from, to }) });
  }

  if (isCoach && !selectedAthleteId) {
    return (
      <AppShell>
        <CoachRoster
          range={range}
          onRangeChange={setRange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomRange={setCustomRange}
        />
      </AppShell>
    );
  }

  if (!selectedAthleteId) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No athlete profile yet.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AthleteAnalytics
        athleteId={selectedAthleteId}
        range={range}
        onRangeChange={setRange}
        showBack={isCoach}
        customFrom={customFrom}
        customTo={customTo}
        onCustomRange={setCustomRange}
      />
    </AppShell>
  );
}

// ---------- Coach roster ----------

function CoachRoster({
  range,
  onRangeChange,
  customFrom,
  customTo,
  onCustomRange,
}: {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  customFrom?: string;
  customTo?: string;
  onCustomRange: (from?: string, to?: string) => void;
}) {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const since = isoDaysAgo(14);

  const { data: roster } = useQuery({
    queryKey: ["analytics-roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, primary_event, profile_image_url").order("name");
        return (data ?? []).map((a: any) => ({ athlete_id: a.id, athletes: a }));
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, primary_event, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return data ?? [];
    },
  });

  const athleteIds = roster?.map((r: any) => r.athlete_id) ?? [];

  const { data: rosterLoad } = useQuery({
    queryKey: ["analytics-roster-load", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("athlete_id, load_date, ctl, atl, tsb, readiness_status, readiness_score, confidence")
        .in("athlete_id", athleteIds)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: lastSessions } = useQuery({
    queryKey: ["analytics-roster-last", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, athlete_id, title, session_date")
        .in("athlete_id", athleteIds)
        .not("completed_at", "is", null)
        .order("session_date", { ascending: false })
        .limit(athleteIds.length * 5);
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    if (!roster) return [];
    return roster
      .map((r: any) => {
        const a = r.athletes;
        const load = (rosterLoad ?? []).filter((x: any) => x.athlete_id === r.athlete_id);
        const latest = load[load.length - 1];
        const trend = ctlSlopeDirection(load.map((x: any) => Number(x.ctl)).filter((n) => !Number.isNaN(n)));
        const last = (lastSessions ?? []).find((s: any) => s.athlete_id === r.athlete_id);
        return {
          athleteId: r.athlete_id,
          name: a?.name ?? "—",
          event: a?.primary_event ?? null,
          readinessStatus: latest?.readiness_status ?? null,
          readinessScore: latest?.readiness_score ?? null,
          confidence: latest?.confidence ?? null,
          trend,
          lastSession: last,
        };
      })
      .sort((a, b) => severity(b.readinessStatus) - severity(a.readinessStatus));
  }, [roster, rosterLoad, lastSessions]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Roster analytics</h1>
          <p className="text-sm text-muted-foreground">Readiness band and 14-day fitness trend for every athlete.</p>
        </div>
        <RangePicker
          value={range}
          onChange={onRangeChange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomRange={onCustomRange}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {!rows.length ? (
            <p className="p-6 text-sm text-muted-foreground">No athletes yet.</p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <Link
                  key={row.athleteId}
                  to="/app/analytics"
                  search={{ athleteId: row.athleteId, range }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {row.lastSession
                        ? `Last: ${row.lastSession.session_date} · ${row.lastSession.title ?? "Session"}`
                        : "No sessions yet"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ReadinessBadge
                      status={row.readinessStatus as any}
                      score={row.readinessScore as any}
                      confidence={row.confidence as any}
                    />
                  </div>
                  <div className="shrink-0 w-28 flex items-center justify-end gap-1 text-sm">
                    <TrendArrow direction={row.trend} />
                    <span className="text-xs text-muted-foreground capitalize">{row.trend}</span>
                    {row.trend === "declining" && row.readinessStatus === "red" && (
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function severity(status: string | null) {
  if (status === "red") return 3;
  if (status === "amber") return 2;
  if (status === "green") return 1;
  return 0;
}

function ctlSlopeDirection(values: number[]): "improving" | "stable" | "declining" {
  if (values.length < 3) return "stable";
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  if (slope > 0.3) return "improving";
  if (slope < -0.3) return "declining";
  return "stable";
}

function TrendArrow({ direction }: { direction: "improving" | "stable" | "declining" }) {
  if (direction === "improving") return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
  if (direction === "declining") return <ArrowDownRight className="h-4 w-4 text-rose-600" />;
  return <ArrowRight className="h-4 w-4 text-muted-foreground" />;
}

// ---------- Athlete analytics ----------

function AthleteAnalytics({
  athleteId,
  range,
  onRangeChange,
  showBack,
  customFrom,
  customTo,
  onCustomRange,
}: {
  athleteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  showBack: boolean;
  customFrom?: string;
  customTo?: string;
  onCustomRange: (from?: string, to?: string) => void;
}) {
  const since = customFrom ?? sinceForRange(range);
  // (We still cap analytics queries by "since"; "to" is applied client-side where it matters.)

  // Own roster fetch — mirrors CoachRoster's query — so a coach can switch
  // directly to another athlete from within this scoped view via
  // CoachAthletePicker, not just navigate back to the roster page first.
  const navigate = useNavigate({ from: Route.fullPath });
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const { data: myAthlete } = useMyAthlete();
  const { data: roster } = useQuery({
    queryKey: ["analytics-roster", user?.id, isManager],
    enabled: !!user && showBack,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  // Navigating here from another athlete's Analytics link (or the roster)
  // is a client-side route change, so the browser won't reset scroll on
  // its own — without this, switching athletes could silently land the
  // page already scrolled to wherever the previous athlete's page was.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [athleteId]);

  const { data: athlete } = useQuery({
    queryKey: ["analytics-athlete", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athletes")
        .select("id, name, primary_event")
        .eq("id", athleteId)
        .maybeSingle();
      return data;
    },
  });

  const { data: load } = useQuery({
    queryKey: ["analytics-load", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl, atl, tsb, training_load, readiness_status, readiness_score, confidence")
        .eq("athlete_id", athleteId)
        .gte("load_date", since)
        .order("load_date", { ascending: true });

      // CTL/ATL/TSB come out of the DB as floating point (exponentially-
      // weighted averages carry full precision). Rounding here — once, at
      // the source — means the chart lines, the area fill, and Recharts'
      // default tooltip all show clean whole numbers without needing a
      // formatter on every chart element that touches this data.
      //
      // Also derives, per day, the equivalent Fitness (CTL) value at each
      // load-ratio guide threshold (0.5 / 0.8 / 1.3 / 1.5). 0.8/1.3/1.5 are
      // the same acute:chronic workload ratio convention already used for
      // the readiness score and the dashboard alerts; 0.5 is a general
      // taper/peaking guideline (not personalized to this athlete). Since
      // tsb = ctl - atl and load_ratio = atl/ctl, a target ratio r
      // corresponds to tsb = ctl * (1 - r) — which scales with the
      // athlete's own current fitness level rather than being a fixed
      // number, so these guide lines stay meaningful whether an athlete's
      // day-to-day load numbers run in the tens or the hundreds.
      return (data ?? []).map((d) => {
        const ctlR = d.ctl != null ? Math.round(Number(d.ctl)) : null;
        const atlR = d.atl != null ? Math.round(Number(d.atl)) : null;
        const tsbR = d.tsb != null ? Math.round(Number(d.tsb)) : null;
        return {
          ...d,
          ctl: ctlR,
          atl: atlR,
          tsb: tsbR,
          ratioLow: ctlR != null ? Math.round(ctlR * (1 - 0.8)) : null,
          ratioPeak: ctlR != null ? Math.round(ctlR * (1 - 0.5)) : null,
          ratioCaution: ctlR != null ? Math.round(ctlR * (1 - 1.3)) : null,
          ratioHighRisk: ctlR != null ? Math.round(ctlR * (1 - 1.5)) : null,
        };
      });
    },
  });

  // session_training_load() (the Postgres function behind ctl/atl/tsb)
  // silently substitutes a category-based RPE estimate whenever a session
  // has none logged, so the chart keeps rendering either way — this just
  // counts how many completed sessions in the visible range are running on
  // that estimate rather than real effort data, so the chart can say so
  // instead of quietly presenting a guess as fact.
  const { data: estimatedLoadCount } = useQuery({
    queryKey: ["analytics-estimated-rpe-count", athleteId, since],
    queryFn: async () => {
      const { count } = await supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .not("completed_at", "is", null)
        .is("rpe", null)
        .neq("day_type", "rest");
      return count ?? 0;
    },
  });

  // Baseline-building window — the contiguous run of "insufficient"/"low"
  // confidence days at the very start of the loaded range (confidence is
  // already computed server-side from how many of the trailing 28 days have
  // real data). Every athlete's chart ramps up from zero on their first
  // logged day regardless of how much real training history they actually
  // bring in — this doesn't fix that, it just makes the chart honest about
  // which early stretch shouldn't be read as a true fitness picture yet.
  const lowConfidenceEndDate = useMemo(() => {
    if (!load || load.length === 0) return null;
    let lastLowConfDate: string | null = null;
    for (const row of load) {
      if (row.confidence === "insufficient" || row.confidence === "low") {
        lastLowConfDate = row.load_date as string;
      } else {
        break; // only the contiguous run from the very start counts
      }
    }
    return lastLowConfDate;
  }, [load]);

  const { data: fatigue } = useQuery({
    queryKey: ["analytics-fatigue", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_fatigue")
        .select("efficiency_score, session_id, sessions!inner(session_date, athlete_id)")
        .eq("sessions.athlete_id", athleteId)
        .gte("sessions.session_date", since)
        .not("efficiency_score", "is", null);
      return data ?? [];
    },
  });

  const { data: weeklyDist } = useQuery({
    queryKey: ["analytics-weekly-distance", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_weekly_distance" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("week_start", since)
        .order("week_start", { ascending: true });
      return data ?? [];
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["analytics-zone-time", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_time_weekly" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("week_start", since)
        .order("week_start", { ascending: true });
      return data ?? [];
    },
  });

  // Independent of the page-level range picker above, same reasoning as
  // stepVolumeSessions just below — always fetches from the start of the
  // current year so every "Training trends grouped by" option
  // (week/month/year) always has enough data to work with, regardless of
  // what the outer range picker happens to be set to (e.g. its default
  // "4 weeks", which would silently starve a "month" or "year" grouping
  // of data if this query were still bound to it). Previously this used
  // the outer `since` AND was never filtered by granularity at all —
  // Sessions by Type and Time by Training Intent always just showed the
  // outer range's full total regardless of which week/month/year button
  // was selected.
  const intentPeriodStart = useMemo(() => {
    const now = new Date();
    return toLocalISODate(new Date(now.getFullYear(), 0, 1));
  }, []);

  const { data: intentRollup } = useQuery({
    queryKey: ["analytics-intent-time", athleteId, intentPeriodStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("intent, total_time_seconds, day_type, activity_type, session_date")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", intentPeriodStart);
      return data ?? [];
    },
  });

  // This card now has its own "This week" / "This month" / "This year" period toggle,
  // independent of the page's global range picker above, so it fetches from the start of
  // the current year (covers all three period options) rather than using the outer `since`.
  const volumePeriodStart = useMemo(() => {
    const now = new Date();
    return toLocalISODate(new Date(now.getFullYear(), 0, 1));
  }, []);

  const { data: stepVolumeSessions } = useQuery({
    queryKey: ["analytics-step-volume", athleteId, volumePeriodStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select(
          "id, session_date, steps!steps_session_id_fkey(id, kind, reps, set_count, target_distance_m, target_time_seconds, interval_results(actual_time_seconds, actual_distance_m))",
        )
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", volumePeriodStart);
      return data ?? [];
    },
  });

  // Race days (past and any upcoming planned) within the loaded range —
  // marked as vertical lines on the Fitness/Fatigue/Form chart so a coach
  // can see how Form was trending into each one, and over time build a
  // real picture of where THIS athlete tends to race well, rather than
  // relying on a generic guideline alone.
  const { data: raceDays } = useQuery({
    queryKey: ["analytics-races", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, session_date, title, completed_at")
        .eq("athlete_id", athleteId)
        .eq("day_type", "race")
        .gte("session_date", since)
        .order("session_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: physio } = useQuery({
    queryKey: ["analytics-physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_physio_profile")
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return data;
    },
  });

  // ---------------------------------------------------------------------
  // Training Load Forecast — projects Fitness/Fatigue/Form forward from
  // today under a handful of "what if training continued like this"
  // scenarios. Independent of the page-level range picker above, same
  // reasoning as intentPeriodStart/volumePeriodStart — always fetches the
  // last 35 real days regardless of what the outer range is set to, since
  // the projection needs a full 28-day window of real history to seed its
  // rolling averages correctly even if someone's viewing "This month" on
  // the 3rd.
  type ForecastScenario = "continued" | "increased" | "decreased" | "none";
  type ForecastMonths = 1 | 3;
  const [showForecast, setShowForecast] = useState(false);
  const [forecastScenario, setForecastScenario] = useState<ForecastScenario>("continued");
  const [forecastMonths, setForecastMonths] = useState<ForecastMonths>(3);
  const FORECAST_DAYS = forecastMonths === 1 ? 30 : 91;

  const { data: forecastSeed } = useQuery({
    queryKey: ["analytics-forecast-seed", athleteId],
    queryFn: async () => {
      const from = isoDaysAgo(35);
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("load_date, combined_load, ctl, atl")
        .eq("athlete_id", athleteId)
        .gte("load_date", from)
        .order("load_date", { ascending: true });
      return data ?? [];
    },
  });

  // Mirrors the same 7-day / 28-day simple-moving-average math the
  // recompute_readiness() Postgres function uses for real ATL/CTL (NOT the
  // standard Banister exponentially-weighted formula — this app's chosen
  // model is a plain rolling average of combined_load over 7 and 28
  // days), so the projected line picks up exactly where the real one
  // leaves off instead of jumping to a different curve shape.
  const forecast = useMemo(() => {
    if (!forecastSeed || forecastSeed.length < 7) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byDate = new Map<string, number>();
    for (const row of forecastSeed) {
      byDate.set(row.load_date as string, Number(row.combined_load ?? 0));
    }

    function dateOffset(days: number) {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return toLocalISODate(d);
    }

    // Seed the rolling window with the last 28 real days (missing dates —
    // e.g. before the athlete started logging — count as 0, a rest day).
    const series: { date: string; load: number }[] = [];
    for (let i = 27; i >= 0; i--) {
      const date = dateOffset(-i);
      series.push({ date, load: byDate.get(date) ?? 0 });
    }

    // What gets repeated going forward — the athlete's own last 7 days,
    // not a flattened average, so the projection still shows a realistic
    // weekly rhythm (rest days included) rather than one flat number
    // every day.
    const lastWeekPattern = series.slice(-7).map((s) => s.load);
    const multiplier =
      forecastScenario === "increased" ? 1.2 : forecastScenario === "decreased" ? 0.7 : forecastScenario === "none" ? 0 : 1;

    const lastReal = [...forecastSeed].reverse().find((r) => r.ctl != null && r.atl != null);
    const anchorCtl = lastReal ? Number(lastReal.ctl) : series.slice(-28).reduce((s, x) => s + x.load, 0) / 28;
    const anchorAtl = lastReal ? Number(lastReal.atl) : series.slice(-7).reduce((s, x) => s + x.load, 0) / 7;

    const points: { load_date: string; ctlProjected: number; atlProjected: number; tsbProjected: number }[] = [
      // Shared boundary point — same date/values as the last real day, so
      // the projected (dashed) line visually connects with no gap where
      // the real (solid) line ends.
      {
        load_date: lastReal ? (lastReal.load_date as string) : dateOffset(0),
        ctlProjected: Math.round(anchorCtl),
        atlProjected: Math.round(anchorAtl),
        tsbProjected: Math.round(anchorCtl - anchorAtl),
      },
    ];

    for (let i = 1; i <= FORECAST_DAYS; i++) {
      const patternValue = lastWeekPattern[(i - 1) % 7] ?? 0;
      const load = patternValue * multiplier;
      series.push({ date: dateOffset(i), load });

      const window7 = series.slice(-7);
      const window28 = series.slice(-28);
      const atl = window7.reduce((s, x) => s + x.load, 0) / window7.length;
      const ctl = window28.reduce((s, x) => s + x.load, 0) / window28.length;

      points.push({
        load_date: dateOffset(i),
        ctlProjected: Math.round(ctl),
        atlProjected: Math.round(atl),
        tsbProjected: Math.round(ctl - atl),
      });
    }

    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastSeed, forecastScenario, forecastMonths]);

  // Real history + the projection above, merged onto one shared timeline
  // so the chart can draw a solid line for the real data and a dashed one
  // for the projected continuation without a visible seam. Only the last
  // 30 real days are kept for context — the chart's job here is "how does
  // the near future look from here", not re-showing the whole history the
  // main Fitness/Fatigue/Form chart above already covers.
  const forecastChartData = useMemo(() => {
    if (!forecast) return null;
    const recentReal = (load ?? []).slice(-30).map((d: any) => ({
      load_date: d.load_date,
      ctl: d.ctl,
      atl: d.atl,
      tsb: d.tsb,
    }));
    return [...recentReal, ...forecast];
  }, [load, forecast]);

  const [granularity, setGranularity] = useState<GranularityKey>("week");

  const latest = load?.[load.length - 1];

  // Training load, bucketed by whichever granularity is selected (week/month/year).
  const loadByPeriod = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of load ?? []) {
      const key = bucketKey(r.load_date as string, granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.training_load ?? 0));
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ period: bucketLabel(key, granularity), value: Math.round(value) }));
  }, [load, granularity]);

  // Average efficiency score, bucketed the same way.
  const efficiencyByPeriod = useMemo(() => {
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const r of fatigue ?? []) {
      const date = (r as any).sessions?.session_date;
      if (!date || r.efficiency_score == null) continue;
      const key = bucketKey(date, granularity);
      const cur = buckets.get(key) ?? { sum: 0, n: 0 };
      cur.sum += Number(r.efficiency_score);
      cur.n += 1;
      buckets.set(key, cur);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, { sum, n }]) => ({ period: bucketLabel(key, granularity), value: Math.round(sum / n) }));
  }, [fatigue, granularity]);

  // Distance: the underlying view is pre-aggregated per ISO week, but summing those weekly
  // totals into whichever bucket is selected gives the same result as bucketing raw sessions
  // would, without needing a second data source.
  const distanceByPeriod = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of (weeklyDist ?? []) as any[]) {
      const key = bucketKey(r.week_start, granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.distance_m ?? 0));
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, meters]) => ({ period: bucketLabel(key, granularity), km: Math.round((meters / 1000) * 10) / 10 }));
  }, [weeklyDist, granularity]);

  const zoneBuckets = useMemo(() => {
    const make = (source: "hr" | "pace") => {
      const sec = new Map<string, number>();
      const m = new Map<string, number>();
      for (const r of ((zoneTime as any) ?? []).filter((x: any) => x.source === source)) {
        sec.set(r.zone, (sec.get(r.zone) ?? 0) + Number(r.seconds ?? 0));
        m.set(r.zone, (m.get(r.zone) ?? 0) + Number(r.meters ?? 0));
      }
      // z6 was missing here — this predates the 6-zone model, found while
      // making the change below.
      const order = ["z1", "z2", "z3", "z4", "z5", "z6"];
      return order.map((zone) => ({
        zone: zone.toUpperCase(),
        hours: Math.round(((sec.get(zone) ?? 0) / 3600) * 10) / 10,
        km: Math.round(((m.get(zone) ?? 0) / 1000) * 10) / 10,
      }));
    };
    return { hr: make("hr"), pace: make("pace") };
  }, [zoneTime]);

  const intentData = useMemo(() => {
    const periodStartISO = periodStartForGranularity(granularity);
    const buckets = new Map<string, number>();
    for (const r of (intentRollup as any[]) ?? []) {
      if (!r.session_date || r.session_date < periodStartISO) continue;
      // Non-training days (race, recovery, cross_training, rest) have no
      // `intent` value at all — they were being silently dropped entirely,
      // which is why Race never showed up here despite race sessions
      // clearly existing. day_type takes priority for anything not
      // "training", matching the same logic sessionColorClass already uses
      // for the calendar.
      //
      // cross_training used to collapse into one lumped bucket regardless
      // of what it actually was — split by activity_type (gym/ride/swim)
      // where set, same fallback pattern as the athlete weekly report, so
      // a coach can see "how much gym vs bike vs swim" instead of one
      // undifferentiated blob. Falls back to the old single
      // "cross_training" bucket for older data with no activity_type set.
      let key: string | null;
      if (r.day_type && r.day_type !== "training") {
        if (r.day_type === "cross_training" && (r.activity_type === "gym" || r.activity_type === "ride" || r.activity_type === "swim")) {
          key = r.activity_type;
        } else {
          key = r.day_type;
        }
      } else {
        key = r.intent;
      }
      if (!key) continue;
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.total_time_seconds ?? 0));
    }
    const order = [
      "easy", "aerobic", "tempo", "threshold", "vo2", "anaerobic", "speed",
      "race", "recovery", "gym", "ride", "swim", "cross_training", "rest",
    ];
    const LABELS: Record<string, string> = {
      easy: "Easy", aerobic: "Aerobic", tempo: "Tempo", threshold: "Threshold", vo2: "VO2",
      anaerobic: "Anaerobic", speed: "Speed", race: "Race", recovery: "Recovery",
      gym: "Gym", ride: "Ride", swim: "Swim",
      cross_training: "Cross-training (other)", rest: "Rest",
    };
    return order
      .filter((k) => buckets.has(k))
      .map((key) => ({
        key,
        intent: LABELS[key] ?? key,
        minutes: Math.round((buckets.get(key) ?? 0) / 60),
      }));
  }, [intentRollup, granularity]);

  const intentTotalMinutes = useMemo(() => intentData.reduce((a, d) => a + d.minutes, 0), [intentData]);

  // Higher-level rollup than intentData above — that one breaks training
  // sessions down by intent (and now cross-training by gym/ride/swim).
  // This one steps back to the top-level day_type only: how many sessions
  // (and how many hours) were Training vs Race vs Recovery vs
  // Cross-training vs Rest, in one glance. Reuses the same intentRollup
  // query rather than firing a second query for the same date range —
  // and, like intentData above, filters by the selected granularity
  // rather than showing the query's full fetched range regardless of
  // which week/month/year button is selected.
  const dayTypeData = useMemo(() => {
    const periodStartISO = periodStartForGranularity(granularity);
    const buckets = new Map<string, { count: number; minutes: number }>();
    for (const r of (intentRollup as any[]) ?? []) {
      if (!r.session_date || r.session_date < periodStartISO) continue;
      const key = r.day_type ?? "training";
      const cur = buckets.get(key) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += Number(r.total_time_seconds ?? 0) / 60;
      buckets.set(key, cur);
    }
    return DAY_TYPE_ORDER.filter((k) => buckets.has(k)).map((key) => {
      const b = buckets.get(key)!;
      return {
        key,
        label: DAY_TYPE_PIE_LABELS[key] ?? key,
        sessions: b.count,
        hours: Math.round((b.minutes / 60) * 10) / 10,
      };
    });
  }, [intentRollup, granularity]);

  const dayTypeTotalSessions = useMemo(() => dayTypeData.reduce((a, d) => a + d.sessions, 0), [dayTypeData]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {showBack && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <Link to="/app/athletes" className="hover:text-foreground">
                Athletes
              </Link>
              <span className="text-border">/</span>
              <Link to="/app/athletes/$athleteId" params={{ athleteId }} className="hover:text-foreground">
                {athlete?.name ?? "Athlete"}
              </Link>
            </div>
          )}
          <h1 className="text-2xl font-bold mt-1">{athlete?.name ?? "Analytics"}</h1>
          <div className="mt-1">
            <ReadinessBadge
              status={latest?.readiness_status as any}
              score={latest?.readiness_score as any}
              confidence={latest?.confidence as any}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showBack && (
            <CoachAthletePicker
              roster={roster ?? []}
              myAthlete={myAthlete as any}
              value={athleteId}
              onChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
            />
          )}
          <RangePicker
            value={range}
            onChange={onRangeChange}
            customFrom={customFrom}
            customTo={customTo}
            onCustomRange={onCustomRange}
          />
        </div>
      </div>

      {showBack && <AthleteSubnav athleteId={athleteId} active="analytics" />}

      {/* Year-at-a-glance weekly training strip — Coros-style. Clicking a
          week zooms every chart below to that week via the existing
          custom-range mechanism (same one the range picker uses). */}
      <YearlyLoadStrip athleteId={athleteId} onWeekClick={(from, to) => onCustomRange(from, to)} />

      {/* Fitness / Fatigue / Form chart — with an optional forward-looking
          projection layered on top of the same card via a toggle, rather
          than a separate chart, so "what happened" and "what if it
          continued" read as one picture instead of two disconnected
          ones. Turning the forecast on necessarily overrides the range
          picker above with a fixed recent window (last 30 real days) —
          a multi-month or "All time" history squashed against a 1-3
          month projection isn't a readable chart either way, so this
          makes that trade-off explicit and automatic instead of letting
          someone select "All time" and wonder why the forecast looks
          broken. */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Fitness, Fatigue & Form</CardTitle>
              <CardDescription>
                {showForecast
                  ? "Projected forward from today, based on this athlete's last 30 days of real training."
                  : `Fitness, fatigue, and form over ${RANGES[range].label.toLowerCase()}.`}
              </CardDescription>
            </div>
            <Button size="sm" variant={showForecast ? "default" : "outline"} onClick={() => setShowForecast((v) => !v)}>
              {showForecast ? "Hide forecast" : "Show forecast"}
            </Button>
          </div>
          {showForecast ? (
            <div className="flex items-center gap-3 flex-wrap pt-2">
              <div className="flex border rounded-md overflow-hidden text-xs w-fit">
                <button
                  onClick={() => setForecastScenario("continued")}
                  className={`px-2.5 py-1 ${forecastScenario === "continued" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  Continued
                </button>
                <button
                  onClick={() => setForecastScenario("increased")}
                  className={`px-2.5 py-1 ${forecastScenario === "increased" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  Increased
                </button>
                <button
                  onClick={() => setForecastScenario("decreased")}
                  className={`px-2.5 py-1 ${forecastScenario === "decreased" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  Decreased
                </button>
                <button
                  onClick={() => setForecastScenario("none")}
                  className={`px-2.5 py-1 ${forecastScenario === "none" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  No training
                </button>
              </div>
              <div className="flex border rounded-md overflow-hidden text-xs w-fit">
                <button
                  onClick={() => setForecastMonths(1)}
                  className={`px-2.5 py-1 ${forecastMonths === 1 ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  1 Month
                </button>
                <button
                  onClick={() => setForecastMonths(3)}
                  className={`px-2.5 py-1 ${forecastMonths === 3 ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  3 Months
                </button>
              </div>
            </div>
          ) : (
            !!estimatedLoadCount && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 pt-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {estimatedLoadCount} session{estimatedLoadCount === 1 ? "" : "s"} in this range {estimatedLoadCount === 1 ? "has" : "have"} no logged RPE — {estimatedLoadCount === 1 ? "its" : "their"} contribution to these numbers is a category-based estimate, not real effort data.
              </p>
            )
          )}
        </CardHeader>
        <CardContent>
          {showForecast ? (
            !forecastChartData || !load || load.length < 7 ? (
              <p className="text-sm text-muted-foreground">
                Building baseline — need at least a week of real training load history to project from.
              </p>
            ) : (
              <>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer>
                    <ComposedChart data={forecastChartData} margin={{ top: 26, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="load_date" tick={{ fontSize: 11 }} minTickGap={32} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 12,
                        }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" />
                      {load && load.length > 0 && (
                        <ReferenceLine
                          x={load[load.length - 1].load_date as string}
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={1}
                          label={{ value: "Today", position: "top", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        />
                      )}
                      {/* Real data — same colors/style as the non-forecast
                          view below, solid lines. */}
                      <Area type="monotone" dataKey="tsb" name="Form" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} />
                      <Line type="monotone" dataKey="ctl" name="Fitness" stroke="#10b981" strokeWidth={2} dot={false} />
                      <Line
                        type="monotone"
                        dataKey="atl"
                        name="Fatigue"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        dot={false}
                      />
                      {/* Projected continuation — same colors, open dashed
                          stroke so it's unmistakably a projection, not more
                          real data. */}
                      <Area
                        type="monotone"
                        dataKey="tsbProjected"
                        name="Form (projected)"
                        stroke="#3b82f6"
                        strokeDasharray="6 4"
                        fill="#3b82f6"
                        fillOpacity={0.05}
                      />
                      <Line
                        type="monotone"
                        dataKey="ctlProjected"
                        name="Fitness (projected)"
                        stroke="#10b981"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="atlProjected"
                        name="Fatigue (projected)"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                      />
                      {/* Race days — including any upcoming planned race
                          that falls within the projection window, so a
                          coach can see whether the projected trajectory
                          sets up well for it. */}
                      {(raceDays ?? []).map((r: any) => {
                        const rawTitle = r.title ?? "Race";
                        const shortTitle = rawTitle.length > 18 ? `${rawTitle.slice(0, 17)}…` : rawTitle;
                        return (
                          <ReferenceLine
                            key={r.id}
                            x={r.session_date}
                            stroke="#db2777"
                            strokeWidth={1.5}
                            strokeDasharray={r.completed_at ? undefined : "4 3"}
                            label={{
                              value: "🏁 " + shortTitle,
                              position: "top",
                              offset: 10,
                              fontSize: 10,
                              fill: "#db2777",
                            }}
                          />
                        );
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  "Continued" repeats this athlete's own last 7 days of training load forward as-is. "Increased" and
                  "decreased" scale that same weekly pattern up ~20% or down ~30%. "No training" projects a full
                  stop. All four use the same Fitness/Fatigue/Form math as the real chart, so the projected line
                  always picks up exactly where the real one leaves off — this is a model of what the numbers would
                  do under each scenario, not a prediction of what will actually happen.
                </p>
              </>
            )
          ) : !load || load.length < 3 ? (
            <p className="text-sm text-muted-foreground">
              Building baseline — keep logging sessions and daily check-ins.
            </p>
          ) : (
            <>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <ComposedChart data={load} margin={{ top: 26, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <pattern
                        id="lowConfidenceHatch"
                        patternUnits="userSpaceOnUse"
                        width="6"
                        height="6"
                        patternTransform="rotate(45)"
                      >
                        <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.4" strokeWidth="1.5" />
                      </pattern>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="load_date" tick={{ fontSize: 11 }} minTickGap={32} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {lowConfidenceEndDate && (
                      <ReferenceArea
                        x1={load[0].load_date as string}
                        x2={lowConfidenceEndDate}
                        fill="url(#lowConfidenceHatch)"
                        ifOverflow="extendDomain"
                      />
                    )}
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" />
                    <Area
                      type="monotone"
                      dataKey="tsb"
                      name="Form"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.12}
                    />
                    <Line
                      type="monotone"
                      dataKey="ctl"
                      name="Fitness"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="atl"
                      name="Fatigue"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                    />
                    {/* Load-ratio guide lines — each one is that day's own
                        Fitness value scaled to what Form would need to be to
                        sit exactly at that ratio, so the guide tracks each
                        athlete's own fitness level instead of a fixed
                        number. 0.8/1.3/1.5 are the same thresholds already
                        used for the readiness score and dashboard alerts;
                        0.5 is a general taper/peaking guideline, not
                        personalized to this athlete. */}
                    <Line
                      type="monotone"
                      dataKey="ratioPeak"
                      name="Peak/taper guide (ratio ~0.5)"
                      stroke="#22d3ee"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ratioLow"
                      name="Low load guide (ratio 0.8)"
                      stroke="#94a3b8"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ratioCaution"
                      name="Caution guide (ratio 1.3)"
                      stroke="#f59e0b"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ratioHighRisk"
                      name="High-risk guide (ratio 1.5)"
                      stroke="#ef4444"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      dot={false}
                    />
                    {/* Race days — vertical markers so it's visible how Form
                        was trending into each actual race, past or planned.
                        Dashed/lighter for a not-yet-completed (future
                        planned) race vs a solid line for one that already
                        happened. */}
                    {(raceDays ?? []).map((r: any) => {
                      const rawTitle = r.title ?? "Race";
                      const shortTitle = rawTitle.length > 18 ? `${rawTitle.slice(0, 17)}…` : rawTitle;
                      return (
                        <ReferenceLine
                          key={r.id}
                          x={r.session_date}
                          stroke="#db2777"
                          strokeWidth={1.5}
                          strokeDasharray={r.completed_at ? undefined : "4 3"}
                          label={{
                            value: "🏁 " + shortTitle,
                            position: "top",
                            offset: 10,
                            fontSize: 10,
                            fill: "#db2777",
                          }}
                        />
                      );
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Dashed guide lines mark this athlete's own acute:chronic load-ratio thresholds (Fatigue ÷ Fitness) —
                below the grey line is under-loaded, between grey and amber is the typical training zone, above amber
                is worth watching, above red carries elevated injury risk. The cyan line is a general peaking/taper
                guideline for the final 1-2 weeks before a key race — not personalized to this athlete, just a common
                starting point. Same thresholds the readiness score and "Needs Attention" alerts already use, so this
                chart, the alerts, and the reports all agree with each other. Pink markers show actual race days
                (solid = completed, dashed = planned) — worth building a picture over time of where this athlete's
                own Form tends to sit when they race well.
              </p>
              {lowConfidenceEndDate && (
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, hsl(var(--muted-foreground)) 0, hsl(var(--muted-foreground)) 1px, transparent 1px, transparent 4px)",
                      opacity: 0.6,
                    }}
                  />
                  Hatched region (through {lowConfidenceEndDate}): building baseline — not enough history yet to
                  fully trust these early readings, especially for an athlete with real training history predating
                  this app.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-medium text-muted-foreground">Training trends grouped by</h2>
        <div className="flex border rounded-md overflow-hidden text-xs">
          <button
            onClick={() => setGranularity("week")}
            className={`px-2.5 py-1 ${granularity === "week" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
          >
            Week
          </button>
          <button
            onClick={() => setGranularity("month")}
            className={`px-2.5 py-1 ${granularity === "month" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
          >
            Month
          </button>
          <button
            onClick={() => setGranularity("year")}
            className={`px-2.5 py-1 ${granularity === "year" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
          >
            Year
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Training Load</CardTitle>
            <CardDescription>Sum of session load per {granularity}.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadByPeriod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No training load recorded yet.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <BarChart data={loadByPeriod} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Bar dataKey="value" name="Load" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Within-session fatigue trend</CardTitle>
            <CardDescription>
              Average efficiency score across interval sessions, by {granularity}. Higher = holding pace better late.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {efficiencyByPeriod.length < 2 ? (
              <p className="text-sm text-muted-foreground">Complete a few interval sessions to see this trend.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <RLineChart data={efficiencyByPeriod} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Efficiency"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </RLineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distance</CardTitle>
            <CardDescription>Total distance per {granularity}.</CardDescription>
          </CardHeader>
          <CardContent>
            {distanceByPeriod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No distance logged in this range.</p>
            ) : (
              <div className="h-[200px] w-full">
                <ResponsiveContainer>
                  <BarChart data={distanceByPeriod} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Bar dataKey="km" name="km" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <ZoneBarCard
          title="Time in HR Zone"
          description="Hours per HR zone in this range."
          data={zoneBuckets.hr}
          dataKey="hours"
          unit="hr"
          color="#ef4444"
        />
        <ZoneBarCard
          title="Time in Pace Zone"
          description="Hours per pace zone (anchored to 5K pace)."
          data={zoneBuckets.pace}
          dataKey="hours"
          unit="hr"
          color="#3b82f6"
        />
        <ZoneBarCard
          title="Distance in HR Zone"
          description="Kilometres per HR zone in this range."
          data={zoneBuckets.hr}
          dataKey="km"
          unit="km"
          color="#ef4444"
        />
        <ZoneBarCard
          title="Distance in Pace Zone"
          description="Kilometres per pace zone in this range."
          data={zoneBuckets.pace}
          dataKey="km"
          unit="km"
          color="#3b82f6"
        />

        <Card>
          <CardHeader>
            <CardTitle>Time by Training Intent</CardTitle>
            <CardDescription>
              Session-level total time grouped by intent, {volumePeriodLabel(granularity)} — race days included,
              colors match the calendar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {intentData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed training sessions {volumePeriodLabel(granularity)}.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={intentData}
                      dataKey="minutes"
                      nameKey="intent"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      label={({ value }: any) => {
                        const pct = intentTotalMinutes ? Math.round((Number(value) / intentTotalMinutes) * 100) : 0;
                        return `${pct}%`;
                      }}
                      labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                    >
                      {intentData.map((d) => (
                        <Cell key={d.key} fill={INTENT_PIE_COLORS[d.key] ?? "#8b5cf6"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: number, name: string) => {
                        const pct = intentTotalMinutes ? Math.round((value / intentTotalMinutes) * 100) : 0;
                        return [`${formatVolumeValue(value, "minutes")} (${pct}%)`, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions by Type</CardTitle>
            <CardDescription>
              How many sessions — and how many hours — were Training vs Race vs Recovery vs Cross-training vs Rest,{" "}
              {volumePeriodLabel(granularity)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dayTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed sessions {volumePeriodLabel(granularity)}.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={dayTypeData}
                      dataKey="sessions"
                      nameKey="label"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      label={({ value }: any) => {
                        const pct = dayTypeTotalSessions ? Math.round((Number(value) / dayTypeTotalSessions) * 100) : 0;
                        return `${pct}%`;
                      }}
                      labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                    >
                      {dayTypeData.map((d) => (
                        <Cell key={d.key} fill={DAY_TYPE_PIE_COLORS[d.key] ?? "#8b5cf6"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(_value: number, name: string, entry: any) => {
                        const d = entry?.payload;
                        return [`${d?.sessions ?? 0} session${d?.sessions === 1 ? "" : "s"} · ${d?.hours ?? 0}h`, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <VolumeShareCard sessions={(stepVolumeSessions as any[]) ?? []} granularity={granularity} />
      </div>

      {/* Physio */}
      <Card>
        <CardHeader>
          <CardTitle>Physiological profile</CardTitle>
          <CardDescription>From PBs, age, and training age.</CardDescription>
        </CardHeader>
        <CardContent>
          {!physio || physio.status !== "ok" ? (
            <p className="text-sm text-muted-foreground">
              {physio?.coaching_note ?? "Log PBs at two or more distances to generate a profile."}
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div className="flex items-center gap-4">
                <PieSplit aerobic={Number(physio.aerobic_pct ?? 0)} anaerobic={Number(physio.anaerobic_pct ?? 0)} />
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-3 rounded bg-emerald-500" /> Aerobic
                    <span className="font-semibold tabular-nums ml-1">{Number(physio.aerobic_pct)}%</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="h-2 w-3 rounded bg-rose-500" /> Anaerobic
                    <span className="font-semibold tabular-nums ml-1">{Number(physio.anaerobic_pct)}%</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Archetype</div>
                <div className="font-semibold">{physio.archetype}</div>
                {physio.speed_reserve_pct != null && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Speed reserve: <span className="tabular-nums">{physio.speed_reserve_pct}%</span> (
                    {physio.speed_reserve_bucket})
                  </div>
                )}
              </div>
              {physio.coaching_note && (
                <p className="sm:col-span-2 text-sm leading-relaxed border-l-2 pl-3 text-muted-foreground">
                  {physio.coaching_note}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RangePicker({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomRange,
}: {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  customFrom?: string;
  customTo?: string;
  onCustomRange?: (from?: string, to?: string) => void;
}) {
  const isCustom = !!(customFrom || customTo);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="hidden sm:flex border rounded-md overflow-hidden">
        {(Object.keys(RANGES) as RangeKey[]).map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`px-3 py-1.5 text-xs ${value === k && !isCustom ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
          >
            {k === "all" ? "All" : k === "month" ? "MTD" : k === "year" ? "YTD" : k.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="sm:hidden">
        <Select value={value} onValueChange={(v) => onChange(v as RangeKey)}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {RANGES[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {onCustomRange && (
        <div className="flex items-center gap-1 text-xs">
          <input
            type="date"
            value={customFrom ?? ""}
            onChange={(e) => onCustomRange(e.target.value || undefined, customTo)}
            className="h-8 px-2 border rounded bg-background"
            aria-label="From"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo ?? ""}
            onChange={(e) => onCustomRange(customFrom, e.target.value || undefined)}
            className="h-8 px-2 border rounded bg-background"
            aria-label="To"
          />
          {isCustom && (
            <button
              onClick={() => onCustomRange(undefined, undefined)}
              className="px-2 h-8 text-xs hover:bg-accent rounded"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PieSplit({ aerobic, anaerobic }: { aerobic: number; anaerobic: number }) {
  const total = aerobic + anaerobic || 1;
  const aerAngle = (aerobic / total) * 360;
  return (
    <div
      className="h-20 w-20 rounded-full"
      style={{ background: `conic-gradient(rgb(16 185 129) 0 ${aerAngle}deg, rgb(244 63 94) ${aerAngle}deg 360deg)` }}
      aria-label={`${aerobic}% aerobic, ${anaerobic}% anaerobic`}
    />
  );
}

function ZoneBarCard({
  title,
  description,
  data,
  dataKey,
  unit,
  color,
}: {
  title: string;
  description: string;
  data: { zone: string; hours: number; km: number }[];
  dataKey: "hours" | "km";
  unit: string;
  color: string;
}) {
  const hasData = data.some((d) => Number(d[dataKey]) > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">No zone data yet — complete sessions with HR or pace logged.</p>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Bar dataKey={dataKey} name={unit} fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Matches the exact hex values behind sessionColorClass in
// calendar-day-cell.tsx, so a zone/intent reads the same color on the
// calendar and here. race/recovery use pink-600/teal-500 rather than
// purple-600/sky-400 specifically to not collide with anaerobic/aerobic —
// those two pairs share a color in the underlying two-table split (a
// session is only ever colored from one table at a time there, so it's
// invisible on the calendar itself), but this chart merges both dimensions
// into one legend, which is exactly where that collision became visible.
const INTENT_PIE_COLORS: Record<string, string> = {
  easy: "#34d399", // emerald-400 — matches calendar-day-cell.tsx
  aerobic: "#38bdf8", // sky-400 — matches calendar-day-cell.tsx
  tempo: "#fbbf24", // amber-400 — matches calendar-day-cell.tsx
  threshold: "#f97316", // orange-500
  vo2: "#ef4444", // red-500
  anaerobic: "#9333ea", // purple-600 — matches calendar-day-cell.tsx
  speed: "#d946ef", // fuchsia-500
  race: "#db2777", // pink-600 — matches calendar-day-cell.tsx
  recovery: "#14b8a6", // teal-500 — matches calendar-day-cell.tsx
  gym: "#a78bfa", // violet-400 — distinct from anaerobic's purple-600
  ride: "#22c55e", // green-500 — distinct from easy's emerald-400
  swim: "#06b6d4", // cyan-500 — distinct from aerobic's sky-400
  cross_training: "#94a3b8", // slate-400 — kept as the "other/unset" fallback
  rest: "#d6d3d1", // stone-300
};

// Top-level day_type rollup — a coarser view than INTENT_PIE_COLORS above
// (which breaks "training" down by intent). Reuses the same race/recovery/
// rest colors from that palette for consistency, since those two charts
// will often sit next to each other on the page.
const DAY_TYPE_ORDER = ["training", "race", "recovery", "cross_training", "rest"];
const DAY_TYPE_PIE_LABELS: Record<string, string> = {
  training: "Training",
  race: "Race",
  recovery: "Recovery",
  cross_training: "Cross-training",
  rest: "Rest",
};
const DAY_TYPE_PIE_COLORS: Record<string, string> = {
  training: "#38bdf8", // sky-400
  race: "#db2777", // pink-600 — matches INTENT_PIE_COLORS
  recovery: "#14b8a6", // teal-500 — matches INTENT_PIE_COLORS
  cross_training: "#a78bfa", // violet-400
  rest: "#d6d3d1", // stone-300 — matches INTENT_PIE_COLORS
};

const KIND_COLORS: Record<string, string> = {
  Warmup: "#0ea5e9",
  Work: "#ef4444",
  Strides: "#f59e0b",
  Recovery: "#64748b",
  Cooldown: "#10b981",
};

function formatVolumeValue(value: number, mode: "minutes" | "km") {
  if (mode === "km") {
    return `${value} km`;
  }
  if (value >= 60) {
    const h = Math.floor(value / 60);
    const m = value % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${value} min`;
}

const VOLUME_KIND_ORDER = ["warmup", "work", "strides", "recovery", "cooldown"];

function startOfIsoWeek(d: Date) {
  const day = d.getDay() || 7; // Mon=1 .. Sun=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function volumePeriodLabel(g: GranularityKey) {
  if (g === "week") return "this week";
  if (g === "month") return "this month";
  return "this year";
}

function periodStartForGranularity(g: GranularityKey) {
  const now = new Date();
  if (g === "week") return toLocalISODate(startOfIsoWeek(now));
  if (g === "month") return toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  return toLocalISODate(new Date(now.getFullYear(), 0, 1));
}

// Reverted back to a pie chart (its original form) now that the page-level
// "Training trends grouped by" control above handles Week/Month/Year — this
// card no longer needs its own separate period toggle duplicating that.
function VolumeShareCard({ sessions, granularity }: { sessions: any[]; granularity: GranularityKey }) {
  const [mode, setMode] = useState<"minutes" | "km">("minutes");

  const periodStartISO = useMemo(() => periodStartForGranularity(granularity), [granularity]);

  const data = useMemo(() => {
    const sec = new Map<string, number>();
    const m = new Map<string, number>();
    for (const session of sessions ?? []) {
      if (!session.session_date || session.session_date < periodStartISO) continue;
      for (const st of session.steps ?? []) {
        const kind = st.kind ?? "work";
        const results = (st.interval_results as any[]) ?? [];
        if (results.length > 0) {
          // Real per-rep data: sum every rep's actuals (a step like 5×1km has 5 rows).
          for (const r of results) {
            sec.set(kind, (sec.get(kind) ?? 0) + Number(r.actual_time_seconds ?? 0));
            m.set(kind, (m.get(kind) ?? 0) + Number(r.actual_distance_m ?? 0));
          }
        } else {
          // Fallback for manually-entered sessions / steps with no per-rep results yet:
          // attribute the planned target volume so the chart isn't empty.
          const reps = Number(st.reps ?? 1);
          const setCount = Number(st.set_count ?? 1);
          const td = Number(st.target_distance_m ?? 0) * reps * setCount;
          const tt = Number(st.target_time_seconds ?? 0) * reps * setCount;
          if (td > 0) m.set(kind, (m.get(kind) ?? 0) + td);
          if (tt > 0) sec.set(kind, (sec.get(kind) ?? 0) + tt);
        }
      }
    }
    return VOLUME_KIND_ORDER.filter((k) => (sec.get(k) ?? 0) > 0 || (m.get(k) ?? 0) > 0).map((kind) => ({
      kind: kind.charAt(0).toUpperCase() + kind.slice(1),
      minutes: Math.round((sec.get(kind) ?? 0) / 60),
      km: Math.round(((m.get(kind) ?? 0) / 1000) * 10) / 10,
    }));
  }, [sessions, periodStartISO]);

  const hasData = data.some((d) => Number(d[mode]) > 0);
  const total = data.reduce((a, d) => a + Number(d[mode]), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Volume by Session Component</CardTitle>
            <CardDescription>
              Share of {mode === "minutes" ? "time" : "distance"} across warmup, work, strides, recovery, and
              cooldown — {volumePeriodLabel(granularity)} to date.
            </CardDescription>
          </div>
          <div className="flex border rounded-md overflow-hidden text-xs">
            <button
              onClick={() => setMode("minutes")}
              className={`px-2.5 py-1 ${mode === "minutes" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >
              Time
            </button>
            <button
              onClick={() => setMode("km")}
              className={`px-2.5 py-1 ${mode === "km" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >
              Distance
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">No logged step volume {volumePeriodLabel(granularity)} yet.</p>
        ) : (
          <>
            <div className="h-[240px] w-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey={mode}
                    nameKey="kind"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                    label={({ value }: any) => formatVolumeValue(Number(value), mode)}
                    labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                  >
                    {data.map((d) => (
                      <Cell key={d.kind} fill={KIND_COLORS[d.kind] ?? "#8b5cf6"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      fontSize: 12,
                    }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    formatter={(v: any, n: any) => {
                      const pct = total ? Math.round((Number(v) / total) * 100) : 0;
                      return [`${formatVolumeValue(Number(v), mode)} (${pct}%)`, n];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {mode === "km" && (
              <p className="text-xs text-muted-foreground mt-2">
                Includes warmup/cooldown to show how volume is split. Will exceed the "Distance" chart's number above,
                which intentionally excludes warmup/cooldown.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
} 
