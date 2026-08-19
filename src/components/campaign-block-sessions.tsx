import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Loader2, Minus } from "lucide-react";
import { estimateSessionVolume, sumVolumes, formatKm, formatDuration } from "@/lib/session-volume";
import {
  plannedZoneMix,
  measuredZoneMix,
  sumZoneSeconds,
  totalZoneSeconds,
  emptyZoneSeconds,
  type ZoneSeconds,
} from "@/lib/zone-mix";
import { ZoneColumn, ZoneBar, ZoneLegend, HardShareLabel } from "@/components/zone-column";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// What a block actually contains, once it has been filled.
//
// The fill dialog showed a session list before committing and then that view
// was gone — the block row said "Filled from Base 4wk" and nothing else. So
// the one moment you could check whether the sessions matched the campaign's
// volume was the moment before they existed, which is the wrong way round: the
// question "does this block hold what the campaign asked for" is worth asking
// long after the fill, especially once sessions have been edited by hand.
//
// This reads the SESSIONS, not the fill record. A block's real content is
// whatever is on those dates — including anything added manually afterwards,
// and excluding anything since deleted. Reading campaign_week_fills instead
// would report what was prescribed rather than what is there, and those drift
// apart the moment a coach touches a session.
// ----------------------------------------------------------------------------

export interface BlockWeek {
  id?: string;
  weekNumber: number;
  weekStart: string;
  loadPct: number;
  isDeload?: boolean;
  fillTemplateName?: string | null;
}

function endOfWeek(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Under 5% either way reads as a match — the estimate is not precise enough
 *  to justify calling 2% a discrepancy, and flagging one would train a coach
 *  to ignore the flag. */
const MATCH_TOLERANCE_PCT = 5;

export function volumeVerdict(actualM: number, targetM: number | null) {
  if (targetM == null || targetM <= 0) {
    return { kind: "no-target" as const, deltaPct: null as number | null };
  }
  const deltaPct = (actualM / targetM - 1) * 100;
  if (Math.abs(deltaPct) < MATCH_TOLERANCE_PCT) return { kind: "match" as const, deltaPct };
  return { kind: deltaPct > 0 ? ("over" as const) : ("under" as const), deltaPct };
}

export function VolumeVerdictBadge({
  actualM,
  targetM,
  className,
}: {
  actualM: number;
  targetM: number | null;
  className?: string;
}) {
  const v = volumeVerdict(actualM, targetM);
  if (v.kind === "no-target") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground", className)}>
        <Minus className="h-3 w-3" /> no target set
      </span>
    );
  }
  if (v.kind === "match") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-500", className)}>
        <CheckCircle2 className="h-3 w-3" /> matches target
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500", className)}>
      <AlertTriangle className="h-3 w-3" />
      {v.deltaPct! > 0 ? "+" : ""}
      {v.deltaPct!.toFixed(0)}% vs target
    </span>
  );
}

export function CampaignBlockSessions({
  athleteId,
  weeks,
  baselineKm,
}: {
  athleteId: string;
  weeks: BlockWeek[];
  baselineKm: number | null;
}) {
  const [view, setView] = useState<"sessions" | "zones">("sessions");

  const range = useMemo(() => {
    if (weeks.length === 0) return null;
    const sorted = [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    return { start: sorted[0].weekStart, end: endOfWeek(sorted[sorted.length - 1].weekStart) };
  }, [weeks]);

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-block-sessions", athleteId, range?.start, range?.end],
    enabled: !!athleteId && !!range,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select(
          "id, session_date, title, day_type, intent, is_long_run, total_distance_m, total_time_seconds, completed_at",
        )
        .eq("athlete_id", athleteId)
        .gte("session_date", range!.start)
        .lte("session_date", range!.end)
        .order("session_date");
      if (error) throw error;

      const ids = (sessions ?? []).map((s: any) => s.id);
      if (ids.length === 0) return {
          sessions: [] as any[],
          stepsBySession: new Map<string, any[]>(),
          zonesBySession: new Map<string, any[]>(),
        };

      // Steps in one query rather than per session — a six-week block is
      // easily forty sessions, and forty round trips to render a panel is
      // the kind of thing that only shows up on a slow connection.
      const { data: steps, error: stepsErr } = await supabase
        .from("steps")
        .select("*")
        .in("session_id", ids)
        .order("step_order");
      if (stepsErr) throw stepsErr;

      const stepsBySession = new Map<string, any[]>();
      for (const st of (steps ?? []) as any[]) {
        const list = stepsBySession.get(st.session_id) ?? [];
        list.push(st);
        stepsBySession.set(st.session_id, list);
      }

      // Measured zone time, for sessions that have actually been run.
      //
      // Fetched per session rather than from athlete_zone_time_weekly so a
      // block whose weeks are partly done and partly ahead can show measured
      // time for the former and planned for the latter, in the same column.
      // The weekly view would force one basis on the whole week.
      const { data: zoneRows, error: zoneErr } = await supabase
        .from("session_zone_time")
        .select("session_id, zone, seconds, source")
        .in("session_id", ids);
      if (zoneErr) throw zoneErr;

      const zonesBySession = new Map<string, any[]>();
      for (const z of (zoneRows ?? []) as any[]) {
        const list = zonesBySession.get(z.session_id) ?? [];
        list.push(z);
        zonesBySession.set(z.session_id, list);
      }

      return { sessions: (sessions ?? []) as any[], stepsBySession, zonesBySession };
    },
  });

  const byWeek = useMemo(() => {
    const sorted = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
    return sorted.map((w) => {
      const end = endOfWeek(w.weekStart);
      const sessions = (data?.sessions ?? []).filter(
        (s: any) => s.session_date >= w.weekStart && s.session_date <= end,
      );
      const volumes = sessions.map((s: any) =>
        estimateSessionVolume(
          s,
          data?.stepsBySession.get(s.id) ?? [],
          // A completed session's recorded total wins anyway; the pace key
          // only matters for planned sessions with time-based targets.
          s.is_long_run ? "long" : (s.intent ?? s.day_type ?? "easy"),
        ),
      );
      const total = sumVolumes(volumes);
      const targetM =
        baselineKm != null && baselineKm > 0 ? baselineKm * 1000 * (Number(w.loadPct) / 100) : null;

      // Measured where the session has been run, planned where it has not.
      //
      // Per session rather than per week, so a part-completed week reads
      // honestly instead of having to pick one basis for all of it. `mixBasis`
      // records whether the week is measured, planned, or a mix of both — the
      // label above the column says which, because a planned mix is an
      // intention and a measured one is what happened.
      let anyMeasured = false;
      let anyPlanned = false;
      const mixes: ZoneSeconds[] = sessions.map((sess: any) => {
        const rows = data?.zonesBySession.get(sess.id) ?? [];
        if (rows.length > 0) {
          anyMeasured = true;
          return measuredZoneMix(rows).seconds;
        }
        const planned = plannedZoneMix(sess, data?.stepsBySession.get(sess.id) ?? []);
        if (planned.basis === "planned") anyPlanned = true;
        return planned.seconds;
      });
      const zones = mixes.length > 0 ? sumZoneSeconds(mixes) : emptyZoneSeconds();
      const mixBasis =
        anyMeasured && anyPlanned ? "mixed" : anyMeasured ? "measured" : anyPlanned ? "planned" : "none";

      return { week: w, sessions, volumes, total, targetM, mixes, zones, mixBasis };
    });
  }, [weeks, data, baselineKm]);

  const blockTotal = useMemo(() => sumVolumes(byWeek.map((r) => r.total)), [byWeek]);
  const blockTarget = useMemo(
    () => byWeek.reduce((a, r) => a + (r.targetM ?? 0), 0),
    [byWeek],
  );
  const blockZones = useMemo(() => sumZoneSeconds(byWeek.map((r) => r.zones)), [byWeek]);

  // Tallest week on screen sets the scale, so the zone columns take the same
  // shape as the block's volume rather than flattening it away.
  const maxWeekSeconds = useMemo(
    () => Math.max(0, ...byWeek.map((r) => totalZoneSeconds(r.zones))),
    [byWeek],
  );

  const blockBasisLabel = useMemo(() => {
    const kinds = new Set(byWeek.filter((r) => r.sessions.length > 0).map((r) => r.mixBasis));
    if (kinds.size === 1 && kinds.has("measured")) return "measured";
    if (kinds.size === 1 && kinds.has("planned")) return "planned";
    return "mixed";
  }, [byWeek]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading this block's sessions…
      </div>
    );
  }

  const hasAny = byWeek.some((r) => r.sessions.length > 0);
  if (!hasAny) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        Nothing on these dates yet. Fill the block from a plan template, or add sessions on the calendar.
      </div>
    );
  }

  return (
    <div className="bg-muted/20">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">Block total</span>
        <span className="text-muted-foreground">
          {formatKm(blockTotal.totalM, 0)}
          {blockTarget > 0 && <> against a target of {formatKm(blockTarget, 0)}</>}
          {blockTotal.totalSeconds > 0 && <> · {formatDuration(blockTotal.totalSeconds)}</>}
        </span>
        <VolumeVerdictBadge actualM={blockTotal.totalM} targetM={blockTarget > 0 ? blockTarget : null} />
        <div className="ml-auto flex shrink-0 rounded-md border">
          {(["sessions", "zones"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={cn(
                "px-2 py-0.5 text-[11px] capitalize transition-colors first:rounded-l-md last:rounded-r-md",
                view === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {view === "zones" ? (
        <div className="space-y-3 px-3 py-3">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="font-medium">Intensity distribution</span>
            <HardShareLabel zones={blockZones} />
            <span className="ml-auto text-[10px] text-muted-foreground">
              {blockBasisLabel}
            </span>
          </div>

          {/* One column per week, each full height and split by share.
              Proportional rather than absolute on purpose — the question is
              how much of a week is hard, and a taller column would let a light
              week of all-threshold running look safer than a big easy week. */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${byWeek.length}, minmax(0, 1fr))` }}
          >
            {byWeek.map((row) => (
              <ZoneColumn
                key={row.week.weekNumber}
                zones={row.zones}
                height={72}
                fillPct={
                  maxWeekSeconds > 0 ? (totalZoneSeconds(row.zones) / maxWeekSeconds) * 100 : 0
                }
                label={`W${row.week.weekNumber}`}
              />
            ))}
          </div>

          <div className="space-y-1">
            {byWeek.map((row) => (
              <div key={row.week.weekNumber} className="flex items-center gap-2 text-[11px]">
                <span className="w-8 shrink-0 font-medium">W{row.week.weekNumber}</span>
                <ZoneBar zones={row.zones} className="min-w-0 flex-1" />
                <HardShareLabel zones={row.zones} className="w-20 shrink-0 text-right" />
              </div>
            ))}
          </div>

          <ZoneLegend zones={blockZones} />

          <p className="text-[11px] text-muted-foreground">
            {blockBasisLabel === "planned"
              ? "Nothing here has been run yet, so this is what the sessions are MEANT to be — zones come from each step's target, or from the session's intent where no zone is set. What the athlete actually does may look very different, and comparing the two once the block is done is the useful part."
              : blockBasisLabel === "measured"
                ? "Measured from real pace against this athlete's own zone boundaries."
                : "Weeks already run show measured time in zone; weeks still ahead show what their sessions are planned to be. Those are different things and the mix is deliberate — it is the block as it currently stands."}
          </p>
        </div>
      ) : (
        <>
      {byWeek.map((row) => (
        <div key={row.week.weekNumber} className="border-b last:border-b-0">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="w-10 shrink-0 font-medium">W{row.week.weekNumber}</span>
            <span className="w-24 shrink-0 text-muted-foreground">{fmtDate(row.week.weekStart)}</span>
            <span className="text-muted-foreground">
              {formatKm(row.total.totalM, 0)}
              {row.targetM != null && <> / {formatKm(row.targetM, 0)}</>}
            </span>
            {row.week.isDeload && (
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                deload
              </Badge>
            )}
            <VolumeVerdictBadge className="ml-auto" actualM={row.total.totalM} targetM={row.targetM} />
          </div>

          <div className="divide-y border-t">
            {row.sessions.map((s: any, i: number) => (
              <div key={s.id} className="flex items-center gap-2 py-1 pl-12 pr-3 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{fmtDate(s.session_date)}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {s.completed_at && (
                  <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                    done
                  </Badge>
                )}
                <ZoneBar zones={row.mixes[i]} className="w-16 shrink-0" />
                <span className="w-16 shrink-0 text-right text-muted-foreground">
                  {row.volumes[i].isEmpty ? "—" : formatKm(row.volumes[i].totalM, 1)}
                </span>
              </div>
            ))}
            {row.sessions.length === 0 && (
              <div className="py-1.5 pl-12 pr-3 text-xs italic text-muted-foreground">no sessions this week</div>
            )}
          </div>
        </div>
      ))}

        </>
      )}

      {view === "sessions" && blockTotal.estimatedFromTimeM > blockTotal.totalM * 0.15 && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          {Math.round((blockTotal.estimatedFromTimeM / blockTotal.totalM) * 100)}% of this distance is converted from
          time-based targets at an assumed pace rather than prescribed in kilometres.
        </p>
      )}
    </div>
  );
}
