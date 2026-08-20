-- ============================================================================
-- PROGRESSION RUNS — prescribing them, and recording whether one was intended.
--
-- THE PROBLEM
--
-- A deliberate negative split, going out too conservatively, and a tempo that
-- got away from someone all produce the same trace. Nothing in the data
-- distinguishes them. So the app currently reads a rising pace as pace
-- CONTRAST, splits the run into warmup + work, and flags it for review — the
-- least-wrong default when intent is unknowable, but wrong every time on a
-- progression run.
--
-- Intent has to come from a person. There are two moments it can:
--
--   BEFORE   the coach prescribed a build — written down in advance, and the
--            more reliable of the two.
--   AFTER    someone says so when asked, which is the only option when the
--            run was not prescribed at all.
--
-- This migration adds one column for each.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Prescribing a build: a step gains an END pace.
--
-- WHY ONE FIELD AND NOT A SHAPE ENUM
--
-- "Step down for the last 5km" is ALREADY expressible: two blocks, 10km at
-- 4:30 then 5km at 3:50. Multi-block prescription works today and states the
-- breakpoint explicitly rather than encoding it in a parameter.
--
-- The only thing the schema could not express is the continuous EVEN build —
-- one block whose pace changes gradually throughout. Both paces present and
-- the end faster means build between them; absent means steady. No enum, no
-- breakpoint column, and step-downs keep working exactly as they do now.
-- ---------------------------------------------------------------------------
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS target_pace_end_sec_per_km numeric;

COMMENT ON COLUMN public.steps.target_pace_end_sec_per_km IS
  'Finish pace for a progressive block. With target_pace_sec_per_km as the start, the pair describes a continuous build. Null means a steady target. Step-downs are authored as separate blocks instead, which states the breakpoint explicitly.';

-- Sanity only. Deliberately does NOT require the end to be faster than the
-- start: a coach prescribing a controlled fade is doing something real, and
-- the schema should not forbid it just because the classifier only treats
-- end-faster as a reason to suppress the workout split.
DO $$ BEGIN
  ALTER TABLE public.steps
    ADD CONSTRAINT steps_target_pace_end_positive_check
      CHECK (target_pace_end_sec_per_km IS NULL OR target_pace_end_sec_per_km > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 2. Recording the answer when someone is asked.
--
-- THREE STATES, NOT A BOOLEAN.
--
--   NULL           nobody has been asked, or nobody has answered
--   'intended'     a build, so the rising pace is adherence
--   'not_intended' it rose and should not have
--
-- The third state is the one worth having. "Went too fast" cannot be detected
-- from a trace, but it is exactly what someone tells you when they answer no —
-- so a boolean, or treating "no" as "leave it alone", would throw away the
-- only reliable answer to the question this feature exists to ask.
--
-- It also stops the question being asked twice. Without a recorded "no", every
-- recompute would raise it again, and a prompt that keeps returning after it
-- has been answered is one people learn to dismiss unread.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progression_intent text;

DO $$ BEGIN
  ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_progression_intent_check
      CHECK (progression_intent IS NULL
             OR progression_intent = ANY (ARRAY['intended','not_intended']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.sessions.progression_intent IS
  'Whether a detected rising pace was deliberate. Null = unanswered. not_intended is meaningful data, not an absence — it is the only reliable record that a run was run too hard.';


-- ---------------------------------------------------------------------------
-- 3. Who answered, and when.
--
-- Both the coach and the athlete can answer, and they know different things —
-- the athlete what they did, the coach what they asked for. Recording which
-- of them said so keeps a later disagreement legible rather than leaving an
-- anonymous verdict nobody can question.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progression_answered_by uuid;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progression_answered_at timestamptz;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public'
--    AND ((table_name='steps'    AND column_name='target_pace_end_sec_per_km')
--      OR (table_name='sessions' AND column_name LIKE 'progression%'))
--  ORDER BY table_name, column_name;
-- Expect 4 rows, all nullable.
--
-- SELECT COUNT(*) FROM public.sessions WHERE progression_intent IS NOT NULL;
-- Expect 0 — nothing has been asked yet.
