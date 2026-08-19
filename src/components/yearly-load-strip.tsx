import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  ZONE_KEYS,
  ZONE_COLORS,
  ZONE_LABELS,
  measuredZoneMix,
  plannedZoneMix,
  sumZoneSeconds,
  emptyZoneSeconds,
  zonePercentages,
  hardSharePct,
  totalZoneSeconds,
} from "@/lib/zone-mix";
import { cn } from "@/lib/utils";

/**
 * Year-at-a-glance weekly training strip — the Coros-style column graph.
 * 52 Monday-start weeks of history ending with the current week, PLUS 4
 * more weeks of already-planned training ahead of it, with a metric toggle
 * (Distance / Activity Time / Training Load) and the current week
 * highlighted. The 4 future weeks render as faded, dashed-outline bars —
 * clearly "planned," never mistaken for completed volume.
 *
 * Load  = sum of athlete_load_daily.combined_load (falls back to
 *         training_load for days recorded before external load existed).
 *         For any day with a completed session but no row in that table
 *         yet — most commonly today, right after logging, since the
 *         recompute pipeline can lag behind real-time — falls back to a
 *         per-session estimate (real rpe if logged, else the same
 *         intent/day-type estimate used for the future weeks) so the
 *         current week's bar doesn't read as blank just because the
 *         aggregation hasn't caught up.
 *         For the future weeks there's no real load yet either, so it's
 *         estimated the same way session_training_load() does server-side
 *         (rpe × duration) — just computed here from intent/day_type,
 *         since a planned session obviously has no real rpe.
 * Time / Distance = summed from completed sessions for history; for the
 *         future weeks, summed from each planned session's own total if
 *         set, else from its steps' target distance/time (same
 *         prefer-explicit-else-sum-structure fallback already used
 *         elsewhere for planned volume).
 *
 * `compact` renders a shorter, non-collapsible version for the Home page.
 * `onWeekClick` (full mode) lets the Analytics page zoom its charts to the
 * clicked week via its existing custom-range mechanism.
 */

type Metric = "distance" | "time" | "load" | "zones";

const METRIC_LABELS: Record<Metric, string> = {
  distance: "Distance",
  time: "Activity Time",
  load: "Training Load",
  zones: "Intensity Mix",
};

// Category-based load estimate, mirroring session_training_load()'s own
// fallback shape (rpe × duration) — computed client-side here since a
// planned session has no real rpe yet, and since that SQL function's own
// fallback reads a `category` column that no longer exists on sessions.
const INTENT_RPE: Record<string, number> = {
  easy: 3, aerobic: 4, tempo: 6, threshold: 7, vo2: 8, anaerobic: 8, speed: 8, time_trial: 8,
};
const DAYTYPE_RPE: Record<string, number> = { race: 9, recovery: 2, cross_training: 4, rest: 0 };

function estimateRpe(s: any): number {
  if (s.day_type && DAYTYPE_RPE[s.day_type] != null) return DAYTYPE_RPE[s.day_type];
  if (s.intent && INTENT_RPE[s.intent] != null) return INTENT_RPE[s.intent];
  return 4;
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0 Sun … 6 Sat
  out.setDate(out.getDate() - ((day + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function YearlyLoadStrip({
  athleteId,
  compact = false,
  onWeekClick,
}: {
  athleteId: string;
  compact?: boolean;
  onWeekClick?: (weekStartISO: string, weekEndISO: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>("distance");
  const [collapsed, setCollapsed] = useState(false);

  // 52 week buckets of history, oldest first, current week last, plus 4
  // more weeks after it — same strip, so what's already planned shows up
  // right alongside what's already been done.
  const weeks = useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const out: { start: string; end: string; startDate: Date; isFuture: boolean }[] = [];
    for (let i = 51; i >= -4; i--) {
      const start = new Date(thisMonday);
      start.setDate(thisMonday.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      out.push({ start: toISO(start), end: toISO(end), startDate: start, isFuture: i < 0 });
    }
    return out;
  }, []);
  const rangeStart = weeks[0].start;
  const rangeEnd = weeks[weeks.length - 1].end;
  const currentWeekStart = toISO(mondayOf(new Date()));
  const futureStart = weeks.find((w) => w.isFuture)?.start;

  const { data: loadRows = [] } = useQuery({
    queryKey: ["yearly-strip-load", athleteId, rangeStart],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("load_date, training_load, combined_load")
        .eq("athlete_id", athleteId)
        .gte("load_date", rangeStart);
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: sessionRows = [] } = useQuery({
    queryKey: ["yearly-strip-sessions", athleteId, rangeStart],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("session_date, total_distance_m, total_time_seconds, completed_at, rpe, day_type, intent")
        .eq("athlete_id", athleteId)
        .gte("session_date", rangeStart)
        .not("completed_at", "is", null);
      if (error) return [];
      return data ?? [];
    },
  });

  // Already-planned (not yet completed) sessions in the 4 future weeks.
  const { data: plannedSessions = [] } = useQuery({
    queryKey: ["yearly-strip-planned-sessions", athleteId, futureStart, rangeEnd],
    enabled: !!athleteId && !!futureStart,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, session_date, day_type, intent, total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", futureStart!)
        .lte("session_date", rangeEnd)
        .is("completed_at", null);
      if (error) return [];
      return data ?? [];
    },
  });

  const plannedSessionIds = useMemo(() => (plannedSessions as any[]).map((s) => s.id), [plannedSessions]);

  // Measured time in zone, week by week.
  //
  // Read from athlete_zone_time_weekly rather than per session: this covers
  // 52 weeks, which is several hundred sessions, and the weekly rollup is
  // already grouped the way this strip needs. The campaign block panel does
  // read per session, because there a part-completed week has to show
  // measured and planned side by side — over a year that distinction lands on
  // the boundary between history and the four planned weeks instead, and the
  // strip already draws those differently.
  const { data: zoneRows = [] } = useQuery({
    queryKey: ["yearly-strip-zones", athleteId, rangeStart],
    enabled: !!athleteId && metric === "zones",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_zone_time_weekly")
        .select("week_start, zone, source, seconds")
        .eq("athlete_id", athleteId)
        .gte("week_start", rangeStart);
      if (error) return [];
      return data ?? [];
    },
  });

  // Step-level targets for planned sessions that have no total of their
  // own yet (the normal case — totals usually only populate once a
  // session's actually run).
  const { data: plannedSteps = [] } = useQuery({
    queryKey: ["yearly-strip-planned-steps", plannedSessionIds.join(",")],
    enabled: plannedSessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps")
        // kind/target_zone/target_mode and the recovery fields are read by
        // plannedZoneMix — without them every step would fall back to the
        // session intent and a threshold session's warmup would be counted
        // as threshold time.
        .select(
          "session_id, kind, reps, set_count, target_distance_m, target_time_seconds, target_mode, target_zone, recovery_target_kind, recovery_target_seconds, recovery_target_distance_m, recovery_between_reps_seconds, recovery_between_sets_seconds",
        )
        .in("session_id", plannedSessionIds);
      if (error) return [];
      return data ?? [];
    },
  });

  const data = useMemo(() => {
    // Index every day's numbers by its Monday, then roll up per week.
    const byWeek = new Map<string, { load: number; time: number; distance: number }>();
    for (const w of weeks) byWeek.set(w.start, { load: 0, time: 0, distance: 0 });

    const weekKey = (dateStr: string) => toISO(mondayOf(new Date(dateStr + "T00:00:00")));

    // Dates athlete_load_daily has already computed a real number for —
    // days a completed session exists but this table hasn't caught up to
    // yet (most commonly today, right after logging) fall back to a
    // per-session estimate below instead of silently reading as zero.
    const loadCoveredDates = new Set((loadRows as any[]).map((r) => r.load_date));

    for (const r of loadRows as any[]) {
      const k = weekKey(r.load_date);
      const bucket = byWeek.get(k);
      if (!bucket) continue;
      bucket.load += Number(r.combined_load ?? r.training_load ?? 0);
    }
    for (const s of sessionRows as any[]) {
      const k = weekKey(s.session_date);
      const bucket = byWeek.get(k);
      if (!bucket) continue;
      bucket.time += Number(s.total_time_seconds ?? 0);
      bucket.distance += Number(s.total_distance_m ?? 0) / 1000;
      if (!loadCoveredDates.has(s.session_date)) {
        const rpeEff = s.rpe != null ? Number(s.rpe) : estimateRpe(s);
        const durationMin = Number(s.total_time_seconds ?? 0) / 60;
        bucket.load += rpeEff * durationMin;
      }
    }

    const stepsBySession = new Map<string, any[]>();
    for (const st of plannedSteps as any[]) {
      const list = stepsBySession.get(st.session_id) ?? [];
      list.push(st);
      stepsBySession.set(st.session_id, list);
    }
    for (const s of plannedSessions as any[]) {
      const k = weekKey(s.session_date);
      const bucket = byWeek.get(k);
      if (!bucket) continue;
      let plannedDistanceM = Number(s.total_distance_m ?? 0);
      let plannedTimeS = Number(s.total_time_seconds ?? 0);
      if (!plannedDistanceM && !plannedTimeS) {
        const steps = stepsBySession.get(s.id) ?? [];
        for (const st of steps) {
          const mult = Number(st.reps ?? 1) * Number(st.set_count ?? 1);
          plannedDistanceM += Number(st.target_distance_m ?? 0) * mult;
          plannedTimeS += Number(st.target_time_seconds ?? 0) * mult;
        }
      }
      bucket.distance += plannedDistanceM / 1000;
      bucket.time += plannedTimeS;
      const durationMin = plannedTimeS > 0 ? plannedTimeS / 60 : 0;
      bucket.load += estimateRpe(s) * durationMin;
    }

    return weeks.map((w) => {
      const b = byWeek.get(w.start)!;
      // Month label on the first week whose Monday falls in the first 7
      // days of a month — gives one tick per month across the year.
      const monthLabel =
        w.startDate.getDate() <= 7 ? w.startDate.toLocaleDateString(undefined, { month: "short" }) : "";

      // Zone mix: measured for history, planned for the weeks ahead.
      let zones = emptyZoneSeconds();
      if (w.isFuture) {
        const sessions = (plannedSessions as any[]).filter((s) => weekKey(s.session_date) === w.start);
        zones = sumZoneSeconds(
          sessions.map((s) => plannedZoneMix(s, stepsBySession.get(s.id) ?? []).seconds),
        );
      } else {
        const rows = (zoneRows as any[]).filter((r) => r.week_start === w.start);
        zones = measuredZoneMix(rows).seconds;
      }
      const zonePct = zonePercentages(zones);
      const zoneTotal = totalZoneSeconds(zones);
      // Minutes, matching the Activity Time tab's own unit — the stack's
      // total height is then the week's total time, and the segments are how
      // that time was spent.
      const zoneMin = (k: keyof typeof zones) => (zones[k] ?? 0) / 60;

      return {
        week: w.start,
        end: w.end,
        monthLabel,
        isFuture: w.isFuture,
        value: metric === "load" ? Math.round(b.load) : metric === "time" ? b.time : Math.round(b.distance * 10) / 10,
        // ABSOLUTE minutes, not percentages.
        //
        // An earlier version stacked to 100% so every column was the same
        // height. That answered "what was the mix" but broke the thing this
        // strip is for — you could no longer see that one week was three
        // times the size of the next, and the zones tab looked like a
        // different chart from the other three. Stacking real minutes keeps
        // both readings: height is volume, the split is distribution.
        z1: zoneMin("z1"),
        z2: zoneMin("z2"),
        z3: zoneMin("z3"),
        z4: zoneMin("z4"),
        z5: zoneMin("z5"),
        z6: zoneMin("z6"),
        zonePct,
        zoneSeconds: zones,
        zoneTotal,
        hardPct: hardSharePct(zones),
      };
    });
  }, [weeks, loadRows, sessionRows, plannedSessions, plannedSteps, metric, zoneRows]);

  // Total only counts actual history — mixing in planned future weeks
  // would overstate what's actually been done.
  const yearTotal = data.filter((d) => !d.isFuture).reduce((s, d) => s + d.value, 0);

  // Adding up percentages would be meaningless, so the zones tab reports the
  // year's actual Z3+ share instead — recomputed from the summed seconds, not
  // averaged from the weekly percentages, which would weight a 30-minute week
  // the same as a fifteen-hour one.
  const yearZones = useMemo(
    () => sumZoneSeconds(data.filter((d) => !d.isFuture).map((d) => d.zoneSeconds)),
    [data],
  );
  const yearHardPct = hardSharePct(yearZones);

  const totalLabel =
    metric === "zones"
      ? yearHardPct == null
        ? "no zone data"
        : `${yearHardPct.toFixed(0)}% at Z3+`
      : metric === "time"
        ? fmtTime(yearTotal)
        : metric === "distance"
          ? `${Math.round(yearTotal)} km`
          : `${Math.round(yearTotal)} TL`;

  return (
    <div className="border rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={metric === m ? "default" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setMetric(m)}
            >
              {METRIC_LABELS[m]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Last 12 months · <span className="font-medium text-foreground">{totalLabel}</span>
          </span>
          {!compact && (
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className={cn(compact ? "h-24" : "h-40", "mt-1")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 6 }} barCategoryGap={1}>
                <XAxis
                  dataKey="monthLabel"
                  interval={0}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  height={20}
                />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip
                  cursor={{ fill: "rgba(148,163,184,0.15)" }}
                  labelFormatter={() => ""}
                  formatter={(v: any, _n: any, props: any) => {
                    const p = props?.payload;
                    const label = p
                      ? `${new Date(p.week + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(p.end + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}${p.isFuture ? " · planned" : ""}`
                      : "";
                    if (metric === "zones") {
                      if (!p || !p.zoneTotal) return ["no zone data", label];
                      const mins = Number(v);
                      if (!(mins > 0)) return [null as any, null as any];
                      const pct = p.zonePct?.[_n as string] ?? 0;
                      return [
                        `${Math.round(mins)}m · ${pct.toFixed(0)}%`,
                        ZONE_LABELS[_n as keyof typeof ZONE_LABELS] ?? _n,
                      ];
                    }
                    const val =
                      metric === "time" ? fmtTime(Number(v)) : metric === "distance" ? `${v} km` : `${v} TL`;
                    return [val, label];
                  }}
                />
                {metric === "zones" ? (
                  // One stacked series per zone, z1 first so it renders at the
                  // bottom — a stack founded on speed would read backwards.
                  ZONE_KEYS.map((z, i) => (
                    <Bar
                      key={z}
                      dataKey={z}
                      stackId="zones"
                      radius={i === ZONE_KEYS.length - 1 ? [2, 2, 0, 0] : undefined}
                      onClick={(d: any) => {
                        if (onWeekClick && d?.week) onWeekClick(d.week, d.end);
                      }}
                      cursor={onWeekClick ? "pointer" : undefined}
                    >
                      {data.map((d) => (
                        <Cell
                          key={d.week}
                          fill={ZONE_COLORS[z]}
                          // Planned weeks stay visually distinct from history
                          // here exactly as they do on the volume tabs — the
                          // difference matters more on this tab, not less,
                          // since a planned mix is an intention.
                          fillOpacity={d.isFuture ? 0.35 : 0.9}
                        />
                      ))}
                    </Bar>
                  ))
                ) : (
                  <Bar
                    dataKey="value"
                    radius={[2, 2, 0, 0]}
                    onClick={(d: any) => {
                      if (onWeekClick && d?.week) onWeekClick(d.week, d.end);
                    }}
                    cursor={onWeekClick ? "pointer" : undefined}
                  >
                    {data.map((d) => (
                      <Cell
                        key={d.week}
                        fill={d.week === currentWeekStart ? "var(--accent-red)" : "#38bdf8"}
                        fillOpacity={d.week === currentWeekStart ? 1 : d.isFuture ? 0.3 : 0.75}
                        stroke={d.isFuture ? "#38bdf8" : undefined}
                        strokeDasharray={d.isFuture ? "3 2" : undefined}
                        strokeOpacity={d.isFuture ? 0.6 : undefined}
                      />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!compact && (
            <>
              {metric === "zones" && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {ZONE_KEYS.map((z) => (
                    <span key={z} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z] }} />
                      {ZONE_LABELS[z]}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {metric === "zones"
                  ? "Column height is the week's total time, same as the other tabs; the split is where that time was spent. History is measured from real pace against this athlete's own zone boundaries; the faded weeks ahead are what their planned sessions are MEANT to be, taken from each step's target or the session's intent — so a short bar there means little planned, not an easy week."
                  : "Faded, dashed-outline bars are the next 4 weeks — already planned, not yet completed."}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
