Plan:

1. Fix the remaining broken analysis toggle
- The earlier fix did not catch the calendar sheet's `Analysis` button.
- Actual issue found: `app.sessions.calendar.tsx` still has invalid nested interactive markup: `<Link><Button>Analysis</Button></Link>`.
- I'll change it to the valid `Button asChild` pattern so the route click reliably reaches `/app/sessions/$sessionId/analysis`.
- I'll also fix the adjacent `+ New session` button in the same sheet because it has the same invalid pattern.

2. Fix the missing work data on the current analysis page
- Actual issue found in the database for the session you were viewing: `a06c3f65-77aa-4fb1-89e4-176afb39e84f` (`[TEST] Maya Okafor · Easy run`).
- It has one work rep row, but the row is incomplete:
  - pace exists: `260 sec/km`
  - time, distance, HR avg/end, cadence, stride length are all null.
- Because time is null, the zone/fatigue functions correctly skip it (they require `actual_time_seconds > 0` and explicit non-null checks per metric — confirmed in `recompute_session_zones` and `compute_session_fatigue`), so the graph and zone panels have nothing meaningful to render. No silent default to "Easy" is happening — missing data is correctly skipped/null.

3. Reseed incomplete test rep rows with realistic complete values
- Sweep all `[TEST]` completed sessions and, for any work rep row missing per-rep values, fill realistic numbers consistent with the session totals and athlete's zones (time, distance, HR avg, HR end, cadence, stride length).
- Only seeded `[TEST]` athlete data is touched — no real user data.

4. Recompute derived analysis data
- After the data repair, call the existing `recompute_session_zones` and `compute_session_fatigue` functions on each affected session so `session_zone_time` and `session_fatigue` are repopulated.

5. Verify and report back
- Verify the analysis link works from the calendar sheet and the session detail view.
- Verify the current Easy run analysis page now has graph points and zone rows.
- Report root causes plainly: one remaining invalid nested Link/Button in the calendar sheet, plus incomplete seeded rep rows causing correct skip/null behavior on the analysis screen.