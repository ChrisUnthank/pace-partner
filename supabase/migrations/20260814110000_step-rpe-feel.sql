-- ============================================================================
-- Per-step RPE and feel.
--
-- sessions.rpe and session_insights.feel_score are session-level: one number
-- for the whole thing. That doesn't describe how a session is actually
-- experienced, and Jack already rates it the way it happens:
--
--     warm up   RPE 2, felt normal
--     reps      RPE 7, felt poor
--     cool down RPE 3, felt normal
--
-- Collapsed to one session number, that becomes something like RPE 5 / normal
-- — which is true of no part of the session. Worse for the model: "reps felt
-- poor at RPE 7" is the signal worth having, and averaging it against an easy
-- warm up is exactly what buries it.
--
-- It also matters for Final Surge users specifically: warm ups arrive there as
-- their OWN session, so a per-step rating is the only way a merged session can
-- carry both ratings without inventing an average.
--
-- steps.target_rpe already exists — that's the PRESCRIBED effort, what the
-- coach asked for. These are the REPORTED ones, what the athlete felt. Kept
-- separate on purpose: comparing asked-for against delivered is the useful
-- comparison, and one column can't hold both.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS actual_rpe   numeric,
  ADD COLUMN IF NOT EXISTS feel_score   integer,
  ADD COLUMN IF NOT EXISTS feel_note    text;

COMMENT ON COLUMN public.steps.actual_rpe IS
  'REPORTED effort for this step, 1-10 — what the athlete felt. Distinct from target_rpe, which is what was prescribed.';
COMMENT ON COLUMN public.steps.feel_score IS
  'How this step felt, 1-5 (1 poor .. 5 great). Same scale as session_insights.feel_score so the two can be read together.';
COMMENT ON COLUMN public.steps.feel_note IS
  'Optional free text about this step specifically — "legs flat on the last two", "quads tight from Saturday".';

-- Guards, because a 70 typed into an RPE box shouldn't become data.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'steps_actual_rpe_range') THEN
    ALTER TABLE public.steps
      ADD CONSTRAINT steps_actual_rpe_range CHECK (actual_rpe IS NULL OR (actual_rpe >= 1 AND actual_rpe <= 10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'steps_feel_score_range') THEN
    ALTER TABLE public.steps
      ADD CONSTRAINT steps_feel_score_range CHECK (feel_score IS NULL OR (feel_score >= 1 AND feel_score <= 5));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS steps_actual_rpe_idx ON public.steps (session_id, kind)
  WHERE actual_rpe IS NOT NULL;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- A distance-weighted session RPE, derived from the steps that have one.
--
-- Deliberately a VIEW-style function rather than a stored column: sessions.rpe
-- stays exactly as it is, so nothing that reads it changes behaviour. This is
-- for anywhere a single number is genuinely wanted, and it weights by distance
-- so a 2km warm up at RPE 2 doesn't count as much as 8km of reps at RPE 7.
--
-- Returns NULL when no step has a rating, rather than inventing one.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.session_weighted_rpe(_session_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH step_dist AS (
    SELECT st.id, st.actual_rpe, COALESCE(SUM(ir.actual_distance_m), 0) AS m
    FROM public.steps st
    LEFT JOIN public.interval_results ir ON ir.step_id = st.id
    WHERE st.session_id = _session_id AND st.actual_rpe IS NOT NULL
    GROUP BY st.id, st.actual_rpe
  )
  SELECT CASE
           WHEN SUM(m) > 0 THEN ROUND(SUM(actual_rpe * m) / SUM(m), 1)
           -- No recorded distance on any rated step: fall back to a plain
           -- mean rather than dividing by zero.
           WHEN COUNT(*) > 0 THEN ROUND(AVG(actual_rpe), 1)
           ELSE NULL
         END
  FROM step_dist;
$function$;

REVOKE ALL ON FUNCTION public.session_weighted_rpe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_weighted_rpe(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='steps'
--   AND column_name IN ('actual_rpe','feel_score','feel_note');
