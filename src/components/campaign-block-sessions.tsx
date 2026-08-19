import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Loader2, Minus } from "lucide-react";
import { estimateSessionVolume, sumVolumes, formatKm, formatDuration } from "@/lib/session-volume";
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
      if (ids.length === 0) return { sessions: [], stepsBySession: new Map<string, any[]>() };

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
      return { sessions: (sessions ?? []) as any[], stepsBySession };
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
      return { week: w, sessions, volumes, total, targetM };
    });
  }, [weeks, data, baselineKm]);

  const blockTotal = useMemo(() => sumVolumes(byWeek.map((r) => r.total)), [byWeek]);
  const blockTarget = useMemo(
    () => byWeek.reduce((a, r) => a + (r.targetM ?? 0), 0),
    [byWeek],
  );

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
        <VolumeVerdictBadge className="ml-auto" actualM={blockTotal.totalM} targetM={blockTarget > 0 ? blockTarget : null} />
      </div>

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

      {blockTotal.estimatedFromTimeM > blockTotal.totalM * 0.15 && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          {Math.round((blockTotal.estimatedFromTimeM / blockTotal.totalM) * 100)}% of this distance is converted from
          time-based targets at an assumed pace rather than prescribed in kilometres.
        </p>
      )}
    </div>
  );
}
