import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  CalendarRange,
  Users,
  User2,
  LogOut,
  Home,
  BookmarkCheck,
  LineChart,
  ChevronsLeft,
  ChevronsRight,
  Zap,
  ClipboardList,
  Megaphone,
  MessageSquare,
  Trophy,
  Gauge,
  Calculator,
  GitCompare,
  IdCard,
  ListChecks,
  FileText,
  Flag,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { useQuery } from "@tanstack/react-query";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);

  const { data: coachProfile } = useQuery({
    queryKey: ["my-coach-profile-slug", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("slug")
        .eq("coach_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems: { to: string; label: string; icon: any; show: boolean }[] = [
    { to: "/app", label: "Home", icon: Home, show: true },
    // Athletes sits right under Home for coaches — it's the page a coach
    // actually wants first. Races, Race Tactics, and Athlete Page have
    // moved out of the coach sidebar entirely: a coach now reaches those
    // for a given athlete from that athlete's full view instead, so the
    // sidebar only shows them here for the athlete's own role.
    { to: "/app/athletes", label: "Athletes", icon: Users, show: isCoach },
    { to: "/app/daily-log", label: "Daily Log", icon: ClipboardList, show: isAthlete },
    { to: "/app/zones", label: "Zones", icon: Gauge, show: isAthlete || isCoach },
    { to: "/app/sessions", label: "Sessions", icon: CalendarDays, show: true },
    { to: "/app/sessions/calendar", label: "Calendar", icon: CalendarRange, show: true },
    { to: "/app/analytics", label: "Analytics", icon: LineChart, show: true },
    { to: "/app/races", label: "Races", icon: Trophy, show: isAthlete },
    { to: "/app/race-tactics", label: "Race Tactics", icon: Flag, show: isAthlete },
    { to: "/app/calculators", label: "Calculators", icon: Calculator, show: true },
    { to: "/app/compare", label: "Compare", icon: GitCompare, show: true },
    { to: "/app/reports", label: "Reports", icon: FileText, show: true },
    { to: "/app/templates", label: "Templates", icon: BookmarkCheck, show: isCoach },
    { to: "/app/plans", label: "Plans", icon: ListChecks, show: isCoach },
    { to: "/app/noticeboard", label: "Noticeboard", icon: Megaphone, show: true },
    { to: "/app/messages", label: "Messages", icon: MessageSquare, show: true },

    {
      to: "/app/coach",
      label: "Coach Profile",
      icon: IdCard,
      show: isCoach,
    },

    {
      to: "/app/athlete",
      label: "Athlete Page",
      icon: Globe,
      show: isAthlete,
    },

    { to: "/app/profile", label: "Profile", icon: User2, show: true },
  ].filter((n) => n.show);

  const crumb = (() => {
    const active = [...navItems].reverse().find((n) => (n.to === "/app" ? path === "/app" : path.startsWith(n.to)));
    return active?.label ?? "Strider";
  })();

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 sticky top-0 h-screen overflow-y-auto print:hidden",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("h-14 flex items-center border-b border-border", collapsed ? "justify-center" : "px-5")}>
          <Link to="/app" className="flex items-center gap-2 group">
            <span className="w-7 h-7 grid place-items-center rounded-md bg-[var(--accent-red)] shadow-[0_0_18px_-4px_var(--accent-red)]">
              <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
            </span>
            {!collapsed && (
              <span className="font-display text-base font-extrabold tracking-tight uppercase">Strider</span>
            )}
          </Link>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.map((n) => {
            const active = n.to === "/app" ? path === "/app" : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center h-10" : "px-3 h-10",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent-red)]" />
                )}
                <n.icon className={cn("h-4 w-4", active && "text-[var(--accent-red)]")} />
                {!collapsed && <span>{n.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "w-full flex items-center gap-2 h-9 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors",
              collapsed ? "justify-center" : "px-3",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" /> Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/app" className="md:hidden flex items-center gap-2">
              <span className="w-6 h-6 grid place-items-center rounded-md bg-[var(--accent-red)]">
                <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
              </span>
            </Link>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <span>Strider</span>
              <span className="text-border">/</span>
              <span className="text-foreground">{crumb}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[180px]">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Mobile bottom nav */}
        <nav className="md:hidden order-last sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur-md flex overflow-x-auto print:hidden">
          {navItems.map((n) => {
            const active = n.to === "/app" ? path === "/app" : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap min-w-[64px]",
                  active ? "text-[var(--accent-red)]" : "text-muted-foreground",
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-7xl w-full mx-auto print:p-0 print:max-w-none">{children}</main>
      </div>
    </div>
  );
}
