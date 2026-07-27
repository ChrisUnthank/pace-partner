import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { ReadinessBadge } from "@/components/readiness-badge";
import { metersFmt, secToClock } from "@/lib/format";
import { CalendarDays, X, Maximize2 } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip } from "recharts";

type AthleteSummary = {
  id: string;
  name: string;
  primary_event?: string | null;
  profile_image_url?: string | null;
};

// Quick-look panel showing an athlete's recent totals, current training
// load, a mini year-of-load trend, and a handful of recent sessions —
// without navigating away from wherever it's rendered. Deliberately an
// in-flow block (a sticky column on desktop, a normal stacked section on
// mobile), not a fixed/floating overlay — a `fixed inset-y-0` overlay has
// no way to know a given page's header height, so it risks sliding over
// the header strip. Living in normal document flow inside the caller's own
// layout sidesteps that entirely, on any page, regardless of header height.
//
// "Full view" goes to the full /app/athletes/$athleteId page.
//
// Scope note: no HR time-in-zone breakdown yet — that would read from
// session_zone_time, whose exact columns haven't been confirmed against
// this schema. Everything here reuses queries/tables already proven out
// elsewhere (athlete_load_daily, sessions).
export function AthleteSummaryPanel({
  athlete,
  onClose,
  embedded = false,
}: {
  athlete: AthleteSummary | null;
  onClose: () => void;
  // True when rendered inside something that already provides its own
  // chrome — currently the Roster page's quick-view Sheet, which has its
  // own background/padding and its own close (X) button top-right. Drops
  // this component's own border/background/padding and its header-row
  // close button so the two don't stack. The Home dashboard's "Your
  // athletes" widget renders this in-flow instead (no Sheet), so it keeps
  // the default (embedded=false) look.
  embedded?: boolean;
}) {
  const athleteId = athlete?.id ?? null;
  const isOpen = !!athleteId;

  const { data: load } = useQuery({
    queryKey: ["panel-load", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("*")
        .eq("athlete_id", athleteId!)
        .order("load_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
  });

  // Last 12 months of Fitness/Fatigue/Form, for the mini trend chart under
  // the readiness badge — same fields (ctl/atl/tsb) and colors as the real
  // Fitness, Fatigue & Form chart on the Analytics page, just compressed
  // and stripped of axes/legend/guide-lines for a glanceable mini version.
  const { data: yearLoad } = useQuery({
    queryKey: ["panel-year-load", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl, atl, tsb")
        .eq("athlete_id", athleteId!)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      return (data ?? []).map((d: any) => ({
        load_date: d.load_date,
        ctl: d.ctl != null ? Math.round(Number(d.ctl)) : null,
        atl: d.atl != null ? Math.round(Number(d.atl)) : null,
        tsb: d.tsb != null ? Math.round(Number(d.tsb)) : null,
      }));
    },
  });

  // Last 7 days — summary totals row (distance/time/workout count).
  const { data: rangeSessions } = useQuery({
    queryKey: ["panel-range-sessions", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("sessions")
        .select("id, total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athleteId!)
        .gte("session_date", since);
      return data ?? [];
    },
  });

  // Most recent sessions regardless of date — the mini list underneath.
  const { data: recentSessions } = useQuery({
    queryKey: ["panel-recent-sessions", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, session_date, title, completed_at")
        .eq("athlete_id", athleteId!)
        .order("session_date", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  if (!athlete) return null;

  const completedInRange = (rangeSessions ?? []).filter((s: any) => s.completed_at);
  const rangeDistanceM = completedInRange.reduce((sum: number, s: any) => sum + Number(s.total_distance_m ?? 0), 0);
  const rangeTimeS = completedInRange.reduce((sum: number, s: any) => sum + Number(s.total_time_seconds ?? 0), 0);

  return (
    <div className={embedded ? "space-y-5" : "border rounded-lg bg-card p-4 space-y-5"}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <UserAvatar name={athlete.name} imageUrl={athlete.profile_image_url ?? undefined} size="lg" />
          <div className="min-w-0">
            <div className="font-semibold truncate">{athlete.name}</div>
            <div className="text-xs text-muted-foreground truncate">{athlete.primary_event ?? "—"}</div>
          </div>
        </div>
        {!embedded && (
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" className="flex-1">
          <Link to="/app/athletes/$athleteId" params={{ athleteId: athlete.id }}>
            <Maximize2 className="h-3.5 w-3.5 mr-1.5" /> Full view
          </Link>
        </Button>
        <Button asChild size="icon" variant="outline" title="View calendar">
          <Link to="/app/sessions/calendar" search={{ athleteId: athlete.id } as any}>
            <CalendarDays className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {load && (
        <>
          <ReadinessBadge status={load.readiness_status} score={load.readiness_score} confidence={load.confidence} />

          {/* Mini 12-month training load trend — same Fitness/Fatigue/Form
              data as the Analytics page chart, compressed with hidden axes
              and no legend/guide-lines so it reads at a glance rather than
              competing with the full chart for detail. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs text-muted-foreground">12-month training load</div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Fitness
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />Fatigue
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />Form
                </span>
              </div>
            </div>
            {!yearLoad || yearLoad.length < 3 ? (
              <p className="text-xs text-muted-foreground">Building baseline — keep logging sessions.</p>
            ) : (
              <div className="h-24 w-full -ml-2">
                <ResponsiveContainer>
                  <ComposedChart data={yearLoad} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="panelFormFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="load_date" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 11,
                        padding: "4px 8px",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontSize: 11 }}
                      itemStyle={{ fontSize: 11 }}
                    />
                    <Area type="monotone" dataKey="tsb" name="Form" stroke="#3b82f6" fill="url(#panelFormFill)" strokeWidth={1.5} />
                    <Line type="monotone" dataKey="ctl" name="Fitness" stroke="#10b981" strokeWidth={1.5} dot={false} />
                    <Line
                      type="monotone"
                      dataKey="atl"
                      name="Fatigue"
                      stroke="#f43f5e"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <div className="text-xs text-muted-foreground mb-2">Last 7 days</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="border rounded-lg px-2 py-2 text-center">
            <div className="text-base font-semibold tabular-nums">{metersFmt(rangeDistanceM)}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Distance</div>
          </div>
          <div className="border rounded-lg px-2 py-2 text-center">
            <div className="text-base font-semibold tabular-nums">{completedInRange.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Workouts</div>
          </div>
          <div className="border rounded-lg px-2 py-2 text-center">
            <div className="text-base font-semibold tabular-nums">{secToClock(rangeTimeS)}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Time</div>
          </div>
        </div>
      </div>

      {load && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">Training load</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="border rounded-lg px-2 py-2 text-center">
              <div className="text-base font-semibold tabular-nums">{load.ctl?.toFixed?.(0) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Fitness</div>
            </div>
            <div className="border rounded-lg px-2 py-2 text-center">
              <div className="text-base font-semibold tabular-nums">{load.atl?.toFixed?.(0) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Fatigue</div>
            </div>
            <div className="border rounded-lg px-2 py-2 text-center">
              <div className="text-base font-semibold tabular-nums">{load.tsb?.toFixed?.(0) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Form</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs text-muted-foreground mb-2">Recent sessions</div>
        {!recentSessions || recentSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <div className="divide-y border rounded-lg overflow-hidden">
            {recentSessions.map((s: any) => (
              <Link
                key={s.id}
                to="/app/sessions/$sessionId"
                params={{ sessionId: s.id }}
                className="flex justify-between items-center px-3 py-2 text-sm hover:bg-accent/40"
              >
                <span className="truncate">
                  {s.session_date} · {s.title}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {s.completed_at ? "Done" : "Planned"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
