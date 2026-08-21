-- ============================================================================
-- SQUAD ADMIN — coaching plans, availability, and the non-training facts
-- about an athlete.
--
-- Manage Athletes under Coaching answers a different question from the
-- "Manage athletes" dialog on Training Schedule, which — as its own code
-- comment says — is "assign, remove, or move an athlete between the coach's
-- groups". That one is group assignment; this is who the person is, when they
-- can train, and what they are paying.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- Nothing that duplicates the Address Book. It already derives its contents
-- from athletes, parent_athlete_links and person_contact_details, so it needs
-- no feeding — edit those and it updates itself. A second store that "updates
-- the address book" would be two sources of the same truth, which is the
-- drift this codebase keeps paying for.
--
-- Nothing to do with taking payments. Fees are recorded so the question "what
-- is this athlete on" has an answer; whether anything was actually paid is a
-- separate model and a separate decision.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Named coaching plans, owned by a coach.
--
-- Named rather than a fee on each athlete, because fees vary by athlete type,
-- level and age — so the same figures get typed repeatedly and drift the
-- moment prices change. A plan lets a coach raise the squad fee once.
--
-- The per-athlete override below is what keeps that from being rigid: a plan
-- carries the usual figure, and an individual arrangement sits on the athlete
-- without needing a plan of its own.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name           text NOT NULL,
  description    text,

  fee_amount     numeric CHECK (fee_amount IS NULL OR fee_amount >= 0),
  -- Stored per plan rather than assumed globally: a coach with athletes in
  -- more than one country should not have that silently reinterpreted.
  fee_currency   text NOT NULL DEFAULT 'AUD',
  fee_period     text NOT NULL DEFAULT 'monthly',

  -- Retired rather than deleted, so athletes already on a plan keep a
  -- readable record of what they were on.
  active         boolean NOT NULL DEFAULT true,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.coaching_plans
    ADD CONSTRAINT coaching_plans_fee_period_check
      CHECK (fee_period = ANY (ARRAY['session','weekly','fortnightly','monthly','term','annual']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS coaching_plans_coach_name_idx
  ON public.coaching_plans (coach_user_id, lower(name));

COMMENT ON TABLE public.coaching_plans IS
  'Named fee arrangements owned by a coach. Athletes reference one; athletes.fee_amount_override handles the individual exception without needing a plan of its own.';


-- ---------------------------------------------------------------------------
-- 2. Which days an athlete can train, and why.
--
-- A row per available day rather than an array or a jsonb blob, because each
-- day carries its own note — "after 6pm", "only if not working" — and those
-- are the part a coach actually needs when placing a session. An array could
-- hold the days but not the qualifications; jsonb could hold both but is
-- awkward to query and easy to write inconsistently.
--
-- ABSENCE OF A ROW MEANS UNAVAILABLE. No row for Tuesday is the same as not
-- ticking Tuesday, so there is one representation of "no" rather than a
-- row saying false alongside no row at all.
--
-- Mon=1 .. Sun=7, matching dayOfWeek() in campaign-generator.ts and
-- TemplateSessionRow.day_of_week. A second convention in the same codebase
-- would be found the hard way.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS athlete_availability_day_idx
  ON public.athlete_availability (athlete_id, day_of_week);

COMMENT ON TABLE public.athlete_availability IS
  'Days an athlete can train, one row per day, each with an optional note. No row means unavailable — there is no "false" row.';


-- ---------------------------------------------------------------------------
-- 3. Admin fields on the athlete.
--
-- club already exists and has never had a UI. school does not exist at all.
-- Both are the kind of thing a coach needs when a school championship entry
-- is due and nothing in the app can answer it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS school text;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS coaching_plan_id uuid REFERENCES public.coaching_plans(id) ON DELETE SET NULL;

-- NULL means "whatever the plan says". A figure here is a deliberate
-- exception for this athlete, so the two remain distinguishable and a plan
-- price change still reaches everyone who has not been given an exception.
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS fee_amount_override numeric
    CHECK (fee_amount_override IS NULL OR fee_amount_override >= 0);

-- Anything about availability that is not tied to a single day: "away in
-- January", "exam block in June".
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS availability_notes text;

-- Free-text admin notes. Explicitly NOT for training or performance
-- observations — those belong on sessions and in the coach diary, where they
-- are dated and searchable.
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS admin_notes text;

COMMENT ON COLUMN public.athletes.fee_amount_override IS
  'Individual fee for this athlete. NULL means use the coaching plan''s amount — kept distinct so a plan price change still reaches athletes without an explicit exception.';


-- ---------------------------------------------------------------------------
-- 4. RLS.
--
-- coaching_plans belong to the coach who created them. athlete_availability
-- follows the athlete, using can_access_athlete() rather than a hand-copied
-- rule — copying that access logic is what previously missed the manager role
-- on the gear-media policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.coaching_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_availability ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_availability TO authenticated;

DROP POLICY IF EXISTS "coaching plans own" ON public.coaching_plans;
CREATE POLICY "coaching plans own" ON public.coaching_plans
  FOR ALL TO authenticated
  USING (coach_user_id = auth.uid())
  WITH CHECK (coach_user_id = auth.uid());

DROP POLICY IF EXISTS "availability via athlete" ON public.athlete_availability;
CREATE POLICY "availability via athlete" ON public.athlete_availability
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname='public' AND tablename IN ('coaching_plans','athlete_availability');
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='athletes'
--    AND column_name IN ('school','coaching_plan_id','fee_amount_override','availability_notes','admin_notes')
--  ORDER BY column_name;
-- Expect 5 rows.
--
-- Nothing is seeded — no default plans, no assumed availability. An athlete
-- with no availability rows is simply unrecorded, not unavailable every day.
