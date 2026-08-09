-- ============================================================================
-- Migration tracking catch-up — Batch 7: Health & Injury Tracking
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 7 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- SHAPE OF THIS FEATURE: injuries is the core record (body region/part,
-- side, severity 1-5, status, whether a healthcare provider is involved),
-- with injury_updates (dated progress notes) and injury_appointments
-- (scheduled HCP visits, optionally linked to a personal calendar entry)
-- hanging off it. The other four — bicarb_log, daily_nutrition,
-- lactate_spot_checks, recovery_sessions — are independent, simpler
-- self-tracking logs, not injury-specific.
--
-- RLS is uniform and simple across the whole batch: every table has
-- exactly one ALL policy gated on can_access_athlete() — no coach/athlete
-- write-split like several earlier batches had. Reproduced as found.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. injuries (parent table) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.injuries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id     uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  body_part      text NOT NULL,
  side           text,
  status         text NOT NULL DEFAULT 'active',
  severity       smallint,
  onset_date     date NOT NULL,
  resolved_date  date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  body_region    text,
  seeing_hcp     boolean NOT NULL DEFAULT false,
  hcp_name       text,
  next_appt_at   timestamptz,
  archived       boolean NOT NULL DEFAULT false
);

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_body_region_check
      CHECK (body_region IS NULL OR body_region = ANY (ARRAY[
        'head','neck','shoulder','chest','upper_arm','elbow','forearm','wrist_hand',
        'abdomen','hip_flexor','groin','quad','knee','shin','ankle_front','foot_top',
        'upper_back','lower_back','glute','hamstring','calf','achilles','heel','sole'
      ]::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_severity_check CHECK (severity >= 1 AND severity <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_side_check
      CHECK (side = ANY (ARRAY['left','right','both','n/a']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_status_check
      CHECK (status = ANY (ARRAY['active','monitoring','resolved']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.injuries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "injuries access via athlete" ON public.injuries;
CREATE POLICY "injuries access via athlete" ON public.injuries
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 2. injury_updates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.injury_updates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  injury_id    uuid NOT NULL REFERENCES public.injuries(id) ON DELETE CASCADE,
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  update_date  date NOT NULL,
  severity     smallint,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.injury_updates
    ADD CONSTRAINT injury_updates_severity_check CHECK (severity >= 1 AND severity <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.injury_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "injury_updates access via athlete" ON public.injury_updates;
CREATE POLICY "injury_updates access via athlete" ON public.injury_updates
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 3. injury_appointments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.injury_appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  injury_id          uuid NOT NULL REFERENCES public.injuries(id) ON DELETE CASCADE,
  athlete_id         uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  hcp_name           text,
  appt_at            timestamptz NOT NULL,
  notes              text,
  calendar_entry_id  uuid REFERENCES public.athlete_personal_calendar_entries(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.injury_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "injury appointments access" ON public.injury_appointments;
CREATE POLICY "injury appointments access" ON public.injury_appointments
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 4. bicarb_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bicarb_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id             uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  log_date               date NOT NULL,
  dose_g                 numeric,
  product                text,
  timing_minutes_before  integer,
  session_id             uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  tolerance              smallint,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.bicarb_log
    ADD CONSTRAINT bicarb_log_tolerance_check CHECK (tolerance >= 1 AND tolerance <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.bicarb_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bicarb access via athlete" ON public.bicarb_log;
CREATE POLICY "bicarb access via athlete" ON public.bicarb_log
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 5. daily_nutrition ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_nutrition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id       uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  nutrition_date   date NOT NULL,
  calories         integer,
  protein_g        numeric,
  carbs_g          numeric,
  fat_g            numeric,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_nutrition_athlete_id_nutrition_date_key UNIQUE (athlete_id, nutrition_date)
);

ALTER TABLE public.daily_nutrition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nutrition access via athlete" ON public.daily_nutrition;
CREATE POLICY "nutrition access via athlete" ON public.daily_nutrition
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 6. lactate_spot_checks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lactate_spot_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  check_date   date NOT NULL,
  mmol         numeric NOT NULL,
  context      text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lactate_spot_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lactate spot checks access via athlete" ON public.lactate_spot_checks;
CREATE POLICY "lactate spot checks access via athlete" ON public.lactate_spot_checks
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 7. recovery_sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recovery_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  session_date       date NOT NULL,
  modality           text NOT NULL,
  duration_minutes   integer,
  provider           text,
  notes              text,
  felt_after         smallint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.recovery_sessions
    ADD CONSTRAINT recovery_sessions_felt_after_check CHECK (felt_after >= 1 AND felt_after <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.recovery_sessions
    ADD CONSTRAINT recovery_sessions_modality_check
      CHECK (modality = ANY (ARRAY['physio','massage','sauna','compression','ice_bath','other']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.recovery_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recovery access via athlete" ON public.recovery_sessions;
CREATE POLICY "recovery access via athlete" ON public.recovery_sessions
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


NOTIFY pgrst, 'reload schema';
