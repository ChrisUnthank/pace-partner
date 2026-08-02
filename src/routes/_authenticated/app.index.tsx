import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyRawRoles, useMyAthlete, useAuthUser } from "@/lib/use-auth";
import { useEffectiveRole } from "@/lib/view-mode";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { Plus, Settings2, RotateCcw, X, GripVertical } from "lucide-react";
import { useState } from "react";
import { useDashboardLayout, widgetsForRole, type DashboardRole, type DashboardWidgetId } from "@/lib/dashboard-layout";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardCustomizeSheet } from "@/components/dashboard/dashboard-customize-sheet";
import {
  QuickActionsWidget,
  CommunityWidget,
  CoachingHubWidget,
  HealthVitalsWidget,
  CoachingInsightsWidget,
  YourAthletesWidget,
  UpcomingRacesWidget,
  RecentReviewsWidget,
  QuickLinksSelfWidget,
  AthleteLoadStripWidget,
  AthleteTodayWidget,
  AthleteAttentionWidget,
  AthleteNextSessionWidget,
  AthleteQuickTilesWidget,
  AthleteRecentNoticesWidget,
  AthleteAiCoachWidget,
  AthleteAiReviewsWidget,
} from "@/components/dashboard/dashboard-widgets";
import { AthleteActivitySnapshotWidget } from "@/components/dashboard/athlete-activity-snapshot-widget";
import { AthleteMiniCalendarWidget } from "@/components/dashboard/athlete-mini-calendar-widget";

export const Route = createFileRoute("/_authenticated/app/")({
  component: AppHome,
});

function AppHome() {
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const isManager = rawRoles.includes("manager");
  const { isCoachView, isAthleteView } = useEffectiveRole();

  const { data: myProfile } = useQuery({
    queryKey: ["my-profile-image", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("profile_image_url, full_name")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  // Which dashboard applies — same precedence the page already used
  // (coach branch takes priority over the athlete-only branch). A pure
  // parent account (neither coach nor athlete) gets neither, matching
  // the previous behaviour where that combination rendered nothing here.
  // Uses the effective view (isCoachView/isAthleteView), not raw roles —
  // a dual-role coach who's switched to "Athlete" view via the header
  // toggle should land on their own athlete dashboard here, not the
  // roster one, even though they still hold the coach role.
  const dashboardRole: DashboardRole | null = isCoachView ? "coach" : isAthleteView && athlete ? "athlete" : null;

  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const layout = useDashboardLayout(dashboardRole ?? "coach", !!dashboardRole);

  const visibleIds = (dashboardRole ? layout.order.filter((id) => !layout.hidden.has(id)) : []) as DashboardWidgetId[];
  const sizes = dashboardRole
    ? Object.fromEntries(widgetsForRole(dashboardRole).map((w) => [w.id, { span: w.span, rowSpan: w.rowSpan ?? 1 }]))
    : {};

  // Which of the three independent drag-and-drop areas each widget
  // belongs to — see WidgetDef.zone. Undefined defaults to "full",
  // which is every athlete widget today, so fullIds ends up being
  // "all of them" and mainIds/sidebarIds stay empty for the athlete
  // dashboard — the two-column section below simply doesn't render,
  // no role branching needed to preserve that dashboard's original
  // single-grid layout.
  const zoneOf = dashboardRole
    ? Object.fromEntries(widgetsForRole(dashboardRole).map((w) => [w.id, w.zone ?? "full"]))
    : {};
  const fullIds = visibleIds.filter((id) => (zoneOf[id] ?? "full") === "full");
  const mainIds = visibleIds.filter((id) => zoneOf[id] === "main");
  const sidebarIds = visibleIds.filter((id) => zoneOf[id] === "sidebar");

  // Reordering within one zone (e.g. dragging inside the sidebar column)
  // only ever touches that zone's own ids — this splices the zone's new
  // relative order back into the master order at exactly the slots
  // those ids already occupied, leaving every other id's position
  // completely untouched. Same helper for all three zones.
  function reorderZone(zoneIds: DashboardWidgetId[], newZoneOrder: DashboardWidgetId[]) {
    const fullOrder = layout.order as DashboardWidgetId[];
    const zoneIdSet = new Set(zoneIds);
    let i = 0;
    layout.reorder(fullOrder.map((id) => (zoneIdSet.has(id) ? newZoneOrder[i++] : id)));
  }

  function renderWidget(id: DashboardWidgetId) {
    switch (id) {
      case "quick_actions":
        return <QuickActionsWidget />;
      case "quick_tiles":
        return <CommunityWidget />;
      case "coaching_hub":
        return <CoachingHubWidget />;
      case "health_vitals":
        return <HealthVitalsWidget />;
      case "your_athletes":
        return <YourAthletesWidget />;
      case "coaching_insights":
        return <CoachingInsightsWidget />;
      case "upcoming_races":
        return <UpcomingRacesWidget />;
      case "recent_reviews":
        return <RecentReviewsWidget />;
      case "quick_links_self":
        return <QuickLinksSelfWidget />;
      case "athlete_load_strip":
        return athlete ? <AthleteLoadStripWidget athleteId={athlete.id} /> : null;
      case "athlete_today":
        return athlete ? <AthleteTodayWidget athleteId={athlete.id} /> : null;
      case "athlete_attention":
        return athlete ? <AthleteAttentionWidget athleteId={athlete.id} /> : null;
      case "athlete_next_session":
        return athlete ? <AthleteNextSessionWidget athleteId={athlete.id} /> : null;
      case "athlete_quick_tiles":
        return <AthleteQuickTilesWidget />;
      case "athlete_recent_notices":
        return athlete ? <AthleteRecentNoticesWidget athleteId={athlete.id} /> : null;
      case "athlete_activity_snapshot":
        return athlete ? <AthleteActivitySnapshotWidget athleteId={athlete.id} /> : null;
      case "athlete_mini_calendar":
        return athlete ? <AthleteMiniCalendarWidget athleteId={athlete.id} /> : null;
      case "athlete_ai_coach":
        return athlete ? <AthleteAiCoachWidget athleteId={athlete.id} /> : null;
      case "athlete_ai_reviews":
        return athlete ? <AthleteAiReviewsWidget athleteId={athlete.id} /> : null;
      default:
        return null;
    }
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <UserAvatar
            name={(myProfile as any)?.full_name ?? athlete?.name ?? user?.email ?? ""}
            imageUrl={(myProfile as any)?.profile_image_url ?? (athlete as any)?.profile_image_url}
            size="lg"
          />
          <div>
            <h1 className="text-2xl font-bold">Welcome back</h1>
            <p className="text-muted-foreground text-sm">
              {(() => {
                const labels: string[] = [];
                if (isManager) labels.push("Manager");
                if (rawRoles.includes("coach")) labels.push("Coach");
                if (isAthlete) labels.push("Athlete");
                return labels.length ? `${labels.join(" & ")} view` : "Choose a role to get started";
              })()}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!rolesLoading && rawRoles.length > 0 && dashboardRole && (
              <>
                {editMode ? (
                  <Button size="sm" onClick={() => setEditMode(false)}>
                    <X className="h-4 w-4 mr-1" />
                    Done
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
                    <Settings2 className="h-4 w-4 mr-1" />
                    Customize
                  </Button>
                )}
              </>
            )}
            {/* One-click path into the session builder from the coach's
                landing page — previously the only routes there were
                sidebar → Training → Sessions → New session, or via a
                calendar day. Hidden while customizing so it doesn't sit
                next to the edit-mode controls. */}
            {isCoachView && !editMode && (
              <Button asChild size="sm">
                <Link to="/app/sessions/new">
                  <Plus className="h-4 w-4 mr-1" />
                  New session
                </Link>
              </Button>
            )}
          </div>
        </div>

        {!rolesLoading && rawRoles.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Set up your role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Pick how you'll use Strider.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "athlete" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    const { data: existing } = await supabase
                      .from("athletes")
                      .select("id")
                      .eq("user_id", user!.id)
                      .maybeSingle();
                    if (!existing) {
                      await supabase
                        .from("athletes")
                        .insert({ user_id: user!.id, name: user!.email ?? "Athlete", created_by: user!.id });
                    }
                    window.location.reload();
                  }}
                >
                  I'm an Athlete
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "coach" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    window.location.reload();
                  }}
                >
                  I'm a Coach
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "manager" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    window.location.reload();
                  }}
                >
                  I'm a Manager
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!rolesLoading && rawRoles.length > 0 && dashboardRole && (
          <>
            {editMode && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--accent-red)]/40 bg-[var(--accent-red)]/5 px-4 py-3 text-sm animate-in fade-in-0 slide-in-from-top-1 duration-300">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <GripVertical className="h-3.5 w-3.5 shrink-0" />
                  Drag a widget to reorder it, or use the eye icon to hide it.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>
                    Manage widgets
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => layout.reset()}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reset
                  </Button>
                </div>
              </div>
            )}

            <DashboardGrid
              ids={fullIds}
              sizes={sizes}
              editMode={editMode}
              onReorder={(next) => reorderZone(fullIds, next as DashboardWidgetId[])}
              onHide={(id) => layout.setHidden(id as DashboardWidgetId, true)}
              renderWidget={(id) => renderWidget(id as DashboardWidgetId)}
              columns={3}
            />

            {(mainIds.length > 0 || sidebarIds.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">
                <DashboardGrid
                  ids={mainIds}
                  sizes={sizes}
                  editMode={editMode}
                  onReorder={(next) => reorderZone(mainIds, next as DashboardWidgetId[])}
                  onHide={(id) => layout.setHidden(id as DashboardWidgetId, true)}
                  renderWidget={(id) => renderWidget(id as DashboardWidgetId)}
                  columns={1}
                />
                <DashboardGrid
                  ids={sidebarIds}
                  sizes={sizes}
                  editMode={editMode}
                  onReorder={(next) => reorderZone(sidebarIds, next as DashboardWidgetId[])}
                  onHide={(id) => layout.setHidden(id as DashboardWidgetId, true)}
                  renderWidget={(id) => renderWidget(id as DashboardWidgetId)}
                  columns={1}
                />
              </div>
            )}

            <DashboardCustomizeSheet
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              role={dashboardRole}
              order={layout.order as DashboardWidgetId[]}
              hidden={layout.hidden}
              onToggle={(id, isHidden) => layout.setHidden(id, isHidden)}
              onReorder={(next) => layout.reorder(next)}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
