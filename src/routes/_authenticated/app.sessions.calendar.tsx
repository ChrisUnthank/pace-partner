import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles, useMyLinkedAthletes } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, List as ListIcon, Upload, CalendarPlus, PencilLine, Trophy, HeartPulse, CalendarRange, X } from "lucide-react";
import {
  CalendarDayCell,
  WeekTotalCell,
  type CalendarSession,
  type DayData,
  type DayForecast,
  sessionColorClass,
  sessionShortLabel,
  INTENT_BAR,
  DAYTYPE_BAR,
} from "@/components/calendar-day-cell";
import { CalendarQuickAddRail, quickAddItemFor } from "@/components/calendar-quick-add-rail";
import { estimateStepsVolume } from "@/lib/session-volume";
import { healthStateOn } from "@/lib/health-events";
import { resolvedTargetShortLabel, resolveStepTarget } from "@/lib/target-resolution";
import { sessionClassificationLabel, timeOfDayHintMs } from "@/lib/session-categories";
import { metersFmt, secToClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useServerFn } from "@tanstack/react-start";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { toast } from "sonner";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { BucketTabStrip, TRAINING_TABS } from "@/components/bucket-tab-strip";
import { emptyProgressionRules, offsetDaysBetween, buildCopyDraft } from "@/lib/calendar-copy";
import { commitCopyDrafts } from "@/lib/calendar-copy.functions";

const searchSchema = z.object({
  athleteId: z.string().optional(),
  view: z.enum(["month", "week"]).optional(),
  date: z.string().optional(), // YYYY-MM-DD anchor
});

export const Route = createFileRoute("/_authenticated/app/sessions/calendar")({
  validateSearch: searchSchema,
  component: CalendarPage,
});

// --- date helpers (UTC-safe ISO YYYY-MM-DD math) ---
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // Monday of this week
  return addDays(x, diff);
} // Monday start
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
// "2026-07" — used to identify/compare months without needing a full Date,
// and as the data-month-key the sticky-header IntersectionObserver reads.
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthKeyToDate(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function CalendarPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const uploadFile = useServerFn(uploadAndParseSessionFile);
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");
  const isParent = rawRoles.includes("parent");
  // Parents only ever view — no uploads, no manual entries, no vitals
  // logging, no "add to this day" affordance. Everything below that
  // creates or edits data checks this instead of isCoach/isAthlete
  // individually, so a bare-parent account can never trigger a write.
  const canEdit = isCoach || roles.includes("athlete");

  const view = search.view ?? "month";
  const anchor = search.date ? parseISO(search.date) : new Date();

  // Continuous-scroll month window (Month view only — Week view keeps its
  // existing paginated behavior unchanged). Independent of `anchor`/the
  // `date` search param, which now only seeds the window's initial
  // center; scrolling expands monthWindowStart/End without touching the
  // URL. Starts 2 months back / 2 months forward — enough to feel
  // continuous immediately without loading more than a coach is likely
  // to ever look at in one sitting.
  const [monthWindowStart, setMonthWindowStart] = useState(() => startOfMonth(addMonths(anchor, -2)));
  const [monthWindowEnd, setMonthWindowEnd] = useState(() => endOfMonth(addMonths(anchor, 2)));
  // Which month's sticky header is currently pinned at the top of the
  // scroll container — drives the month label, and which month
  // "Copy this month → next month" / Prev / Next operate on. Tracked via
  // IntersectionObserver further down, not derived from scroll math.
  const [centeredMonthKey, setCenteredMonthKey] = useState(() => monthKey(anchor));
  const centeredMonthDate = monthKeyToDate(centeredMonthKey);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const monthHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Set just before prepending months above the current viewport, so a
  // layout effect can compensate scrollTop by however much taller the
  // content became — otherwise the browser holds scrollTop fixed in
  // pixels, which visually yanks the view to whatever now occupies that
  // offset instead of keeping the user looking at the same date.
  const prevScrollHeightRef = useRef<number | null>(null);
  // Guards handleContinuousScroll against re-triggering a month-window
  // expansion while one is still settling. Without this, a fast mouse
  // wheel (which fires many discrete, larger-delta scroll events, unlike
  // trackpad momentum) can cross the 600px edge-load threshold several
  // times before React has re-rendered the prepended month AND the
  // compensating scrollTop adjustment below has actually run — each of
  // those extra calls prepends another month and shifts scrollHeight
  // again mid-flight, which is what produced the squashed/truncated
  // month header glitch. Locked the instant an edge-load fires, released
  // only once that load has actually settled (immediately for an append,
  // after the scroll-position correction for a prepend).
  const loadingEdgeRef = useRef(false);

  // Coach roster
  const { data: roster } = useQuery({
    queryKey: ["calendar-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return (data ?? []) as { id: string; name: string; profile_image_url: string | null }[];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean) as {
        id: string;
        name: string;
        profile_image_url: string | null;
      }[];
    },
  });

  // Parent's linked children, reshaped to match the coach roster's
  // { id, name, profile_image_url } accessor shape so the athlete switcher
  // below can treat both the same way.
  const { data: linkedAthletesRaw } = useMyLinkedAthletes();
  const parentRoster = useMemo(
    () =>
      (linkedAthletesRaw ?? [])
        .map((r: any) => r.athletes)
        .filter(Boolean)
        .map((a: any) => ({ id: a.id, name: a.name, profile_image_url: a.profile_image_url ?? null })),
    [linkedAthletesRaw],
  );

  const selectedAthleteId = search.athleteId ?? myAthlete?.id ?? roster?.[0]?.id ?? parentRoster?.[0]?.id ?? "";
  const selectedAthleteName =
    roster?.find((a) => a.id === selectedAthleteId)?.name ??
    parentRoster?.find((a) => a.id === selectedAthleteId)?.name ??
    (myAthlete && myAthlete.id === selectedAthleteId ? myAthlete.name : undefined);

  // Home location for forecasting, auto-detected from the athlete's most
  // recent completed GPS session — there's no dedicated "home location"
  // field on athletes today, and this avoids needing one just to show a
  // forecast. A brand-new athlete with no uploaded runs yet simply won't
  // have a forecast until their first GPS session exists; that's an
  // acceptable gap for a first pass rather than a blocker.
  const { data: homeLocation } = useQuery({
    queryKey: ["calendar-home-location", selectedAthleteId],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data: recentSession } = await supabase
        .from("sessions")
        .select("id")
        .eq("athlete_id", selectedAthleteId)
        .not("completed_at", "is", null)
        .order("session_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!recentSession) return null;

      const { data: point } = await supabase
        .from("raw_session_points")
        .select("lat, lng")
        .eq("session_id", recentSession.id)
        .not("lat", "is", null)
        .not("lng", "is", null)
        .limit(1)
        .maybeSingle();
      if (!point?.lat || !point?.lng) return null;

      return { lat: Number(point.lat), lng: Number(point.lng) };
    },
  });

  // Open-Meteo's forecast endpoint is free, keyless, and CORS-enabled —
  // fetched directly from the browser rather than through a server
  // function, same provider already used server-side for past-session
  // weather (fetchWeather in session-files.functions.ts), just the daily
  // aggregate shape instead of hourly (a day cell only has room for one
  // number, not an hour-by-hour breakdown). staleTime keeps this from
  // re-fetching every time the athlete flips between week/month or
  // navigates a few days — a forecast doesn't meaningfully change that often.
  const { data: forecast } = useQuery({
    queryKey: ["calendar-forecast", homeLocation?.lat, homeLocation?.lng],
    enabled: !!homeLocation,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${homeLocation!.lat}&longitude=${homeLocation!.lng}&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max&forecast_days=16&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const days: string[] = data?.daily?.time ?? [];
      const tempMax: (number | null)[] = data?.daily?.temperature_2m_max ?? [];
      const tempMin: (number | null)[] = data?.daily?.temperature_2m_min ?? [];
      const windMax: (number | null)[] = data?.daily?.wind_speed_10m_max ?? [];

      const map = new Map<string, DayForecast>();
      days.forEach((d, i) => {
        map.set(d, { tempMax: tempMax[i] ?? null, tempMin: tempMin[i] ?? null, windMax: windMax[i] ?? null });
      });
      return map;
    },
  });

  // Date range to load
  const { rangeStart, rangeEnd, gridDays, weekStart } = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      return { rangeStart: toISO(ws), rangeEnd: toISO(addDays(ws, 6)), gridDays: days, weekStart: ws };
    }
    // Month view: the WHOLE continuous-scroll window, not just one month —
    // every month currently loaded needs its sessions/load/vitals fetched
    // in the same query so scrolling through them doesn't hit empty cells.
    const gStart = startOfWeek(monthWindowStart);
    const gEnd = addDays(startOfWeek(endOfMonth(monthWindowEnd)), 6);
    const len = Math.round((+gEnd - +gStart) / 86400000) + 1;
    const days = Array.from({ length: len }, (_, i) => addDays(gStart, i));
    return { rangeStart: toISO(gStart), rangeEnd: toISO(gEnd), gridDays: days, weekStart: gStart };
  }, [view, anchor, monthWindowStart, monthWindowEnd]);

  const { data: bundle } = useQuery({
    queryKey: ["calendar", selectedAthleteId, rangeStart, rangeEnd],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const [{ data: sessions }, { data: load }, { data: vitals }] = await Promise.all([
        supabase
          .from("sessions")
          .select(
            "id, title, session_date, day_type, intent, structure, is_long_run, completed_at, is_planned, activity_type, total_distance_m, total_time_seconds, total_moving_time_seconds, time_of_day, terrain",
          )
          .eq("athlete_id", selectedAthleteId)
          .gte("session_date", rangeStart)
          .lte("session_date", rangeEnd)
          .order("session_date", { ascending: true }),
        supabase
          .from("athlete_load_daily")
          .select("load_date, readiness_status, readiness_score, training_load")
          .eq("athlete_id", selectedAthleteId)
          .gte("load_date", rangeStart)
          .lte("load_date", rangeEnd),
        // Resting HR logged via the Daily Log — same table already backing the
        // Home dashboard and readiness score, just surfaced here too now,
        // matching TrainingPeaks' calendar Metrics card.
        supabase
          .from("daily_vitals")
          .select("vitals_date, resting_hr")
          .eq("athlete_id", selectedAthleteId)
          .gte("vitals_date", rangeStart)
          .lte("vitals_date", rangeEnd),
      ]);
      const sIds = (sessions ?? []).map((s) => s.id);
      let fatigue: any[] = [];
      if (sIds.length) {
        const { data: fz } = await supabase
          .from("session_fatigue")
          .select("session_id, efficiency_score")
          .in("session_id", sIds);
        fatigue = fz ?? [];
      }
      // Real recorded start time per session, for correctly ordering
      // multiple sessions on the same day — session_date alone has no
      // time component, and completed_at is set to whenever the upload
      // was PROCESSED (not when the session actually happened), so
      // neither is safe to sort same-day sessions by. session_files.
      // started_at is the actual device/GPS-recorded start time; a
      // multi-file session (e.g. separate warmup/work/cooldown files)
      // uses the EARLIEST file, same "true start" convention already used
      // by recompute_fit_import_session_dates for date correction.
      // Sessions with no attached file (manually logged, e.g. a Gym
      // session) fall back to their own time_of_day hint at render time.
      const earliestStartMsBySession: Record<string, number> = {};
      if (sIds.length) {
        const { data: files } = await supabase
          .from("session_files")
          .select("session_id, started_at")
          .in("session_id", sIds)
          .not("started_at", "is", null);
        for (const f of files ?? []) {
          const ms = new Date(f.started_at as string).getTime();
          const cur = earliestStartMsBySession[f.session_id as string];
          if (cur == null || ms < cur) earliestStartMsBySession[f.session_id as string] = ms;
        }
      }
      // Steps for PLANNED sessions — completed pills show actuals, so no
      // lookup is needed there.
      //
      // ALL steps, not just work steps. This query used to fetch only
      // kind='work' because its sole job was the target-pace label, which
      // meant a planned session's DISTANCE had nowhere to come from: it lives
      // in the steps, and sessions.total_distance_m stays null until a file is
      // uploaded. So a whole campaign block filled from a plan showed no
      // distance anywhere on the calendar. Warmup and cooldown have to be in
      // here too, or a threshold session reads as 5 km when it is 11 on the
      // road.
      const plannedIds = (sessions ?? []).filter((s) => !s.completed_at).map((s) => s.id);
      let plannedSteps: any[] = [];
      if (plannedIds.length) {
        const { data: ws } = await supabase
          .from("steps")
          .select(
            "session_id, step_order, kind, reps, set_count, target_distance_m, target_time_seconds, counts_toward_distance, recovery_target_kind, recovery_target_distance_m, recovery_target_seconds, recovery_between_reps_seconds, recovery_between_sets_seconds, target_mode, target_pace_sec_per_km, target_threshold_pace_pct, target_threshold_hr_pct, target_zone, target_rpe",
          )
          .in("session_id", plannedIds)
          .order("step_order");
        plannedSteps = ws ?? [];
      }
      const plannedWorkSteps = plannedSteps.filter((st: any) => st.kind === "work");
      return {
        sessions: (sessions ?? []) as CalendarSession[],
        load: load ?? [],
        fatigue,
        vitals: vitals ?? [],
        plannedWorkSteps,
        plannedSteps,
        earliestStartMsBySession,
      };
    },
  });

  // PBs for this date range — entirely independent of `bundle` above, on
  // purpose. This reads directly from `performances` (is_pb = true,
  // maintained by the recompute_pb_after_perf_change DB trigger) rather
  // than joining through sessions, specifically so a PB with no session
  // behind it at all (bulk-imported or manually entered historical
  // results) still shows up here. A read-only decoration for the day
  // cell header — doesn't touch total_distance_m or anything else the
  // analytics/training-load pipeline reads.
  const { data: pbPerformances } = useQuery({
    queryKey: ["calendar-pbs", selectedAthleteId, rangeStart, rangeEnd],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("id, performance_date, distance_m, time_seconds, event_name")
        .eq("athlete_id", selectedAthleteId)
        .eq("is_pb", true)
        .gte("performance_date", rangeStart)
        .lte("performance_date", rangeEnd);
      return data ?? [];
    },
  });

  // Zone profile for target resolution (Phase 3) — keyed by athlete, not
  // range, so switching months doesn't refetch it.
  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile-for-targets", selectedAthleteId],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_profiles")
        .select("*")
        .eq("athlete_id", selectedAthleteId)
        .maybeSingle();
      return data;
    },
  });

  // Aggregate by date
  const byDate = useMemo(() => {
    const map = new Map<string, DayData>();
    for (const d of gridDays) map.set(toISO(d), { date: toISO(d), sessions: [] });
    if (bundle) {
      // Average efficiency per session across its work steps
      const effSum = new Map<string, { sum: number; n: number }>();
      for (const f of bundle.fatigue) {
        if (f.efficiency_score == null) continue;
        const cur = effSum.get(f.session_id) ?? { sum: 0, n: 0 };
        cur.sum += f.efficiency_score;
        cur.n += 1;
        effSum.set(f.session_id, cur);
      }
      const effBySession: Record<string, number> = {};
      for (const [sid, v] of effSum) effBySession[sid] = v.sum / v.n;

      // First work step per planned session (rows arrive ordered by
      // step_order, so first-in wins).
      const firstWorkStep = new Map<string, any>();
      for (const ws of bundle.plannedWorkSteps ?? []) {
        if (!firstWorkStep.has(ws.session_id)) firstWorkStep.set(ws.session_id, ws);
      }

      // Planned volume per session, from its steps.
      //
      // Estimated, not measured — a time-based target only becomes a distance
      // once a pace is assumed. Carried separately from total_distance_m so
      // nothing downstream can mistake one for the other, and rendered
      // differently by the day cell for the same reason.
      const stepsBySession = new Map<string, any[]>();
      for (const st of bundle.plannedSteps ?? []) {
        const list = stepsBySession.get(st.session_id) ?? [];
        list.push(st);
        stepsBySession.set(st.session_id, list);
      }

      for (const s of bundle.sessions) {
        const day = map.get(s.session_date);
        if (!day) continue;
        const step = !s.completed_at ? firstWorkStep.get(s.id) : null;
        const targetLabel = step ? resolvedTargetShortLabel(step, zoneProfile) : null;
        let plannedDistanceM: number | null = null;
        let plannedTimeS: number | null = null;
        if (!s.completed_at) {
          const vol = estimateStepsVolume(
            stepsBySession.get(s.id) ?? [],
            s.is_long_run ? "long" : (s.intent ?? s.day_type ?? "easy"),
            // The athlete's own zone paces, not the generic table. Without
            // this a planned easy run was estimated at 5:30/km while the pill
            // beside it read "Z2 · 4:05–4:43/km".
            (st) => resolveStepTarget(st, zoneProfile as any).paceRangeSecPerKm,
          );
          if (!vol.isEmpty) {
            plannedDistanceM = vol.totalM > 0 ? vol.totalM : null;
            plannedTimeS = vol.totalSeconds > 0 ? vol.totalSeconds : null;
          }
        }
        day.sessions.push({ ...s, ...(targetLabel ? { targetLabel } : {}), plannedDistanceM, plannedTimeS });
        day.efficiencyBySession = day.efficiencyBySession ?? {};
        if (effBySession[s.id] != null) day.efficiencyBySession[s.id] = effBySession[s.id];
      }
      // Same-day ordering — real recorded start time wins when a session
      // has an attached file, falling back to its own time_of_day hint
      // (morning/afternoon/evening) for sessions with neither, and
      // finally a stable index-based tiebreak so two genuinely
      // time-unknown sessions don't jump around between renders. Without
      // this, multiple sessions on one day fall back to whatever order
      // the query happened to return them in — effectively upload order,
      // not actual time of day.
      for (const day of map.values()) {
        const sortKey = (s: CalendarSession, idx: number): number => {
          const real = bundle.earliestStartMsBySession[s.id];
          if (real != null) return real;
          const hint = timeOfDayHintMs(s);
          if (hint != null) return hint;
          return Number.MAX_SAFE_INTEGER - (day.sessions.length - idx); // stable, keeps original relative order last
        };
        day.sessions = day.sessions
          .map((s, idx) => ({ s, key: sortKey(s, idx) }))
          .sort((a, b) => a.key - b.key)
          .map((x) => x.s);
      }
      for (const r of bundle.load) {
        const day = map.get(r.load_date);
        if (!day) continue;
        day.readiness_status = r.readiness_status as any;
        day.readiness_score = r.readiness_score as any;
        day.training_load = r.training_load as any;
      }
      for (const v of bundle.vitals) {
        const day = map.get(v.vitals_date);
        if (!day) continue;
        day.restingHr = v.resting_hr as any;
      }
    }
    // Merged outside the `if (bundle)` block above since it comes from its
    // own separate query, not `bundle` — a day can have PBs with no
    // session at all, so this can't be folded into the sessions loop.
    for (const p of pbPerformances ?? []) {
      const day = map.get(p.performance_date);
      if (!day) continue;
      day.pbs = day.pbs ?? [];
      day.pbs.push({
        id: p.id,
        distance_m: p.distance_m,
        time_seconds: p.time_seconds,
        event_name: p.event_name,
      });
    }
    return map;
  }, [bundle, gridDays, zoneProfile, pbPerformances]);

  // gridDays always starts on a Monday and is a whole number of weeks (both
  // the month grid's padding and the single-week view guarantee this), so a
  // straight chunk-into-7s is safe here without any remainder handling.
  const weeks = useMemo(() => {
    const chunks: Date[][] = [];
    for (let i = 0; i < gridDays.length; i += 7) {
      chunks.push(gridDays.slice(i, i + 7));
    }
    return chunks.map((days) => {
      let distanceM = 0;
      let timeS = 0;
      let sessionCount = 0;
      let plannedDistanceM = 0;
      let plannedTimeS = 0;
      let plannedCount = 0;
      for (const d of days) {
        const day = byDate.get(toISO(d));
        if (!day) continue;
        for (const s of day.sessions) {
          // Actual and planned kept apart, never added together.
          //
          // Completed sessions are what happened; planned ones are what is
          // meant to. Summing them into one figure would make a part-done
          // week unreadable — you could not tell 40 km run from 40 km still
          // to come. But excluding planned entirely, which is what this did,
          // left every future week showing a dash, so a coach who had just
          // filled a campaign block saw no volume anywhere.
          if (s.completed_at) {
            if (s.total_distance_m) distanceM += s.total_distance_m;
            if (s.total_time_seconds) timeS += s.total_time_seconds;
            sessionCount++;
          } else {
            if ((s as any).plannedDistanceM) plannedDistanceM += (s as any).plannedDistanceM;
            if ((s as any).plannedTimeS) plannedTimeS += (s as any).plannedTimeS;
            plannedCount++;
          }
        }
      }
      return { days, distanceM, timeS, sessionCount, plannedDistanceM, plannedTimeS, plannedCount };
    });
  }, [gridDays, byDate]);

  // Groups the continuous-scroll window's weeks by month, one block per
  // month with its own sticky header — this is what actually renders for
  // Month view. A week that straddles a month boundary (e.g. the week
  // starting Mon 27 Jul running into Aug) is listed under whichever
  // month contains its Monday, same "which month owns this row" rule
  // the single-month view already used via inMonth checks.
  const continuousMonths = useMemo(() => {
    if (view !== "month" || weeks.length === 0) return [];
    // Derived from `weeks` rather than restated, so the planned fields cannot
    // be added there and silently dropped here — which is exactly what the
    // hand-written shape did on the first attempt.
    type WeekBlock = (typeof weeks)[number];
    const months: { key: string; label: string; start: Date; weeks: WeekBlock[] }[] = [];
    // Bounds come from the weeks themselves rather than being
    // independently recomputed from monthWindowStart/End — a leading
    // week's Monday can land in the month BEFORE monthWindowStart (grid
    // padding before the 1st), and deriving the loop from monthWindowStart
    // directly would silently drop that week's section entirely instead
    // of giving it its own (small) month heading.
    let cursor = startOfMonth(weeks[0].days[0]);
    const endCursor = startOfMonth(weeks[weeks.length - 1].days[0]);
    while (cursor <= endCursor) {
      const monthWeeks = weeks.filter(
        (w) => w.days[0].getFullYear() === cursor.getFullYear() && w.days[0].getMonth() === cursor.getMonth(),
      );
      if (monthWeeks.length > 0) {
        months.push({
          key: monthKey(cursor),
          label: cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
          start: new Date(cursor),
          weeks: monthWeeks,
        });
      }
      cursor = addMonths(cursor, 1);
    }
    return months;
  }, [view, weeks]);

  const todayISO = toISO(new Date());
  const monthLabel = centeredMonthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  // Smoothly scrolls the given month's sticky header into view, expanding
  // the loaded window first if that month isn't loaded yet. Used by
  // Today/Prev/Next in Month view instead of navigating to a new page.
  function scrollToMonth(key: string) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = monthHeaderRefs.current.get(key);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function shiftMonthView(delta: number) {
    const target = addMonths(centeredMonthDate, delta);
    const key = monthKey(target);
    if (key < monthKey(monthWindowStart)) setMonthWindowStart(startOfMonth(target));
    if (key > monthKey(monthWindowEnd)) setMonthWindowEnd(endOfMonth(target));
    scrollToMonth(key);
  }

  function goTodayMonthView() {
    const key = monthKey(new Date());
    if (key < monthKey(monthWindowStart) || key > monthKey(monthWindowEnd)) {
      setMonthWindowStart(startOfMonth(addMonths(new Date(), -2)));
      setMonthWindowEnd(endOfMonth(addMonths(new Date(), 2)));
    }
    scrollToMonth(key);
  }

  function shift(delta: number) {
    if (view === "month") {
      shiftMonthView(delta);
      return;
    }
    const next = addDays(anchor, delta * 7);
    navigate({ search: (p: any) => ({ ...p, date: toISO(next) }) });
  }
  function goToday() {
    if (view === "month") {
      goTodayMonthView();
      return;
    }
    navigate({ search: (p: any) => ({ ...p, date: undefined }) });
  }
  function setView(v: "month" | "week") {
    navigate({ search: (p: any) => ({ ...p, view: v }) });
  }

  // Straight copy-forward: no progression dialog, no review step — exactly
  // what's currently on screen for this athlete, copied verbatim to the
  // next equivalent period. Reuses the same buildCopyDraft/commit engine
  // as the full Copy Period dialog (empty progression rules = an exact
  // copy). Confirmation is a proper in-app dialog rather than
  // window.confirm() — the native browser confirm renders with an ugly
  // "an embedded page says" wrapper inside Lovable's preview iframe and
  // wouldn't look right in production either.
  function requestQuickCopy(kind: "week" | "month") {
    if (!selectedAthleteId) {
      toast.error("Select an athlete first");
      return;
    }

    let srcStart: string;
    let srcEnd: string;
    let targetStart: string;

    if (kind === "week") {
      const ws = startOfWeek(anchor);
      srcStart = toISO(ws);
      srcEnd = toISO(addDays(ws, 6));
      targetStart = toISO(addDays(ws, 7));
    } else {
      const mStart = startOfMonth(centeredMonthDate);
      const mEnd = endOfMonth(centeredMonthDate);
      srcStart = toISO(mStart);
      srcEnd = toISO(mEnd);
      targetStart = toISO(new Date(centeredMonthDate.getFullYear(), centeredMonthDate.getMonth() + 1, 1));
    }

    setPendingQuickCopy({ kind, srcStart, srcEnd, targetStart });
  }

  async function confirmQuickCopy() {
    if (!pendingQuickCopy || !selectedAthleteId) return;
    const { kind, srcStart, srcEnd, targetStart } = pendingQuickCopy;

    setPendingQuickCopy(null);
    setQuickCopying(kind);
    try {
      const { data: sourceSessions, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("athlete_id", selectedAthleteId)
        .gte("session_date", srcStart)
        .lte("session_date", srcEnd)
        .order("session_date")
        .order("time_of_day");
      if (error) throw error;

      if (!sourceSessions || sourceSessions.length === 0) {
        toast.error(`No sessions found in this ${kind}`);
        return;
      }

      const sessionIds = sourceSessions.map((s: any) => s.id);
      const { data: allSteps, error: stepsErr } = await supabase
        .from("steps")
        .select("*")
        .in("session_id", sessionIds)
        .order("step_order");
      if (stepsErr) throw stepsErr;

      const stepsBySession = new Map<string, any[]>();
      for (const s of allSteps ?? []) {
        const list = stepsBySession.get(s.session_id) ?? [];
        list.push(s);
        stepsBySession.set(s.session_id, list);
      }

      const offsetDays = offsetDaysBetween(srcStart, targetStart);
      const rules = emptyProgressionRules(); // all 0/0 volume+intensity — exact copy, no scaling
      const drafts = sourceSessions.map((s: any) =>
        buildCopyDraft(s, stepsBySession.get(s.id) ?? [], offsetDays, rules),
      );

      const payload = drafts.map((d) => ({
        athlete_id: d.athlete_id,
        session_date: d.session_date,
        title: d.title,
        day_type: d.day_type,
        intent: d.intent,
        structure: d.structure,
        is_long_run: d.is_long_run,
        steps: d.steps,
      }));

      const result = await commitCopyDrafts({ data: { drafts: payload } });
      toast.success(`${result.created} session${result.created === 1 ? "" : "s"} copied to next ${kind}`);
      qc.invalidateQueries({ queryKey: ["calendar"] });
    } catch (err: any) {
      toast.error(err?.message ?? `Failed to copy ${kind}`);
    } finally {
      setQuickCopying(null);
    }
  }

  // Tracks which month's sticky header is currently pinned at the top of
  // the scroll container. rootMargin creates a thin observation band near
  // the top edge only — a header "counts" as current once it's scrolled
  // up near the top, not merely somewhere in the visible area — same
  // logic a native sticky-section list uses.
  useEffect(() => {
    if (view !== "month") return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const key = topMost.target.getAttribute("data-month-key");
        if (key) setCenteredMonthKey(key);
      },
      { root: container, rootMargin: "0px 0px -85% 0px", threshold: 0 },
    );

    monthHeaderRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [view, continuousMonths]);

  // Compensates scroll position after months get prepended above the
  // current viewport — see prevScrollHeightRef's declaration above for why.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || prevScrollHeightRef.current == null) {
      loadingEdgeRef.current = false;
      return;
    }
    const diff = el.scrollHeight - prevScrollHeightRef.current;
    if (diff > 0) el.scrollTop += diff;
    prevScrollHeightRef.current = null;
    loadingEdgeRef.current = false;
  }, [monthWindowStart]);

  // Append (bottom edge) doesn't shift scroll position the way a prepend
  // does, so there's no measurement to wait for — the lock just needs
  // releasing once the newly-appended month has actually rendered.
  useEffect(() => {
    loadingEdgeRef.current = false;
  }, [monthWindowEnd]);

  // Land on the requested date.
  //
  // The month window is seeded anchor−2 .. anchor+2, but a scroll container
  // opens at the TOP — which is two months BEFORE the date that was asked
  // for. So arriving from the dashboard mini-calendar (which links with
  // ?date=…) or any other deep link showed the wrong part of the year, and
  // the date you clicked was off-screen below.
  //
  // Only runs when a `date` param was actually supplied: with no param the
  // anchor is today, and today's month is where the top-of-window behaviour
  // should stay for a plain visit to the calendar.
  //
  // `instant` rather than smooth — this is the initial position, not a
  // navigation, and animating a scroll on mount reads as a glitch.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!search.date || view !== "month") return;
    const key = monthKey(anchor);
    // Two frames: the first lets the month headers mount and register their
    // refs, the second lets layout settle so scrollIntoView measures real
    // positions rather than a half-built list.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = monthHeaderRefs.current.get(key);
        if (!el) return;
        el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
        setCenteredMonthKey(key);
        didInitialScrollRef.current = true;
      });
    });
  }, [search.date, view, anchor]);

  // Expands the loaded window as the user scrolls near either edge —
  // this is what makes the scroll feel continuous instead of hitting a
  // hard stop a couple of months out. 600px of runway is enough to load
  // the next month well before it's actually reached at normal scroll
  // speed.
  const EDGE_LOAD_THRESHOLD_PX = 600;
  function handleContinuousScroll(e: React.UIEvent<HTMLDivElement>) {
    if (view !== "month") return;
    if (loadingEdgeRef.current) return;
    const el = e.currentTarget;
    if (el.scrollTop < EDGE_LOAD_THRESHOLD_PX) {
      loadingEdgeRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      setMonthWindowStart((prev) => addMonths(prev, -1));
      return;
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < EDGE_LOAD_THRESHOLD_PX) {
      loadingEdgeRef.current = true;
      setMonthWindowEnd((prev) => addMonths(prev, 1));
    }
  }

  // Scroll-to-navigate: scrolling down over the grid moves forward a week,
  // scrolling up moves back — Week view only; Month view's own scroll IS
  // the navigation now (see handleContinuousScroll above), so hijacking
  // its wheel events too would fight the native scroll instead of
  // complementing it. In addition to the arrow buttons and Today, not a
  // replacement for them. Throttled with a cooldown rather than accumulating
  // every wheel tick, since a single trackpad swipe fires dozens of small delta
  // events — without this it would fly through several weeks on one gesture.
  const wheelCooldown = useRef(false);
  function handleGridWheel(e: React.WheelEvent) {
    if (Math.abs(e.deltaY) < 12) return; // ignore tiny jitter (e.g. trackpad momentum tail)
    if (wheelCooldown.current) return;
    wheelCooldown.current = true;
    shift(e.deltaY > 0 ? 1 : -1);
    setTimeout(() => {
      wheelCooldown.current = false;
    }, 450);
  }

  const [sheetDay, setSheetDay] = useState<DayData | null>(null);
  // Date (YYYY-MM-DD) currently showing the "add to this day" menu — works
  // on any day, empty or not, so existing sessions are never blocked from
  // getting a second one added alongside them.
  const [addMenuDate, setAddMenuDate] = useState<string | null>(null);
  const [uploadDate, setUploadDate] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [quickCopying, setQuickCopying] = useState<"week" | "month" | null>(null);
  const [pendingQuickCopy, setPendingQuickCopy] = useState<{
    kind: "week" | "month";
    srcStart: string;
    srcEnd: string;
    targetStart: string;
  } | null>(null);

  // Injuries and illnesses covering the visible range.
  //
  // Overlap test rather than a containment one: a six-week injury starting
  // before this month still covers every day of it, and filtering on
  // onset_date alone would show nothing.
  //
  // Chronic conditions are excluded — asthma marking all 365 days would bury
  // the acute events that actually explain a bad week, which is the entire
  // point of putting this on the calendar.
  const { data: healthEvents = [] } = useQuery({
    queryKey: ["calendar-health", selectedAthleteId, rangeStart, rangeEnd],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("injuries")
        .select("id, kind, body_part, side, illness_type, onset_date, resolved_date, expected_resolved_date, is_chronic, status, severity, notes, training_impact, training_modifications")
        .eq("athlete_id", selectedAthleteId)
        .eq("archived", false)
        .lte("onset_date", rangeEnd)
        .or(`resolved_date.is.null,resolved_date.gte.${rangeStart}`)
        .or(`expected_resolved_date.is.null,expected_resolved_date.gte.${rangeStart}`);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const healthByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    if (healthEvents.length === 0) return map;
    const today = toISO(new Date());
    for (const d of gridDays) {
      const day = toISO(d);
      // Carries the RECORD plus its state for that day, not a pre-rendered
      // strip — the popover needs the notes, severity, dates and training
      // impact, and a display-only shape would have thrown all of that away
      // one step before it was wanted.
      const hits = healthEvents
        .map((h: any) => ({ ...h, state: healthStateOn(h, day, { today }) }))
        .filter((h: any) => h.state !== null);
      if (hits.length === 0) continue;
      map.set(day, hits);
    }
    return map;
  }, [healthEvents, gridDays]);

  // --- Quick-add rail ---
  // Which activity (a QUICK_ADD_ITEMS key) is currently loaded. Stays
  // armed after each placement on purpose: laying out a week of easy runs
  // should be one click per day, not one arm-and-click per day. Held in
  // component state rather than the URL — it's a transient input mode, and
  // a shared/bookmarked calendar link shouldn't arrive primed to write.
  const [armedQuickAdd, setArmedQuickAdd] = useState<string | null>(null);
  const [quickAddingDate, setQuickAddingDate] = useState<string | null>(null);
  const armedItem = quickAddItemFor(armedQuickAdd);

  // Retrospective vitals logging — closes the gap where an athlete who
  // forgot to log resting HR/sleep on a given day had no way to go back and
  // fill it in. Works the same as Upload/Create Session above: pick a date,
  // open a small dialog scoped to exactly that date, save.
  const [vitalsDate, setVitalsDate] = useState<string | null>(null);
  const [vSleepHours, setVSleepHours] = useState("");
  const [vRestingHr, setVRestingHr] = useState("");
  const [vWeightKg, setVWeightKg] = useState("");
  const [vHydration, setVHydration] = useState(3);
  const [savingVitals, setSavingVitals] = useState(false);

  const { data: vitalsForDay } = useQuery({
    queryKey: ["calendar-vitals-edit", selectedAthleteId, vitalsDate],
    enabled: !!vitalsDate && !!selectedAthleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_vitals")
        .select("*")
        .eq("athlete_id", selectedAthleteId)
        .eq("vitals_date", vitalsDate!)
        .maybeSingle();
      return data as any;
    },
  });

  // Re-seed the form every time a new day is opened (or its existing values
  // finish loading) — a fresh day should start blank, not carry over
  // whatever was left in the fields from the previous day's dialog.
  useEffect(() => {
    if (!vitalsDate) return;
    setVSleepHours(vitalsForDay?.sleep_hours != null ? String(vitalsForDay.sleep_hours) : "");
    setVRestingHr(vitalsForDay?.resting_hr != null ? String(vitalsForDay.resting_hr) : "");
    setVWeightKg(vitalsForDay?.weight_kg != null ? String(vitalsForDay.weight_kg) : "");
    setVHydration(vitalsForDay?.hydration ?? 3);
  }, [vitalsDate, vitalsForDay]);

  async function saveVitalsForDay() {
    if (!vitalsDate || !selectedAthleteId) return;
    setSavingVitals(true);
    const { error } = await supabase.from("daily_vitals").upsert(
      {
        athlete_id: selectedAthleteId,
        vitals_date: vitalsDate,
        sleep_hours: vSleepHours === "" ? null : Number(vSleepHours),
        resting_hr: vRestingHr === "" ? null : Number(vRestingHr),
        weight_kg: vWeightKg === "" ? null : Number(vWeightKg),
        hydration: vHydration,
      } as any,
      { onConflict: "athlete_id,vitals_date" },
    );
    setSavingVitals(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vitals saved");
    qc.invalidateQueries({ queryKey: ["calendar"] });
    setVitalsDate(null);
  }

  // Escape disarms the rail. Bound at the window rather than on the grid
  // so it works wherever focus happens to be — after clicking three days
  // in a row, focus is on a day cell, but after scrolling it may be
  // nowhere in particular, and "press Esc to stop" has to be true either
  // way or it isn't worth telling the coach.
  useEffect(() => {
    if (!armedQuickAdd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmedQuickAdd(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armedQuickAdd]);

  // Switching athlete disarms. An arm left over from the previous athlete
  // would place onto whoever is now selected on the very next click, with
  // nothing on screen having changed to suggest that — the single worst
  // failure this feature could have.
  useEffect(() => {
    setArmedQuickAdd(null);
  }, [selectedAthleteId]);

  // Places the armed activity on a day. Writes exactly the columns
  // app.sessions.new.tsx writes for the equivalent choice — see
  // QUICK_ADD_ITEMS for why `structure` is set on some items and left null
  // on others.
  //
  // No steps are created. A quick-added session is a marker on the
  // calendar saying "this is the day and this is the kind of work"; the
  // blocks get built when the coach opens it. The Workout Structure editor
  // renders its add-block buttons unconditionally, so a session with zero
  // steps opens and edits normally.
  async function quickAddSession(date: string) {
    const item = quickAddItemFor(armedQuickAdd);
    if (!item || !selectedAthleteId || !user) return;
    if (quickAddingDate) return; // one write in flight at a time

    setQuickAddingDate(date);
    const { data, error } = await supabase
      .from("sessions")
      .insert({
        athlete_id: selectedAthleteId,
        created_by: user.id,
        session_date: date,
        title: item.title,
        day_type: item.day_type,
        intent: item.intent,
        structure: item.structure,
        is_long_run: item.is_long_run,
        is_planned: true,
        activity_type: item.activity_type,
      } as any)
      .select("id")
      .single();
    setQuickAddingDate(null);

    if (error || !data) {
      toast.error(error?.message ?? "Couldn't add that session");
      return;
    }

    qc.invalidateQueries({ queryKey: ["calendar"] });

    // Undo matters more here than anywhere else on this page: this is the
    // only control in the app where a single stray click writes a row.
    // The created session has no steps and no results, so deleting it
    // cannot destroy anything the coach entered.
    const newId = data.id as string;
    toast.success(
      `${item.label} added — ${parseISO(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`,
      {
        action: {
          label: "Undo",
          onClick: async () => {
            const { error: delErr } = await supabase.from("sessions").delete().eq("id", newId);
            if (delErr) {
              toast.error(delErr.message);
              return;
            }
            qc.invalidateQueries({ queryKey: ["calendar"] });
            toast.success("Removed");
          },
        },
      },
    );
  }

  // Matches BulkFitUpload's own mechanism exactly (src/components/bulk-fit-upload.tsx,
  // used on the sessions list) rather than forcing everything onto the day
  // clicked: no session is pre-created, and no sessionId is passed to
  // uploadAndParseSessionFile — each file is handed over on its own, and the
  // server decides whether to merge it into an existing nearby session or
  // start a new one, purely from that file's own recorded start time (files
  // close together merge into one session; more than 90 minutes apart — an
  // AM and a PM run, say — become separate sessions). The specific day
  // clicked here is just where the dialog happened to open from, not a
  // guarantee of where the resulting session(s) land — if a file's own
  // clock disagrees with the day clicked, the file's clock wins, same as
  // it would from the sessions-list uploader. Files are uploaded one at a
  // time, not in parallel, so two uploads landing in the same session never
  // race each other's rebuild.
  async function handleCalendarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0 || !selectedAthleteId) return;

    setUploading(true);
    let successCount = 0;
    let firstErrorMessage: string | null = null;
    try {
      for (const file of files) {
        try {
          const reader = new FileReader();
          const base64: string = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result || "").split(",")[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });

          const res: any = await uploadFile({
            data: {
              athleteId: selectedAthleteId,
              filename: file.name,
              kind: file.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit",
              fileBase64: base64,
            },
          });

          if (res?.error) throw new Error(res.error);
          successCount++;
        } catch (fileErr: any) {
          console.error(`Calendar upload error (${file.name}):`, fileErr);
          if (!firstErrorMessage) firstErrorMessage = `${file.name}: ${fileErr.message ?? "Upload failed"}`;
        }
      }

      if (successCount === 0) throw new Error(firstErrorMessage ?? "Upload failed");

      toast.success(
        successCount === 1 ? "File uploaded" : `${successCount} of ${files.length} files uploaded`,
      );
      if (firstErrorMessage && successCount < files.length) {
        toast.error(`Some files didn't upload: ${firstErrorMessage}`);
      }
      // No forced navigation to a single session — multiple files can now
      // land in more than one session (that's the whole point), so there's
      // no single "the" session to jump to. Closing the dialog and
      // refreshing the grid lets whatever landed show up in place.
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setUploadDate(null);
    } catch (err: any) {
      console.error("Calendar upload error:", err);
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  // Same condition that already drives compact cells — an 8th "totals"
  // column has no room next to already-cramped mobile month cells, so it
  // only shows wherever cells are already full-size.
  const showWeekTotals = !(isMobile && view === "month");

  return (
    <AppShell fullWidth>
      <div className="space-y-3">
        {/* Row 1 — breadcrumb + athlete subnav together on the left,
            athlete/child picker on the right. The subnav used to share a
            row with the page heading further down; moving it up here and
            merging that heading row with the Today/Prev/Next controls
            (below) drops the header from three rows to two, freeing real
            vertical room for the calendar grid itself. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {isCoach && selectedAthleteId && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                <Link to="/app/athletes" className="hover:text-foreground">
                  Athletes
                </Link>
                <span className="text-border">/</span>
                <Link
                  to="/app/athletes/$athleteId"
                  params={{ athleteId: selectedAthleteId }}
                  className="hover:text-foreground"
                >
                  {selectedAthleteName ?? "Athlete"}
                </Link>
              </div>
            )}
            {isCoach && selectedAthleteId ? (
              <AthleteSubnav athleteId={selectedAthleteId} active="calendar" />
            ) : (
              !isParent && (
                <BucketTabStrip
                  items={TRAINING_TABS.filter((t) =>
                    t.to === "/app/daily-log" || t.to === "/app/my-schedule" ? roles.includes("athlete") : true,
                  )}
                  active="/app/sessions/calendar"
                />
              )
            )}
          </div>
          <div className="shrink-0">
            {isCoach &&
              roster &&
              roster.length > 0 &&
              (() => {
                const sel =
                  roster.find((a) => a.id === selectedAthleteId) ??
                  (myAthlete && myAthlete.id === selectedAthleteId
                    ? {
                        id: myAthlete.id,
                        name: myAthlete.name,
                        profile_image_url: (myAthlete as any).profile_image_url,
                      }
                    : null);
                return (
                  <div className="flex items-center gap-2">
                    {sel && <UserAvatar name={sel.name} imageUrl={sel.profile_image_url} size="sm" />}
                    <Select
                      value={selectedAthleteId}
                      onValueChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
                    >
                      <SelectTrigger className="h-9 w-[180px]">
                        <SelectValue placeholder="Select athlete" />
                      </SelectTrigger>
                      <SelectContent>
                        {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                        {roster
                          .filter((a) => a.id !== myAthlete?.id)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
            {/* Parent child-switcher — same pattern as the coach roster
                selector above, sourced from parent_athlete_links instead.
                Only a real choice once a parent has more than one child
                linked; with just one, their name still shows via the
                avatar+label for clarity without a pointless single-item
                dropdown. */}
            {isParent && !isCoach && parentRoster.length > 0 && (
              <div className="flex items-center gap-2">
                {parentRoster.length > 1 ? (
                  <Select
                    value={selectedAthleteId}
                    onValueChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
                  >
                    <SelectTrigger className="h-9 w-[180px]">
                      <SelectValue placeholder="Select child" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentRoster.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2">
                    <UserAvatar name={parentRoster[0].name} imageUrl={parentRoster[0].profile_image_url} size="sm" />
                    <span className="text-sm font-medium">{parentRoster[0].name}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 2 — icon + eyebrow heading, Today/Prev/Next and the current
            month/week label all on the left (heading and date controls
            side by side rather than stacked on separate rows), Month/Week
            toggle + Copy + List view on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
                style={{ background: "var(--accent-red)" }}
              >
                <CalendarRange className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Training</div>
                <h1 className="text-2xl font-bold leading-tight">Calendar</h1>
                {!isCoach && !isParent && (
                  <p className="text-xs text-muted-foreground">Sessions by date · color = intent / day type</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => shift(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={() => shift(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="ml-2 text-sm font-medium">{view === "month" ? monthLabel : weekLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border overflow-hidden">
              <button
                onClick={() => setView("month")}
                className={cn("px-3 py-1.5 text-xs", view === "month" ? "bg-accent" : "bg-background")}
              >
                Month
              </button>
              <button
                onClick={() => setView("week")}
                className={cn("px-3 py-1.5 text-xs border-l", view === "week" ? "bg-accent" : "bg-background")}
              >
                Week
              </button>
            </div>
            {isCoach && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                disabled={quickCopying === view}
                onClick={() => requestQuickCopy(view)}
              >
                {quickCopying === view
                  ? "Copying..."
                  : view === "month"
                    ? "Copy this month → next month"
                    : "Copy this week → next week"}
              </Button>
            )}
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/app/sessions"
                  search={selectedAthleteId ? ({ athleteId: selectedAthleteId } as any) : undefined}
                >
                  <ListIcon className="h-4 w-4 mr-1" /> List view
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Armed-state banner. The rail itself shows which pill is lit, but
            the rail is 44px wide and collapsed most of the time — the
            coach needs to be told, in words, that clicking a day is now
            going to write something, and how to stop. */}
        {armedItem && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/5 px-3 py-1.5 text-xs">
            <span className={cn("h-3.5 w-3.5 shrink-0 rounded-sm", armedItem.colorClass)} />
            <span className="min-w-0">
              Adding <span className="font-semibold">{armedItem.label}</span> — click any day to place it. Stays on for
              the next day, and the next. Press <kbd className="rounded border px-1">Esc</kbd> or Done to stop.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 shrink-0 px-2 text-xs"
              onClick={() => setArmedQuickAdd(null)}
            >
              <X className="mr-1 h-3 w-3" /> Done
            </Button>
          </div>
        )}

        <Card onWheel={view === "week" ? handleGridWheel : undefined}>
          <CardContent className={cn("flex items-stretch", view === "month" ? "p-0" : "p-1 sm:p-1.5")}>
            {canEdit && (
              <CalendarQuickAddRail
                armedKey={armedQuickAdd}
                onArm={setArmedQuickAdd}
                disabled={!selectedAthleteId || !!quickAddingDate}
              />
            )}
            {/* min-w-0 at the flex-item level, not on inner content — the
                grid inside will not shrink below its content otherwise and
                the rail gets squeezed off. */}
            <div className={cn("min-w-0 flex-1", canEdit && view !== "month" && "pl-1")}>
            {view === "month" ? (
              <div
                ref={scrollContainerRef}
                onScroll={handleContinuousScroll}
                className="max-h-[75vh] overflow-y-auto brand-scrollbar"
              >
                <div className="p-1 sm:p-1.5">
                  {continuousMonths.map((month) => (
                    <div key={month.key} className="mb-3 last:mb-0">
                      <div
                        ref={(el) => {
                          if (el) monthHeaderRefs.current.set(month.key, el);
                          else monthHeaderRefs.current.delete(month.key);
                        }}
                        data-month-key={month.key}
                        className="sticky top-0 z-20 py-1.5 bg-card text-sm font-semibold border-b border-border"
                      >
                        {month.label}
                      </div>
                      <div
                        className={cn(
                          "grid gap-0.5 mb-1 mt-1.5 text-[10px] text-muted-foreground",
                          showWeekTotals ? "grid-cols-8" : "grid-cols-7",
                        )}
                      >
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                          <div key={d} className="text-center uppercase tracking-wide">
                            {d}
                          </div>
                        ))}
                        {showWeekTotals && <div className="text-center uppercase tracking-wide">Total</div>}
                      </div>
                      <div className="space-y-0.5">
                        {month.weeks.map((week, wi) => (
                          <div key={wi} className={cn("grid gap-0.5", showWeekTotals ? "grid-cols-8" : "grid-cols-7")}>
                            {week.days.map((d) => {
                              const iso = toISO(d);
                              const day = byDate.get(iso)!;
                              const inMonth = d.getMonth() === month.start.getMonth();
                            return (
                              <CalendarDayCell
                                key={iso}
                                day={day}
                                inMonth={inMonth}
                                isToday={iso === todayISO}
                                compact={!showWeekTotals}
                                weather={showWeekTotals ? (forecast?.get(iso) ?? null) : undefined}
                                onMultiClick={(dd) => setSheetDay(dd)}
                                onAdd={canEdit ? (date) => setAddMenuDate(date) : undefined}
                                health={healthByDate.get(iso)}
                                onHealthChanged={() => qc.invalidateQueries({ queryKey: ["calendar-health"] })}
                                quickAddArmed={!!armedItem}
                                quickAddPending={quickAddingDate === iso}
                                onQuickAdd={canEdit ? quickAddSession : undefined}
                              />
                            );
                          })}
                          {showWeekTotals && (
                            <WeekTotalCell
                              distanceM={week.distanceM}
                              timeS={week.timeS}
                              sessionCount={week.sessionCount}
                              plannedDistanceM={week.plannedDistanceM}
                              plannedTimeS={week.plannedTimeS}
                              plannedCount={week.plannedCount}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-8 gap-0.5 mb-1 text-[10px] text-muted-foreground">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div key={d} className="text-center uppercase tracking-wide">
                      {d}
                    </div>
                  ))}
                  <div className="text-center uppercase tracking-wide">Total</div>
                </div>
                <div className="space-y-0.5">
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-8 gap-0.5">
                      {week.days.map((d) => {
                        const iso = toISO(d);
                        const day = byDate.get(iso)!;
                        return (
                          <CalendarDayCell
                            key={iso}
                            day={day}
                            inMonth={true}
                            isToday={iso === todayISO}
                            compact={false}
                            weather={forecast?.get(iso) ?? null}
                            onMultiClick={(dd) => setSheetDay(dd)}
                            onAdd={canEdit ? (date) => setAddMenuDate(date) : undefined}
                            health={healthByDate.get(iso)}
                            onHealthChanged={() => qc.invalidateQueries({ queryKey: ["calendar-health"] })}
                            quickAddArmed={!!armedItem}
                            quickAddPending={quickAddingDate === iso}
                            onQuickAdd={canEdit ? quickAddSession : undefined}
                          />
                        );
                      })}
                      <WeekTotalCell
                              distanceM={week.distanceM}
                              timeS={week.timeS}
                              sessionCount={week.sessionCount}
                              plannedDistanceM={week.plannedDistanceM}
                              plannedTimeS={week.plannedTimeS}
                              plannedCount={week.plannedCount}
                            />
                    </div>
                  ))}
                </div>
              </>
            )}
            </div>
          </CardContent>
        </Card>

        <Legend />
      </div>

      <Sheet open={!!sheetDay} onOpenChange={(o) => !o && setSheetDay(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-auto">
          <SheetHeader>
            <SheetTitle>
              {sheetDay
                ? parseISO(sheetDay.date).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : ""}
            </SheetTitle>
          </SheetHeader>
          {sheetDay && (
            <div className="mt-4 space-y-2">
              {(() => {
                let distanceM = 0;
                let timeS = 0;
                let completedCount = 0;
                for (const s of sheetDay.sessions) {
                  if (!s.completed_at) continue;
                  completedCount++;
                  if (s.total_distance_m) distanceM += s.total_distance_m;
                  if (s.total_time_seconds) timeS += s.total_time_seconds;
                }
                if (completedCount === 0) return null;
                return (
                  <div className="text-sm font-medium">
                    {metersFmt(distanceM)} · {secToClock(timeS)}
                    {sheetDay.sessions.length > 1 ? ` across ${completedCount} sessions` : ""}
                  </div>
                );
              })()}
              {sheetDay.readiness_status && (
                <div className="text-xs text-muted-foreground">
                  Readiness: <span className="font-medium capitalize">{sheetDay.readiness_status}</span>
                  {sheetDay.readiness_score != null ? ` · ${Math.round(sheetDay.readiness_score)}` : ""}
                  {sheetDay.training_load != null ? ` · Training load ${Math.round(sheetDay.training_load)}` : ""}
                </div>
              )}
              {sheetDay.restingHr != null && (
                <div className="text-xs text-muted-foreground">
                  Resting HR: <span className="font-medium">{sheetDay.restingHr} bpm</span>
                </div>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const d = sheetDay.date;
                    setSheetDay(null);
                    setVitalsDate(d);
                  }}
                >
                  <HeartPulse className="h-3.5 w-3.5 mr-1.5" /> {sheetDay.restingHr != null ? "Edit vitals" : "Log vitals"}
                </Button>
              )}
              {sheetDay.sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions on this day.</p>
              ) : (
                sheetDay.sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Link
                      to="/app/sessions/$sessionId"
                      params={{ sessionId: s.id }}
                      onClick={() => setSheetDay(null)}
                      className="flex-1 flex items-stretch gap-2 rounded-md border hover:bg-accent/40 overflow-hidden"
                    >
                      <span className={cn("w-1.5", sessionColorClass(s))} />
                      <div className="py-2 pr-2 min-w-0">
                        <div className="text-sm font-medium truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {sessionShortLabel(s)} · {sessionClassificationLabel(s)} ·{" "}
                          {s.completed_at ? "Completed" : "Planned"}
                          {!s.completed_at && s.targetLabel && (
                            <>
                              {" · "}
                              <span className="text-[var(--accent-red)]">{s.targetLabel}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </Link>
                    {s.completed_at && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to="/app/sessions/$sessionId/analysis"
                          params={{ sessionId: s.id }}
                          onClick={() => setSheetDay(null)}
                        >
                          Analysis
                        </Link>
                      </Button>
                    )}
                  </div>
                ))
              )}
              {isCoach && sheetDay.sessions.length === 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/sessions/new" onClick={() => setSheetDay(null)}>
                    + New session
                  </Link>
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* "Add to this day" menu — three entry points, all pre-filled with the
          clicked date so there's no re-picking it in the next screen. */}
      <Dialog open={!!addMenuDate} onOpenChange={(o) => !o && setAddMenuDate(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {addMenuDate
                ? parseISO(addMenuDate).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : ""}
            </DialogTitle>
            <DialogDescription>
              Add a session to this day. Existing sessions on this day aren't affected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                setUploadDate(d);
              }}
            >
              <Upload className="h-4 w-4 mr-2" /> Upload file(s)
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                // NOTE: pre-filling the date/mode here assumes
                // app.sessions.new.tsx reads these from its search params —
                // worth confirming against that file; if it doesn't yet,
                // the date will just need picking manually on that screen.
                navigate({ to: "/app/sessions/new", search: { date: d, mode: "planned" } as any });
              }}
            >
              <CalendarPlus className="h-4 w-4 mr-2" /> Create Session
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                navigate({ to: "/app/sessions/new", search: { date: d, mode: "manual" } as any });
              }}
            >
              <PencilLine className="h-4 w-4 mr-2" /> Manual Session Entry
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                // Same pre-fill assumption as "Create Session" above — plus
                // dayType, which app.sessions.new.tsx doesn't read from
                // search params yet (it currently only ever defaults to
                // "training"). Until that's wired up, this correctly lands
                // on the new-session form with the date set, but "Day type"
                // still needs picking manually (Race is already one of the
                // existing dropdown options).
                navigate({ to: "/app/sessions/new", search: { date: d, mode: "planned", dayType: "race" } as any });
              }}
            >
              <Trophy className="h-4 w-4 mr-2" /> Add Race
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                setVitalsDate(d);
              }}
            >
              <HeartPulse className="h-4 w-4 mr-2" /> Log Vitals
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload dialog — separate from the menu above so the file picker
          only mounts once a date's actually been chosen. */}
      <Dialog open={!!uploadDate} onOpenChange={(o) => !o && !uploading && setUploadDate(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload files</DialogTitle>
            <DialogDescription>
              Opened from{" "}
              {uploadDate
                ? parseISO(uploadDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                : "this day"}
              {" — "}FIT or GPX. Files recorded close together merge into one session; files more than 90 minutes
              apart (e.g. an AM and a PM run) become separate sessions, dated from each file itself.
            </DialogDescription>
          </DialogHeader>
          <input
            type="file"
            accept=".fit,.gpx"
            multiple
            disabled={uploading}
            onChange={handleCalendarUpload}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          {uploading && <p className="text-xs text-muted-foreground">Uploading and parsing…</p>}
        </DialogContent>
      </Dialog>

      {/* Retrospective vitals — same shape as the Daily Log's own vitals
          fields, just scoped to whatever date was clicked instead of always
          "today", so a missed day can be filled in after the fact. */}
      <Dialog open={!!vitalsDate} onOpenChange={(o) => !o && !savingVitals && setVitalsDate(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Log vitals</DialogTitle>
            <DialogDescription>
              {vitalsDate
                ? parseISO(vitalsDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Sleep hours</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={vSleepHours}
                  onChange={(e) => setVSleepHours(e.target.value)}
                  placeholder="7.5"
                />
              </div>
              <div>
                <Label className="text-xs">Resting HR (bpm)</Label>
                <Input
                  type="number"
                  value={vRestingHr}
                  onChange={(e) => setVRestingHr(e.target.value)}
                  placeholder="52"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Weight (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={vWeightKg}
                onChange={(e) => setVWeightKg(e.target.value)}
                placeholder="64.5"
              />
            </div>
            <div>
              <Label className="text-xs">Hydration: {vHydration}/5</Label>
              <Slider
                min={1}
                max={5}
                step={1}
                value={[vHydration]}
                onValueChange={(v) => setVHydration(v[0])}
                className="mt-2"
              />
            </div>
            <Button onClick={saveVitalsForDay} disabled={savingVitals} className="w-full">
              {savingVitals ? "Saving…" : "Save vitals"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingQuickCopy} onOpenChange={(o) => !o && setPendingQuickCopy(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy this {pendingQuickCopy?.kind}?</DialogTitle>
            <DialogDescription>
              Copies this {pendingQuickCopy?.kind} exactly as-is to the next {pendingQuickCopy?.kind}, starting{" "}
              {pendingQuickCopy?.targetStart}. No progression is applied — this is an exact duplicate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingQuickCopy(null)}>
              Cancel
            </Button>
            <Button onClick={confirmQuickCopy}>Copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// Colours are read from INTENT_BAR/DAYTYPE_BAR — the same two maps that
// actually colour the day cells — rather than being listed again here.
//
// They HAD been listed again here, and had drifted: the legend claimed
// Aerobic was teal and Recovery was sky, when the cells use sky for
// Aerobic and teal for Recovery; and that Race was purple and Anaerobic
// rose, when the cells use pink for Race and purple for Anaerobic. Those
// two pairs were swapped outright, so a coach checking the legend to read
// a bar got the wrong answer. It happened because DAYTYPE_BAR's race and
// recovery values were deliberately changed to stop them colliding with
// anaerobic and aerobic, and this list was never updated to match. Which
// entries appear is still chosen by hand (time_trial has no colour, and
// "training" is the absence of a day type, so neither belongs here) —
// only the colours themselves are now single-sourced.
function Legend() {
  const items: { label: string; cls: string }[] = [
    { label: "Easy", cls: INTENT_BAR.easy },
    { label: "Aerobic", cls: INTENT_BAR.aerobic },
    { label: "Tempo", cls: INTENT_BAR.tempo },
    { label: "Threshold", cls: INTENT_BAR.threshold },
    { label: "VO2", cls: INTENT_BAR.vo2 },
    { label: "Anaerobic", cls: INTENT_BAR.anaerobic },
    { label: "Speed", cls: INTENT_BAR.speed },
    { label: "Race", cls: DAYTYPE_BAR.race },
    { label: "Recovery", cls: DAYTYPE_BAR.recovery },
    { label: "Cross-train", cls: DAYTYPE_BAR.cross_training },
    { label: "Rest", cls: DAYTYPE_BAR.rest },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-3 rounded-sm", i.cls)} /> {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 ml-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /> readiness
      </span>
    </div>
  );
}
