-- ============================================================================
-- ILLNESS — giving it somewhere to live.
--
-- WHY THIS EXTENDS injuries RATHER THAN ADDING AN illnesses TABLE
--
-- The two records differ in about three columns and agree on everything else:
-- onset date, resolved date, severity, status, notes, whether a health
-- professional is involved, appointments, and dated progress updates. Both
-- injury_updates and injury_appointments already exist and apply to an illness
-- unchanged — a chest infection has appointments and gets better in stages
-- exactly like an achilles does.
--
-- More importantly, everything that will ever CONSUME this wants the same
-- thing: the periods an athlete was compromised, whatever the cause. Athlete
-- availability, the campaign interruption flow, a coach's weekly report, the
-- calendar. Two tables would mean every one of those unions them, and the
-- moment one consumer forgets, illness silently stops counting — which is the
-- exact drift this codebase has been bitten by repeatedly (four volume
-- estimators, two campaign settings forms, the legend that disagreed with the
-- cells).
--
-- The cost is one discriminator column and a CHECK constraint. That is much
-- cheaper than a second table plus duplicated children plus every future
-- reader remembering both.
--
-- The table keeps the name `injuries`. Renaming it would touch RLS policies,
-- two child tables' foreign keys, and every query in the app for a cosmetic
-- gain; the UI can say "Injuries & Illness" without the table agreeing.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The discriminator
--
-- Defaults to 'injury' so every existing row is correct without a backfill.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'injury';

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_kind_check
      CHECK (kind = ANY (ARRAY['injury','illness']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.injuries.kind IS
  'injury or illness. The table holds both — they share onset/resolution/severity/status/notes/appointments/updates and differ only in how the problem is described.';


-- ---------------------------------------------------------------------------
-- 2. What an illness is
--
-- Coarse on purpose. This is a coach's record, not a clinical one: the
-- categories that change a training decision are respiratory-above-the-neck,
-- respiratory-below-the-neck, gut, fever, and everything else. Finer
-- granularity would be inventing detail the person entering it does not have.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS illness_type text;

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_illness_type_check
      CHECK (illness_type IS NULL OR illness_type = ANY (ARRAY[
        'respiratory_upper','respiratory_lower','gastrointestinal',
        'fever','viral','other'
      ]::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.injuries.illness_type IS
  'Coarse category for kind = illness. respiratory_upper is head-cold territory; respiratory_lower is chest. Null for injuries.';


-- ---------------------------------------------------------------------------
-- 3. Symptoms below the neck
--
-- Nullable, and nothing reads it automatically.
--
-- It is here because it is the one question a coach actually asks before
-- deciding whether an athlete trains through something, and because recording
-- the answer at the time is worth far more than reconstructing it afterwards.
-- Whether it means rest is a judgement this table does not make — it stores
-- what was observed, not what should follow from it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS symptoms_below_neck boolean;

COMMENT ON COLUMN public.injuries.symptoms_below_neck IS
  'Chest, gut or systemic symptoms rather than head-and-throat only. Recorded because it is the question a coach asks; deliberately not wired to any automatic decision.';


-- ---------------------------------------------------------------------------
-- 4. What it meant for training
--
-- Applies to BOTH kinds, which is half the reason they belong in one table.
-- This is the column a campaign interruption would read to know how much of a
-- block was actually lost, and the one that makes an illness record useful six
-- months later rather than just a note that someone was unwell.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS training_impact text NOT NULL DEFAULT 'modified';

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_training_impact_check
      CHECK (training_impact = ANY (ARRAY['none','modified','stopped']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.injuries.training_impact IS
  'none = trained as normal, modified = trained around it, stopped = no training. Applies to injuries and illnesses alike.';


-- ---------------------------------------------------------------------------
-- 5. body_part stops being mandatory
--
-- An illness has no body part and no side. The NOT NULL was correct while the
-- table only held injuries and is the single thing actually blocking illness
-- from being recorded at all.
--
-- Replaced with a conditional constraint so an INJURY still cannot be saved
-- without one — the guarantee is kept where it applies rather than dropped
-- outright.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ALTER COLUMN body_part DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_kind_shape_check
      CHECK (
        (kind = 'injury'  AND body_part IS NOT NULL)
        OR
        (kind = 'illness' AND illness_type IS NOT NULL)
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 6. Finding the active ones quickly
--
-- Partial index: the overwhelmingly common read is "what is currently going on
-- with this athlete", and an archived record from two seasons ago never
-- appears in it.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS injuries_athlete_kind_status_idx
  ON public.injuries (athlete_id, kind, status)
  WHERE archived = false;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='injuries'
--    AND column_name IN ('kind','illness_type','symptoms_below_neck','training_impact','body_part')
--  ORDER BY column_name;
--
-- Expect: body_part is_nullable = YES; kind default 'injury'; training_impact
-- default 'modified'; illness_type and symptoms_below_neck nullable.
--
-- SELECT kind, COUNT(*) FROM public.injuries GROUP BY kind;
-- Expect: every existing row as 'injury'.
