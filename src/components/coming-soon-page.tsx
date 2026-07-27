import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type PlannedFeature = {
  icon: any;
  title: string;
  description: string;
};

// Shared full-page template for a nav destination that's been placed and
// wired up (sidebar entry, route, breadcrumb) but not built yet — as
// opposed to app.calculators.index.tsx's pattern, which is a hub page
// listing several tools where only some are ready. This is for a single
// destination that's entirely "coming soon" on its own page, so it needs
// to look considered rather than like a stub, since it's what a coach or
// athlete lands on when they click the sidebar link.
export function ComingSoonPage({
  icon: Icon,
  eyebrow,
  title,
  description,
  features,
  backTo,
  backLabel,
}: {
  icon: any;
  eyebrow: string;
  title: string;
  description: string;
  features: PlannedFeature[];
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <AppShell>
      <div className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
        {backTo && (
          <Link to={backTo}>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              {backLabel ?? "Back"}
            </Button>
          </Link>
        )}

        <Card className="relative overflow-hidden border-border">
          {/* Subtle accent glow, same red used for active nav states —
              gives the placeholder a bit of the same polish as a real
              page instead of reading as bare/unfinished. */}
          <div
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-[0.07] blur-3xl"
            style={{ background: "var(--accent-red)" }}
          />
          <CardContent className="relative pt-10 pb-10 px-6 md:px-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </span>
              <Badge variant="outline" className="text-[10px]">
                Coming soon
              </Badge>
            </div>

            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div
                className="h-14 w-14 shrink-0 rounded-xl grid place-items-center shadow-[0_0_24px_-6px_var(--accent-red)]"
                style={{ background: "var(--accent-red)" }}
              >
                <Icon className="h-7 w-7 text-white" strokeWidth={2} />
              </div>
              <div className="space-y-2 max-w-2xl">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3">
            What's planned
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((f, i) => {
              const FIcon = f.icon;
              return (
                <Card
                  key={f.title}
                  className={cn(
                    "border-border transition-colors hover:border-[var(--accent-red)]/30",
                    "animate-in fade-in-0 slide-in-from-bottom-2",
                  )}
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
                >
                  <CardContent className="pt-5 pb-5 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <FIcon className="h-4.5 w-4.5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{f.title}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{f.description}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
