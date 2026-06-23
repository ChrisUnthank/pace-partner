
-- ============ 18: Fix recompute_athlete_zone_profile (missing WHERE) ============
CREATE OR REPLACE FUNCTION public.recompute_athlete_zone_profile(_athlete_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ath           record;
  zp            record;
  pace_5k_v     numeric;
  best_5k       numeric;
  best_3k       numeric;
  best_10k      numeric;
  hr_max_v      integer;
BEGIN
  SELECT * INTO ath FROM public.athletes WHERE id = _athlete_id;
  IF ath IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = _athlete_id;

  SELECT MIN(time_seconds) INTO best_5k
    FROM public.performances
    WHERE athlete_id = _athlete_id AND distance_m = 5000
      AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
  IF best_5k IS NOT NULL THEN
    pace_5k_v := best_5k / 5.0;
  ELSE
    SELECT MIN(time_seconds) INTO best_3k FROM public.performances
      WHERE athlete_id = _athlete_id AND distance_m = 3000
        AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
    IF best_3k IS NOT NULL THEN
      pace_5k_v := (best_3k / 3.0) * 1.06;
    ELSE
      SELECT MIN(time_seconds) INTO best_10k FROM public.performances
        WHERE athlete_id = _athlete_id AND distance_m = 10000
          AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
      IF best_10k IS NOT NULL THEN
        pace_5k_v := (best_10k / 10.0) * 0.96;
      END IF;
    END IF;
  END IF;

  hr_max_v := ath.hr_max;

  IF zp IS NULL THEN
    INSERT INTO public.athlete_zone_profiles(
      athlete_id, hr_max, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max,
      pace_5k_sec_per_km, auto_derived, updated_at
    ) VALUES (
      _athlete_id, hr_max_v,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.60)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.70)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.80)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.90)::int END,
      hr_max_v, pace_5k_v, true, now()
    );
  ELSE
    UPDATE public.athlete_zone_profiles SET
      hr_max     = CASE WHEN hr_zones_manual THEN hr_max     ELSE hr_max_v END,
      hr_z1_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z1_max ELSE ROUND(hr_max_v * 0.60)::int END,
      hr_z2_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z2_max ELSE ROUND(hr_max_v * 0.70)::int END,
      hr_z3_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z3_max ELSE ROUND(hr_max_v * 0.80)::int END,
      hr_z4_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z4_max ELSE ROUND(hr_max_v * 0.90)::int END,
      hr_z5_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z5_max ELSE hr_max_v END,
      pace_5k_sec_per_km = CASE WHEN pace_zones_manual OR pace_5k_v IS NULL THEN pace_5k_sec_per_km ELSE pace_5k_v END,
      updated_at = now()
    WHERE athlete_id = _athlete_id;
  END IF;
END $function$;

-- ============ 7: Add time_trial to session_intent enum ============
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                 WHERE t.typname='session_intent' AND e.enumlabel='time_trial') THEN
    ALTER TYPE public.session_intent ADD VALUE 'time_trial';
  END IF;
END $$;

-- ============ 14: Lactate at rep level ============
ALTER TABLE public.interval_results
  ADD COLUMN IF NOT EXISTS lactate_taken boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lactate_mmol numeric(3,1),
  ADD COLUMN IF NOT EXISTS lactate_timing text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='interval_results_lactate_timing_check') THEN
    ALTER TABLE public.interval_results
      ADD CONSTRAINT interval_results_lactate_timing_check
      CHECK (lactate_timing IS NULL OR lactate_timing IN ('end_of_rep','end_of_recovery'));
  END IF;
END $$;

-- ============ 13: per-rep adjustment note + per-step fuel note ============
ALTER TABLE public.interval_results
  ADD COLUMN IF NOT EXISTS adjustment_note text;
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS fuel_note text;

-- ============ 16: Race result enrichment on performances ============
ALTER TABLE public.performances
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS overall_place integer,
  ADD COLUMN IF NOT EXISTS field_size integer,
  ADD COLUMN IF NOT EXISTS age_group_place integer,
  ADD COLUMN IF NOT EXISTS age_group text,
  ADD COLUMN IF NOT EXISTS round text,
  ADD COLUMN IF NOT EXISTS splits jsonb,
  ADD COLUMN IF NOT EXISTS conditions jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS fit_file_id uuid REFERENCES public.session_files(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performances_round_check') THEN
    ALTER TABLE public.performances
      ADD CONSTRAINT performances_round_check
      CHECK (round IS NULL OR round IN ('heat','semi','final','time_trial','race'));
  END IF;
END $$;

-- ============ 17: Athlete display preferences ============
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS distance_unit text NOT NULL DEFAULT 'metric';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='athletes_distance_unit_check') THEN
    ALTER TABLE public.athletes
      ADD CONSTRAINT athletes_distance_unit_check
      CHECK (distance_unit IN ('metric','imperial'));
  END IF;
END $$;

-- ============ 19: Athlete-coach join requests ============
CREATE TABLE IF NOT EXISTS public.athlete_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','cancelled')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_join_requests_one_pending
  ON public.athlete_join_requests (coach_user_id, athlete_id, target_user_id)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.athlete_join_requests TO authenticated;
GRANT ALL ON public.athlete_join_requests TO service_role;
ALTER TABLE public.athlete_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach can create join requests for own athletes"
  ON public.athlete_join_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = coach_user_id
    AND public.can_access_athlete(auth.uid(), athlete_id)
  );

CREATE POLICY "Participants can read their requests"
  ON public.athlete_join_requests FOR SELECT TO authenticated
  USING (auth.uid() = coach_user_id OR auth.uid() = target_user_id);

CREATE POLICY "Participants can update their requests"
  ON public.athlete_join_requests FOR UPDATE TO authenticated
  USING (auth.uid() = coach_user_id OR auth.uid() = target_user_id)
  WITH CHECK (auth.uid() = coach_user_id OR auth.uid() = target_user_id);

-- Notification when a coach creates a request
CREATE OR REPLACE FUNCTION public.trg_notify_join_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE coach_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT full_name INTO coach_name FROM public.profiles WHERE id = NEW.coach_user_id;
    INSERT INTO public.notifications(user_id, kind, title, body, link, data)
    VALUES (
      NEW.target_user_id, 'join_request',
      COALESCE(coach_name,'A coach') || ' wants to add you to their squad',
      COALESCE(NEW.message,'Tap to accept or decline.'),
      '/app/profile',
      jsonb_build_object('request_id', NEW.id, 'coach_user_id', NEW.coach_user_id, 'athlete_id', NEW.athlete_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS athlete_join_requests_notify ON public.athlete_join_requests;
CREATE TRIGGER athlete_join_requests_notify
  AFTER INSERT ON public.athlete_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_join_request();

-- RPC: respond to a join request
CREATE OR REPLACE FUNCTION public.respond_to_join_request(_request_id uuid, _accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  uid uuid := auth.uid();
  req record;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  SELECT * INTO req FROM public.athlete_join_requests WHERE id = _request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF req.target_user_id <> uid THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF req.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','already_responded'); END IF;

  IF _accept THEN
    UPDATE public.athletes SET user_id = uid, updated_at = now()
     WHERE id = req.athlete_id AND (user_id IS NULL OR user_id = uid);
    INSERT INTO public.user_roles(user_id, role) VALUES (uid,'athlete')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.coach_athletes(coach_user_id, athlete_id)
      VALUES (req.coach_user_id, req.athlete_id)
      ON CONFLICT DO NOTHING;
    UPDATE public.athlete_join_requests
       SET status='accepted', responded_at=now() WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'athlete_id',req.athlete_id);
  ELSE
    UPDATE public.athlete_join_requests
       SET status='declined', responded_at=now() WHERE id=_request_id;
    RETURN jsonb_build_object('ok',true,'declined',true);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.respond_to_join_request(uuid, boolean) TO authenticated;
