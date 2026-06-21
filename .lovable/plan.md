## Goal

Populate the app with enough realistic test data that every screen — dashboard, athletes list, athlete detail, calendar, session list, completed-session detail, session analysis graph, and analytics PMC — has meaningful content to preview, without touching the two real user accounts' own athlete records.

## What gets created

All data is inserted via the data-insert tool (one migration-style SQL block, idempotent by name prefix `[TEST] `). Coach owner: **chris@unthank.me**. Easy to wipe later by deleting where name starts with `[TEST] `.

### 5 fictional athletes (varied archetypes)

| Name | Event | Profile shape | DOB / training age |
|---|---|---|---|
| [TEST] Maya Okafor | 800m | Speed-dominant, high speed reserve | 22 / 6 yr |
| [TEST] Daniel Reeves | 1500m | Balanced | 27 / 9 yr |
| [TEST] Priya Shah | 5000m | Aerobic engine | 31 / 12 yr |
| [TEST] Liam Carter | 3000m steeple | Balanced, moderate SR | 19 / 4 yr |
| [TEST] Elena Voss | 10k / HM | Strong aerobic engine, low SR | 35 / 14 yr |

Each gets: athlete row, `coach_athletes` link to chris, `athlete_zone_profiles` (paces + HR zones consistent with their PBs), and 5–7 `performances` across distances so `recompute_physio_profile` produces a real archetype.

### 8 weeks of sessions per athlete (~56 days, ending today)

Per athlete, a realistic weekly micro-cycle:
- Mon — easy run (training/easy)
- Tue — interval work (varies by athlete: 800m reps, mile reps, threshold)
- Wed — easy or recovery
- Thu — tempo / threshold
- Fri — easy + strides
- Sat — long run (or race every ~3 weeks)
- Sun — rest or cross-training

For each session: `sessions` row + `steps` (warmup / work / recovery / cooldown) + `interval_results` per rep with realistic pace/HR/cadence/stride **including intentional within-session drift** so `compute_session_fatigue` produces non-null efficiency scores and the analysis graph shows real fade patterns. Most sessions completed; last 2–3 days left as planned/upcoming so "Today" and planned-session views also have content. Includes 1–2 race entries per athlete (logged as performances + day_type=race sessions).

### Daily check-ins

~5 check-ins per week per athlete across the 8 weeks, with realistic variation (one athlete trending fatigued, one fresh, one with a brief injury_flag week) so readiness bands span green/amber/red and the PMC TSB line varies.

### Derived data

After inserts, call the existing recompute functions per athlete/date so everything downstream populates without new logic:
- `recompute_physio_profile(athlete_id)` once per athlete
- `recompute_readiness(athlete_id, date)` for each of the 56 days (drives `athlete_load_daily` → CTL/ATL/TSB/readiness)
- Session zone time + fatigue are auto-recomputed by existing triggers on `interval_results` insert

## Out of scope

- No schema changes, no new RPCs, no UI changes.
- Amanda's account untouched.
- No invites/auth changes — fictional athletes have `user_id = NULL` (coach-managed, "Invite pending" badge in roster, which is realistic).

## Cleanup path

Single SQL to undo: `DELETE FROM athletes WHERE name LIKE '[TEST] %';` (cascades to sessions/steps/results/load/fatigue/physio/zone profiles via FKs).

## Confirm before I build

1. **Coach = chris@unthank.me, all 5 test athletes attached to him** — OK, or also mirror onto Amanda?
2. **Volume**: 5 athletes × ~50 sessions ≈ 250 sessions, ~1500 interval reps. Fine, or want smaller (e.g. 3 athletes × 4 weeks)?
3. **Name prefix `[TEST] `** so they're obvious and bulk-deletable — OK?
