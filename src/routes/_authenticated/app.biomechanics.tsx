import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon-page";
import { PersonStanding, Activity, Repeat, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/biomechanics")({
  component: BiomechanicsPage,
});

function BiomechanicsPage() {
  return (
    <ComingSoonPage
      icon={PersonStanding}
      eyebrow="Metrics"
      title="Biomechanics"
      description="Running form metrics alongside the pace, HR, and load data already in Analytics — cadence, ground contact time, vertical oscillation, and stride length, tracked over time and against the FIT files you're already uploading."
      features={[
        {
          icon: Activity,
          title: "Form metrics over time",
          description: "Cadence, ground contact time, vertical oscillation, and stride length trended per athlete, pulled from FIT file device data where available.",
        },
        {
          icon: Repeat,
          title: "Left/right balance",
          description: "Ground contact balance and any asymmetry flags, useful context alongside Injury Management.",
        },
        {
          icon: TrendingUp,
          title: "Form vs. fatigue",
          description: "See how cadence and contact time drift late in a session or late in a training block — the same kind of overlay Analytics already does for pace and HR.",
        },
        {
          icon: PersonStanding,
          title: "Session-level breakdown",
          description: "A dedicated form tab on Session Analysis, matching the existing Overview / Zones / Splits pattern.",
        },
      ]}
    />
  );
}
