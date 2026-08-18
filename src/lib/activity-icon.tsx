import {
  Footprints,
  SportShoe,
  Bike,
  Waves,
  Dumbbell,
  Timer,
  Trophy,
  Moon,
  Activity,
  Mountain,
  Road,
  Route,
  Leaf,
} from "lucide-react";
// Tabler Icons (via react-icons) — added specifically for terrain icons
// Lucide doesn't have at all (no treadmill icon exists in Lucide; TbMountain
// gives trail its own genuinely distinct icon; TbTrack gives an oval-track
// running loop, distinct from Mountain's outdoor/trail connotation). Same
// minimalist stroke-based visual language as Lucide, so mixing the two
// doesn't look like a mismatched, bolted-on icon set. Imported individually
// (not the whole package) so this stays properly tree-shaken — pulling in
// one icon here doesn't bundle Tabler's other ~5,000 icons.
import type { ComponentType, CSSProperties } from "react";
import { TbMountain, TbTreadmill, TbTrack } from "react-icons/tb";

// Shared shape both LucideIcon and Tabler's IconType components actually
// satisfy — broadened from the old LucideIcon-only return type so this
// function can hand back either family through one consistent signature.
// `style` is included because callers already pass it and both icon
// families already forward it — analytics' TerrainTile colours its icon
// with style={{ color }}, which works at runtime and was the only thing
// tsc flagged in the whole repo. Type-only widening: no behaviour changes,
// but it clears the one standing error, which matters because a tsc run
// that is already red is a tsc run nobody reads.
type ResolvedIcon = ComponentType<{
  className?: string;
  size?: number;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
}>;

/**
 * Resolve an icon for a given terrain value — the single source of truth
 * for "what does this terrain look like." Used by the Overview card's
 * terrain badge, whose whole job is showing which terrain a session was
 * on, so every value gets its own icon here. activityIconFor below is a
 * DIFFERENT, more selective consumer of terrain — see its own comment for
 * why it only cares about treadmill, not this full mapping. One shared
 * mapping, two callers with different appetite for how much of it to use,
 * rather than two independent mappings that could quietly drift apart.
 */
export function terrainIconFor(terrain?: string | null): ResolvedIcon {
  switch (terrain) {
    case "trail":
      return TbMountain;
    case "treadmill":
      return TbTreadmill;
    case "road":
      return Road;
    case "track":
      return TbTrack;
    case "grass":
      return Leaf;
    case "path":
      return Route;
    default:
      // "mixed", or any value not explicitly handled above — generic
      // outdoor icon, matches the single icon this badge always showed
      // before terrain got its own per-value mapping.
      return Mountain;
  }
}

/**
 * Resolve an icon for a session based on its activity_type, day_type, and
 * (for running specifically) terrain. Falls back to a generic Activity
 * icon when no signal is available.
 */
export function activityIconFor(s: {
  activity_type?: string | null;
  day_type?: string | null;
  intent?: string | null;
  terrain?: string | null;
}): ResolvedIcon {
  const dt = s.day_type ?? "training";
  if (dt === "rest") return Moon;
  if (dt === "race") return Trophy;
  if (s.intent === "time_trial" || s.activity_type === "time_trial") return Timer;
  switch (s.activity_type) {
    case "ride":
      return Bike;
    case "swim":
      return Waves;
    case "gym":
      return Dumbbell;
    case "walk":
      return Footprints;
    // Run/track previously shared Footprints with Walk — same icon for two
    // visually distinct activities on the calendar/session list. SportShoe
    // reads unambiguously as running gear at a glance; Footprints (bare
    // feet, walking gait) stays with Walk and the generic fallback below.
    //
    // Terrain deliberately does NOT override this icon in general — an
    // outdoor run (road, trail, grass, path, track) always shows SportShoe,
    // same as any other run. Treadmill is the one, deliberate exception:
    // it's operationally different enough (no GPS, controlled pace, indoor
    // conditions) that knowing at a glance matters, unlike trail-vs-road
    // which is "still just a run" for this icon's purposes. Manufacturing
    // a distinct icon for every terrain value here would recreate the
    // exact "too many similar-looking icons" problem this was meant to
    // avoid — that level of detail belongs to the Overview terrain badge
    // (terrainIconFor above), whose specific job is showing which terrain,
    // not this one's job of showing which activity. A treadmill run still
    // counts as a run everywhere else (training load, volume, sport
    // categorization) — this only changes which icon renders.
    case "run":
    case "track":
      if (s.terrain === "treadmill") return TbTreadmill;
      return SportShoe;
  }
  if (dt === "cross_training") return Activity;
  return Footprints;
}

export function ActivityIcon({
  session,
  className,
  size = 16,
}: {
  session: { activity_type?: string | null; day_type?: string | null; intent?: string | null; terrain?: string | null };
  className?: string;
  size?: number;
}) {
  const Icon = activityIconFor(session);
  return <Icon className={className} size={size} aria-hidden />;
}

/**
 * Overview card's terrain badge — genuinely distinct icon per terrain
 * value, unlike ActivityIcon above which deliberately only distinguishes
 * treadmill. This badge's entire purpose is showing which terrain, so full
 * differentiation is exactly what it should do.
 */
export function TerrainIcon({
  terrain,
  className,
  size = 16,
}: {
  terrain?: string | null;
  className?: string;
  size?: number;
}) {
  const Icon = terrainIconFor(terrain);
  return <Icon className={className} size={size} aria-hidden />;
}
