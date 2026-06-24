## Implementation — Option (a) for imported FIT/GPX sessions

Single file change: `src/lib/session-files.functions.ts` → `uploadAndParseSessionFile.handler`.

No SQL migration. All target columns already exist (`sessions.total_distance_m`, `total_time_seconds`, `avg_hr`, `max_hr`, `completion_pct`; `steps.*`; `interval_results.*`).

### Changes inside the handler

1. **Reuse session when `data.sessionId` is supplied.**
   - Replace the unconditional `insert` with: if `data.sessionId` → `select * from sessions where id = sessionId` and use that row; else keep current insert path. Throws if the supplied id is not found.

2. **Write totals to the columns the UI actually reads.**
   - In the post-points update, add `total_distance_m`, `total_time_seconds`, `avg_hr`, `max_hr`, `completion_pct: 100`.
   - Keep all existing `work_*` writes (legacy panels).
   - `avg_hr` = mean of point HRs; `max_hr` = max of point HRs.

3. **Synthesise one `steps` + one `interval_results` row** (only when the session has no existing steps — protects planned sessions).
   - `steps`: `step_order=1, kind='work', reps=1, set_count=1, target_kind = totalDistanceM>0 ? 'distance' : 'time', target_distance_m`, `target_time_seconds`, `counts_toward_distance=true`.
   - `interval_results`: `set_number=1, rep_number=1, actual_time_seconds, actual_distance_m, actual_pace_sec_per_km, hr_avg, hr_max, cadence`.
   - This lights up: detail rep grid, Work segment breakdown, Time-in-zone, Per-step fatigue, Completion %, Analytics "Volume by Session Component".
   - The existing triggers `trg_recompute_totals_from_rep`, `trg_recompute_completion_from_rep`, `trg_recompute_zones_from_rep` then fire automatically — values they recompute will match what we just wrote.

4. **`raw_session_points` left untouched** (per spec).

### Out of scope this pass

- 1W / custom `to` analytics range, VO/GCT manual inputs, Time Trial wiring through builder+importer, "Step Kind" → "Session Component" relabel. Tracked but not changed here.

### Files touched

- `src/lib/session-files.functions.ts` only.

### Acceptance checks I will run after the edit

1. Bulk-upload a FIT → new session row has non-null `total_*`, `avg_hr`, `max_hr`, `completion_pct=100`.
2. Session detail page shows Duration, Distance, Avg HR populated, completion badge 100%.
3. Analysis page Totals card + Work segment breakdown render with the imported values.
4. Analytics → Volume by Session Component shows a "Work" entry for the imported session.
5. Upload via daily-log with an explicit `sessionId` → no duplicate `sessions` row created; existing planned session is enriched.
