import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BucketTabStrip } from "@/components/bucket-tab-strip";
import { BookmarkCheck, CalendarRange, LayoutGrid } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/coaching-hub")({
  component: CoachingHubOverview,
});

const HUB_TABS = [
  { to: "/app/coaching-hub", label: "Overview", icon: LayoutGrid },
  { to: "/app/templates", label: "Session Templates", icon: BookmarkCheck },
  { to: "/app/plans", label: "Plans", icon: CalendarRange },
];

function CoachingHubOverview() {
  const { data: templateCount } = useQuery({
    queryKey: ["hub-template-count"],
    queryFn: async () => {
      const { count } = await supabase.from("session_templates").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: planTemplateCount } = useQuery({
    queryKey: ["hub-plan-template-count"],
    queryFn: async () => {
      const { count } = await supabase.from("plan_templates").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: activePlans } = useQuery({
    queryKey: ["hub-active-plans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_plans")
        .select("id, name, start_date, duration_weeks, athletes(id, name)")
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: recentTemplates } = useQuery({
    queryKey: ["hub-recent-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_templates")
        .select("id, name, intent")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  return (
    <AppShell>
      <div className="space-y-4 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Coaching Hub</h1>
          <p className="text-sm text-muted-foreground">Session templates, training plans, and everything you reuse across your roster.</p>
        </div>

        <BucketTabStrip items={HUB_TABS} active="/app/coaching-hub" />

        <div className="grid sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Session templates</div>
              <div className="text-3xl font-bold mt-1">{templateCount ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Plan templates</div>
              <div className="text-3xl font-bold mt-1">{planTemplateCount ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Active plans</div>
              <div className="text-3xl font-bold mt-1">{activePlans?.length ?? "—"}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent session templates</CardTitle>
              <CardDescription>Reusable session structures — apply to any athlete on any date.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/templates">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {!recentTemplates || recentTemplates.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No templates yet. Open any session and tap <span className="font-semibold">Save as template</span> to add the first one.
              </p>
            ) : (
              <div className="divide-y">
                {recentTemplates.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-medium truncate">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.intent}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Active plans</CardTitle>
              <CardDescription>Currently assigned multi-week plans, across your roster.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/plans">Manage plans</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {!activePlans || activePlans.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No plans currently assigned.</p>
            ) : (
              <div className="divide-y">
                {activePlans.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{p.athletes?.name}</span>
                      <span className="text-muted-foreground"> · {p.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{p.duration_weeks}wk</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
