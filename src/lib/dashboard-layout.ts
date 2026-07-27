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
  Trophy,import { useMemo } from "react";
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
  | "athlete_quick_tiles"
  | "athlete_recent_notices";

export type WidgetDef = {
  id: DashboardWidgetId;
  role: DashboardRole;
  label: string;
  description: string;
  icon: any;
  // Column span out of the dashboard's 2-column grid.
  span: 1 | 2;
  defaultVisible: boolean;
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
    span: 2,
    defaultVisible: true,
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
    span: 2,
    defaultVisible: true,
  },
  {
    id: "coaching_hub",
    role: "coach",
    label: "Coaching Hub",
    description: "Session templates, plan templates, and active plans.",
    icon: BookmarkCheck,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "health_vitals",
    role: "coach",
    label: "Health & Vitals",
    description: "Daily logs, injuries, and recovery across your roster.",
    icon: HeartPulse,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "your_athletes",
    role: "coach",
    label: "Your athletes",
    description: "Roster list with a quick-look summary on click.",
    icon: Users,
    span: 2,
    defaultVisible: true,
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
  },
  {
    id: "upcoming_races",
    role: "coach",
    label: "Upcoming races",
    description: "Races across your squad in the next two weeks.",
    icon: Trophy,
    span: 1,
    defaultVisible: true,
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
    id: "athlete_quick_tiles",
    role: "athlete",
    label: "Quick tiles",
    description: "Daily Log, Sessions, Health, Locker, Noticeboard, Messages.",
    icon: ClipboardList,
    span: 2,
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
  Star,
  LineChart,
  CalendarDays,
  Newspaper,
} from "lucide-react";

export type DashboardRole = "coach" | "athlete";

export type DashboardWidgetId =
  | "quick_actions"
  | "quick_tiles"
  | "squad_readiness"
  | "your_athletes"
  | "needs_attention"
  | "upcoming_races"
  | "recent_reviews"
  | "athlete_load_strip"
  | "athlete_today"
  | "athlete_attention"
  | "athlete_next_session"
  | "athlete_quick_tiles"
  | "athlete_recent_notices";

export type WidgetDef = {
  id: DashboardWidgetId;
  role: DashboardRole;
  label: string;
  description: string;
  icon: any;
  // Column span out of the dashboard's 2-column grid.
  span: 1 | 2;
  defaultVisible: boolean;
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
    span: 2,
    defaultVisible: true,
  },
  {
    id: "quick_tiles",
    role: "coach",
    label: "Quick tiles",
    description: "Messages, Noticeboard, Athletes, Health & Vitals.",
    icon: ClipboardList,
    span: 2,
    defaultVisible: true,
  },
  {
    id: "squad_readiness",
    role: "coach",
    label: "Squad readiness",
    description: "How many athletes are ready, cautious, or need recovery today.",
    icon: HeartPulse,
    span: 2,
    defaultVisible: true,
  },
  {
    id: "your_athletes",
    role: "coach",
    label: "Your athletes",
    description: "Roster list with a quick-look summary on click.",
    icon: Users,
    span: 2,
    defaultVisible: true,
  },
  {
    id: "needs_attention",
    role: "coach",
    label: "Needs attention",
    description: "Flagged sessions and athletes worth a look.",
    icon: AlertTriangle,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "upcoming_races",
    role: "coach",
    label: "Upcoming races",
    description: "Races across your squad in the next two weeks.",
    icon: Trophy,
    span: 1,
    defaultVisible: true,
  },
  {
    id: "recent_reviews",
    role: "coach",
    label: "Recent reviews",
    description: "Your latest AI coaching reviews.",
    icon: Star,
    span: 1,
    defaultVisible: true,
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
    id: "athlete_quick_tiles",
    role: "athlete",
    label: "Quick tiles",
    description: "Daily Log, Sessions, Health, Locker, Noticeboard, Messages.",
    icon: ClipboardList,
    span: 2,
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
