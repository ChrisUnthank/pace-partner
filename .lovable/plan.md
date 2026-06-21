## Confirmation (plain English)

**Fatigue & zone-time:** Already computed per-step (`session_fatigue` row per work step, `session_zone_time` aggregated across all reps regardless of which work step they belong to). Multiple Work steps in one session will each get their own independent fatigue score — same behavior as the multi-step sessions from earlier work, no recompute changes needed. Zone-time will simply sum across both Work blocks, which is correct.

**Existing test sessions:** Purely additive. No data migration for ordering — existing rows already have `step_order` and will render in order. The only schema change is adding distance-recovery columns for the in-step recovery (nullable, no backfill needed). Existing sessions that only used seconds keep working unchanged.

**Distance-based in-step recovery storage:** Mirror the pattern already used by the standalone Recovery step. Add `recovery_between_reps_target_kind` ('time'|'distance'), `recovery_between_reps_distance_m`, and matching `recovery_between_sets_*` columns. The existing `recovery_between_reps_seconds` / `recovery_between_sets_seconds` columns remain authoritative when target_kind='time'. Nothing else in the app currently reads the in-step recovery fields for load/zone/fatigue math (verified: `session_training_load` uses session-level RPE+duration; `compute_session_fatigue` reads `interval_results.actual_time_seconds`; `recompute_session_zones` reads `interval_results` + `steps.kind`/`counts_toward_distance` only). So adding distance recovery is a pure builder-UI + display concern — no calculation code needs to interpret it.

---

## Plan

### A. Schema (one migration)
Add to `public.steps`:
- `recovery_between_reps_target_kind` text ('time'|'distance'), default 'time'
- `recovery_between_reps_distance_m` integer, nullable
- `recovery_between_sets_target_kind` text ('time'|'distance'), default 'time'
- `recovery_between_sets_distance_m` integer, nullable

Mirror the same four columns on `public.template_steps` so templates round-trip distance recovery.

No data backfill (defaults handle it). No changes to triggers/functions.

### B. Session builder (`app.sessions.new.tsx`)

**Ordering model:**
- Internal state stays a flat `steps[]` array. Warmup is always index 0; Cooldown is always the last index. The "middle" slice (indices 1..n-2) holds any number of Work and standalone Recovery steps in user-defined order.
- "Add Work" and "Add Recovery" buttons insert the new step at `length - 1` (just before Cooldown).
- Drag-and-drop reordering on the middle slice only. Use `@dnd-kit/core` + `@dnd-kit/sortable` (lightweight, already-common shadcn-compatible). Warmup card and Cooldown card render outside the sortable context with a small "anchored" badge so they visually can't be picked up.
- Up/down arrow buttons as a keyboard-accessible fallback on each middle step.

**Standalone Recovery step relabel:**
- Card title: "Recovery between blocks"
- Helper text under title: "Easy effort between separate Work blocks (e.g. 90s jog between a threshold block and a speed block). For recovery between reps or sets inside a single Work block, use the fields inside that Work step."
- Disable / hide the "Add Recovery between blocks" button when there are fewer than 1 Work steps before the insertion point (soft guard — still allow it, just show a muted hint).

**In-step recovery (inside Work step) gains Time/Distance toggle:**
- Two existing sub-sections ("Recovery between reps" and "Recovery between sets") each get a Time/Distance segmented toggle matching the standalone Recovery UI.
- When 'time' → show seconds input (existing). When 'distance' → show metres input.
- Mode select (standing/walk/jog/float) stays visible for both.
- Persist new fields on save; read them back when loading from template / existing session.

**Insert position:** New Work / new standalone Recovery is inserted at `steps.length - 1` (right before Cooldown), which matches "after the currently-last middle step".

### C. Display surfaces (read-only)
`app.sessions.$sessionId.tsx` already iterates `steps` in `step_order`. Update the step renderer to:
- Show distance-based in-step recovery as "jog 100m" when `recovery_between_reps_target_kind='distance'`.
- Show standalone Recovery step's heading as "Recovery between blocks".

No changes needed in `app.today.tsx` summary line, fatigue card, zone-time card, or load math.

### D. Templates round-trip
`src/lib/templates.ts` — extend `STEP_STRUCTURAL_COLS` to include the four new columns so save-as-template and apply-template carry distance recovery through.

### E. Verification
1. Create a session with two Work blocks + one Recovery-between-blocks in the middle, reorder via drag, save, reload → step_order persists.
2. Create a Work step with `recovery_between_reps_target_kind='distance'`, recovery_between_reps_distance_m=100, save → session detail renders "jog 100m"; fatigue + zone-time for the session still compute as before.
3. Save such a session as a template, apply to another athlete → distance recovery and ordering are preserved.

### Out of scope
- No changes to `interval_results` (logging still records `actual_time_seconds` regardless of whether the planned recovery was a distance or a time — distance recovery is a planning instruction, not a measured field).
- No changes to load/readiness/zone/fatigue functions.
- No reordering of warmup/cooldown (anchored).
