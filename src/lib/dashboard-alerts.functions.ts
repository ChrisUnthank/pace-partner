import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertType =
  | "atl_spike"
  | "tsb_negative"
  | "injury_flag"
  | "poor_sleep"
  | "high_soreness"
  | "low_feel"
  | "missed_session"
  | "atl_drop"
  | "consecutive_rest"
  | "tsb_positive"
  | "no_session_today"
  | "moderate_feel";

export interface DashAlert {
  alert_type: AlertType;
  severity: AlertSeverity;
  athlete_id: string;
  athlete_name: string;
  athlete_image_url: string | null;
  title: string;
  trigger: string;
  guidance: string;
  actions: { label: string; kind: "link" | "skip_session" | "rest_day"; target?: string; sessionId?: string }[];
  extra?: { note?: string | null };
}

const QUALITY_INTENTS = new Set(["threshold", "vo2", "anaerobic", "speed"]);

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { return isoDate(new Date(Date.now() - n * 86400_000)); }

export const listDashboardAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashAlert[]> => {
    const sb = context.supabase;
    const today = isoDate(new Date());
    const since28 = daysAgo(28);
    const since7 = daysAgo(7);

    const { data: roster } = await sb
      .from("coach_athletes")
      .select("athlete_id, athletes(id, name, profile_image_url, user_id)")
      .eq("coach_user_id", context.userId);
    if (!roster || !roster.length) return [];

    const ids = roster.map((r) => r.athlete_id);

    const [loadRes, ckRes, sessRes, insRes, dismRes] = await Promise.all([
      sb.from("athlete_load_daily").select("athlete_id, load_date, atl, tsb").in("athlete_id", ids).gte("load_date", since28).order("load_date", { ascending: false }),
      sb.from("daily_checkins").select("athlete_id, checkin_date, sleep_quality, soreness, injury_flag, injury_notes").in("athlete_id", ids).gte("checkin_date", since28).order("checkin_date", { ascending: false }),
      sb.from("sessions").select("id, athlete_id, session_date, title, day_type, intent, completed_at").in("athlete_id", ids).gte("session_date", since28).order("session_date", { ascending: false }),
      sb.from("session_insights").select("athlete_id, session_id, feel_score, created_at").in("athlete_id", ids).order("created_at", { ascending: false }).limit(200),
      sb.from("alert_dismissals").select("athlete_id, alert_type").eq("coach_user_id", context.userId).eq("dismissed_date", today),
    ]);
    const load = loadRes.data ?? [];
    const checkins = ckRes.data ?? [];
    const sessions28 = sessRes.data ?? [];
    const insights28 = insRes.data ?? [];

    const dismissed = new Set((dismRes.data ?? []).map((d: any) => d.athlete_id + ":" + d.alert_type));
    const insightsBySession = new Map<string, any>(insights28.map((i: any) => [i.session_id, i]));
    const hourLocal = new Date().getHours();
    const alerts: DashAlert[] = [];

    for (const r of roster) {
      const ath: any = r.athletes;
      if (!ath) continue;
      const athId: string = r.athlete_id;
      const name: string = ath.name ?? "Athlete";
      const img: string | null = ath.profile_image_url ?? null;

      const loadRows = load.filter((x: any) => x.athlete_id === athId);
      const todayLoad = loadRows.find((x: any) => x.load_date === today);
      const sevenAgo = loadRows.find((x: any) => x.load_date === since7);
      const atlToday = todayLoad ? Number(todayLoad.atl ?? 0) : null;
      const atl7 = sevenAgo ? Number(sevenAgo.atl ?? 0) : null;
      const atlDelta = atlToday != null && atl7 != null ? atlToday - atl7 : null;
      const tsb = todayLoad ? Number(todayLoad.tsb ?? 0) : null;

      const cks = checkins.filter((c: any) => c.athlete_id === athId);
      const todayCk = cks.find((c: any) => c.checkin_date === today);

      const sess = sessions28.filter((s: any) => s.athlete_id === athId);
      const todaysPlanned = sess.filter((s: any) => s.session_date === today);
      const todayDone = todaysPlanned.some((s: any) => s.completed_at);

      const push = (a: DashAlert) => {
        if (!dismissed.has(athId + ":" + a.alert_type)) alerts.push(a);
      };

      // CRITICAL
      if (atlDelta != null && atlDelta > 10) {
        push({
          alert_type: "atl_spike", severity: "critical",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "ATL spiking",
          trigger: "ATL +" + atlDelta.toFixed(0) + " over the past 7 days",
          guidance: "Training load has risen sharply this week. Consider reducing intensity or volume in tomorrow's session — swap threshold work for easy running or a rest day.",
          actions: nextSessionActions(sess),
        });
      }
      if (tsb != null && tsb < -20) {
        push({
          alert_type: "tsb_negative", severity: "critical",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "TSB too negative",
          trigger: "TSB " + tsb.toFixed(0),
          guidance: "Athlete is carrying significant accumulated fatigue. Recommend a recovery day or easy session before the next quality effort.",
          actions: nextSessionActions(sess),
        });
      }
      if (todayCk?.injury_flag) {
        push({
          alert_type: "injury_flag", severity: "critical",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Injury flag raised",
          trigger: "Flagged in today's daily log",
          guidance: "Athlete has flagged a niggle or injury — see their note below. Review and consider modifying this week's sessions before the issue worsens.",
          actions: [
            { label: "View daily log", kind: "link", target: "/app/athletes/" + athId },
            ...nextSessionActions(sess),
          ],
          extra: { note: todayCk.injury_notes ?? null },
        });
      }
      const sleepStreak = consecutiveFromToday(cks, today, (c: any) => (c.sleep_quality ?? 99) <= 2);
      if (sleepStreak >= 3) {
        push({
          alert_type: "poor_sleep", severity: "critical",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Poor sleep trend",
          trigger: "Sleep quality ≤2 for " + sleepStreak + " days",
          guidance: "Athlete has reported poor sleep for " + sleepStreak + " consecutive days. Recovery is likely compromised — consider reducing session intensity until sleep improves.",
          actions: [...nextSessionActions(sess, { onlyModify: true }), { label: "Message", kind: "link", target: "/app/messages" }],
        });
      }

      // WARNING
      const soreStreak = consecutiveFromToday(cks, today, (c: any) => (c.soreness ?? 0) >= 4);
      if (soreStreak >= 2) {
        push({
          alert_type: "high_soreness", severity: "warning",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "High soreness",
          trigger: "Soreness ≥4 for " + soreStreak + " days",
          guidance: "Persistent soreness reported for " + soreStreak + " days. Consider a recovery session or full rest before the next quality effort.",
          actions: nextSessionActions(sess),
        });
      }
      const lastQuality = sess.find((s: any) => s.completed_at && QUALITY_INTENTS.has(s.intent));
      const lastFeel = lastQuality ? insightsBySession.get(lastQuality.id) : null;
      if (lastQuality && lastFeel?.feel_score != null && lastFeel.feel_score <= 3) {
        push({
          alert_type: "low_feel", severity: "warning",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Low session feel score",
          trigger: "Feel " + lastFeel.feel_score + "/10 on " + (lastQuality.title ?? "quality session"),
          guidance: "Athlete rated their last quality session very poorly. Monitor closely — if soreness follows, reduce the next session's intensity.",
          actions: [
            { label: "View session", kind: "link", target: "/app/sessions/" + lastQuality.id },
            ...nextSessionActions(sess, { onlyModify: true }),
          ],
        });
      }
      const missed = sess.find((s: any) =>
        !s.completed_at && s.session_date < today && s.session_date >= daysAgo(14) && s.day_type !== "rest",
      );
      if (missed) {
        push({
          alert_type: "missed_session", severity: "warning",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Missed planned session",
          trigger: "Not completed on " + missed.session_date,
          guidance: "A planned session was not completed today. Update the session status and consider whether the coming week needs adjusting.",
          actions: [
            { label: "Mark as skipped", kind: "skip_session", sessionId: missed.id },
            { label: "Open session", kind: "link", target: "/app/sessions/" + missed.id },
          ],
        });
      }
      if (atlDelta != null && atlDelta < -8) {
        push({
          alert_type: "atl_drop", severity: "warning",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "ATL dropping sharply",
          trigger: "ATL " + atlDelta.toFixed(0) + " over the past 7 days",
          guidance: "Training load has dropped significantly this week. Confirm this is a planned taper or recovery week — if not, check athlete availability.",
          actions: [
            { label: "View training", kind: "link", target: "/app/athletes/" + athId },
            { label: "Message", kind: "link", target: "/app/messages" },
          ],
        });
      }
      const restStreak = consecutiveRestDays(sess, today);
      if (restStreak >= 3) {
        push({
          alert_type: "consecutive_rest", severity: "warning",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Consecutive rest days",
          trigger: restStreak + " days without a logged session",
          guidance: "Athlete has had " + restStreak + " consecutive days without a logged session. Confirm this is planned — if not, follow up with the athlete.",
          actions: [
            { label: "View calendar", kind: "link", target: "/app/sessions/calendar" },
            { label: "Message", kind: "link", target: "/app/messages" },
          ],
        });
      }

      // INFO
      if (tsb != null && tsb > 25) {
        push({
          alert_type: "tsb_positive", severity: "info",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "TSB very positive",
          trigger: "TSB +" + tsb.toFixed(0),
          guidance: "Athlete appears under-loaded relative to recent fitness. Consider adding a session or increasing volume if health and schedule allow.",
          actions: [
            { label: "View training", kind: "link", target: "/app/athletes/" + athId },
            { label: "Add session", kind: "link", target: "/app/sessions/new" },
          ],
        });
      }
      if (hourLocal >= 19 && todaysPlanned.length && !todayDone) {
        push({
          alert_type: "no_session_today", severity: "info",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "No session logged today",
          trigger: todaysPlanned.length + " planned, none completed",
          guidance: "No session has been logged today and a session was planned. Check whether it was completed or skipped.",
          actions: [
            { label: "View session", kind: "link", target: "/app/sessions/" + todaysPlanned[0].id },
            { label: "Message", kind: "link", target: "/app/messages" },
          ],
        });
      }
      if (lastQuality && lastFeel?.feel_score != null && lastFeel.feel_score > 3 && lastFeel.feel_score <= 5) {
        push({
          alert_type: "moderate_feel", severity: "info",
          athlete_id: athId, athlete_name: name, athlete_image_url: img,
          title: "Moderate session feel score",
          trigger: "Feel " + lastFeel.feel_score + "/10 on " + (lastQuality.title ?? "quality session"),
          guidance: "Athlete found their last quality session moderately difficult. Keep an eye on soreness and fatigue over the next 48 hours.",
          actions: [{ label: "View session", kind: "link", target: "/app/sessions/" + lastQuality.id }],
        });
      }
    }

    const sevRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) =>
      sevRank[a.severity] - sevRank[b.severity] || a.athlete_name.localeCompare(b.athlete_name),
    );
    return alerts;
  });

function nextSessionActions(sess: any[], opts?: { onlyModify?: boolean }): DashAlert["actions"] {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sess
    .filter((s) => !s.completed_at && s.session_date >= today)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))[0];
  if (!upcoming) return [];
  const a: DashAlert["actions"] = [
    { label: "Modify session", kind: "link", target: "/app/sessions/" + upcoming.id },
  ];
  if (!opts?.onlyModify) a.push({ label: "Mark rest day", kind: "rest_day", sessionId: upcoming.id });
  return a;
}

function consecutiveFromToday(rows: any[], today: string, predicate: (r: any) => boolean) {
  let n = 0;
  const cursor = new Date(today);
  for (let i = 0; i < 14; i++) {
    const d = cursor.toISOString().slice(0, 10);
    const row = rows.find((r: any) => r.checkin_date === d);
    if (!row || !predicate(row)) break;
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

function consecutiveRestDays(sess: any[], today: string) {
  let n = 0;
  const cursor = new Date(today);
  for (let i = 0; i < 14; i++) {
    const d = cursor.toISOString().slice(0, 10);
    const has = sess.some((s: any) => s.session_date === d && (s.completed_at || s.day_type !== "rest"));
    if (has) break;
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export const dismissAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; alertType: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("alert_dismissals").insert({
      coach_user_id: context.userId,
      athlete_id: data.athleteId,
      alert_type: data.alertType,
    });
    if (error && !error.message.includes("duplicate")) throw error;
    return { ok: true };
  });

export const markSessionRestDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sessions")
      .update({ day_type: "rest", intent: null, structure: null, title: "Rest day" })
      .eq("id", data.sessionId);
    if (error) throw error;
    return { ok: true };
  });

export const markSessionSkipped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sessions")
      .update({ day_type: "rest", title: "Skipped" })
      .eq("id", data.sessionId);
    if (error) throw error;
    return { ok: true };
  });
