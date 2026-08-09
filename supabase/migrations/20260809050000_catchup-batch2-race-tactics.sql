-- ============================================================================
-- Migration tracking catch-up — Batch 2: Race Tactics
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim, not hand-reconstructed), and
-- pg_policies on 9 Aug 2026. Zero behavioural change. None of these 6
-- tables had any CREATE TABLE anywhere in GitHub history.
--
-- Six tables, one clear hierarchy: race_tactics_plans is the parent (keyed
-- to an athlete), with five children hanging off plan_id — decision points,
-- AI suggestions, comments, post-race review, and coach-private notes.
--
-- RLS pattern worth understanding before touching any of this: three
-- different access-check helpers are used deliberately, not
-- interchangeably —
--   can_access_athlete()  — broad read access (coach OR athlete OR parent)
--   is_coach_of()         — coach-only write access
--   is_athlete_self()     — lets the athlete themselves also write to some
--                           tables (decision points, post-race, the plan
--                           itself), but NOT to race_tactics_private_notes,
--                           which is coach-eyes-only by design (policy name
--                           says it plainly: race_private_notes_all).
-- The INSERT policies on race_tactics_plans and two of its children also
-- accept a direct "auth.uid() owns this athlete record" check as an
-- alternative to is_coach_of() — covering the case where the athlete
-- creates their own plan/decision point, not just a coach on their behalf.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. race_tactics_plans (parent table) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_tactics_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id           uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  event_name           text NOT NULL,
  race_distance_m      integer NOT NULL,
  race_type            text NOT NULL DEFAULT 'track',
  race_date            date,
  goal_time_seconds    numeric NOT NULL,
  current_pb_seconds   numeric,
  target_pb_seconds    numeric,
  split_increment_m    integer NOT NULL,
  splits               jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditions           jsonb,
  status               text NOT NULL DEFAULT 'draft',
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  strategy             text NOT NULL DEFAULT 'even_pace',
  event_tactics        jsonb,
  published_at         timestamptz,
  athlete_intentions   text,
  linked_session_id    uuid REFERENCES public.sessions(id) ON DELETE SET NULL
);

DO $$ BEGIN
  ALTER TABLE public.race_tactics_plans
    ADD CONSTRAINT race_tactics_strategy_check
      CHECK (strategy = ANY (ARRAY['even_pace','negative_split','positive_split','fast_start','controlled_start','custom']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_tactics_plans
    ADD CONSTRAINT race_tactics_race_type_check
      CHECK (race_type = ANY (ARRAY['track','road','cross_country']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_tactics_plans
    ADD CONSTRAINT race_tactics_status_check
      CHECK (status = ANY (ARRAY['draft','coach_review','approved','race_ready','completed']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.race_tactics_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_tactics_read" ON public.race_tactics_plans;
CREATE POLICY "race_tactics_read" ON public.race_tactics_plans
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "race_tactics_insert" ON public.race_tactics_plans;
CREATE POLICY "race_tactics_insert" ON public.race_tactics_plans
  FOR INSERT WITH CHECK (
    public.is_coach_of(auth.uid(), athlete_id)
    OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = race_tactics_plans.athlete_id AND a.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "race_tactics_update" ON public.race_tactics_plans;
CREATE POLICY "race_tactics_update" ON public.race_tactics_plans
  FOR UPDATE
  USING (public.is_coach_of(auth.uid(), athlete_id) OR public.is_athlete_self(auth.uid(), athlete_id))
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id) OR public.is_athlete_self(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "race_tactics_delete" ON public.race_tactics_plans;
CREATE POLICY "race_tactics_delete" ON public.race_tactics_plans
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id) OR created_by = auth.uid());


-- ── 2. race_tactics_decision_points ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_tactics_decision_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES public.race_tactics_plans(id) ON DELETE CASCADE,
  distance_m    integer NOT NULL,
  trigger_text  text NOT NULL,
  action_text   text NOT NULL,
  notes         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.race_tactics_decision_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_points_read" ON public.race_tactics_decision_points;
CREATE POLICY "decision_points_read" ON public.race_tactics_decision_points
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_decision_points.plan_id
              AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "decision_points_insert" ON public.race_tactics_decision_points;
CREATE POLICY "decision_points_insert" ON public.race_tactics_decision_points
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_decision_points.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id)
                   OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = p.athlete_id AND a.user_id = auth.uid())))
  );

DROP POLICY IF EXISTS "decision_points_update" ON public.race_tactics_decision_points;
CREATE POLICY "decision_points_update" ON public.race_tactics_decision_points
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_decision_points.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_decision_points.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  );

DROP POLICY IF EXISTS "decision_points_delete" ON public.race_tactics_decision_points;
CREATE POLICY "decision_points_delete" ON public.race_tactics_decision_points
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_decision_points.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  );


-- ── 3. race_tactics_ai_suggestions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_tactics_ai_suggestions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                     uuid NOT NULL REFERENCES public.race_tactics_plans(id) ON DELETE CASCADE,
  primary_strategy            text NOT NULL,
  primary_strategy_label      text NOT NULL,
  reasoning                   text NOT NULL,
  risks                       text NOT NULL,
  alternative_strategy        text NOT NULL,
  alternative_strategy_label  text NOT NULL,
  alternative_reasoning       text NOT NULL,
  suggested_splits            jsonb NOT NULL DEFAULT '[]'::jsonb,
  tactical_decision_points    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                      text NOT NULL DEFAULT 'pending',
  created_by                  uuid REFERENCES auth.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.race_tactics_ai_suggestions
    ADD CONSTRAINT ai_suggestion_status_check
      CHECK (status = ANY (ARRAY['pending','accepted','rejected']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.race_tactics_ai_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_suggestions_read" ON public.race_tactics_ai_suggestions;
CREATE POLICY "ai_suggestions_read" ON public.race_tactics_ai_suggestions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_ai_suggestions.plan_id
              AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "ai_suggestions_insert" ON public.race_tactics_ai_suggestions;
CREATE POLICY "ai_suggestions_insert" ON public.race_tactics_ai_suggestions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_ai_suggestions.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id)
                   OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = p.athlete_id AND a.user_id = auth.uid())))
  );

DROP POLICY IF EXISTS "ai_suggestions_update" ON public.race_tactics_ai_suggestions;
CREATE POLICY "ai_suggestions_update" ON public.race_tactics_ai_suggestions
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_ai_suggestions.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_ai_suggestions.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  );


-- ── 4. race_tactics_comments ──────────────────────────────────────────────────
-- No UPDATE policy live — reproduced exactly as found: comments are
-- write-once/delete, not editable in place, same pattern as
-- athlete_training_response_notes in Batch 1.
CREATE TABLE IF NOT EXISTS public.race_tactics_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES public.race_tactics_plans(id) ON DELETE CASCADE,
  body           text NOT NULL,
  is_suggestion  boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.race_tactics_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_comments_read" ON public.race_tactics_comments;
CREATE POLICY "race_comments_read" ON public.race_tactics_comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_comments.plan_id
              AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "race_comments_insert" ON public.race_tactics_comments;
CREATE POLICY "race_comments_insert" ON public.race_tactics_comments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_comments.plan_id
              AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "race_comments_delete" ON public.race_tactics_comments;
CREATE POLICY "race_comments_delete" ON public.race_tactics_comments
  FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.race_tactics_plans p
               WHERE p.id = race_tactics_comments.plan_id
                 AND public.is_coach_of(auth.uid(), p.athlete_id))
  );


-- ── 5. race_tactics_post_race ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_tactics_post_race (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                  uuid NOT NULL REFERENCES public.race_tactics_plans(id) ON DELETE CASCADE,
  actual_splits            jsonb NOT NULL DEFAULT '[]'::jsonb,
  finishing_position       text,
  decision_point_notes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  coach_what_worked        text,
  coach_what_didnt         text,
  coach_what_to_change     text,
  athlete_how_it_felt      text,
  athlete_what_different   text,
  athlete_what_learned     text,
  linked_performance_id    uuid REFERENCES public.performances(id) ON DELETE SET NULL,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT race_tactics_post_race_plan_id_key UNIQUE (plan_id)
);

ALTER TABLE public.race_tactics_post_race ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_race_read" ON public.race_tactics_post_race;
CREATE POLICY "post_race_read" ON public.race_tactics_post_race
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_post_race.plan_id
              AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "post_race_insert" ON public.race_tactics_post_race;
CREATE POLICY "post_race_insert" ON public.race_tactics_post_race
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_post_race.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  );

DROP POLICY IF EXISTS "post_race_update" ON public.race_tactics_post_race;
CREATE POLICY "post_race_update" ON public.race_tactics_post_race
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_post_race.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_post_race.plan_id
              AND (public.is_coach_of(auth.uid(), p.athlete_id) OR public.is_athlete_self(auth.uid(), p.athlete_id)))
  );


-- ── 6. race_tactics_private_notes ─────────────────────────────────────────────
-- Coach-eyes-only by design — single ALL policy, no athlete access path at
-- all (unlike every other table in this batch). Reproduced exactly as found.
CREATE TABLE IF NOT EXISTS public.race_tactics_private_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES public.race_tactics_plans(id) ON DELETE CASCADE,
  note        text NOT NULL,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.race_tactics_private_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_private_notes_all" ON public.race_tactics_private_notes;
CREATE POLICY "race_private_notes_all" ON public.race_tactics_private_notes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_private_notes.plan_id
              AND public.is_coach_of(auth.uid(), p.athlete_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.race_tactics_plans p
            WHERE p.id = race_tactics_private_notes.plan_id
              AND public.is_coach_of(auth.uid(), p.athlete_id))
  );


NOTIFY pgrst, 'reload schema';
