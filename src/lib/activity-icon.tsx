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
} from "lucide-react";
// Tabler Icons (via react-icons) — added specifically for terrain-based
// running icons Lucide doesn't have at all (no treadmill icon exists in
// Lucide; TbMountain gives trail running a genuinely distinct icon rather
// than reusing the generic running shoe). Same minimalist stroke-based
// visual language as Lucide, so mixing the two doesn't look like a
// mismatched, bolted-on icon set. Imported individually (not the whole
// package) so this stays properly tree-shaken — pulling in one icon here
// doesn't bundle Tabler's other ~5,000 icons.
import type { ComponentType } from "react";
import { TbMountain, TbTreadmill } from "react-icons/tb";

// Shared shape both LucideIcon and Tabler's IconType components actually
// satisfy — broadened from the old LucideIcon-only return type so this
// function can hand back either family through one consistent signature.
type ResolvedIcon = ComponentType<{ className?: string; size?: number; "aria-hidden"?: boolean }>;

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
    // Terrain refines this further for the two cases where a genuinely
    // different icon exists and adds real signal — trail (an actual
    // off-road icon, not just "running") and treadmill (Lucide has no
    // treadmill icon at all; Tabler does). Road/track/path/grass/mixed
    // don't get their own icon yet — SportShoe covers them reasonably
    // well, and manufacturing a distinct icon for every terrain value
    // risks the exact "too many similar-looking icons" problem this was
    // meant to avoid. Easy to add more here later if a specific one earns
    // its own icon.
    case "run":
    case "track":
      if (s.terrain === "trail") return TbMountain;
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
