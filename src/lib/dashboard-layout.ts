import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import {
  CalendarRange,
  ClipboardList,
  HeartPulse,
  Users,
  AlertTriangle,
  MessageSquare,
  Sparkles,
  Trophy,
  FileText,
  LineChart,
  CalendarDays,
  Newspaper,
  BookmarkCheck,
  Activity,
  Link2,
  History,
} from "lucide-react";

export type DashboardRole = "coach" | "athlete";

export type DashboardWidgetId =
  | "quick_actions"
  | "quick_tiles"
  | "coaching_hub"
  | "health_vitals"
  | "coaching_insights"
  | "your_athletes"
  | "upcoming_races"
  | "recent_reviews"
  | "athlete_load_strip"
  | "athlete_today"
  | "athlete_attention"
  | "athlete_next_session"
  | "athlete_latest_session"
  | "athlete_quick_tiles"
  | "athlete_recent_notices"
  | "athlete_activity_snapshot"
  | "athlete_mini_calendar"
  | "athlete_ai_coach"
  | "athlete_ai_reviews"
  | "quick_links_self";

export type WidgetDef = {
  id: DashboardWidgetId;
  role: DashboardRole;
  label: string;
  description: string;
  icon: any;
  // Column span out of the dashboard's 3-column grid (was 2-column —
  // widened so Training Load / Activity Snapshot can run 2/3-width
  // alongside a narrower 1/3 Calendar). Still meaningful for "full"-zone
  // widgets and for the athlete dashboard (which has no zone concept);
  // for "main"/"sidebar" zone widgets it's cosmetic/self-documenting
  // only — those each render at the full width of their own narrower
  // column regardless of this number, since that column is itself a
  // single-column grid.
  span: 1 | 2 | 3;
  // Row span — currently only used by the Calendar widget, which is
  // deliberately tall (1/3 width, 2 rows) to visually match the combined
  // height of two 2/3-width widgets stacked beside it. Optional/absent
  // means 1 (every existing widget's implicit height before this).
  rowSpan?: 1 | 2;
  defaultVisible: boolean;
  // Which of the coach dashboard's three independent drag-and-drop
  // areas this widget lives in — "full" (full page width, above the
  // split, e.g. Quick actions/Community), "main" (the 2/3-width column,
  // e.g. Your athletes/Coaching Insights), or "sidebar" (the 1/3-width
  // column everything else stacks in). Each area is its own separate
  // drag context — reordering only ever happens within one area, never
  // across them. Absent/undefined defaults to "full", which is what
  // every athlete widget uses (the athlete dashboard has no column
  // split at all, unchanged from before this feature existed).
  zone?: "full" | "main" | "sidebar";
};

// The catalog — single source of truth for what a widget is called, what
// it does, its icon, and its default size/visibility. Add a new widget
// here and it shows up in both the drag-and-drop grid and the "Add
// widget" list automatically.
export const COACH_WIDGETS: WidgetDef[] = [
  {
    id: "quick_actions",
    role: "coach",
    label: "Quick actions",
    description: "Calendar and Analytics shortcuts.",
    icon: CalendarRange,
    span: 3,
    defaultVisible: true,
    zone: "full",
  },
  // Was "Quick tiles" (Messages/Noticeboard/Athletes/Health & Vitals) —
  // Athletes and Health & Vitals now have their own dedicated widgets
  // below, so this one narrows to exactly the Community bucket's four
  // destinations (Messages, Noticeboard, Group Chat, Coach Profile Page).
  // Id kept as "quick_tiles" so anyone who already hid/reordered it keeps
  // that choice rather than losing it to a rename.
  {
    id: "quick_tiles",
    role: "coach",
    label: "Community",
    description: "Messages, Noticeboard, Group Chat, and your Coach Profile page.",
    icon: MessageSquare,
    span: 3,
    defaultVisible: true,
    zone: "full",
  },
  {
    id: "coaching_hub",
    role: "coach",
    label: "Coaching Hub",
    description: "Session templates, plan templates, and active plans.",
    icon: BookmarkCheck,
    span: 1,
    defaultVisible: true,
    zone: "sidebar",
  },
  {
    id: "health_vitals",
    role: "coach",
    label: "Health & Vitals",
    description: "Daily logs, injuries, and recovery across your roster.",
    icon: HeartPulse,
    span: 1,
    defaultVisible: true,
    zone: "sidebar",
  },
  {
    id: "your_athletes",
    role: "coach",
    label: "Your athletes",
    description: "Roster list with a quick-look summary on click.",
    icon: Users,
    span: 2,
    defaultVisible: true,
    zone: "main",
  },
  // Combines the old separate "Squad readiness" and "Needs attention"
  // widgets into one card — a single place for at-a-glance coaching
  // signals, with room to fold more sections into the same card later
  // (each section renders independently inside CoachingInsightsWidget)
  // rather than spawning yet another standalone widget per signal.
  {
    id: "coaching_insights",
    role: "coach",
    label: "Coaching Insights",
    description: "Squad readiness and flagged athletes worth a look, together in one card.",
    icon: Sparkles,
    span: 2,
    defaultVisible: true,
    zone: "main",
  },
  {
    id: "upcoming_races",
    role: "coach",
    label: "Upcoming races",
    description: "Races across your squad in the next two weeks.",
    icon: Trophy,
    span: 1,
    defaultVisible: true,
    zone: "sidebar",
  },
  // Was "Recent reviews" — broadened to pair with the Reports page
  // (Metrics bucket) rather than reading as AI-reviews-only.
  {
    id: "recent_reviews",
    role: "coach",
    label: "Reports and Reviews",
    description: "Your latest AI coaching reviews, with a link through to Reports.",
    icon: FileText,
    span: 1,
    defaultVisible: true,
    zone: "sidebar",
  },
  // Was a fixed block outside the widget grid entirely, only ever shown
  // to a coach who's also an athlete — that gate is unchanged (still
  // null for a coach with no athlete profile of their own), but it's
  // now a real movable/hideable/resizable-by-catalog widget like
  // everything else, instead of always pinned to the bottom of the
  // page regardless of layout customization.
  {
    id: "quick_links_self",
    role: "coach",
    label: "Quick links",
    description: "Shortcuts to your own athlete pages — Daily Log, Health & Vitals, Locker, and more (dual-role only).",
    icon: Link2,
    span: 2,
    defaultVisible: true,
    zone: "sidebar",
  },
];

export const ATHLETE_WIDGETS: WidgetDef[] = [
  {
    id: "athlete_load_strip",
    role: "athlete",
    label: "Year at a glance",
    description: "Weekly training load strip.",
    icon: LineChart,
    span: 2,
    defaultVisible: true,
  },
  // Order matters here, not just span/rowSpan — with the grid's dense
  // auto-flow (see dashboard-grid.tsx), placing this 1/3-width,
  // 2-row-tall widget immediately after the first 2/3-width widget
  // (Year at a glance) is what makes it land beside BOTH that widget
  // and Activity Snapshot below it, forming a clean 2/3 + 1/3 block
  // rather than falling into a random later slot. Moving this entry
  // elsewhere in the array will change where it visually lands.
  {
    id: "athlete_mini_calendar",
    role: "athlete",
    label: "Calendar",
    description: "A small month view of your training calendar.",
    icon: CalendarRange,
    span: 1,
    rowSpan: 2,
    defaultVisible: true,
  },
  {
    id: "athlete_today",
    role: "athlete",
    label: "Today",
    description: "Readiness and vitals.",
    icon: HeartPulse,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "athlete_attention",
    role: "athlete",
    label: "Worth a look",
    description: "Injuries, upcoming events, and gear worth checking.",
    icon: AlertTriangle,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "athlete_next_session",
    role: "athlete",
    label: "Next session",
    description: "Your next planned session.",
    icon: CalendarDays,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "athlete_latest_session",
    role: "athlete",
    label: "Latest session",
    description: "A snapshot of your most recently logged session.",
    icon: History,
    span: 1,
    defaultVisible: true,
  },
  // Was full-width in the old 2-column grid (span:2 of 2 = 100%) — bumped
  // to span:3 (of 3) here to keep that same "always full width" intent,
  // rather than 2/3 which would leave an awkward empty 1/3 gap.
  {
    id: "athlete_quick_tiles",
    role: "athlete",
    label: "Quick tiles",
    description: "Daily Log, Sessions, Health, Locker, Analytics, Messages.",
    icon: ClipboardList,
    span: 3,
    defaultVisible: true,
  },
  {
    id: "athlete_recent_notices",
    role: "athlete",
    label: "Recent notices",
    description: "Latest posts from your coach.",
    icon: Newspaper,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "athlete_activity_snapshot",
    role: "athlete",
    label: "Activity Snapshot",
    description: "Last 4 weeks — total activities, active days, and time per sport.",
    icon: Activity,
    span: 2,
    defaultVisible: true,
  },
  // AI Coach chat + AI Reviews — athlete-facing counterparts to the
  // coach-side CoachChat (on the athlete detail page) and GenerateReviewCard.
  // Both components already work unmodified for an athlete acting on their
  // own athleteId (chat-thread and review RLS were already self-permissive),
  // so these widgets are thin wrappers, same pattern as every widget above.
  // Gated behind ai_subscription_active (see ai.functions.ts) rather than
  // hidden by default — defaultVisible: true so it's actually discoverable,
  // and the components themselves render the "not available" state cleanly
  // if access is ever off for a given athlete.
  {
    id: "athlete_ai_coach",
    role: "athlete",
    label: "AI Coach",
    description: "Chat with an AI assistant grounded in your own training data.",
    icon: Sparkles,
    span: 2,
    defaultVisible: true,
  },
  {
    id: "athlete_ai_reviews",
    role: "athlete",
    label: "AI Reviews",
    description: "Generate a structured summary of your recent training.",
    icon: FileText,
    span: 1,
    defaultVisible: true,
  },
];

export function widgetsForRole(role: DashboardRole): WidgetDef[] {
  return role === "coach" ? COACH_WIDGETS : ATHLETE_WIDGETS;
}

export function defaultOrder(role: DashboardRole): DashboardWidgetId[] {
  return widgetsForRole(role).map((w) => w.id);
}

export function defaultHidden(role: DashboardRole): DashboardWidgetId[] {
  return widgetsForRole(role)
    .filter((w) => !w.defaultVisible)
    .map((w) => w.id);
}

// Reads + persists one person's layout for one role. Two independent
// mutations (reorder / setHidden) rather than one big "save" button —
// every change is saved immediately, so nothing is lost if someone
// navigates away mid-edit. `enabled` lets the caller skip the query
// entirely for a role that doesn't apply to the signed-in user (e.g. a
// parent account, which has no dashboard of its own here).
export function useDashboardLayout(role: DashboardRole, enabled: boolean = true) {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const queryKey = ["dashboard-layout", user?.id, role];
  const active = enabled && !!user;

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: active,
    queryFn: async () => {
      // Cast: dashboard_layouts is added by a standalone SQL file run
      // manually in the Supabase SQL Editor (see migration_dashboard_
      // layouts.sql), not through Lovable's own migration flow — so the
      // generated Database type may not know about it yet. Same reason
      // for the cast on the upsert below.
      const { data, error } = await (supabase as any)
        .from("dashboard_layouts")
        .select("widget_order, hidden_widgets")
        .eq("user_id", user!.id)
        .eq("dashboard_role", role)
        .maybeSingle();
      if (error) throw error;
      return data as { widget_order: DashboardWidgetId[]; hidden_widgets: DashboardWidgetId[] } | null;
    },
  });

  const allIds = defaultOrder(role);

  // Merge saved order with the current catalog — a widget added to the
  // catalog after someone already customized their layout appears
  // appended at the end (visible, per its own defaultVisible) rather than
  // silently missing until they hit Reset.
  const order = useMemo<DashboardWidgetId[]>(() => {
    const saved = data?.widget_order;
    const base = saved && saved.length > 0 ? saved.filter((id) => allIds.includes(id)) : [...allIds];
    const missing = allIds.filter((id) => !base.includes(id));
    return [...base, ...missing];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.widget_order, role]);

  const hidden = useMemo<Set<DashboardWidgetId>>(() => {
    return new Set(data?.hidden_widgets ?? defaultHidden(role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.hidden_widgets, role]);

  const mutation = useMutation({
    mutationFn: async (next: { order: DashboardWidgetId[]; hidden: DashboardWidgetId[] }) => {
      const { error } = await (supabase as any).from("dashboard_layouts").upsert(
        {
          user_id: user!.id,
          dashboard_role: role,
          widget_order: next.order,
          hidden_widgets: next.hidden,
        },
        { onConflict: "user_id,dashboard_role" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message ?? "Couldn't save your dashboard layout"),
  });

  function reorder(nextOrder: DashboardWidgetId[]) {
    mutation.mutate({ order: nextOrder, hidden: Array.from(hidden) });
  }

  function setHidden(id: DashboardWidgetId, isHidden: boolean) {
    const next = new Set(hidden);
    if (isHidden) next.add(id);
    else next.delete(id);
    mutation.mutate({ order, hidden: Array.from(next) });
  }

  function reset() {
    mutation.mutate({ order: defaultOrder(role), hidden: defaultHidden(role) });
  }

  return { order, hidden, isLoading, reorder, setHidden, reset, saving: mutation.isPending };
}
