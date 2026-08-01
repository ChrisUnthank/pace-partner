import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import { secToClock, paceFmt, metersFmt } from "@/lib/format";

// Reads the output of get_athlete_records() (see
// supabase/migrations/20260801000001_athlete_records_milestones.sql) —
// one normalized row per record type, only present when a real
// qualifying session exists. Deliberately not a static list padded with
// placeholders: a record_key simply missing from the response means "not
// yet logged", rendered explicitly below rather than hidden or faked.
//
// Scope note: this covers session-level totals only (distance, time,
// cadence, pace, efficiency score). Ground contact time and vertical
// oscillation aren't included — those only exist per-point in
// raw_session_points, with no session-level average column to read from
// yet. Left out rather than approximated.

type RecordRow = {
  record_key: string;
  label: string;
  value: number;
  unit: string;
  session_id: string | null;
  session_date: string;
  session_title: string | null;
};

const RECORD_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Running",
    keys: [
      "longest_run",
      "highest_weekly_volume",
      "fastest_threshold",
      "best_tempo",
      "longest_interval",
      "highest_cadence",
      "best_efficiency",
    ],
  },
  {
    title: "Cross-training",
    keys: ["longest_ride", "longest_swim", "longest_gym", "highest_weekly_cross_volume"],
  },
];

// Weekly-volume rows carry a week_start in session_date rather than an
// actual session — labelled as a week range instead of a single date.
const WEEK_RANGE_KEYS = new Set(["highest_weekly_volume", "highest_weekly_cross_volume"]);

function formatValue(row: RecordRow): string {
  switch (row.unit) {
    case "m":
      return metersFmt(row.value);
    case "sec":
      return secToClock(row.value);
    case "sec_per_km":
      return paceFmt(row.value);
    case "spm":
      return `${Math.round(row.value)} spm`;
    case "score":
      return `${Math.round(row.value)}/100`;
    default:
      return String(row.value);
  }
}

function formatWhen(row: RecordRow): string {
  const d = new Date(row.session_date + "T00:00:00");
  if (WEEK_RANGE_KEYS.has(row.record_key)) {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const fmt = (x: Date) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Week of ${fmt(d)}–${fmt(end)}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function RecordItem({ row }: { row: RecordRow }) {
  const content = (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-md hover:bg-accent/40 transition-colors">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{row.label}</div>
        <div className="text-xs text-muted-foreground truncate">
          {formatWhen(row)}
          {row.session_title ? ` · ${row.session_title}` : ""}
        </div>
      </div>
      <div className="font-display text-lg font-extrabold tabular-nums shrink-0">{formatValue(row)}</div>
    </div>
  );

  if (!row.session_id) return content;

  return (
    <Link to="/app/sessions/$sessionId" params={{ sessionId: row.session_id }} className="block">
      {content}
    </Link>
  );
}

function EmptyRecordItem({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-md">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xs text-muted-foreground">Not yet logged</div>
    </div>
  );
}

const ALL_LABELS: Record<string, string> = {
  longest_run: "Longest run",
  highest_weekly_volume: "Highest weekly volume",
  fastest_threshold: "Fastest threshold session",
  best_tempo: "Best tempo session",
  longest_interval: "Longest interval session",
  highest_cadence: "Highest cadence",
  best_efficiency: "Best efficiency score",
  longest_ride: "Longest ride",
  longest_swim: "Longest swim",
  longest_gym: "Longest gym session",
  highest_weekly_cross_volume: "Highest weekly cross-training volume",
};

export function RecordsMilestonesCard({ athleteId }: { athleteId: string }) {
  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-records", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_records" as any, { _athlete_id: athleteId });
      if (error) throw error;
      return (data ?? []) as RecordRow[];
    },
  });

  const byKey = new Map((rows ?? []).map((r) => [r.record_key, r]));
  const hasAny = (rows ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-[var(--accent-red)]" />
          Records & Milestones
        </CardTitle>
        <CardDescription>
          Auto-detected from logged session history — running and cross-training. Tap a record to open the session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load records — {(error as any)?.message ?? "unknown error"}. If this mentions the function not
            existing, the <code className="text-xs">get_athlete_records</code> migration hasn't been run in Supabase
            yet.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            No qualifying sessions yet — records will appear here as completed sessions come in.
          </p>
        ) : (
          <div className="space-y-4">
            {RECORD_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 px-3">
                  {group.title}
                </div>
                <div className="divide-y divide-border">
                  {group.keys.map((key) => {
                    const row = byKey.get(key);
                    return row ? <RecordItem key={key} row={row} /> : <EmptyRecordItem key={key} label={ALL_LABELS[key]} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
