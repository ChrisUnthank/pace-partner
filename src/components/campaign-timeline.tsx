import { useMemo } from "react";
import type { GeneratedWeek, GeneratedBlock, Phase } from "@/lib/campaign-generator";
import { Flag, Lock } from "lucide-react";

// ----------------------------------------------------------------------------
// The season, as bars.
//
// One bar per week, height proportional to load_pct, coloured by phase, with
// races flagged above the week they fall in.
//
// Races are MARKERS, not bars of their own. A club race during a base block is
// an event inside the block rather than an interruption to it — showing it as
// a separate block turned one real season into 23 one-week slivers, which
// described the weeks accurately and the training not at all.
// ----------------------------------------------------------------------------

const PHASE_STYLE: Record<Phase, { fill: string; label: string; blurb: string }> = {
  reset: {
    fill: "#94a3b8",
    label: "Down period",
    blurb:
      "The break after the previous season, planned at the head of this campaign rather than the tail of the last — so recovery is set with the next build in view.",
  },
  base: {
    fill: "#5eead4",
    label: "Base",
    blurb: "Aerobic capacity, mostly easy volume. Long run-ins get several base blocks; short ones may get none.",
  },
  build: {
    fill: "#14b8a6",
    label: "Build",
    blurb: "Training turns race-specific. Intensity comes in with the target event in mind.",
  },
  peak: {
    fill: "#0f766e",
    label: "Peak",
    blurb: "The highest load of the campaign. Runs straight through — no deload inside it.",
  },
  taper: {
    fill: "#166534",
    label: "Taper",
    blurb: "Load steps down week by week so the work turns into freshness. Length is yours to set.",
  },
  race_week: {
    fill: "#0369a1",
    label: "Race week",
    blurb: "A target race. Only a peak race gets a block of its own; the rest sit inside the block around them.",
  },
  transition: {
    fill: "#94a3b8",
    label: "Transition",
    blurb: "Deliberate rest and unstructured activity after the final target.",
  },
};

const PRIORITY_STYLE: Record<string, { fill: string; label: string }> = {
  peak: { fill: "#dc2626", label: "Peak" },
  key: { fill: "#f97316", label: "Key" },
  tune_up: { fill: "#eab308", label: "Tune-up" },
  training: { fill: "#94a3b8", label: "Training" },
};

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function CampaignTimeline({
  weeks,
  blocks,
  onWeekClick,
}: {
  weeks: GeneratedWeek[];
  blocks: GeneratedBlock[];
  onWeekClick?: (week: GeneratedWeek) => void;
}) {
  // Scale bars against the campaign's own maximum rather than a fixed 150%,
  // so a conservative campaign doesn't render as a row of stumps.
  const maxLoad = useMemo(() => Math.max(100, ...weeks.map((w) => w.loadPct)), [weeks]);

  // Block spans, for the labelled strip beneath the bars.
  //
  // Both memos sit BEFORE the empty check. A hook after an early return runs
  // conditionally, so the hook order changes the moment weeks goes from empty
  // to populated — which is exactly what happens in the create dialog as soon
  // as the first race is added, and React throws.
  const spans = useMemo(() => {
    const byStart = new Map(blocks.map((b) => [b.startsOn, b]));
    return weeks.map((w) => byStart.get(w.weekStart) ?? null);
  }, [blocks, weeks]);

  if (weeks.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Bars. Horizontally scrollable rather than squeezed: a 30-week season
          on a laptop would otherwise give each week about 30px, too narrow to
          click or read. */}
      <div className="overflow-x-auto brand-scrollbar pb-1">
        <div className="min-w-max">
          {/* Race flags, above the bars */}
          <div className="flex items-end gap-1 h-8">
            {weeks.map((w) => (
              <div key={`flag-${w.weekNumber}`} className="w-12 flex justify-center">
                {w.raceName && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded"
                    style={{
                      background: `${PRIORITY_STYLE[w.racePriority ?? "training"]?.fill}22`,
                      color: PRIORITY_STYLE[w.racePriority ?? "training"]?.fill,
                    }}
                    title={`${w.raceName} — ${PRIORITY_STYLE[w.racePriority ?? "training"]?.label}`}
                  >
                    <Flag className="h-2.5 w-2.5" />
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* The bars themselves */}
          <div className="flex items-end gap-1 h-40">
            {weeks.map((w) => {
              const style = PHASE_STYLE[w.phase];
              const pct = (w.loadPct / maxLoad) * 100;
              return (
                <button
                  key={w.weekNumber}
                  type="button"
                  onClick={() => onWeekClick?.(w)}
                  className="w-12 flex flex-col justify-end h-full group relative"
                  title={`Week ${w.weekNumber} · ${style.label} · ${w.loadPct}%${w.isDeload ? " (deload)" : ""}${
                    w.raceName ? ` · ${w.raceName}` : ""
                  }`}
                >
                  <div
                    className="w-full rounded-t transition-opacity group-hover:opacity-80 relative"
                    style={{
                      height: `${pct}%`,
                      background: style.fill,
                      // Deloads read as a dip in the bar chart already, but a
                      // hatched fill makes them identifiable at a glance
                      // without counting heights.
                      backgroundImage: w.isDeload
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 3px, transparent 3px 6px)"
                        : undefined,
                    }}
                  >
                    {w.isLocked && (
                      <Lock className="h-3 w-3 absolute top-1 left-1/2 -translate-x-1/2 text-white/80" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Week numbers */}
          <div className="flex gap-1 mt-1">
            {weeks.map((w) => (
              <div key={`n-${w.weekNumber}`} className="w-12 text-center text-[10px] text-muted-foreground">
                W{w.weekNumber}
              </div>
            ))}
          </div>

          {/* Block strip */}
          <div className="flex gap-1 mt-1">
            {weeks.map((w, i) => {
              const block = spans[i];
              if (!block) return <div key={`b-${w.weekNumber}`} className="w-12" />;
              const widthPx = block.weeks * 48 + (block.weeks - 1) * 4;
              return (
                <div
                  key={`b-${w.weekNumber}`}
                  className="rounded text-[10px] text-white px-2 py-1 leading-tight overflow-hidden"
                  style={{ width: widthPx, background: PHASE_STYLE[block.phase].fill }}
                  title={PHASE_STYLE[block.phase].blurb}
                >
                  <div className="font-medium truncate">{block.label}</div>
                  <div className="opacity-80">{block.weeks} wk</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend. Only phases actually present — a legend listing phases the
          campaign doesn't contain is noise. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {Array.from(new Set(blocks.map((b) => b.phase))).map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full inline-block" style={{ background: PHASE_STYLE[p].fill }} />
            {PHASE_STYLE[p].label}
          </span>
        ))}
        {weeks.some((w) => w.isDeload) && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="h-2 w-2 rounded-full inline-block border"
              style={{ backgroundImage: "repeating-linear-gradient(45deg, #999 0 2px, transparent 2px 4px)" }}
            />
            Deload
          </span>
        )}
      </div>
    </div>
  );
}

export { PHASE_STYLE, PRIORITY_STYLE, fmtDate };
