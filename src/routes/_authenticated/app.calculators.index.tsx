import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Timer, Mountain, Flame, ArrowRight, Calculator, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/calculators/")({
  component: CalculatorsPage,
});

const CALCULATORS = [
  {
    to: "/app/calculators/zonecalculator",
    title: "Zone Calculator",
    description:
      "Work out training zones from any of 8 methods — Daniels VDOT, a recent race, Critical Speed, Karvonen, and more — then save them straight to Zone Boundaries.",
    icon: HeartPulse,
    available: true,
  },
  {
    to: "/app/calculators/startingfitness",
    title: "Starting Fitness",
    description:
      "Give a new athlete a real starting Fitness/Fatigue estimate from a typical recent week, instead of everyone beginning at zero.",
    icon: Gauge,
    available: true,
  },
  {
    to: "/app/calculators/pacepredictor",
    title: "Performance Predictor",
    description:
      "Predict times across distances from a recent race, adjusted for the athlete's actual speed/endurance profile — not the same flat formula for every athlete.",
    icon: Timer,
    available: true,
  },
  {
    to: null,
    title: "Altitude Adjustment",
    description: "Adjust an expected race time for elevation when racing away from sea level.",
    icon: Mountain,
    available: false,
  },
  {
    to: null,
    title: "Calorie Calculator",
    description: "Estimate calories burned for a run from distance, weight, and effort.",
    icon: Flame,
    available: false,
  },
] as const;

function CalculatorsPage() {
  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <Calculator className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
            <h1 className="text-2xl font-bold leading-tight">Calculators</h1>
            <p className="text-sm text-muted-foreground">Standalone tools — no session or upload required.</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {CALCULATORS.map((c) => {
            const Icon = c.icon;
            const card = (
              <Card
                className={cn(
                  "h-full transition-colors",
                  c.available ? "hover:border-primary/50 cursor-pointer" : "opacity-60",
                )}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-md bg-accent flex items-center justify-center shrink-0">
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <CardTitle className="text-base">{c.title}</CardTitle>
                    </div>
                    {c.available ? (
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    ) : (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{c.description}</CardDescription>
                </CardHeader>
              </Card>
            );
            return c.available && c.to ? (
              <Link key={c.title} to={c.to}>
                {card}
              </Link>
            ) : (
              <div key={c.title}>{card}</div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
