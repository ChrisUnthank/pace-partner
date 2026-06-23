## Phase B3 — Implementation plan

7 items grouped by surface area. Each item gets its own commit-sized change. No item touches the session-workflow code path stabilized in B1/B2.

### 4 — Analytics date range
- Add custom date-range option to the existing `RangePicker` (alongside 4w/3m/6m/all).
- Extend `searchSchema` with optional `from`/`to` ISO dates; when present they override the preset.
- Reuse existing `analytics-*` queries by feeding `since`/`until` into their query keys.
- Add a small popover with two `<input type="date">` controls.

### 7 — `time_trial` session-type wiring
- Add `time_trial` to the session-type enum used by `app.sessions.new.tsx`, `session-categories.ts`, and the activity-icon switch (use existing `Timer` icon).
- Treat a time-trial like a single `work` step but mark `intent='race_pace'` and surface a "Distance / Target time" pair in the new-session form.
- Show "Time Trial" badge on Session List and Session Detail headers via `sessionClassificationLabel`.
- On completion, the existing `recompute_session_totals` already covers it — no DB change.

### 11 — Coach Sessions page
- New route `/_authenticated/app/coach/sessions.tsx` (coach + manager only).
- Lists every session across the coach's athletes, default sort by `session_date` desc.
- Filters: athlete (multi-select), status (planned/completed), date range.
- Reuses `sessions-list` query shape with `in('athlete_id', ids)`; links each row to existing session detail.
- Adds a left-nav entry in `app-shell.tsx` shown only when `useMyRoles().includes('coach')`.

### 15 — Bulk FIT upload
- New `BulkFitUpload` component on `/app/sessions` (coach + athlete).
- Accepts multiple `.fit` files; for each: create a `sessions` row (athlete = current selection / self) and upload to `session_files` bucket, then call existing FIT-parser server fn one at a time, surfacing per-file progress and errors.
- No new server fn — drives the existing single-file parser in a loop with `Promise.allSettled`.

### 16 — Race results UI
- New route `/_authenticated/app/races.tsx` listing rows from `performances` (already exists).
- Form to add a result: event, distance, time, date, placing, notes.
- Edit + delete with confirm dialog.
- Surface PBs (best time per event) on athlete profile page (`app.athletes.$athleteId.tsx`) via a small "Personal Bests" card.

### 17 — Units & timezone UI
- Add `units` (`metric` | `imperial`) and `timezone` columns to `profiles` (migration with GRANTs).
- Build a Settings section under `/app/profile` with a unit toggle and an IANA timezone select (default to `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Helper `src/lib/units.ts` reads from a React Query `["my-profile"]` cache and exposes `formatDistance`, `formatPace`, `formatTime` that honour the chosen units.
- Migrate the most user-visible formatters in `format.ts` to call the helpers; remaining surfaces stay metric until later.

### 19 — Join requests UI + invite-existing-account flow
- Coach-side: new "Join requests" tab on `/app/athletes` listing `athlete_join_requests` rows, with Accept (creates `coach_athletes`, marks request `accepted`) / Decline buttons.
- Athlete-side: button on `/app/profile` → "Request to join a coach" with coach-email lookup.
- Invite-existing-account: extend the existing `athlete_invites` flow so when the invited email already has an account, accepting the invite immediately creates the `coach_athletes` row instead of provisioning a new athlete.

### Files touched (estimate)
- New: `src/routes/_authenticated/app.coach.sessions.tsx`, `src/routes/_authenticated/app.races.tsx`, `src/components/bulk-fit-upload.tsx`, `src/lib/units.ts`.
- Edited: `app.analytics.tsx`, `app.sessions.new.tsx`, `app.sessions.index.tsx`, `app.athletes.index.tsx`, `app.athletes.$athleteId.tsx`, `app.profile.tsx`, `app-shell.tsx`, `session-categories.ts`, `activity-icon.tsx`, `format.ts`.
- Migrations: one for `profiles.units/timezone` + GRANTs; one to ensure `time_trial` enum value exists.

### Order of execution
1. Migrations (units/timezone, time_trial enum).
2. Units helper + profile settings UI (#17).
3. time_trial wiring (#7).
4. Analytics date range (#4).
5. Coach sessions page (#11).
6. Race results page + PB card (#16).
7. Join requests + invite-existing flow (#19).
8. Bulk FIT upload (#15) — last because it depends on existing parser shape.

### Verification (after each item)
- Build passes.
- Targeted Playwright check for the new screen renders without console errors.
- For #17 and #19, confirm RLS policies + GRANTs let the right roles read/write.

No changes to session workflow files stabilized in B1/B2 except adding the `time_trial` icon variant.