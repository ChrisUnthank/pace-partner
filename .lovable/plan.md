## Plan: Stabilize session workflow + single source of truth

### Goals
- One canonical session row and one set of interval result rows drive every screen.
- Warm Up / Work / Cool Down values persist across navigation and refresh.
- Completed sessions remain editable; edits recompute everything downstream.
- Session List stays stable; weekly volume reflects completed totals.
- Activity icons (already working) untouched.

### Single source of truth

- **`public.sessions`** row owns: `total_distance_m`, `total_time_seconds`, `avg_hr`, `max_hr`, `rpe`, `completion_pct`, `completed_at`.
- **`public.interval_results`** rows own per-rep actuals (distance, time, HR, cadence, stride).
- Derived data (`session_zone_time`, `session_fatigue`, `athlete_load_daily`, `athlete_weekly_distance`, `athlete_zone_time_weekly`) is recomputed from those two by database triggers — never recomputed in the client.
- All screens (Session Details, View Analysis, Session List, Dashboard, Athlete Profile, Weekly Volume, Analytics) read from the same `sessions` + `interval_results` data through the same React Query keys, and share one invalidation helper.

### Root causes being fixed

1. **Rep inputs blank after navigating away** — `RepRow` initializes local state once on mount, before `interval_results` finishes loading; never syncs when data arrives.
2. **Saves silently drop on race** — current insert-vs-update branch reads stale `results`; can also bypass a unique key.
3. **Stale Session Details after rep edits** — only `["results"]`, `["fatigue"]`, `["zone-time"]` are invalidated; the `["session", id]` row that holds totals/RPE/completion isn’t refreshed.
4. **Session List flicker → empty** — visible-athlete query caches an empty array before roles/athlete hooks resolve; downstream sessions query then runs with no IDs.
5. **Totals not clearing on full delete** — `recompute_session_totals` early-returns when no logged rows exist, leaving stale `total_distance_m` / `total_time_seconds`.
6. **Weekly volume mixes planned/actual** — current view falls back to planned step distance; should reflect completed actuals only.

### Implementation

**Step A — Database (one migration)**
- Add unique constraint on `interval_results (step_id, set_number, rep_number)` so upserts are safe and duplicates are impossible.
- Rewrite `recompute_session_totals(_session_id)` so when zero logged rows remain it clears `total_distance_m`, `total_time_seconds`, `avg_hr`, `max_hr` (instead of leaving stale values). Keep weighted avg HR and max HR logic.
- Ensure the trigger fires on `INSERT/UPDATE/DELETE` (already does) and that `compute_session_completion` runs on the same events.
- Rewrite `athlete_weekly_distance` view to use `sessions.total_distance_m` for completed sessions, with `SUM(interval_results.actual_distance_m)` only as fallback when totals are NULL; ignore non-completed sessions.
- Backfill: re-run `recompute_session_totals` and `compute_session_completion` for all existing sessions.

**Step B — Detail page hydration & saves** (`src/routes/_authenticated/app.sessions.$sessionId.index.tsx`)
- Replace the once-on-mount `useState` initializers in `RepRow` and `SessionSummary` with `useEffect` syncs that update local state whenever the fetched `result` / `session` row changes (using a stable key like `result?.id` / `session.updated_at`).
- Render a skeleton for step blocks while results are still loading instead of blank inputs.
- Replace the `saveRep` insert/update branch with a single `upsert` on `(step_id, set_number, rep_number)`.
- Surface save errors via `toast.error` and rollback local state on failure.
- After any rep save, totals save, RPE save, or delete, call a shared `invalidateSession(qc, sessionId, athleteId)` helper that invalidates: `["session", id]`, `["steps", id]`, `["results", id, ...]`, `["fatigue", id]`, `["zone-time", id]`, `["sessions-list"]`, `["athlete-sessions", athleteId]`, `["weekly-distance", athleteId]`, `["analytics-*", athleteId]`, `["roster-readiness"]`, `["home-next-session", athleteId]`, `["volume-by-date", athleteId]`.
- Keep `SessionSummary` editable regardless of `completed_at`; “Update totals & RPE” updates only the entered fields, never recreating the session row.

**Step C — Analysis page alignment** (`app.sessions.$sessionId.analysis.tsx`)
- Use the exact same query keys as Detail for `session`, `steps`, `results`, `zone-time`, `fatigue` so navigating between them never refetches a different shape.
- Display totals directly from the shared `session` row (already does); remove any local recomputation.

**Step D — Session List stability** (`app.sessions.index.tsx`)
- Gate `visible-athlete-ids` on `useMyRoles`/`useMyAthlete` being loaded (not just `user`). Include role + athlete IDs in the query key.
- Disable the sessions query (`enabled`) until the visible-athlete query has succeeded, so we never query with an empty list and cache “no sessions”.
- Show explicit loading vs empty states.
- Subscribe to the same invalidation helper from Step B.

**Step E — Daily Log RPE consistency** (`src/components/daily-log-sessions.tsx`)
- When saving a daily-log session, also write `rpe = feel` to the `sessions` row so session load recalculates server-side.
- Invalidate the same shared keys.

**Step F — Verification (must complete before closing)**
1. Create new session with WU/Work/CD values; save.
2. Detail → Analysis → Detail; values still present.
3. Browser refresh; values still present.
4. Edit completed session (change a rep, change RPE, change totals). Confirm totals, RPE, completion %, session load, zone time, fatigue, weekly volume, dashboard alerts, analytics totals all update.
5. Delete all interval rows; confirm session totals clear (not stale).
6. Session List shows the session after refresh and remains stable (no flicker to empty).
7. Dashboard, Analytics, Athlete Profile and Session Details show identical totals for the same session.
8. Confirm no duplicate `interval_results` rows are created by repeated saves (unique constraint enforces this).
9. Confirm icons unchanged.

### Files changed

- `supabase/migrations/<new>.sql` — unique constraint, rewritten `recompute_session_totals`, rewritten `athlete_weekly_distance` view, backfill.
- `src/lib/session-invalidation.ts` — new shared helper.
- `src/routes/_authenticated/app.sessions.$sessionId.index.tsx` — hydration sync, upsert, error toasts, shared invalidation, always-editable summary.
- `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx` — aligned query keys.
- `src/routes/_authenticated/app.sessions.index.tsx` — load gating + stable empty/loading states.
- `src/components/daily-log-sessions.tsx` — write RPE + shared invalidation.

No changes to activity icons, navigation, auth, or unrelated features.