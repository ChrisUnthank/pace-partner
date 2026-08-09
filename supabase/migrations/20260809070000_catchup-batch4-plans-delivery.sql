-- ============================================================================
-- Migration tracking catch-up — Batch 4: Coaching Plans & Delivery
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 6 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- SHAPE OF THIS FEATURE: plan_templates (reusable, either coach-authored or
-- system-provided via is_system) contain plan_template_sessions (one row
-- per week/day slot). An athlete_plans row is a template applied to a real
-- athlete with a real start date; athlete_plan_sessions links each of the
-- plan's real sessions row back to the plan it came from. plan_deliveries
-- + plan_delivery_recipients are a separate concern — a coach "publishing"
-- a plan/summary to one or more athletes via email/noticeboard/in-app,
-- tracked per-recipient for delivery status.
--
-- DEPENDENCY NOT YET CLOSED: athlete_plans.goal_id references
-- athlete_goals(id), which is itself still untracked (on the original
-- audit list). The FK is captured correctly below; athlete_goals' own
-- CREATE TABLE still needs its own batch.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. plan_templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  days_per_week   integer NOT NULL,
  duration_weeks  integer NOT NULL,
  distance_focus  text,
  level           text,
  is_system       boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.plan_templates
    ADD CONSTRAINT plan_templates_days_per_week_check CHECK (days_per_week >= 3 AND days_per_week <= 7);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_templates
    ADD CONSTRAINT plan_templates_distance_focus_check
      CHECK (distance_focus = ANY (ARRAY['5k','10k','half_marathon','marathon','track_middle_distance']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_templates
    ADD CONSTRAINT plan_templates_duration_weeks_check CHECK (duration_weeks > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_templates
    ADD CONSTRAINT plan_templates_level_check
      CHECK (level = ANY (ARRAY['beginner','intermediate','advanced']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.plan_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "template read system or own" ON public.plan_templates;
CREATE POLICY "template read system or own" ON public.plan_templates
  FOR SELECT USING (is_system OR created_by = auth.uid());

DROP POLICY IF EXISTS "template insert by coach" ON public.plan_templates;
CREATE POLICY "template insert by coach" ON public.plan_templates
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  );

DROP POLICY IF EXISTS "template update own" ON public.plan_templates;
CREATE POLICY "template update own" ON public.plan_templates
  FOR UPDATE
  USING (created_by = auth.uid() AND NOT is_system)
  WITH CHECK (created_by = auth.uid() AND NOT is_system);

DROP POLICY IF EXISTS "template delete own" ON public.plan_templates;
CREATE POLICY "template delete own" ON public.plan_templates
  FOR DELETE USING (created_by = auth.uid() AND NOT is_system);


-- ── 2. plan_template_sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_template_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_template_id     uuid NOT NULL REFERENCES public.plan_templates(id) ON DELETE CASCADE,
  week_number          integer NOT NULL,
  day_of_week          integer NOT NULL,
  title                text NOT NULL,
  effort_type          text NOT NULL,
  notes                text,
  steps                jsonb,
  session_template_id  uuid REFERENCES public.session_templates(id) ON DELETE SET NULL,
  CONSTRAINT plan_template_sessions_plan_template_id_week_number_day_of__key UNIQUE (plan_template_id, week_number, day_of_week)
);

DO $$ BEGIN
  ALTER TABLE public.plan_template_sessions
    ADD CONSTRAINT plan_template_sessions_week_number_check CHECK (week_number > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_template_sessions
    ADD CONSTRAINT plan_template_sessions_day_of_week_check CHECK (day_of_week >= 1 AND day_of_week <= 7);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_template_sessions
    ADD CONSTRAINT plan_template_sessions_effort_type_check
      CHECK (effort_type = ANY (ARRAY['easy','long','tempo','threshold','vo2','race','cross_train','strides','rest']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.plan_template_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "template session read via template" ON public.plan_template_sessions;
CREATE POLICY "template session read via template" ON public.plan_template_sessions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.plan_templates t
            WHERE t.id = plan_template_sessions.plan_template_id AND (t.is_system OR t.created_by = auth.uid()))
  );

DROP POLICY IF EXISTS "template session write via own template" ON public.plan_template_sessions;
CREATE POLICY "template session write via own template" ON public.plan_template_sessions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.plan_templates t
            WHERE t.id = plan_template_sessions.plan_template_id AND t.created_by = auth.uid() AND NOT t.is_system)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.plan_templates t
            WHERE t.id = plan_template_sessions.plan_template_id AND t.created_by = auth.uid() AND NOT t.is_system)
  );


-- ── 3. athlete_plans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id       uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  plan_template_id uuid REFERENCES public.plan_templates(id) ON DELETE SET NULL,
  goal_id          uuid REFERENCES public.athlete_goals(id) ON DELETE SET NULL,
  name             text NOT NULL,
  start_date       date NOT NULL,
  duration_weeks   integer NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_plans
    ADD CONSTRAINT athlete_plans_status_check
      CHECK (status = ANY (ARRAY['active','completed','abandoned']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete plan read athlete/coach" ON public.athlete_plans;
CREATE POLICY "athlete plan read athlete/coach" ON public.athlete_plans
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "athlete plan write athlete/coach" ON public.athlete_plans;
CREATE POLICY "athlete plan write athlete/coach" ON public.athlete_plans
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 4. athlete_plan_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_plan_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_plan_id uuid NOT NULL REFERENCES public.athlete_plans(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  week_number     integer NOT NULL,
  CONSTRAINT athlete_plan_sessions_session_id_key UNIQUE (session_id)
);

ALTER TABLE public.athlete_plan_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete plan session read via plan" ON public.athlete_plan_sessions;
CREATE POLICY "athlete plan session read via plan" ON public.athlete_plan_sessions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.athlete_plans p
            WHERE p.id = athlete_plan_sessions.athlete_plan_id AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "athlete plan session write via plan" ON public.athlete_plan_sessions;
CREATE POLICY "athlete plan session write via plan" ON public.athlete_plan_sessions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.athlete_plans p
            WHERE p.id = athlete_plan_sessions.athlete_plan_id AND public.can_access_athlete(auth.uid(), p.athlete_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.athlete_plans p
            WHERE p.id = athlete_plan_sessions.athlete_plan_id AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );


-- ── 5. plan_deliveries ────────────────────────────────────────────────────────
-- A coach "publishing" a plan/summary to one or more athletes. scope_type/
-- scope_label describe WHO it went to (one athlete, a hand-picked select,
-- a whole group, the full roster) for display purposes — the actual
-- per-recipient fan-out lives in plan_delivery_recipients below.
CREATE TABLE IF NOT EXISTS public.plan_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_range_start     date NOT NULL,
  date_range_end       date NOT NULL,
  summary              text NOT NULL,
  channels             text[] NOT NULL DEFAULT '{}'::text[],
  export_detail_level  text NOT NULL DEFAULT 'simple',
  noticeboard_post_id  uuid REFERENCES public.noticeboard_posts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  scope_type           text,
  scope_label          text
);

DO $$ BEGIN
  ALTER TABLE public.plan_deliveries
    ADD CONSTRAINT plan_deliveries_scope_type_check
      CHECK (scope_type IS NULL OR scope_type = ANY (ARRAY['athlete','select','group','roster']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_deliveries
    ADD CONSTRAINT plan_deliveries_export_detail_level_check
      CHECK (export_detail_level = ANY (ARRAY['simple','detailed','both']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.plan_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coach can manage own deliveries" ON public.plan_deliveries;
CREATE POLICY "Coach can manage own deliveries" ON public.plan_deliveries
  FOR ALL USING (auth.uid() = coach_user_id) WITH CHECK (auth.uid() = coach_user_id);


-- ── 6. plan_delivery_recipients ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_delivery_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       uuid NOT NULL REFERENCES public.plan_deliveries(id) ON DELETE CASCADE,
  athlete_id        uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  email_to          text,
  email_status      text NOT NULL DEFAULT 'not_attempted',
  notified_in_app   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.plan_delivery_recipients
    ADD CONSTRAINT plan_delivery_recipients_email_status_check
      CHECK (email_status = ANY (ARRAY['not_attempted','sent','failed','skipped_no_email']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.plan_delivery_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coach can insert recipient rows for their own deliveries" ON public.plan_delivery_recipients;
CREATE POLICY "Coach can insert recipient rows for their own deliveries" ON public.plan_delivery_recipients
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.plan_deliveries d WHERE d.id = plan_delivery_recipients.delivery_id AND d.coach_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Recipient athlete/parent can read their own delivery rows" ON public.plan_delivery_recipients;
CREATE POLICY "Recipient athlete/parent can read their own delivery rows" ON public.plan_delivery_recipients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.plan_deliveries d WHERE d.id = plan_delivery_recipients.delivery_id AND d.coach_user_id = auth.uid())
    OR public.can_access_athlete(auth.uid(), athlete_id)
  );


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- STILL OPEN: athlete_plans.goal_id references athlete_goals(id), which is
-- itself still untracked. Captured correctly as an FK here; athlete_goals'
-- own CREATE TABLE still needs its own batch.
-- ============================================================================
