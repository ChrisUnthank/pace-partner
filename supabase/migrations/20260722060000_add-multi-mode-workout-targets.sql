-- Phase 1: Multi-Mode Workout Targets — data contract foundation
-- Adds new target columns to steps and template_steps.
-- All columns default to NULL so existing rows are unaffected.

-- ── steps ────────────────────────────────────────────────────────────────────
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS target_mode                text,
  ADD COLUMN IF NOT EXISTS target_threshold_pace_pct  numeric,
  ADD COLUMN IF NOT EXISTS target_threshold_hr_pct    numeric,
  ADD COLUMN IF NOT EXISTS target_zone                text,
  ADD COLUMN IF NOT EXISTS target_rpe                 numeric;

DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_mode_check
      CHECK (target_mode IS NULL OR target_mode IN (
        'pace','threshold_pace_pct','threshold_hr_pct','zone','rpe','open'
      ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_zone_check
      CHECK (target_zone IS NULL OR target_zone IN ('z1','z2','z3','z4','z5'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_threshold_pace_pct_check
      CHECK (target_threshold_pace_pct IS NULL OR
             (target_threshold_pace_pct > 0 AND target_threshold_pace_pct <= 200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_threshold_hr_pct_check
      CHECK (target_threshold_hr_pct IS NULL OR
             (target_threshold_hr_pct > 0 AND target_threshold_hr_pct <= 200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_rpe_check
      CHECK (target_rpe IS NULL OR (target_rpe >= 1 AND target_rpe <= 10));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- At most one payload field set at a time (excludes the mode discriminant itself).
DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_payload_exclusive_check
      CHECK (
        (
          CASE WHEN target_pace_sec_per_km    IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_threshold_pace_pct IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_threshold_hr_pct   IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_zone               IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_rpe                IS NOT NULL THEN 1 ELSE 0 END
        ) <= 1
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── template_steps ────────────────────────────────────────────────────────────
ALTER TABLE public.template_steps
  ADD COLUMN IF NOT EXISTS target_mode                text,
  ADD COLUMN IF NOT EXISTS target_threshold_pace_pct  numeric,
  ADD COLUMN IF NOT EXISTS target_threshold_hr_pct    numeric,
  ADD COLUMN IF NOT EXISTS target_zone                text,
  ADD COLUMN IF NOT EXISTS target_rpe                 numeric;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_mode_check
      CHECK (target_mode IS NULL OR target_mode IN (
        'pace','threshold_pace_pct','threshold_hr_pct','zone','rpe','open'
      ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_zone_check
      CHECK (target_zone IS NULL OR target_zone IN ('z1','z2','z3','z4','z5'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_threshold_pace_pct_check
      CHECK (target_threshold_pace_pct IS NULL OR
             (target_threshold_pace_pct > 0 AND target_threshold_pace_pct <= 200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_threshold_hr_pct_check
      CHECK (target_threshold_hr_pct IS NULL OR
             (target_threshold_hr_pct > 0 AND target_threshold_hr_pct <= 200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_rpe_check
      CHECK (target_rpe IS NULL OR (target_rpe >= 1 AND target_rpe <= 10));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_steps
    ADD CONSTRAINT template_steps_target_payload_exclusive_check
      CHECK (
        (
          CASE WHEN target_pace_sec_per_km    IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_threshold_pace_pct IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_threshold_hr_pct   IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_zone               IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN target_rpe                IS NOT NULL THEN 1 ELSE 0 END
        ) <= 1
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
