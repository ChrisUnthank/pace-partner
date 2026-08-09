-- ============================================================================
-- Migration tracking catch-up — Batch 8: Squad / Training Groups
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), pg_policies, and pg_enum
-- (for the two custom enum types this batch depends on) on 9 Aug 2026.
-- Zero behavioural change. None of these 4 tables had any CREATE TABLE
-- anywhere in GitHub history, and neither of the two enum types they use
-- had a CREATE TYPE anywhere either.
--
-- SHAPE OF THIS FEATURE: a coach's training_groups (squads) contain
-- athletes via training_group_members. squad_training_sessions is the
-- RECURRING weekly schedule template (day-of-week OR a specific one-off
-- date — the check constraint requires at least one), and
-- squad_training_overrides lets a coach cancel/reschedule ONE occurrence
-- of that recurring schedule without touching the template itself —
-- unique per (schedule_id, occurrence_date), so at most one override per
-- calendar date per schedule.
--
-- NOTE ON training_day_type's 9th value: "Session" (capitalized, unlike
-- every other lowercase value) is reproduced exactly as found live, not
-- corrected — almost certainly a data-entry inconsistency from whenever
-- it was added, but this migration's job is to capture reality, not tidy
-- it up.
--
-- RLS pattern here is simpler than most other batches: read is open to any
-- authenticated user for the two schedule tables (squad_training_sessions,
-- squad_training_overrides) and training_group_members — write is coach/
-- manager-role gated, not per-athlete scoped at all. training_groups
-- itself additionally lets the owning coach manage their own groups
-- directly (not just via the role check).
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 0. Enum types this batch depends on ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.training_day_type AS ENUM (
    'group_session', 'individual_program', 'rest', 'optional', 'long_run',
    'cross_training', 'sport_specific_training', 'sport_specific_game_event', 'Session'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.training_time_of_day AS ENUM ('am', 'pm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 1. training_groups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  color          text
);

ALTER TABLE public.training_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups readable by authenticated" ON public.training_groups;
CREATE POLICY "groups readable by authenticated" ON public.training_groups
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "coaches manage own groups" ON public.training_groups;
CREATE POLICY "coaches manage own groups" ON public.training_groups
  FOR ALL
  USING (coach_user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (coach_user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));


-- ── 2. training_group_members ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_group_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.training_groups(id) ON DELETE CASCADE,
  athlete_id  uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES auth.users(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_group_members_group_id_athlete_id_key UNIQUE (group_id, athlete_id)
);

ALTER TABLE public.training_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group membership readable by authenticated" ON public.training_group_members;
CREATE POLICY "group membership readable by authenticated" ON public.training_group_members
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "coaches manage own group membership" ON public.training_group_members;
CREATE POLICY "coaches manage own group membership" ON public.training_group_members
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'manager')
    OR EXISTS (SELECT 1 FROM public.training_groups g WHERE g.id = training_group_members.group_id AND g.coach_user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager')
    OR EXISTS (SELECT 1 FROM public.training_groups g WHERE g.id = training_group_members.group_id AND g.coach_user_id = auth.uid())
  );


-- ── 3. squad_training_sessions (recurring weekly template) ─────────────────
CREATE TABLE IF NOT EXISTS public.squad_training_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  squad_label    text NOT NULL,
  day_of_week    smallint,
  specific_date  date,
  start_time     time,
  location_id    uuid REFERENCES public.training_locations(id) ON DELETE SET NULL,
  location_text  text,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  group_id       uuid REFERENCES public.training_groups(id) ON DELETE CASCADE,
  day_type       public.training_day_type NOT NULL DEFAULT 'group_session',
  time_of_day    public.training_time_of_day
);

DO $$ BEGIN
  ALTER TABLE public.squad_training_sessions
    ADD CONSTRAINT squad_training_sessions_check CHECK (day_of_week IS NOT NULL OR specific_date IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.squad_training_sessions
    ADD CONSTRAINT squad_training_sessions_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.squad_training_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "squad schedule readable by authenticated" ON public.squad_training_sessions;
CREATE POLICY "squad schedule readable by authenticated" ON public.squad_training_sessions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "coaches manage squad schedule" ON public.squad_training_sessions;
CREATE POLICY "coaches manage squad schedule" ON public.squad_training_sessions
  FOR ALL
  USING (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'));


-- ── 4. squad_training_overrides (one-off exception to the template above) ──
CREATE TABLE IF NOT EXISTS public.squad_training_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      uuid NOT NULL REFERENCES public.squad_training_sessions(id) ON DELETE CASCADE,
  occurrence_date  date NOT NULL,
  cancelled        boolean NOT NULL DEFAULT false,
  start_time       time,
  location_id      uuid REFERENCES public.training_locations(id) ON DELETE SET NULL,
  location_text    text,
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  time_of_day      public.training_time_of_day,
  CONSTRAINT squad_training_overrides_schedule_id_occurrence_date_key UNIQUE (schedule_id, occurrence_date)
);

ALTER TABLE public.squad_training_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "overrides readable by authenticated" ON public.squad_training_overrides;
CREATE POLICY "overrides readable by authenticated" ON public.squad_training_overrides
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "coaches manage overrides" ON public.squad_training_overrides;
CREATE POLICY "coaches manage overrides" ON public.squad_training_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'));


NOTIFY pgrst, 'reload schema';
