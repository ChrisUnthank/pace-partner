import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Year-at-a-glance weekly training strip — the Coros-style column graph.
 * 52 Monday-start weeks ending with the current week, with a metric toggle
 * (Load / Time / Distance) and the current week highlighted.
 *
 * Load  = sum of athlete_load_daily.combined_load (falls back to
 *         training_load for days recorded before external load existed)
 * Time / Distance = summed from completed sessions.
 *
 * `compact` renders a shorter, non-collapsible version for the Home page.
 * `onWeekClick` (full mode) lets the Analytics page zoom its charts to the
 * clicked week via its existing custom-range mechanism.
 */

type Metric = "load" | "time" | "distance";

const METRIC_LABELS: Record<Metric, string> = {
  load: "Training Load",
  time: "Activity Time",
  distance: "Distance",
};

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
  const [metric, setMetric] = useState<Metric>("load");
  const [collapsed, setCollapsed] = useState(false);

  // 52 week buckets, oldest first, current week last.
  const weeks = useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const out: { start: string; end: string; startDate: Date }[] = [];
    for (let i = 51; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(thisMonday.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      out.push({ start: toISO(start), end: toISO(end), startDate: start });
    }
    return out;
  }, []);
  const rangeStart = weeks[0].start;
  const currentWeekStart = weeks[weeks.length - 1].start;

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
        .select("session_date, total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", rangeStart)
        .not("completed_at", "is", null);
      if (error) return [];
      return data ?? [];
    },
  });

  const data = useMemo(() => {
    // Index every day's numbers by its Monday, then roll up per week.
    const byWeek = new Map<string, { load: number; time: number; distance: number }>();
    for (const w of weeks) byWeek.set(w.start, { load: 0, time: 0, distance: 0 });

    const weekKey = (dateStr: string) => toISO(mondayOf(new Date(dateStr + "T00:00:00")));

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
    }

    return weeks.map((w) => {
      const b = byWeek.get(w.start)!;
      // Month label on the first week whose Monday falls in the first 7
      // days of a month — gives one tick per month across the year.
      const monthLabel =
        w.startDate.getDate() <= 7 ? w.startDate.toLocaleDateString(undefined, { month: "short" }) : "";
      return {
        week: w.start,
        end: w.end,
        monthLabel,
        value: metric === "load" ? Math.round(b.load) : metric === "time" ? b.time : Math.round(b.distance * 10) / 10,
      };
    });
  }, [weeks, loadRows, sessionRows, metric]);

  const yearTotal = data.reduce((s, d) => s + d.value, 0);
  const totalLabel =
    metric === "time" ? fmtTime(yearTotal) : metric === "distance" ? `${Math.round(yearTotal)} km` : `${Math.round(yearTotal)} TL`;

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
        <div className={cn(compact ? "h-20" : "h-36", "mt-1")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={1}>
              <XAxis
                dataKey="monthLabel"
                interval={0}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                height={14}
              />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.15)" }}
                labelFormatter={() => ""}
                formatter={(v: any, _n: any, props: any) => {
                  const p = props?.payload;
                  const label = p
                    ? `${new Date(p.week + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(p.end + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                    : "";
                  const val =
                    metric === "time" ? fmtTime(Number(v)) : metric === "distance" ? `${v} km` : `${v} TL`;
                  return [val, label];
                }}
              />
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
                    fill={d.week === currentWeekStart ? "hsl(var(--primary))" : "#38bdf8"}
                    fillOpacity={d.week === currentWeekStart ? 1 : 0.75}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
