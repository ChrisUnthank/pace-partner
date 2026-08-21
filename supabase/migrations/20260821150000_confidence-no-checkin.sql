-- ============================================================================
-- CONFIDENCE MUST NOT READ 'HIGH' WITH NO SUBJECTIVE INPUT.
--
-- My bug, from the same session that introduced the cap. The guard was
--
--     IF checkin_score_v IS NOT NULL AND answered < 3 ...
--
-- so it fired for a PARTIAL check-in and skipped an ABSENT one entirely —
-- exactly backwards. An athlete who has never checked in got 'high'.
--
-- The data says this is the normal case rather than a corner:
--
--     412 completed sessions, 12 with a logged RPE (3%), 5 check-ins in total
--     96% of sessions have neither
--
-- So nearly every readiness score in the system is built from session labels
-- and duration, with the 40% subjective component never firing. That is a
-- legitimate way to run the score — the label-based RPE fallback is sensible
-- and the load side is real — but it is not a HIGH-confidence read on how an
-- athlete feels, and saying so was the whole point of the confidence field.
--
-- Deliberately only touches confidence. The score itself is unchanged:
-- missing input is not bad news, and lowering readiness for absent data would
-- repeat the conflation this work has been removing.
--
-- Replaces the function only. RE-RUN BACKFILL_READINESS.sql after this.
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
  -- How far back an absence keeps costing an athlete once they are training
  -- again. See the header for why this is 56 and not 180.
  DETRAINING_WINDOW_DAYS CONSTANT int := 56;
  total_days int;
  load_ratio_v numeric;
  load_balance numeric;
  fatigue_component numeric;
  eq_days_off numeric;
  retention_pct numeric;
  checkin_score_v numeric;
  answered int;
  checkin_sum numeric;
  readiness numeric;
  band public.readiness_status;
  confidence_v text;
  injury_v boolean;
  training_stopped boolean;
  reason_v text;
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
    COALESCE(prev_ctl, seed_ctl_v, 0) + (combined_today - COALESCE(prev_ctl, seed_ctl_v, 0)) * alpha_ctl, 4);
  atl_val := ROUND(
    COALESCE(prev_atl, seed_atl_v, 0) + (combined_today - COALESCE(prev_atl, seed_atl_v, 0)) * alpha_atl, 4);

  SELECT COUNT(*) INTO total_days
    FROM public.athlete_load_daily
    WHERE athlete_id = _athlete_id
      AND load_date BETWEEN _date - INTERVAL '27 days' AND _date - INTERVAL '1 day'
      AND combined_load IS NOT NULL;
  total_days := COALESCE(total_days, 0) + 1;

  -- ══ FIX 1 ═══════════════════════════════════════════════════════════════
  -- The load side no longer punishes freshness.
  --
  -- It used to penalise ATL/CTL below 0.8 exactly as hard as above 1.3. One
  -- week of complete rest drives the ratio to 0.44 and scored about 46, so a
  -- taper read as a problem and the dashboard advised adding sessions during
  -- race week. The error is using one symmetric penalty for two things that
  -- behave nothing alike: fatigue accumulates and dissipates in days, fitness
  -- in months.
  --
  -- Now two independent factors, multiplied:
  --
  --   fatigue_component  penalises ratio > 1.3 exactly as before. Acute
  --                      fatigue IS day-to-day responsive, so that side was
  --                      always right.
  --
  --   retention_pct      what a genuine absence has cost, from the athlete's
  --                      detraining curve. Nothing to day 7, 3% by day 10,
  --                      7% by a fortnight, 24% by a month.
  --
  -- A tapering athlete: 100% x 100% = 100. Rested and ready, which is the
  -- point. A month off: 100% x 74% = 74. An overreached athlete: 71 x 100%.
  --
  -- equivalent_days_off is used rather than "days since last session" because
  -- a single token jog would reset that to zero — an athlete running lightly
  -- through a six-week injury would accrue no cost at all.
  IF ctl_val IS NULL OR ctl_val = 0 THEN
    load_ratio_v := NULL;
    load_balance := NULL;
  ELSE
    load_ratio_v := ROUND(atl_val / ctl_val, 3);

    fatigue_component := GREATEST(0, LEAST(100, 100 - 100 *
      CASE WHEN load_ratio_v > 1.3 THEN (load_ratio_v - 1.3) / 0.7 ELSE 0 END));

    eq_days_off := public.equivalent_days_off(_athlete_id, _date, DETRAINING_WINDOW_DAYS);
    retention_pct := public.detraining_retention(_athlete_id, eq_days_off);

    load_balance := ROUND(fatigue_component * COALESCE(retention_pct, 100) / 100.0, 1);
  END IF;

  SELECT * INTO c FROM public.daily_checkins WHERE athlete_id = _athlete_id AND checkin_date = _date;
  injury_v := COALESCE(c.injury_flag, false);

  -- ══ FIX 2 ═══════════════════════════════════════════════════════════════
  -- Missing check-in answers are no longer invented.
  --
  -- Absent fields used to default to 3 (neutral), so answering only "energy:
  -- 5" produced a confident 68 with four fifths of it made up and nothing
  -- saying so. Now only the answered questions are averaged, then scaled onto
  -- the same 20-100 range a full check-in produces — so a one-question
  -- check-in and a five-question one are directly comparable, and neither
  -- claims more than it knows.
  answered := 0;
  checkin_sum := 0;
  IF c IS NOT NULL THEN
    IF c.sleep_quality IS NOT NULL THEN answered := answered + 1; checkin_sum := checkin_sum + c.sleep_quality; END IF;
    IF c.soreness      IS NOT NULL THEN answered := answered + 1; checkin_sum := checkin_sum + (6 - c.soreness); END IF;
    IF c.stress        IS NOT NULL THEN answered := answered + 1; checkin_sum := checkin_sum + (6 - c.stress); END IF;
    IF c.motivation    IS NOT NULL THEN answered := answered + 1; checkin_sum := checkin_sum + c.motivation; END IF;
    IF c.energy        IS NOT NULL THEN answered := answered + 1; checkin_sum := checkin_sum + c.energy; END IF;
  END IF;

  IF answered > 0 THEN
    -- Mean of answered questions (1..5) x 20 gives 20..100, the same range as
    -- the old all-five calculation.
    checkin_score_v := ROUND((checkin_sum / answered) * 20.0, 1);
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

  -- ══ FIX 3 ═══════════════════════════════════════════════════════════════
  -- Confidence reflects the check-in too, not just load history.
  --
  -- It was derived solely from days of load data, so thirty days of training
  -- plus a one-question check-in reported 'high' confidence on a score that
  -- was 40% guesswork. A part-answered check-in now caps confidence at
  -- 'medium' however long the load history is.
  confidence_v := CASE
    WHEN total_days IS NULL OR total_days < 3 THEN 'insufficient'
    WHEN total_days < 7 THEN 'low'
    WHEN total_days < 21 THEN 'medium'
    ELSE 'high'
  END;

  -- Fewer than three answered questions caps confidence — INCLUDING none at
  -- all. The earlier version required checkin_score_v IS NOT NULL, so an
  -- athlete who had never checked in skipped the cap entirely and reported
  -- 'high' confidence on a score with no subjective input in it whatsoever.
  --
  -- That is the case, not the edge case: across this database 96% of
  -- completed sessions carry neither a felt RPE nor a check-in, so almost
  -- every readiness score is derived from labels and duration alone. It
  -- should not claim to be a confident reading of how an athlete feels.
  IF answered < 3 AND confidence_v = 'high' THEN
    confidence_v := 'medium';
  END IF;

  -- ══ FIX 4 ═══════════════════════════════════════════════════════════════
  -- An active injury that has STOPPED training now reaches readiness.
  --
  -- injury_flag on the daily check-in was the only signal, so the whole
  -- injuries and illness record had no effect unless the athlete separately
  -- ticked a box each day.
  --
  -- Only training_impact = 'stopped'. A coach's own reasoning, and it is
  -- right: "trained around it" is ordinary training and a reduced-volume week
  -- is often indistinguishable from a taper, so neither should be penalised.
  -- Chronic conditions are excluded — asthma must not red-band someone for a
  -- year.
  --
  -- This matters MORE now than before the change above. An injured athlete
  -- resting used to read as under-loaded and score badly by accident. With
  -- freshness no longer penalised they would read as maximally fresh — a
  -- green light to train hard on someone who cannot run.
  SELECT EXISTS (
    SELECT 1 FROM public.injuries i
     WHERE i.athlete_id = _athlete_id
       AND COALESCE(i.archived, false) = false
       AND COALESCE(i.is_chronic, false) = false
       AND i.training_impact = 'stopped'
       AND i.onset_date <= _date
       AND (i.resolved_date IS NULL OR i.resolved_date >= _date)
       AND (i.resolved_date IS NOT NULL
            OR i.expected_resolved_date IS NULL
            OR i.expected_resolved_date >= _date)
  ) INTO training_stopped;

  reason_v := NULL;

  IF confidence_v = 'insufficient' OR readiness IS NULL THEN
    band := NULL;
  ELSIF readiness < 40 THEN
    band := 'red';
  ELSIF readiness < 65 THEN
    band := 'amber';
  ELSE
    band := 'green';
  END IF;

  -- ══ FIX 5 ═══════════════════════════════════════════════════════════════
  -- A forced band no longer contradicts the score beside it.
  --
  -- The old code set band := 'red' and left readiness untouched, so the badge
  -- could render "Recover · 85". The score is now capped to the top of the
  -- band it has been forced into — saying "at most this" rather than
  -- inventing a figure — and the reason is recorded.
  IF training_stopped THEN
    band := 'red';
    readiness := LEAST(COALESCE(readiness, 39), 39);
    reason_v := 'Injury or illness currently stopping training';
  ELSIF injury_v THEN
    band := 'red';
    readiness := LEAST(COALESCE(readiness, 39), 39);
    reason_v := 'Injury concern flagged on today''s check-in';
  ELSIF retention_pct IS NOT NULL AND retention_pct < 90 THEN
    reason_v := 'Extended time off training — ' || ROUND(100 - retention_pct) ||
                '% of fitness credit reduced after ' || ROUND(eq_days_off) || ' equivalent days off';
  END IF;

  INSERT INTO public.athlete_load_daily (
    athlete_id, load_date, training_load, external_load_total, combined_load, atl, ctl, tsb,
    readiness_score, readiness_status, confidence, data_days, checkin_score, load_balance_score,
    load_ratio, readiness_reason, updated_at
  ) VALUES (
    _athlete_id, _date, training_load_today, external_load_today, combined_today, atl_val, ctl_val,
    ROUND(COALESCE(ctl_val, 0) - COALESCE(atl_val, 0), 4),
    readiness, band, confidence_v, total_days, checkin_score_v, load_balance, load_ratio_v,
    reason_v, now()
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
    readiness_reason = EXCLUDED.readiness_reason,
    updated_at = now();

  -- Unchanged: drop the seed once 90 calendar days of real tracking exist.
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
