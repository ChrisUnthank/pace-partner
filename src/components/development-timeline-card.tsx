import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";

// Development Timeline — automatic phase detection, not a manually-set
// value. This is deliberately NOT the same thing as the coach-authored
// macro-phase periodisation (training_phases table) planned as a later
// Coaching Hub build — that will be an intentional plan a coach lays out
// in advance; this card infers where an athlete's training actually sits
// *right now* from real load data and their own goal race date. The two
// can disagree (e.g. a coach plans "Development" for this block but the
// data shows load flat) — that's a legitimate signal worth seeing, not a
// bug, so this card is left standalone rather than merged with that
// future feature.
//
// Six phases, in order: Foundation, Development, Performance, Competition,
// Peak, Transition. Detection uses two real signals: days until the
// athlete's primary active race goal (athlete_goals), and their CTL
// (Fitness) trend + a taper ratio from athlete_load_daily — same
// Fitness/Fatigue/Form data the Analytics chart already uses, no new
// computation pipeline.

type Phase = "Foundation" | "Development" | "Performance" | "Competition" | "Peak" | "Transition";

const PHASE_ORDER: Phase[] = ["Foundation", "Development", "Performance", "Competition", "Peak", "Transition"];

const PHASE_META: Record<Phase, { description: string }> = {
  Foundation: { description: "Building aerobic base and consistency — no upcoming race driving the training yet." },
  Development: { description: "Fitness (CTL) trending up steadily — the main volume/aerobic-building block." },
  Performance: { description: "Race still 3-8 weeks out — shifting toward race-specific work." },
  Competition: { description: "Race within 3 weeks — sharpening, volume starting to come down." },
  Peak: { description: "Final taper — race imminent or a clear drop in load relative to recent weeks." },
  Transition: { description: "Just raced — recovery block before the next build starts." },
};

type LoadRow = { load_date: string; ctl: number | null; training_load: number | null };

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function DevelopmentTimelineCard({ athleteId }: { athleteId: string }) {
  const { data: loadDaily } = useQuery({
    queryKey: ["development-timeline-load", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl, training_load")
        .eq("athlete_id", athleteId)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LoadRow[];
    },
  });

  const { data: primaryGoal } = useQuery({
    queryKey: ["development-timeline-goal", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_goals")
        .select("race_date, goal_type, status, is_primary")
        .eq("athlete_id", athleteId)
        .eq("is_primary", true)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: recentRace } = useQuery({
    queryKey: ["development-timeline-recent-race", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("performances")
        .select("performance_date")
        .eq("athlete_id", athleteId)
        .eq("context", "race")
        .gte("performance_date", since)
        .order("performance_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const result = useMemo(() => {
    const rows = loadDaily ?? [];
    if (rows.length < 28) {
      return { phase: null as Phase | null, reason: "Needs at least 4 weeks of training load history to detect a phase." };
    }

    const today = new Date();
    const latest = rows[rows.length - 1];
    const latestDate = new Date(latest.load_date + "T00:00:00Z");

    // CTL trend — compare the latest value to ~28 days before it.
    const monthAgoTarget = daysBetween(new Date(0), latestDate) - 28;
    let ctlMonthAgo: number | null = null;
    for (const r of rows) {
      const d = daysBetween(new Date(0), new Date(r.load_date + "T00:00:00Z"));
      if (d <= monthAgoTarget) ctlMonthAgo = r.ctl;
      else break;
    }
    const ctlNow = latest.ctl;
    const ctlTrendPct =
      ctlNow != null && ctlMonthAgo != null && ctlMonthAgo > 0 ? ((ctlNow - ctlMonthAgo) / ctlMonthAgo) * 100 : null;

    // Taper ratio — last 7 days' average load vs. the 21 days before that.
    const last7 = rows.slice(-7);
    const prior21 = rows.slice(-28, -7);
    const avg = (xs: LoadRow[]) => {
      const vals = xs.map((r) => r.training_load).filter((n): n is number => n != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const last7Avg = avg(last7);
    const prior21Avg = avg(prior21);
    const taperRatio = last7Avg != null && prior21Avg != null && prior21Avg > 0 ? last7Avg / prior21Avg : null;

    const raceDate = primaryGoal?.race_date && primaryGoal.goal_type === "race" ? new Date(primaryGoal.race_date + "T00:00:00Z") : null;
    const daysToRace = raceDate ? daysBetween(today, raceDate) : null;

    let phase: Phase;
    let reason: string;

    if (recentRace?.performance_date) {
      phase = "Transition";
      reason = `Raced on ${recentRace.performance_date}, within the last 2 weeks.`;
    } else if (daysToRace != null && daysToRace >= 0 && daysToRace <= 3) {
      phase = "Peak";
      reason = `${daysToRace} day${daysToRace === 1 ? "" : "s"} until the primary goal race.`;
    } else if (daysToRace != null && daysToRace >= 0 && daysToRace <= 14 && taperRatio != null && taperRatio < 0.65) {
      phase = "Peak";
      reason = `${daysToRace} days until the primary goal race, and recent training load has dropped to ${Math.round(taperRatio * 100)}% of the prior 3 weeks — a clear taper.`;
    } else if (daysToRace != null && daysToRace >= 0 && daysToRace <= 21) {
      phase = "Competition";
      reason = `${daysToRace} days until the primary goal race.`;
    } else if (daysToRace != null && daysToRace >= 0 && daysToRace <= 56) {
      phase = "Performance";
      reason = `${daysToRace} days until the primary goal race — shifting toward race-specific work.`;
    } else if (ctlTrendPct != null && ctlTrendPct > 5) {
      phase = "Development";
      reason = `Fitness (CTL) up ${ctlTrendPct.toFixed(0)}% over the last 4 weeks${daysToRace != null ? `, ${daysToRace} days out from the goal race` : ""}.`;
    } else {
      phase = "Foundation";
      reason =
        ctlTrendPct != null
          ? `Fitness (CTL) roughly flat over the last 4 weeks (${ctlTrendPct >= 0 ? "+" : ""}${ctlTrendPct.toFixed(0)}%)${daysToRace == null ? ", no upcoming goal race set" : ""}.`
          : "Not enough recent Fitness (CTL) history to detect a clear build trend.";
    }

    return { phase, reason };
  }, [loadDaily, primaryGoal, recentRace]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-[var(--accent-red)]" />
          Development Timeline
        </CardTitle>
        <CardDescription>
          Automatically detected from recent training load and the primary goal race date — not a coach-set plan,
          just what the data currently shows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result.phase == null ? (
          <p className="text-sm text-muted-foreground">{result.reason}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {PHASE_ORDER.map((p, i) => {
                const active = p === result.phase;
                return (
                  <div key={p} className="flex items-center">
                    <div
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                        active
                          ? "bg-[var(--accent-red)] text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p}
                    </div>
                    {i < PHASE_ORDER.length - 1 && <div className="w-4 h-px bg-border shrink-0" />}
                  </div>
                );
              })}
            </div>
            <p className="text-sm leading-relaxed border-l-2 pl-3 text-muted-foreground">
              <span className="font-medium text-foreground">{result.phase}.</span> {PHASE_META[result.phase].description}{" "}
              {result.reason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
