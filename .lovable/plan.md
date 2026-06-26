## Goal

Make uploaded sessions behave like manual sessions, regardless of how many files were attached or in what order. Add a full chronological splits table on the analysis page (warmup → work → recovery → cooldown), while preserving the existing rep table, zone panels, trace graph, map, and HR-recovery features.

## What's wrong today

`uploadAndParseSessionFile` only ever looks at the file *just uploaded*. Steps and `interval_results` are rebuilt from that one file's laps, so:
- A 2nd or 3rd file replaces the structure created by the 1st.
- Upload order changes the final shape (warmup-first vs workout-first vs cooldown-first).
- `raw_session_points` from earlier files keep their own `elapsed_s` origin, so the combined trace is out of order on the analysis page.
- The session-detail UI sometimes goes blank because `steps` get wiped and re-inserted with the wrong totals.

The existing rep breakdown also pulls from `interval_results` only, so recovery segments never appear in a splits table.

## Plan

### 1. Single source of truth: `rebuildSessionFromAllFiles(sessionId)`

Extract a new internal helper in `src/lib/session-files.functions.ts`. After every upload (and after `deleteSessionFileBlock`), call it. It:

1. Loads all rows from `session_files` for the session, ordered by `started_at` (nulls last → fall back to `created_at`).
2. Re-downloads each file from storage and re-parses it (`parseFIT` / `parseGPX`) — we already have these parsers; nothing else changes about them.
3. Computes a global anchor = earliest `startedAt` across files.
4. Builds a single merged `points[]` with `elapsed_s = (point.timestamp - anchor) / 1000`, tagged with `file_id`. Sorts ascending.
5. Builds a single merged `laps[]` with absolute `startMs`/`endMs`, sorted ascending.
6. Runs the existing `classifyLaps` + `buildWorkRecoveryPairs` on the merged laps so warmup/work/recovery/cooldown comes from the actual chronology, not the file boundary.
7. Wipes and rewrites derived rows for the session in one transaction-shaped sequence:
   - `DELETE raw_session_points WHERE session_id = $1`
   - `DELETE interval_results WHERE step_id IN (SELECT id FROM steps WHERE session_id = $1)`
   - `DELETE steps WHERE session_id = $1` (only when `is_planned = false`, i.e. no manual plan).
   - Re-insert merged `raw_session_points` (with `segment_type` from the merged classification).
   - Re-insert `steps` (warmup / work / cooldown) and `interval_results` for the work step from the merged pairs.
   - For manually planned sessions: keep `steps` untouched, only wipe + rewrite `interval_results` using the existing `buildIntervalRowsFromPlan` against the merged pairs.
8. Updates `sessions` totals (`total_distance_m`, `total_time_seconds`, `avg_hr`, `max_hr`, `work_*`, `structure`, `completion_pct = 100`) from the merged data — not from a single file row.
9. Detects between-set recovery: any recovery lap whose duration ≥ `1.75 × median(recovery)` ends a set; emit a `kind = 'recovery'` step between work blocks (this matches the existing `splitWorkPairsIntoBlocks` logic, just reused on merged data). Between-rep recoveries stay on the work step's `recovery_between_reps_*` fields.

`uploadAndParseSessionFile` becomes: validate → upload file to storage → insert `session_files` row → call `rebuildSessionFromAllFiles(sess.id)` → return. `deleteSessionFileBlock` already exists; after delete it calls the same helper (or clears the session if zero files remain).

Error handling: every `insert` / `update` keeps `throw` on error. If after rebuild there are 0 steps when ≥1 file is attached and parsed successfully, throw.

### 2. Chronological splits table on the analysis page

New component in `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx` (or a small sibling file), rendered above the existing rep breakdown.

- Source: `raw_session_points` for the session, sorted by `elapsed_s`.
- Group rows by `segment_type`, starting a new group every time `segment_type` changes.
- For each group compute: split #, type, duration, distance (last `distance_m` − first), avg pace, max pace (min `pace_sec_per_km` over the group), avg HR, max HR, avg cadence, max cadence, elevation gain/loss (sum of positive/negative deltas).
- Display blank/em-dash for missing metrics.
- Row tint by `segment_type`:
  - work → `bg-red-50`
  - recovery → `bg-slate-50`
  - warmup → `bg-blue-50`
  - cooldown → `bg-emerald-50`
  - strides → `bg-amber-50`

Colors match the existing graph shading utility so the table reads the same way as the chart.

The existing rep table (HR end / HR rec / HR drop) stays exactly as is, below the new splits table.

### 3. Preserve existing analysis features

No changes to:
- Trace mode rendering, MapPanel WebGL fallback, zone panels, `session_zone_time` queries, `compute_session_fatigue`, HR recovery panel.
- `interval_results` columns (rep table still uses them).
- Manual session builder.

Trace vs rep vs empty selection already follows the order in the existing analysis page; with merged `raw_session_points` it will now show the combined chart automatically.

### 4. Acceptance checks (run with Playwright after build)

1. Upload one FIT → session detail populated, steps present, analysis trace + zone + rep table all render.
2. Upload warmup FIT, then workout FIT, then cooldown FIT → final structure is warmup → work → cooldown regardless of order.
3. Upload in reverse order (cooldown → workout → warmup) → identical final structure.
4. New chronological splits table renders with the expected row colors and includes recovery rows.
5. Delete the workout file → session reconstructs from remaining files; deleting the last file clears the session derived data.

## Technical notes (skim if not technical)

- New helper lives in `src/lib/session-files.functions.ts` and is invoked from the existing server function — no new server fn surface, no new types regeneration needed.
- `raw_session_points.segment_type` already constrains to `warmup|work|recovery|cooldown`; "strides" rows can be tagged `work` in the DB and styled separately in the UI only if/when strides detection is added (out of scope for this pass — splits table will simply show `work`).
- All deletes/inserts use the authenticated supabase client from middleware so RLS applies.
- No schema migration required.
