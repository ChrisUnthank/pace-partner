## Immediate Fixes Batch (do before Phase 1.5)

Decisions locked from earlier in this turn:
- Insights = **one shared table** (`session_insights`), reused by Checkout in 1.5b
- Vitals = **new `daily_vitals` table** (separate from `daily_checkins`)
- Weight = **vitals-latest, fallback to `athletes.weight`**
- View Analysis toggle = **graceful empty state** until 1.5c rebuilds it

---

### Fix 1 — HR zone bands: VERIFIED, NO ACTION

Checked all 5 athletes' `athlete_zone_profiles`:
- Current values already match 60/70/80/90% of HRmax exactly.
- `recompute_athlete_zone_profile` already uses `0.60 / 0.70 / 0.80 / 0.90` multipliers.

The brief's premise (~72/82/88/94%) does not match the database. No migration, no trigger change. Flagging so you can confirm I'm not looking at the wrong column — if you saw 72/82/88/94% somewhere in the UI, that was a display bug, not the stored value, and Fix 2's HR Zones panel will display the correct figures by default.

### Fix 2 — Athlete profile additions

In `src/routes/_authenticated/app.athletes.$athleteId.tsx`, add three panels above the existing PhysiologyCard:

**IdentityCard** (top): name, DOB → "31 yrs", primary event, training age, weight. Weight resolution: latest `daily_vitals.weight_kg` if present, else `athletes.weight`, else "not yet logged".

**HR Zones panel**: 5-row table Z1–Z5 with `≤ value bpm` ranges from `athlete_zone_profiles`. Anchor caption: "HRmax: 188 bpm". Z5 row labelled `> Z4 max`.

**Pace Zones panel**: 5-row table Z1–Z5 with mm:ss/km ranges derived from `pace_5k_sec_per_km` using the same offsets the zone-classification code already uses (+90 / +45 / +15 / −14). Anchor caption: "5K pace: 3:42 /km".

**Thresholds strip** (between the two zone panels): two big tiles — "Threshold HR · 169 bpm (90% HRmax)" and "Threshold Pace · 3:57 /km (5K + 15s)".

All read-only, dark-grid styling, no schema changes.

### Fix 3 — Volume column on Training Load list

In the 14-day training load list, add **Volume (km)** as the first data column before Load.
- Completed sessions: `SUM(interval_results.actual_distance_m)` per session ÷ 1000, 1dp.
- Planned: target distance summed from `steps`.
- Neither: "—".
- Computed in the existing query (no new RPC).

### Fix 4A — Vitals (new table + page)

Migration: new `daily_vitals` table.

```
daily_vitals (
  id uuid pk, athlete_id uuid fk, vitals_date date,
  sleep_hours numeric(3,1), resting_hr int, weight_kg numeric(4,1),
  hydration smallint check 1..5,
  recovery_modalities text[],   -- 'physio'|'massage'|'sauna'|'compression'|'ice_bath'|'other'
  external_notes text,
  created_at, updated_at,
  unique (athlete_id, vitals_date)
)
```
+ standard GRANTs (`authenticated`, `service_role`), RLS scoped via `can_access_athlete()`, `updated_at` trigger.

UI:
- New route `/app/vitals` (athlete) and embedded panel on athlete detail (coach view).
- Single-day form with the 6 fields; upserts on `(athlete_id, vitals_date)`.
- Trend chart: line chart for each numeric metric (sleep hrs, RHR, weight, hydration) over selected range (default last 30 days).
- Soft daily prompt on `/app/today` if no row exists for today — dismissible.
- `daily_checkins` is untouched (subjective wellness stays there; objective vitals here).

### Fix 4B — Post-session insight

Migration: new `session_insights` table (this is the shared one Checkout 1.5b will reuse).

```
session_insights (
  id uuid pk, session_id uuid fk unique, athlete_id uuid fk,
  feel_score smallint check 1..10,
  went_well text, was_difficult text, niggles text,
  end_of_day_note text,        -- nullable; used by Checkout in 1.5b
  created_at, updated_at
)
```
+ GRANTs, RLS via `can_access_athlete()`, `updated_at` trigger.

UI:
- Modal that appears immediately after an athlete marks a session complete (existing "mark complete" path on session detail).
- 4 fields: feel slider 1–10, three optional textareas. Submit upserts on `session_id`.
- Coach view: read-only "Athlete reflection" card on session detail page.
- The "end_of_day_note" column stays empty for now; Checkout in 1.5b will write to it.

### View Analysis toggle (interim)

Replace current toggle behaviour with a static empty state on sessions where no trace data exists yet:
> "Detailed analysis available after device sync (coming in the next phase)."

No further debugging of the toggle until 1.5c lands.

---

### Build order within this batch
1. Migration (daily_vitals + session_insights, GRANTs, RLS, trigger).
2. Fix 2 panels (read-only, no schema needed).
3. Fix 3 Volume column.
4. Fix 4A Vitals form + page + soft prompt.
5. Fix 4B post-session modal + coach read view.
6. View Analysis empty state.

I will wait for explicit approval to proceed, and I'll stop after this batch so you can confirm before Phase 1.5.