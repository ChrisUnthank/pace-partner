-- ============================================================================
-- Migration tracking catch-up — Batch 14: recompute_readiness (EWMA fix)
-- ============================================================================
--
-- PURE CAPTURE — the live database already runs the function below. This
-- migration changes zero live behavior. What it fixes is GitHub: the
-- committed version (20260621003118) is not just outdated, it's a
-- DIFFERENT, ALREADY-SUPERSEDED FORMULA.
--
-- THE ACTUAL FINDING
-- The tracked migration computes CTL/ATL as flat moving averages —
-- AVG(combined_load) over a 7-day and 28-day rolling window. The live
-- function instead uses genuine recursive EWMA:
--   alpha_ctl := 1 - exp(-1/42)
--   alpha_atl := 1 - exp(-1/7)
--   ctl_val := prev_ctl + (combined_today - prev_ctl) * alpha_ctl
-- This is exactly the fix already documented in this project's own
-- standing notes as "confirmed and fixed against real data" — EWMA, not
-- flat moving averages. The fix is real and live. It was simply never
-- captured in a migration, so GitHub has been showing the OLD, buggy
-- formula this whole time with no record the fix ever happened.
--
-- Two other real differences from the tracked version, also just capturing
-- what's already live:
--   - Seed-fitness cold start: on an athlete's first tracked day (no prior
--     athlete_load_daily row), CTL/ATL fall back to athletes.seed_ctl/
--     seed_atl instead of implicitly treating them as zero/null. This is
--     what apply_starting_fitness (Batch 13) actually feeds into — the
--     tracked version of this function predates that feature entirely and
--     has no seed-handling logic at all.
--   - Seed auto-drop: once an athlete has 90 real calendar days of tracked
--     load past their first real entry, seed_ctl/seed_atl get cleared
--     automatically — a manually-entered starting estimate stops
--     influencing the calculation once there's enough real data to not
--     need it.
--
-- compute_session_fatigue was checked in the same pass and found to match
-- its tracked migration (20260621022328) exactly, word for word — no
-- action needed there.
--
-- SAFE TO RE-RUN.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_readiness(_athlete_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  training_load_today numeric;
  external_load_today numeric;
  combined_today numeric;
  atl_val numeric;
  ctl_val numeric;
  prev_ctl numeric;
  prev_atl numeric;
  seed_ctl_v numeric;
  seed_atl_v numeric;
  current_seed_ctl numeric;
  first_real_date date;
  alpha_ctl CONSTANT numeric := ROUND(1 - exp(-1.0/42), 10);
  alpha_atl CONSTANT numeric := ROUND(1 - exp(-1.0/7), 10);
  total_days int;
  load_ratio_v numeric;
  load_balance numeric;
  checkin_score_v numeric;
  readiness numeric;
  band public.readiness_status;
  confidence_v text;
  injury_v boolean;
  c record;
BEGIN
  SELECT COALESCE(SUM(public.session_training_load(id)), 0)
    INTO training_load_today
    FROM public.sessions
    WHERE athlete_id = _athlete_id AND session_date = _date;

  external_load_today := public.external_load_score(_athlete_id, _date);
  combined_today := training_load_today + external_load_today;

  SELECT ctl, atl INTO prev_ctl, prev_atl
    FROM public.athlete_load_daily
    WHERE athlete_id = _athlete_id AND load_date = _date - INTERVAL '1 day';

  IF prev_ctl IS NULL THEN
    SELECT seed_ctl, seed_atl INTO seed_ctl_v, seed_atl_v FROM public.athletes WHERE id = _athlete_id;
  END IF;

  ctl_val := ROUND(
    COALESCE(prev_ctl, seed_ctl_v, 0) + (combined_today - COALESCE(prev_ctl, seed_ctl_v, 0)) * alpha_ctl,
    4
  );
  atl_val := ROUND(
    COALESCE(prev_atl, seed_atl_v, 0) + (combined_today - COALESCE(prev_atl, seed_atl_v, 0)) * alpha_atl,
    4
  );

  SELECT COUNT(*) INTO total_days
    FROM public.athlete_load_daily
    WHERE athlete_id = _athlete_id
      AND load_date BETWEEN _date - INTERVAL '27 days' AND _date - INTERVAL '1 day'
      AND combined_load IS NOT NULL;
  total_days := COALESCE(total_days, 0) + 1;

  IF ctl_val IS NULL OR ctl_val = 0 THEN
    load_ratio_v := NULL;
    load_balance := NULL;
  ELSE
    load_ratio_v := ROUND(atl_val / ctl_val, 3);
    load_balance := GREATEST(0, LEAST(100, 100 - 100 * GREATEST(
      CASE WHEN load_ratio_v < 0.8 THEN (0.8 - load_ratio_v) / 0.8 ELSE 0 END,
      CASE WHEN load_ratio_v > 1.3 THEN (load_ratio_v - 1.3) / 0.7 ELSE 0 END
    )));
  END IF;

  SELECT * INTO c FROM public.daily_checkins WHERE athlete_id = _athlete_id AND checkin_date = _date;
  injury_v := COALESCE(c.injury_flag, false);

  IF c IS NOT NULL AND (
    c.sleep_quality IS NOT NULL OR c.soreness IS NOT NULL OR c.stress IS NOT NULL
    OR c.motivation IS NOT NULL OR c.energy IS NOT NULL
  ) THEN
    checkin_score_v := (
      COALESCE(c.sleep_quality, 3) + (6 - COALESCE(c.soreness, 3)) + (6 - COALESCE(c.stress, 3))
      + COALESCE(c.motivation, 3) + COALESCE(c.energy, 3)
    ) * 5.0;
    checkin_score_v := LEAST(100, checkin_score_v * 4.0 / 5.0);
  END IF;

  IF load_balance IS NOT NULL AND checkin_score_v IS NOT NULL THEN
    readiness := ROUND(0.6 * load_balance + 0.4 * checkin_score_v, 1);
  ELSIF checkin_score_v IS NOT NULL THEN
    readiness := ROUND(checkin_score_v, 1);
  ELSIF load_balance IS NOT NULL THEN
    readiness := ROUND(load_balance, 1);
  ELSE
    readiness := NULL;
  END IF;

  confidence_v := CASE
    WHEN total_days IS NULL OR total_days < 3 THEN 'insufficient'
    WHEN total_days < 7 THEN 'low'
    WHEN total_days < 21 THEN 'medium'
    ELSE 'high'
  END;

  IF injury_v THEN
    band := 'red';
  ELSIF confidence_v = 'insufficient' OR readiness IS NULL THEN
    band := NULL;
  ELSIF readiness < 40 THEN
    band := 'red';
  ELSIF readiness < 65 THEN
    band := 'amber';
  ELSE
    band := 'green';
  END IF;

  INSERT INTO public.athlete_load_daily (
    athlete_id, load_date, training_load, external_load_total, combined_load, atl, ctl, tsb,
    readiness_score, readiness_status, confidence, data_days, checkin_score, load_balance_score,
    load_ratio, updated_at
  ) VALUES (
    _athlete_id, _date, training_load_today, external_load_today, combined_today, atl_val, ctl_val,
    ROUND(COALESCE(ctl_val, 0) - COALESCE(atl_val, 0), 4),
    readiness, band, confidence_v, total_days, checkin_score_v, load_balance, load_ratio_v, now()
  )
  ON CONFLICT (athlete_id, load_date) DO UPDATE SET
    training_load = EXCLUDED.training_load,
    external_load_total = EXCLUDED.external_load_total,
    combined_load = EXCLUDED.combined_load,
    atl = EXCLUDED.atl,
    ctl = EXCLUDED.ctl,
    tsb = EXCLUDED.tsb,
    readiness_score = EXCLUDED.readiness_score,
    readiness_status = EXCLUDED.readiness_status,
    confidence = EXCLUDED.confidence,
    data_days = EXCLUDED.data_days,
    checkin_score = EXCLUDED.checkin_score,
    load_balance_score = EXCLUDED.load_balance_score,
    load_ratio = EXCLUDED.load_ratio,
    updated_at = now();

  -- Auto-drop: only bother checking on days where a seed is actually still
  -- set (cheap no-op once it's already cleared). 90 calendar days since the
  -- athlete's real first tracked day — not session count — so this doesn't
  -- penalize lower-frequency athletes.
  SELECT seed_ctl INTO current_seed_ctl FROM public.athletes WHERE id = _athlete_id;
  IF current_seed_ctl IS NOT NULL THEN
    SELECT MIN(load_date) INTO first_real_date
      FROM public.athlete_load_daily
      WHERE athlete_id = _athlete_id AND combined_load > 0;
    IF first_real_date IS NOT NULL AND (_date - first_real_date) >= 90 THEN
      UPDATE public.athletes SET seed_ctl = NULL, seed_atl = NULL WHERE id = _athlete_id;
    END IF;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
