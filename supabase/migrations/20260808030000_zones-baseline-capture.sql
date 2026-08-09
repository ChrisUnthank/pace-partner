-- ============================================================================
-- Zones — Phase 0: baseline capture (bring the LIVE system under version
-- control, unchanged)
-- ============================================================================
--
-- WHAT THIS IS AND ISN'T
-- Every statement in this file reproduces exactly what was already running
-- live in the database, extracted via pg_get_functiondef on 8 Aug 2026. It
-- makes ZERO behavioural changes. Its only job is to close a real gap: none
-- of this — five zone/threshold functions, the VDOT auto-selection system,
-- three triggers, and six columns — had ever been committed to GitHub. Only
-- a stale, superseded version of a couple of these functions existed in
-- earlier migrations, which is what made this gap easy to miss.
--
-- The actual fix (proportional pace-zone math) is in the NEXT migration,
-- 20260808040000, deliberately kept separate — this file is pure "make
-- reality match source control," so a `git diff` against the next migration
-- shows only the real behavioural change, not this catch-up noise mixed in.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. Columns added to athlete_zone_profiles since the original CREATE TABLE ──
ALTER TABLE public.athlete_zone_profiles
  ADD COLUMN IF NOT EXISTS hr_threshold integer,
  ADD COLUMN IF NOT EXISTS hr_z6_max integer,
  ADD COLUMN IF NOT EXISTS pace_z1_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS pace_z2_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS pace_z3_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS pace_z4_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS pace_z5_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS pace_z6_max_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS hr_zones_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pace_zones_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hr_threshold_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS pace_threshold_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS hr_method text,
  ADD COLUMN IF NOT EXISTS pace_method text,
  ADD COLUMN IF NOT EXISTS preferred_zone_basis text NOT NULL DEFAULT 'pace',
  ADD COLUMN IF NOT EXISTS vdot numeric,
  ADD COLUMN IF NOT EXISTS vdot_source_performance_id uuid REFERENCES public.performances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vdot_source_override boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.athlete_zone_profiles
    ADD CONSTRAINT athlete_zone_profiles_hr_threshold_source_check
      CHECK (hr_threshold_source IN ('auto', 'manual', 'test'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_zone_profiles
    ADD CONSTRAINT athlete_zone_profiles_pace_threshold_source_check
      CHECK (pace_threshold_source IN ('auto', 'manual', 'test'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_zone_profiles
    ADD CONSTRAINT athlete_zone_profiles_preferred_zone_basis_check
      CHECK (preferred_zone_basis IN ('pace', 'hr'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 2. Columns added to session_zone_time since the original CREATE TABLE ──
ALTER TABLE public.session_zone_time
  ADD COLUMN IF NOT EXISTS pace_5k_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS hr_z1_max integer,
  ADD COLUMN IF NOT EXISTS hr_z2_max integer,
  ADD COLUMN IF NOT EXISTS hr_z3_max integer,
  ADD COLUMN IF NOT EXISTS hr_z4_max integer,
  ADD COLUMN IF NOT EXISTS hr_z5_max integer,
  ADD COLUMN IF NOT EXISTS boundaries_computed_at timestamptz;

COMMENT ON COLUMN public.session_zone_time.pace_5k_sec_per_km IS
  'Snapshot of the pace threshold active when this row was computed — historically named after the old 5K-based model, now holds pace_threshold_sec_per_km at compute time regardless of source. Kept for backward compatibility rather than renamed, since renaming would break every existing row''s meaning silently.';


-- ── 3. The four pure/deterministic zone-math functions, as they actually run live ──

CREATE OR REPLACE FUNCTION public.compute_vdot(_distance_m numeric, _time_seconds numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _distance_m IS NULL OR _time_seconds IS NULL OR _distance_m <= 0 OR _time_seconds <= 0 THEN NULL
    ELSE (
      WITH v AS (
        SELECT (_distance_m * 60.0) / _time_seconds AS velocity
      ),
      vo2 AS (
        SELECT -4.60 + 0.182258 * velocity + 0.000104 * power(velocity, 2) AS vo2_val FROM v
      ),
      drop_factor AS (
        SELECT 0.2989558 * exp(-0.1932605 * (_time_seconds / 60.0))
             + 0.1894393 * exp(-0.012778 * (_time_seconds / 60.0))
             + 0.8 AS d
      )
      SELECT vo2.vo2_val / drop_factor.d FROM vo2, drop_factor
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.vdot_threshold_pace_sec_per_km(_vdot numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _vdot IS NULL OR _vdot <= 0 THEN NULL
    ELSE (
      WITH d60 AS (
        SELECT 0.2989558 * exp(-0.1932605 * 60.0) + 0.1894393 * exp(-0.012778 * 60.0) + 0.8 AS d
      ),
      target_vo2 AS (
        SELECT _vdot * d60.d AS vo2_t FROM d60
      ),
      solved AS (
        SELECT (-0.182258 + sqrt(power(0.182258, 2) + 4 * 0.000104 * (4.60 + target_vo2.vo2_t)))
               / (2 * 0.000104) AS velocity
        FROM target_vo2
      )
      SELECT 60000.0 / solved.velocity FROM solved
    )
  END;
$function$;

-- NOTE: this is the ORIGINAL flat-second-offset version, captured as-is for
-- an accurate baseline. It is immediately replaced by the proportional
-- version in the next migration (20260808040000) — left unchanged here on
-- purpose so this file is a true, honest snapshot of what was live.
CREATE OR REPLACE FUNCTION public.zones_from_hr_threshold(_hr_threshold integer)
RETURNS TABLE(z1_max integer, z2_max integer, z3_max integer, z4_max integer, z5_max integer, z6_max integer)
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT
    ROUND(_hr_threshold * 0.72)::int,
    ROUND(_hr_threshold * 0.83)::int,
    ROUND(_hr_threshold * 0.94)::int,
    ROUND(_hr_threshold * 1.00)::int,
    ROUND(_hr_threshold * 1.08)::int,
    ROUND(_hr_threshold * 1.08)::int + 15
  WHERE _hr_threshold IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.zones_from_pace_threshold(_threshold_sec_per_km numeric)
RETURNS TABLE(z1_max numeric, z2_max numeric, z3_max numeric, z4_max numeric, z5_max numeric, z6_max numeric)
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT
    _threshold_sec_per_km + 85,
    _threshold_sec_per_km + 45,
    _threshold_sec_per_km + 20,
    _threshold_sec_per_km - 5,
    _threshold_sec_per_km - 20,
    _threshold_sec_per_km - 35
  WHERE _threshold_sec_per_km IS NOT NULL;
$function$;


-- ── 4. The manual-set / reset RPCs (both overload generations, exactly as live) ──

CREATE OR REPLACE FUNCTION public.set_hr_threshold_manual(_athlete_id uuid, _hr_threshold integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE hr_z record;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  SELECT * INTO hr_z FROM public.zones_from_hr_threshold(_hr_threshold);
  INSERT INTO public.athlete_zone_profiles (
    athlete_id, hr_threshold, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max,
    hr_zones_manual, auto_derived, updated_at
  ) VALUES (
    _athlete_id, _hr_threshold, hr_z.z1_max, hr_z.z2_max, hr_z.z3_max, hr_z.z4_max, hr_z.z5_max,
    true, false, now()
  )
  ON CONFLICT (athlete_id) DO UPDATE SET
    hr_threshold = _hr_threshold,
    hr_z1_max = hr_z.z1_max, hr_z2_max = hr_z.z2_max, hr_z3_max = hr_z.z3_max,
    hr_z4_max = hr_z.z4_max, hr_z5_max = hr_z.z5_max,
    hr_zones_manual = true, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_hr_threshold_manual(_athlete_id uuid, _hr_threshold integer, _source text DEFAULT 'manual'::text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE hr_z record;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  IF _source NOT IN ('manual', 'test') THEN
    RAISE EXCEPTION 'invalid source: %, expected manual or test', _source;
  END IF;
  SELECT * INTO hr_z FROM public.zones_from_hr_threshold(_hr_threshold);
  INSERT INTO public.athlete_zone_profiles (
    athlete_id, hr_threshold, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max, hr_z6_max,
    hr_zones_manual, hr_threshold_source, hr_method, auto_derived, updated_at
  ) VALUES (
    _athlete_id, _hr_threshold, hr_z.z1_max, hr_z.z2_max, hr_z.z3_max, hr_z.z4_max, hr_z.z5_max, hr_z.z6_max,
    true, _source, NULL, false, now()
  )
  ON CONFLICT (athlete_id) DO UPDATE SET
    hr_threshold = _hr_threshold,
    hr_z1_max = hr_z.z1_max, hr_z2_max = hr_z.z2_max, hr_z3_max = hr_z.z3_max,
    hr_z4_max = hr_z.z4_max, hr_z5_max = hr_z.z5_max, hr_z6_max = hr_z.z6_max,
    hr_zones_manual = true, hr_threshold_source = _source, hr_method = NULL, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_pace_threshold_manual(_athlete_id uuid, _threshold_sec_per_km numeric)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE pace_z record;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  SELECT * INTO pace_z FROM public.zones_from_pace_threshold(_threshold_sec_per_km);
  INSERT INTO public.athlete_zone_profiles (
    athlete_id, pace_threshold_sec_per_km, pace_z1_max_sec_per_km, pace_z2_max_sec_per_km,
    pace_z3_max_sec_per_km, pace_z4_max_sec_per_km, pace_z5_max_sec_per_km,
    pace_zones_manual, auto_derived, updated_at
  ) VALUES (
    _athlete_id, _threshold_sec_per_km, pace_z.z1_max, pace_z.z2_max, pace_z.z3_max, pace_z.z4_max, pace_z.z5_max,
    true, false, now()
  )
  ON CONFLICT (athlete_id) DO UPDATE SET
    pace_threshold_sec_per_km = _threshold_sec_per_km,
    pace_z1_max_sec_per_km = pace_z.z1_max, pace_z2_max_sec_per_km = pace_z.z2_max,
    pace_z3_max_sec_per_km = pace_z.z3_max, pace_z4_max_sec_per_km = pace_z.z4_max,
    pace_z5_max_sec_per_km = pace_z.z5_max,
    pace_zones_manual = true, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_pace_threshold_manual(_athlete_id uuid, _threshold_sec_per_km numeric, _source text DEFAULT 'manual'::text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE pace_z record;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  IF _source NOT IN ('manual', 'test') THEN
    RAISE EXCEPTION 'invalid source: %, expected manual or test', _source;
  END IF;
  SELECT * INTO pace_z FROM public.zones_from_pace_threshold(_threshold_sec_per_km);
  INSERT INTO public.athlete_zone_profiles (
    athlete_id, pace_threshold_sec_per_km, pace_z1_max_sec_per_km, pace_z2_max_sec_per_km,
    pace_z3_max_sec_per_km, pace_z4_max_sec_per_km, pace_z5_max_sec_per_km, pace_z6_max_sec_per_km,
    pace_zones_manual, pace_threshold_source, pace_method, auto_derived, updated_at
  ) VALUES (
    _athlete_id, _threshold_sec_per_km, pace_z.z1_max, pace_z.z2_max, pace_z.z3_max, pace_z.z4_max,
    pace_z.z5_max, pace_z.z6_max,
    true, _source, NULL, false, now()
  )
  ON CONFLICT (athlete_id) DO UPDATE SET
    pace_threshold_sec_per_km = _threshold_sec_per_km,
    pace_z1_max_sec_per_km = pace_z.z1_max, pace_z2_max_sec_per_km = pace_z.z2_max,
    pace_z3_max_sec_per_km = pace_z.z3_max, pace_z4_max_sec_per_km = pace_z.z4_max,
    pace_z5_max_sec_per_km = pace_z.z5_max, pace_z6_max_sec_per_km = pace_z.z6_max,
    pace_zones_manual = true, pace_threshold_source = _source, pace_method = NULL, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_hr_zones_to_auto(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  UPDATE public.athlete_zone_profiles
     SET hr_zones_manual = false, hr_threshold_source = 'auto'
   WHERE athlete_id = _athlete_id;
  PERFORM public.recompute_athlete_zone_profile(_athlete_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_pace_zones_to_auto(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  UPDATE public.athlete_zone_profiles
     SET pace_zones_manual = false, pace_threshold_source = 'auto'
   WHERE athlete_id = _athlete_id;
  PERFORM public.recompute_athlete_zone_profile(_athlete_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_vdot_to_auto(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  UPDATE public.athlete_zone_profiles
     SET vdot_source_override = false
   WHERE athlete_id = _athlete_id;
  PERFORM public.recompute_athlete_zone_profile(_athlete_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_vdot_source_performance(_athlete_id uuid, _performance_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.performances WHERE id = _performance_id AND athlete_id = _athlete_id) THEN
    RAISE EXCEPTION 'performance % does not belong to athlete %', _performance_id, _athlete_id;
  END IF;
  UPDATE public.athlete_zone_profiles
     SET vdot_source_performance_id = _performance_id, vdot_source_override = true
   WHERE athlete_id = _athlete_id;
  PERFORM public.recompute_athlete_zone_profile(_athlete_id);
END;
$function$;


-- ── 5. The two orchestrator functions — the core logic. Captured as-is; the ──
-- ── proportional-pace fix in the next migration touches ONLY               ──
-- ── zones_from_pace_threshold above, so neither of these needs to change.  ──

CREATE OR REPLACE FUNCTION public.recompute_athlete_zone_profile(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ath record;
  zp record;
  pace_5k_v numeric;
  pace_threshold_v numeric;
  hr_threshold_v integer;
  hr_z record;
  pace_z record;
  vdot_v numeric;
  vdot_perf_id uuid;
BEGIN
  SELECT * INTO ath FROM public.athletes WHERE id = _athlete_id;
  IF ath IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = _athlete_id;

  -- Pace anchor (Riegel-based reference pace, scaled from any qualifying
  -- 3K+ effort to a 5K-equivalent) — the input signal for the 'auto' pace
  -- method, before it's further converted to a threshold value below.
  SELECT MIN(time_seconds * power(5000.0 / distance_m, 1.06) / 5.0) INTO pace_5k_v
  FROM public.performances
  WHERE athlete_id = _athlete_id
    AND distance_m >= 3000
    AND time_seconds IS NOT NULL
    AND performance_date >= CURRENT_DATE - INTERVAL '12 months';

  IF ath.hr_max IS NOT NULL THEN
    hr_threshold_v := ROUND(ath.hr_max * 0.90)::int;
  END IF;

  -- VDOT: a coach override (if set and still valid) takes that specific
  -- race's VDOT; otherwise auto-pick whichever qualifying race produces the
  -- highest VDOT. Falls through to auto-pick if there was no override, or
  -- the overridden performance no longer exists.
  IF zp IS NOT NULL AND zp.vdot_source_override AND zp.vdot_source_performance_id IS NOT NULL THEN
    SELECT public.compute_vdot(p.distance_m, p.time_seconds), p.id INTO vdot_v, vdot_perf_id
    FROM public.performances p WHERE p.id = zp.vdot_source_performance_id;
  END IF;

  IF vdot_perf_id IS NULL THEN
    SELECT public.compute_vdot(p.distance_m, p.time_seconds), p.id INTO vdot_v, vdot_perf_id
    FROM public.performances p
    WHERE p.athlete_id = _athlete_id
      AND p.distance_m >= 3000
      AND p.time_seconds IS NOT NULL
      AND p.performance_date >= CURRENT_DATE - INTERVAL '12 months'
    ORDER BY public.compute_vdot(p.distance_m, p.time_seconds) DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF zp IS NULL THEN
    -- First-time profile: pace_method starts at the existing default, vdot
    -- is stored purely informationally until a coach opts into it.
    IF pace_5k_v IS NOT NULL THEN
      pace_threshold_v := pace_5k_v * 1.06;
    END IF;
    SELECT * INTO hr_z FROM public.zones_from_hr_threshold(hr_threshold_v);
    SELECT * INTO pace_z FROM public.zones_from_pace_threshold(pace_threshold_v);
    INSERT INTO public.athlete_zone_profiles(
      athlete_id, hr_max, hr_threshold, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max, hr_z6_max,
      pace_5k_sec_per_km, pace_threshold_sec_per_km,
      pace_z1_max_sec_per_km, pace_z2_max_sec_per_km, pace_z3_max_sec_per_km, pace_z4_max_sec_per_km,
      pace_z5_max_sec_per_km, pace_z6_max_sec_per_km,
      hr_threshold_source, pace_threshold_source, hr_method, pace_method,
      vdot, vdot_source_performance_id, vdot_source_override, auto_derived, updated_at
    ) VALUES (
      _athlete_id, ath.hr_max, hr_threshold_v, hr_z.z1_max, hr_z.z2_max, hr_z.z3_max, hr_z.z4_max, hr_z.z5_max, hr_z.z6_max,
      pace_5k_v, pace_threshold_v,
      pace_z.z1_max, pace_z.z2_max, pace_z.z3_max, pace_z.z4_max, pace_z.z5_max, pace_z.z6_max,
      'auto', 'auto', 'max_hr_pct', 'best_effort_3k_plus',
      vdot_v, vdot_perf_id, false, true, now()
    );
  ELSE
    IF zp.hr_threshold_source = 'auto' AND hr_threshold_v IS NOT NULL THEN
      SELECT * INTO hr_z FROM public.zones_from_hr_threshold(hr_threshold_v);
      UPDATE public.athlete_zone_profiles SET
        hr_max = ath.hr_max, hr_threshold = hr_threshold_v,
        hr_z1_max = hr_z.z1_max, hr_z2_max = hr_z.z2_max, hr_z3_max = hr_z.z3_max,
        hr_z4_max = hr_z.z4_max, hr_z5_max = hr_z.z5_max, hr_z6_max = hr_z.z6_max,
        hr_method = 'max_hr_pct', hr_zones_manual = false, updated_at = now()
      WHERE athlete_id = _athlete_id;
    ELSIF zp.hr_threshold_source = 'auto' THEN
      UPDATE public.athlete_zone_profiles SET hr_max = ath.hr_max, updated_at = now()
      WHERE athlete_id = _athlete_id;
    END IF;

    IF zp.pace_threshold_source = 'auto' THEN
      -- Pace threshold value depends on which auto method is active —
      -- everything else (boundaries from zones_from_pace_threshold) is the
      -- same regardless of which method produced the threshold.
      IF zp.pace_method = 'vdot' AND vdot_v IS NOT NULL THEN
        pace_threshold_v := public.vdot_threshold_pace_sec_per_km(vdot_v);
      ELSIF pace_5k_v IS NOT NULL THEN
        pace_threshold_v := pace_5k_v * 1.06;
      END IF;

      IF pace_threshold_v IS NOT NULL THEN
        SELECT * INTO pace_z FROM public.zones_from_pace_threshold(pace_threshold_v);
        UPDATE public.athlete_zone_profiles SET
          pace_5k_sec_per_km = pace_5k_v, pace_threshold_sec_per_km = pace_threshold_v,
          pace_z1_max_sec_per_km = pace_z.z1_max, pace_z2_max_sec_per_km = pace_z.z2_max,
          pace_z3_max_sec_per_km = pace_z.z3_max, pace_z4_max_sec_per_km = pace_z.z4_max,
          pace_z5_max_sec_per_km = pace_z.z5_max, pace_z6_max_sec_per_km = pace_z.z6_max,
          pace_zones_manual = false, updated_at = now()
        WHERE athlete_id = _athlete_id;
      END IF;
    END IF;

    -- VDOT itself is stored regardless of threshold_source/pace_method —
    -- always kept current as an informational number.
    UPDATE public.athlete_zone_profiles SET
      vdot = vdot_v, vdot_source_performance_id = vdot_perf_id, updated_at = now()
    WHERE athlete_id = _athlete_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_session_zones(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ath_id uuid;
  zp record;
  r record;
  pace_v numeric;
  pace_band public.zone_band;
  hr_band public.zone_band;
  sess record;
  is_continuous boolean;
  duration_min numeric;
BEGIN
  SELECT athlete_id INTO ath_id FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;
  DELETE FROM public.session_zone_time WHERE session_id = _session_id;
  IF zp IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT ir.actual_time_seconds AS secs, ir.actual_pace_sec_per_km AS pace_field,
           ir.actual_distance_m AS dist, ir.hr_avg AS hr_avg, st.kind AS kind, st.reps AS reps
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id = _session_id
      AND COALESCE(ir.actual_time_seconds, 0) > 0
      AND COALESCE(st.counts_toward_distance, true) = true
  LOOP
    -- Pace bucketing, against the real threshold-derived boundaries — Auto
    -- and Manual both write into the same pace_z1..z6 columns, so this one
    -- read path already serves both. z6 is a genuine bucket here (not
    -- display-only), unlike its "ceiling" role on the profile itself.
    pace_band := NULL;
    IF zp.pace_z1_max_sec_per_km IS NOT NULL THEN
      pace_v := r.pace_field;
      IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
        pace_v := r.secs / (r.dist / 1000.0);
      END IF;
      IF pace_v IS NOT NULL THEN
        pace_band := CASE
          WHEN pace_v >= zp.pace_z1_max_sec_per_km THEN 'z1'
          WHEN zp.pace_z2_max_sec_per_km IS NOT NULL AND pace_v >= zp.pace_z2_max_sec_per_km THEN 'z2'
          WHEN zp.pace_z3_max_sec_per_km IS NOT NULL AND pace_v >= zp.pace_z3_max_sec_per_km THEN 'z3'
          WHEN zp.pace_z4_max_sec_per_km IS NOT NULL AND pace_v >= zp.pace_z4_max_sec_per_km THEN 'z4'
          WHEN zp.pace_z5_max_sec_per_km IS NOT NULL AND pace_v >= zp.pace_z5_max_sec_per_km THEN 'z5'
          ELSE 'z6'
        END;
      END IF;
    END IF;
    IF pace_band IS NOT NULL THEN
      INSERT INTO public.session_zone_time(
        session_id, athlete_id, zone, seconds, meters, source, pace_5k_sec_per_km, boundaries_computed_at
      ) VALUES (
        _session_id, ath_id, pace_band, r.secs, COALESCE(r.dist, 0), 'pace', zp.pace_threshold_sec_per_km, now()
      )
      ON CONFLICT (session_id, zone, source) DO UPDATE SET
        seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
        meters = COALESCE(public.session_zone_time.meters, 0) + COALESCE(EXCLUDED.meters, 0),
        updated_at = now();
    END IF;

    -- HR bucketing — a continuous (non-repeated, non-recovery) effort
    -- longer than 12 minutes that would otherwise read as z5/z6 gets capped
    -- at z4 instead. Cardiac drift over a long steady effort naturally
    -- pushes HR upward late in the piece even though the actual EFFORT
    -- never left threshold — without this cap, a long tempo run's closing
    -- kilometres would misclassify as VO2/Anaerobic purely from drift, not
    -- genuine intensity.
    hr_band := NULL;
    IF r.hr_avg IS NOT NULL AND zp.hr_z1_max IS NOT NULL THEN
      is_continuous := r.kind <> 'recovery' AND COALESCE(r.reps, 1) <= 1;
      duration_min := r.secs / 60.0;
      hr_band := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 'z1'
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 'z2'
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 'z3'
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 'z4'
        WHEN zp.hr_z5_max IS NOT NULL AND r.hr_avg <= zp.hr_z5_max THEN
          CASE WHEN is_continuous AND duration_min > 12 THEN 'z4' ELSE 'z5' END
        ELSE
          CASE WHEN is_continuous AND duration_min > 12 THEN 'z4' ELSE 'z6' END
      END;
    END IF;
    IF hr_band IS NOT NULL THEN
      INSERT INTO public.session_zone_time(
        session_id, athlete_id, zone, seconds, meters, source,
        hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max, boundaries_computed_at
      ) VALUES (
        _session_id, ath_id, hr_band, r.secs, COALESCE(r.dist, 0), 'hr',
        zp.hr_z1_max, zp.hr_z2_max, zp.hr_z3_max, zp.hr_z4_max, zp.hr_z5_max, now()
      )
      ON CONFLICT (session_id, zone, source) DO UPDATE SET
        seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
        meters = COALESCE(public.session_zone_time.meters, 0) + COALESCE(EXCLUDED.meters, 0),
        updated_at = now();
    END IF;
  END LOOP;

  -- Cross-training whole-session HR-zone fallback — a gym/ride/swim entry
  -- has no interval_results to loop over above, so this classifies the
  -- whole session at once off its overall average HR. Not continuous-capped
  -- like the loop above: that cap is specifically about running-session
  -- drift, and a cross-training entry has no rep structure to judge
  -- "continuous" from in the first place.
  IF NOT FOUND THEN
    SELECT activity_type, day_type, avg_hr,
           COALESCE(total_moving_time_seconds, total_time_seconds) AS dur_s, total_distance_m
    INTO sess FROM public.sessions WHERE id = _session_id;

    IF sess.avg_hr IS NOT NULL AND COALESCE(sess.dur_s, 0) > 0 AND zp.hr_z1_max IS NOT NULL
       AND (sess.day_type = 'cross_training' OR sess.activity_type IN ('gym', 'ride', 'swim')) THEN
      hr_band := CASE
        WHEN sess.avg_hr <= zp.hr_z1_max THEN 'z1'
        WHEN zp.hr_z2_max IS NOT NULL AND sess.avg_hr <= zp.hr_z2_max THEN 'z2'
        WHEN zp.hr_z3_max IS NOT NULL AND sess.avg_hr <= zp.hr_z3_max THEN 'z3'
        WHEN zp.hr_z4_max IS NOT NULL AND sess.avg_hr <= zp.hr_z4_max THEN 'z4'
        WHEN zp.hr_z5_max IS NOT NULL AND sess.avg_hr <= zp.hr_z5_max THEN 'z5'
        ELSE 'z6'
      END;
      INSERT INTO public.session_zone_time(
        session_id, athlete_id, zone, seconds, meters, source,
        hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max, boundaries_computed_at
      ) VALUES (
        _session_id, ath_id, hr_band, sess.dur_s, COALESCE(sess.total_distance_m, 0), 'hr',
        zp.hr_z1_max, zp.hr_z2_max, zp.hr_z3_max, zp.hr_z4_max, zp.hr_z5_max, now()
      )
      ON CONFLICT (session_id, zone, source) DO UPDATE SET
        seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
        meters = COALESCE(public.session_zone_time.meters, 0) + COALESCE(EXCLUDED.meters, 0),
        updated_at = now();
    END IF;
  END IF;
END;
$function$;


-- ── 6. The three triggers, and their wiring ──
--
-- HONESTY NOTE: only the trigger FUNCTION names were confirmed live
-- (trg_recompute_zones_from_athlete/_perf/_rep) — the actual CREATE TRIGGER
-- name strings, timing, and exact firing conditions were never directly
-- queried. Guessing a trigger name here would be genuinely dangerous: if the
-- live name differs from a guess, `DROP TRIGGER IF EXISTS <guess>` silently
-- does nothing, the real trigger stays, and this migration's CREATE TRIGGER
-- adds a SECOND one bound to the same function — every recompute would then
-- fire twice per event. Rather than guess, each block below finds and drops
-- whatever trigger is actually bound to that function on that table, by the
-- function binding itself (pg_trigger.tgfoid), not by name. This is correct
-- regardless of what the live trigger was actually called, and safe to
-- re-run.

CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_athlete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.hr_max IS DISTINCT FROM OLD.hr_max THEN
    PERFORM public.recompute_athlete_zone_profile(NEW.id);
  END IF;
  RETURN NULL;
END
$function$;

DO $$
DECLARE trg record;
BEGIN
  FOR trg IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'athletes' AND c.relnamespace = 'public'::regnamespace
      AND p.proname = 'trg_recompute_zones_from_athlete' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.athletes', trg.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_recompute_zones_from_athlete_after_update
  AFTER UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_athlete();

CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_perf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recompute_athlete_zone_profile(COALESCE(NEW.athlete_id, OLD.athlete_id));
  RETURN NULL;
END
$function$;

DO $$
DECLARE trg record;
BEGIN
  FOR trg IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'performances' AND c.relnamespace = 'public'::regnamespace
      AND p.proname = 'trg_recompute_zones_from_perf' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.performances', trg.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_recompute_zones_from_perf_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_perf();

CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_rep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE sid uuid; ath uuid; sdate date;
BEGIN
  SELECT s.id, s.athlete_id, s.session_date INTO sid, ath, sdate
  FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
  WHERE st.id = COALESCE(NEW.step_id, OLD.step_id);
  IF sid IS NOT NULL THEN
    PERFORM public.recompute_session_zones(sid);
    PERFORM public.recompute_readiness_range(ath, sdate, CURRENT_DATE);
  END IF;
  RETURN NULL;
END
$function$;

DO $$
DECLARE trg record;
BEGIN
  FOR trg IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'interval_results' AND c.relnamespace = 'public'::regnamespace
      AND p.proname = 'trg_recompute_zones_from_rep' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.interval_results', trg.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_recompute_zones_from_rep_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.interval_results
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_rep();

-- SAFETY CHECK — run this after the migration to confirm exactly one
-- trigger exists per function (not zero, not two):
--
-- SELECT c.relname, p.proname, count(*) 
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_proc p ON p.oid = t.tgfoid
-- WHERE p.proname IN ('trg_recompute_zones_from_athlete','trg_recompute_zones_from_perf','trg_recompute_zones_from_rep')
--   AND NOT t.tgisinternal
-- GROUP BY 1, 2;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Nothing below this line runs automatically. This migration is a pure
-- capture — the actual fix is 20260808040000_zones-proportional-pace.sql.
-- ============================================================================
