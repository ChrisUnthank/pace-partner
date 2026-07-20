import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type BucketTabItem = {
  to: string;
  label: string;
  icon: any;
  // Optional search params, same pattern AthleteSubnav uses for tabs that
  // need to carry e.g. ?athleteId= through the link.
  search?: Record<string, string>;
};

// Generic sibling-switcher for pages grouped under one of the sidebar's
// accordion buckets (Training / Metrics / Performances / Community).
// Deliberately NOT athlete-scoped — AthleteSubnav already covers that
// case for pages reached from a specific athlete's context. This is for
// the bucket-level grouping introduced alongside the sidebar accordion.
//
// Exists mainly for mobile, where the bottom nav can only show one tap
// target per bucket (its first child) — this strip is how someone gets
// to a sibling page from there. Doubles as a quick desktop shortcut too,
// so it always renders, not just on small screens.
export function BucketTabStrip({ items, active }: { items: BucketTabItem[]; active: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (items.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 print:hidden">
      {items.map((item) => {
        const isActive = item.to === active || path === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            search={item.search as any}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 h-8 text-xs font-medium transition-colors shrink-0",
              isActive
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
