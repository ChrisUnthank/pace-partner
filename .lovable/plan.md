## Problem

After signup the athlete is silently bounced from `/app` to `/app/daily-log` (via `useEffect` in `AppHome` → `/app/today` → `/app/daily-log`). Clicking the **Home** link in the sidebar/bottom nav re-runs the same effect, so athletes can never reach Home.

## Fix

### 1. Remove the auto-redirect
In `src/routes/_authenticated/app.index.tsx`, delete the `useEffect` that calls `navigate({ to: "/app/today" })` for athletes. Home stays on `/app`.

### 2. Render an Athlete Home dashboard
Inside `AppHome`, branch on role:

- **Coach / manager** → existing layout (Welcome row, `DashboardAlertsPanel`, roster, `RecentReviewsCard`) — unchanged.
- **Athlete** → new `<AthleteHome athleteId={athlete.id} />` component (same file, no new route).

`AthleteHome` shows, in this order:

1. **Greeting row** — `UserAvatar` + "Welcome back, {first name}". Same shape used for coaches.
2. **Today snapshot card** — pulls from `daily_vitals` + `daily_checkins` for `todayISO()` and from `athlete_load_daily` for readiness:
   - `ReadinessBadge` (status + score) when present, else "Log your vitals to see readiness".
   - Three small stats: sleep hrs, resting HR, hydration (last logged value or em-dash).
3. **Next session card** — earliest `sessions` row for this athlete with `session_date >= today` and `completed_at is null`. Show date (relative: Today / Tomorrow / day name), title, activity badge, and a `<Link>` to `/app/sessions/$sessionId`. Empty state: "No upcoming sessions scheduled."
4. **Quick actions grid** — 4 large tiled `<Link>`s with icons:
   - Open Daily Log → `/app/daily-log`
   - View Sessions → `/app/sessions`
   - Noticeboard → `/app/noticeboard`
   - Messages → `/app/messages`
5. **Recent notices card** — top 3 from `noticeboard_posts` visible to this athlete (reuse existing query shape from `app.noticeboard.tsx`; title + posted-at + link to `/app/noticeboard`). Empty state: "No recent notices."

Loading states: skeleton rows per card. All queries scoped by `athleteId` and React-Query-keyed so they refresh when the athlete updates vitals or completes a session.

### 3. No route or schema changes
`/app/today` and `/app/vitals` keep their existing redirects to `/app/daily-log` (still useful for old bookmarks). The `_authenticated/app/` layout, nav, and Daily Log page are untouched.

## Files touched
- `src/routes/_authenticated/app.index.tsx` — drop the redirect effect, add `AthleteHome` subcomponent (and small `NextSessionCard` / `TodaySnapshotCard` / `RecentNoticesCard` helpers inline in the same file to keep the change contained).

No new tables, no migrations, no nav changes.
