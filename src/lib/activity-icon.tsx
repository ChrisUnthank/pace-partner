import {
  Footprints,
  Bike,
  Waves,
  Dumbbell,
  Timer,
  Trophy,
  Moon,
  Activity,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolve a Lucide icon for a session based on its activity_type and day_type.
 * Falls back to a generic Activity icon when no signal is available.
 */
export function activityIconFor(s: {
  activity_type?: string | null;
  day_type?: string | null;
  intent?: string | null;
}): LucideIcon {
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
    case "run":
    case "track":
      return Footprints;
  }
  if (dt === "cross_training") return Activity;
  return Footprints;
}

export function ActivityIcon({
  session,
  className,
  size = 16,
}: {
  session: { activity_type?: string | null; day_type?: string | null; intent?: string | null };
  className?: string;
  size?: number;
}) {
  const Icon = activityIconFor(session);
  return <Icon className={className} size={size} aria-hidden />;
}