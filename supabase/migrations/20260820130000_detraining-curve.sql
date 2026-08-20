-- ============================================================================
-- DETRAINING REFERENCE — how much fitness credit survives a layoff.
--
-- THE PROBLEM THIS REPLACES
--
-- recompute_readiness scores load_balance by penalising ATL/CTL below 0.8 as
-- hard as above 1.3. Complete rest for one week drives the ratio to 0.44 and
-- the balance score to about 46 — so a taper reads as a problem, and the
-- dashboard fires "under-loaded, consider adding a session" during race week.
--
-- The underlying error is using one symmetric penalty for two things that
-- behave nothing alike. FATIGUE accumulates and dissipates fast — a 7-day
-- time constant is right for it. FITNESS accumulates and dissipates slowly,
-- and CTL's 42-day constant books a 15% loss after a week off and 49% after
-- four weeks, which massively overstates what actually happens to an
-- endurance athlete.
--
-- CTL itself is not wrong. It honestly measures chronic training LOAD, and
-- that genuinely is 15% lower after a week off. The error is readiness
-- treating that as fitness lost. So CTL is left alone — changing its decay
-- would rewrite every historical figure and break comparability with
-- everything already on screen — and this table changes what readiness DOES
-- with it.
--
--
-- WHY A CURVE EVALUATED ON TOTAL DAYS, NOT A RUNNING TALLY
--
-- retention is a function of ELAPSED absence, looked up once. It is never a
-- sum of daily decrements.
--
-- That distinction answers the obvious question — "if the first week is free
-- and the athlete then misses a month, do we owe the forgiven days?" No.
-- f(30) is calibrated for a 30-day layoff end to end; it was never "7 free
-- days plus 23 charged ones". The two formulations agree exactly when the
-- decrements come from this same curve, and only diverge if the daily rate is
-- flat — which would be a linear model contradicting the very shape it exists
-- to represent.
--
--
-- WHAT THE FLOOR IS, AND WHAT IT IS NOT
--
-- The curve keeps falling to a residual floor rather than plateauing, because
-- an athlete six months out is not sitting at 60% of anything.
--
-- The floor is NOT muscle memory. Muscle memory — myonuclear retention,
-- retained neuromuscular patterning — is real, but it governs how FAST a
-- returning athlete rebuilds, not how much fitness they still have while they
-- are away. Treating it as retained fitness would tell a coach a long-absent
-- athlete is readier than they are, which is the wrong direction to be wrong
-- in. The floor is here for a narrower reason: residual base that a trained
-- body keeps, and the fact that readiness is a poor question to ask of
-- someone who has not trained in half a year anyway.
--
-- Modelling muscle memory properly means a RETURN-TO-TRAINING accelerator —
-- a faster CTL rebuild for someone with history — which is a separate
-- mechanism and a separate decision. apply_starting_fitness / seed_ctl is the
-- existing hook for that if it is ever wanted.
--
--
-- WHY PER ATHLETE
--
-- A 17-year-old and a masters athlete do not detrain alike, and a coach's
-- read on their own athlete beats any default. Rows with athlete_id NULL are
-- the shared baseline; an athlete with their own rows uses those instead.
-- Tuning is then a data edit, not a migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.detraining_curve_points (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = the shared default curve. A row set means this athlete overrides
  -- the default entirely, rather than merging with it — a half-overridden
  -- curve would be very hard to reason about from the UI.
  athlete_id   uuid REFERENCES public.athletes(id) ON DELETE CASCADE,

  days_off     integer NOT NULL CHECK (days_off >= 0),
  -- Percentage of fitness credit still counted after this much absence.
  retention_pct numeric NOT NULL CHECK (retention_pct >= 0 AND retention_pct <= 100),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One retention value per day-mark per curve. Two rows for the same day would
-- make interpolation ambiguous and silently order-dependent.
--
-- TWO PARTIAL INDEXES rather than one expression index over
-- COALESCE(athlete_id, <sentinel>). The COALESCE form needs its expression
-- treated as indexable and invents a magic UUID that means "the default
-- curve" — a value that would then be sitting in the table's index with no
-- row explaining it. Partial indexes say the same thing in the language the
-- constraint is actually written in: unique per athlete, and unique among
-- the shared default rows.
CREATE UNIQUE INDEX IF NOT EXISTS detraining_curve_athlete_day_idx
  ON public.detraining_curve_points (athlete_id, days_off)
  WHERE athlete_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS detraining_curve_default_day_idx
  ON public.detraining_curve_points (days_off)
  WHERE athlete_id IS NULL;

COMMENT ON TABLE public.detraining_curve_points IS
  'Piecewise-linear detraining reference. athlete_id NULL is the shared default; an athlete with rows overrides it wholesale. Retention is a function of total elapsed absence, never a running tally.';


-- ---------------------------------------------------------------------------
-- The default curve.
--
-- Nothing to day 7, so a taper costs nothing. A gentle 1-3% across days 8-10,
-- because a two-week taper does carry a small real cost a coach manages
-- deliberately and pretending otherwise would be as dishonest as the current
-- over-penalty. Then a steepening decline, and a residual floor at six
-- months.
--
-- These figures follow the general shape of the detraining literature —
-- little measurable change in the first ten days, small but real by two to
-- three weeks, substantial by four to six — but they are a defensible
-- STARTING POINT rather than anything precise, which is exactly why they live
-- in an editable table.
-- ---------------------------------------------------------------------------
-- Per row, not all-or-nothing. The earlier form skipped the whole insert if
-- ANY default row existed, so a partially-applied run would have left a
-- half-built curve that no re-run would ever complete.
INSERT INTO public.detraining_curve_points (athlete_id, days_off, retention_pct)
SELECT NULL, v.d, v.r
FROM (VALUES
  (0, 100), (7, 100), (10, 97), (14, 93), (21, 85), (28, 76),
  (42, 62), (60, 50), (90, 38), (120, 30), (180, 25)
) AS v(d, r)
WHERE NOT EXISTS (
  SELECT 1 FROM public.detraining_curve_points e
   WHERE e.athlete_id IS NULL AND e.days_off = v.d
);


-- ---------------------------------------------------------------------------
-- Resolver: retention for an athlete at a given absence, interpolated.
--
-- STABLE rather than IMMUTABLE — it reads a table, and marking it immutable
-- would let the planner cache results across an edit to the curve.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detraining_retention(_athlete_id uuid, _days_off numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  use_athlete uuid;
  lo_d numeric; lo_r numeric;
  hi_d numeric; hi_r numeric;
BEGIN
  IF _days_off IS NULL OR _days_off <= 0 THEN
    RETURN 100;
  END IF;

  -- The athlete's own curve if they have one, otherwise the shared default.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.detraining_curve_points WHERE athlete_id = _athlete_id
  ) THEN _athlete_id ELSE NULL END INTO use_athlete;

  SELECT days_off, retention_pct INTO lo_d, lo_r
    FROM public.detraining_curve_points
   WHERE athlete_id IS NOT DISTINCT FROM use_athlete AND days_off <= _days_off
   ORDER BY days_off DESC LIMIT 1;

  SELECT days_off, retention_pct INTO hi_d, hi_r
    FROM public.detraining_curve_points
   WHERE athlete_id IS NOT DISTINCT FROM use_athlete AND days_off >= _days_off
   ORDER BY days_off ASC LIMIT 1;

  -- Past the last point the curve holds at its floor rather than continuing
  -- to extrapolate downward, which would eventually cross zero.
  IF lo_d IS NOT NULL AND hi_d IS NULL THEN RETURN lo_r; END IF;
  IF lo_d IS NULL AND hi_d IS NOT NULL THEN RETURN hi_r; END IF;
  IF lo_d IS NULL AND hi_d IS NULL THEN RETURN 100; END IF;
  IF hi_d = lo_d THEN RETURN lo_r; END IF;

  RETURN ROUND(lo_r + (hi_r - lo_r) * (_days_off - lo_d) / (hi_d - lo_d), 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.detraining_retention(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detraining_retention(uuid, numeric) TO authenticated;


-- ---------------------------------------------------------------------------
-- Equivalent days off, over a window.
--
-- NOT "days since the last session". A single token 5k would reset that to
-- zero, so an athlete jogging occasionally through a six-week injury would
-- accrue no penalty at all — worse than the behaviour being replaced.
--
-- Instead each day contributes 1 - (that day's load / a normal day's load),
-- clamped to 0..1. A day at 30% volume counts as 0.7 of a day off. Three
-- weeks at 30% reads as about 15 equivalent days rather than either 0 or 21,
-- which is the honest answer and handles reduced-volume-through-injury
-- without needing a rule of its own.
--
-- "Normal" is the athlete's own CTL at the START of the window, so this is
-- self-scaling: it asks how much less than usual, not how much in absolute
-- terms, and never needs calibrating per athlete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equivalent_days_off(_athlete_id uuid, _date date, _window_days int DEFAULT 180)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  baseline numeric;
  total numeric;
BEGIN
  SELECT ctl INTO baseline
    FROM public.athlete_load_daily
   WHERE athlete_id = _athlete_id AND load_date <= _date - _window_days
   ORDER BY load_date DESC LIMIT 1;

  IF baseline IS NULL THEN
    SELECT MAX(ctl) INTO baseline
      FROM public.athlete_load_daily
     WHERE athlete_id = _athlete_id AND load_date <= _date;
  END IF;

  -- No history, or an athlete who has never trained: nothing to detrain from.
  IF baseline IS NULL OR baseline <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(GREATEST(0, LEAST(1, 1 - COALESCE(combined_load, 0) / baseline))), 0)
    INTO total
    FROM public.athlete_load_daily
   WHERE athlete_id = _athlete_id
     AND load_date > _date - _window_days
     AND load_date <= _date;

  RETURN ROUND(total, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.equivalent_days_off(uuid, date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equivalent_days_off(uuid, date, int) TO authenticated;


-- ---------------------------------------------------------------------------
-- RLS — a coach tuning their own athlete's curve, and nobody else's.
-- ---------------------------------------------------------------------------
-- If the script fails as one block, run from here separately — the SQL
-- Editor wraps a multi-statement script in a single transaction, so ONE
-- failure anywhere rolls back the table and both functions above with it.
--
-- can_access_athlete() has EXECUTE revoked from `authenticated`, which looks
-- alarming here and is not a problem: RLS policy expressions are evaluated
-- with the table owner's privileges, not the caller's. campaign_week_fills
-- already uses it this way. The revoke exists to stop clients calling it
-- directly, which is a different thing.
ALTER TABLE public.detraining_curve_points ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.detraining_curve_points TO authenticated;

DROP POLICY IF EXISTS "detraining default readable" ON public.detraining_curve_points;
CREATE POLICY "detraining default readable" ON public.detraining_curve_points
  FOR SELECT TO authenticated
  USING (athlete_id IS NULL OR public.can_access_athlete(auth.uid(), athlete_id));

-- The shared default is deliberately NOT writable from the app: one coach
-- editing it would silently move every other athlete's curve.
DROP POLICY IF EXISTS "detraining athlete writable" ON public.detraining_curve_points;
CREATE POLICY "detraining athlete writable" ON public.detraining_curve_points
  FOR ALL TO authenticated
  USING (athlete_id IS NOT NULL AND public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (athlete_id IS NOT NULL AND public.can_access_athlete(auth.uid(), athlete_id));

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately. Nothing above changes any readiness score yet;
-- this migration only adds the reference. The formula change is separate and
-- needs a backfill.
-- ============================================================================
-- SELECT days_off, retention_pct FROM public.detraining_curve_points
--  WHERE athlete_id IS NULL ORDER BY days_off;
-- Expect 11 rows, 100 down to 25.
--
-- Interpolation spot-checks:
-- SELECT public.detraining_retention(NULL, 0)   AS d0,    -- 100
--        public.detraining_retention(NULL, 7)   AS d7,    -- 100
--        public.detraining_retention(NULL, 9)   AS d9,    -- 98
--        public.detraining_retention(NULL, 30)  AS d30,   -- ~74
--        public.detraining_retention(NULL, 365) AS d365;  -- 25 (floor holds)
--
-- Equivalent days off for a real athlete over the last month:
-- SELECT a.name, public.equivalent_days_off(a.id, CURRENT_DATE, 30)
--   FROM public.athletes a ORDER BY a.name;
