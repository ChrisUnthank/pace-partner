import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Activity, CalendarDays, Users, User2, LogOut, Home, BookmarkCheck } from "lucide-react";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const path = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems: { to: string; label: string; icon: any; show: boolean }[] = [
    { to: "/app", label: "Home", icon: Home, show: true },
    { to: "/app/today", label: "Today", icon: Activity, show: isAthlete },
    { to: "/app/sessions", label: "Sessions", icon: CalendarDays, show: true },
    { to: "/app/athletes", label: "Athletes", icon: Users, show: isCoach },
    { to: "/app/templates", label: "Templates", icon: BookmarkCheck, show: isCoach },
    { to: "/app/profile", label: "Profile", icon: User2, show: true },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <header className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/app" className="font-semibold tracking-tight">Strider</Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>
      <nav className="border-b bg-background">
        <div className="max-w-6xl mx-auto px-2 flex overflow-x-auto">
          {navItems.map((n) => {
            const active = path === n.to || (n.to !== "/app" && path.startsWith(n.to));
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 whitespace-nowrap ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}