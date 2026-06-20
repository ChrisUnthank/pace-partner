## Confirmed understanding (with your additions)

Your two additions fit cleanly into the model I described:

**1. Recovery between reps is first-class data, not a gap.**
Every rep is followed by a recovery step. Each recovery step has:
- **Mode**: standing (still / minimal shuffle), walk, jog, or float (continuous easy running between fast reps)
- **Target type**: time-based (e.g. 90s) OR distance-based (e.g. 200m)
- **Target value** + **actual value** (how long/far it actually took)
- **HR at end of rep** and **HR at end of recovery** → derived **HR recovery (bpm dropped, and bpm/min)**
- Optional avg pace during recovery (for jog/float)

This means a session like "6 × 800m w/ 200m jog recovery" stores 12 step rows (6 work + 6 recovery), and HR recovery between reps becomes a tracked metric that feeds fatigue context and future session adjustments — slow HR recovery late in a session is a stronger fatigue signal than the rep times alone.

**2. Daily check-in captures life load, not just training.**
The check-in form (sleep, soreness, stress, motivation, fuel, injury) gets an **other activities** section:
- Work (none / desk / physical / long hours)
- Gym / strength session (yes + intensity)
- Other sport (which + intensity + duration)
- School activities (PE, sport practice, etc. — relevant for younger athletes)
- Free-text notes

These flow into the same `external_load` concept in your schema map and combine with training load → `combined_load` → readiness. A planned hard track session the day after a school rugby match should get flagged amber automatically.

## What I'll build (Phase 1 — web app, mobile-friendly)

A working app on Lovable Cloud with:

1. **Auth + roles** — shared login, Coach or Athlete role chosen at signup, coach-athlete linking
2. **Data model** — exactly your v2 schema map, plus the two refinements above (recovery step fields, daily activities on check-in). No speculative extras.
3. **Athlete experience**
   - Today view: planned session + daily check-in (incl. other activities)
   - Session logger: tap through reps and recoveries, enter actuals (time/distance/HR), RPE at end
   - History: past sessions, PBs, readiness trend
4. **Coach experience**
   - Roster dashboard: each athlete's readiness (green/amber/red), last session, flags
   - Session builder: structured steps (warmup → work reps + recovery steps → cooldown), assign to athletes
   - Athlete detail: training load chart (acute vs chronic), zone time, fatigue context, physiological profile, execution flags
5. **Readiness + adjustment engine** — daily recompute per athlete; amber/red surfaces a suggested adjustment for coach approval (your `session_adjustment_rules`)
6. **Physiological profile** — computed from PBs in `performances`; aerobic/anaerobic split, speed reserve, archetype label
7. **Honest data labelling** — sessions tagged HR-based or pace-based zone time; manual vs synced clearly marked

**Not in Phase 1** (schema present, UI deferred until you have data): device sync / `raw_session_points`, biomechanics, AI coaching commentary. The schema map already flags these as waiting on real telemetry.

## Technical notes (skim or skip)

- Stack: TanStack Start + React, Tailwind, shadcn/ui, Lovable Cloud (Postgres + auth + RLS).
- Recovery steps modelled as rows in `steps` with `type = 'recovery'` and a `recovery_mode` enum (`standing | walk | jog | float`) and `target_type` (`time | distance`). Rep-level HR-start/HR-end already fits `interval_results`; I'll add `hr_end_recovery` so HR recovery is a derived field.
- Daily activities stored as rows in `external_load` (your existing table, `load_type` covers gym/work/sport/school) linked to the check-in date; the check-in form writes both `daily_checkins` and `external_load` in one submit.
- RLS: athletes see only their own data; coaches see their linked athletes via `coach_athletes`; `has_role()` security-definer function for role checks.
- Mobile-first layouts for athlete views (logger especially); coach dashboard usable on phone but optimised for tablet/desktop.

## Before I start — two quick confirmations

1. **Signup flow**: anyone can sign up and pick Coach or Athlete themselves, and a coach then invites athletes by email to link? Or should athlete accounts only be creatable by a coach? (Most teams prefer the second; solo athletes need the first.)
2. **Pace zones when no HR**: confirm you want the app to auto-derive pace zones from the athlete's most recent 1500m and 5000m PBs in `performances` (Daniels-style), with the coach able to override.

If those are both "yes, your call", I'll just pick the sensible defaults (open signup with role choice + invite linking; auto-derive with override) and start building.
