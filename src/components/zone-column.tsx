import {
  ZONE_KEYS,
  ZONE_COLORS,
  ZONE_LABELS,
  zonePercentages,
  totalZoneSeconds,
  hardSharePct,
  type ZoneSeconds,
} from "@/lib/zone-mix";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// A week's zone distribution as one column.
//
// Proportional, not absolute: every column is full height and divided by
// share. That is the right choice for the question these are answering —
// "is too much of this week hard?" — because a taller column would conflate
// volume with distribution and a light week of all-threshold running would
// look safer than a big week of easy running.
//
// Volume is already shown elsewhere on both surfaces this appears on, so it
// is not being lost, only kept out of this particular reading.
// ----------------------------------------------------------------------------

function fmtMin(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}m`;
}

export function ZoneColumn({
  zones,
  height = 64,
  label,
  className,
  fillPct,
}: {
  zones: ZoneSeconds;
  height?: number;
  /** Shown under the column. */
  label?: string;
  className?: string;
  /**
   * How much of the track this column fills, 0–100. Omit for a full-height
   * proportional column.
   *
   * Supplied, the column carries TWO readings at once: its height is the
   * week's volume relative to the biggest week on screen, and its internal
   * split is where that volume went. Full-height columns answer only the
   * second, which makes a light week of hard running look identical to a big
   * one — fine when volume is shown right alongside, misleading when it is
   * the only column on screen.
   */
  fillPct?: number;
}) {
  const total = totalZoneSeconds(zones);
  const pct = zonePercentages(zones);
  const fill = fillPct == null ? 100 : Math.max(0, Math.min(100, fillPct));

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1", className)}>
      <div
        className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-muted/60"
        style={{ height }}
        title={
          total <= 0
            ? "No time in this week"
            : ZONE_KEYS.filter((k) => (zones[k] ?? 0) > 0)
                .map((k) => `${ZONE_LABELS[k]}: ${fmtMin(zones[k])} (${pct[k].toFixed(0)}%)`)
                .join("\n")
        }
      >
        <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${fill}%` }}>
          {/* flex-col-reverse so z1 sits at the bottom — a stack that put the
              hardest zone underneath would read as a foundation of speed. */}
          {total > 0 &&
            ZONE_KEYS.map((k) =>
              (zones[k] ?? 0) > 0 ? (
                <div key={k} style={{ height: `${pct[k]}%`, background: ZONE_COLORS[k] }} />
              ) : null,
            )}
        </div>
      </div>
      {label && <span className="w-full truncate text-center text-[10px] text-muted-foreground">{label}</span>}
    </div>
  );
}

/** Horizontal version, for a single row inside a list. */
export function ZoneBar({ zones, className }: { zones: ZoneSeconds; className?: string }) {
  const total = totalZoneSeconds(zones);
  const pct = zonePercentages(zones);
  if (total <= 0) return <div className={cn("h-2 rounded-sm bg-muted", className)} />;
  return (
    <div className={cn("flex h-2 overflow-hidden rounded-sm bg-muted", className)}>
      {ZONE_KEYS.map((k) =>
        (zones[k] ?? 0) > 0 ? (
          <div
            key={k}
            style={{ width: `${pct[k]}%`, background: ZONE_COLORS[k] }}
            title={`${ZONE_LABELS[k]}: ${fmtMin(zones[k])} (${pct[k].toFixed(0)}%)`}
          />
        ) : null,
      )}
    </div>
  );
}

export function ZoneLegend({ zones, className }: { zones?: ZoneSeconds; className?: string }) {
  // Only zones actually present, when a mix is supplied — a legend listing
  // bands the block does not contain is noise on an already dense panel.
  const keys = zones ? ZONE_KEYS.filter((k) => (zones[k] ?? 0) > 0) : ZONE_KEYS;
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-1", className)}>
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[k] }} />
          {ZONE_LABELS[k]}
        </span>
      ))}
    </div>
  );
}

/**
 * The share of time at z3 and above, stated plainly.
 *
 * No verdict attached. What counts as too much depends on the phase, the
 * athlete and the coach, and none of those are known here — a base block at
 * 25% hard is worth a second look, a race-week block at 25% is unremarkable.
 * The number is what a coach needs; the judgement is theirs.
 */
export function HardShareLabel({ zones, className }: { zones: ZoneSeconds; className?: string }) {
  const share = hardSharePct(zones);
  if (share == null) return null;
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      <span className="font-medium text-foreground">{share.toFixed(0)}%</span> at Z3+
    </span>
  );
}
