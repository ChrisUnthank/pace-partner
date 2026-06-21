
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS recovery_between_reps_target_kind text NOT NULL DEFAULT 'time',
  ADD COLUMN IF NOT EXISTS recovery_between_reps_distance_m integer,
  ADD COLUMN IF NOT EXISTS recovery_between_sets_target_kind text NOT NULL DEFAULT 'time',
  ADD COLUMN IF NOT EXISTS recovery_between_sets_distance_m integer;

ALTER TABLE public.steps
  DROP CONSTRAINT IF EXISTS steps_rec_reps_tk_chk,
  DROP CONSTRAINT IF EXISTS steps_rec_sets_tk_chk;
ALTER TABLE public.steps
  ADD CONSTRAINT steps_rec_reps_tk_chk CHECK (recovery_between_reps_target_kind IN ('time','distance')),
  ADD CONSTRAINT steps_rec_sets_tk_chk CHECK (recovery_between_sets_target_kind IN ('time','distance'));

ALTER TABLE public.template_steps
  ADD COLUMN IF NOT EXISTS recovery_between_reps_target_kind text NOT NULL DEFAULT 'time',
  ADD COLUMN IF NOT EXISTS recovery_between_reps_distance_m integer,
  ADD COLUMN IF NOT EXISTS recovery_between_sets_target_kind text NOT NULL DEFAULT 'time',
  ADD COLUMN IF NOT EXISTS recovery_between_sets_distance_m integer;

ALTER TABLE public.template_steps
  DROP CONSTRAINT IF EXISTS template_steps_rec_reps_tk_chk,
  DROP CONSTRAINT IF EXISTS template_steps_rec_sets_tk_chk;
ALTER TABLE public.template_steps
  ADD CONSTRAINT template_steps_rec_reps_tk_chk CHECK (recovery_between_reps_target_kind IN ('time','distance')),
  ADD CONSTRAINT template_steps_rec_sets_tk_chk CHECK (recovery_between_sets_target_kind IN ('time','distance'));
