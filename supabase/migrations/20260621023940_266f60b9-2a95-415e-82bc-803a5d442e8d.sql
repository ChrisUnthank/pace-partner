
CREATE TYPE public.session_intent AS ENUM ('easy','aerobic','tempo','threshold','vo2','anaerobic','speed');
CREATE TYPE public.session_structure AS ENUM ('continuous','reps_intervals');
CREATE TYPE public.session_day_type AS ENUM ('training','race','recovery','cross_training','rest');

ALTER TABLE public.sessions
  ADD COLUMN day_type public.session_day_type NOT NULL DEFAULT 'training',
  ADD COLUMN intent public.session_intent,
  ADD COLUMN structure public.session_structure,
  ADD COLUMN is_long_run boolean NOT NULL DEFAULT false;

UPDATE public.sessions SET
  day_type = (CASE category
    WHEN 'race' THEN 'race'
    WHEN 'recovery' THEN 'recovery'
    WHEN 'cross_training' THEN 'cross_training'
    WHEN 'rest' THEN 'rest'
    ELSE 'training' END)::public.session_day_type,
  intent = (CASE category
    WHEN 'easy' THEN 'easy'
    WHEN 'long' THEN 'aerobic'
    WHEN 'steady' THEN 'aerobic'
    WHEN 'tempo' THEN 'tempo'
    WHEN 'threshold' THEN 'threshold'
    WHEN 'intervals' THEN 'vo2'
    WHEN 'reps' THEN 'speed'
    WHEN 'fartlek' THEN 'tempo'
    ELSE NULL END)::public.session_intent,
  structure = (CASE category
    WHEN 'easy' THEN 'continuous'
    WHEN 'long' THEN 'continuous'
    WHEN 'steady' THEN 'continuous'
    WHEN 'tempo' THEN 'continuous'
    WHEN 'threshold' THEN 'continuous'
    WHEN 'intervals' THEN 'reps_intervals'
    WHEN 'reps' THEN 'reps_intervals'
    WHEN 'fartlek' THEN 'reps_intervals'
    ELSE NULL END)::public.session_structure,
  is_long_run = (category = 'long');

CREATE OR REPLACE FUNCTION public.validate_session_classification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.day_type = 'training' THEN
    IF NEW.intent IS NULL OR NEW.structure IS NULL THEN
      RAISE EXCEPTION 'Training sessions require intent and structure';
    END IF;
  ELSE
    NEW.intent := NULL;
    NEW.structure := NULL;
    NEW.is_long_run := false;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_session_classification_trg
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_classification();

ALTER TABLE public.sessions DROP COLUMN category;

CREATE OR REPLACE FUNCTION public.session_training_load(_session_id uuid)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; duration_min numeric; rpe_eff numeric;
BEGIN
  SELECT rpe, day_type, intent, total_time_seconds INTO s FROM public.sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  duration_min := COALESCE(s.total_time_seconds, 0) / 60.0;
  IF duration_min = 0 THEN
    SELECT COALESCE(SUM(ir.actual_time_seconds),0)/60.0 INTO duration_min
      FROM public.interval_results ir JOIN public.steps st ON st.id = ir.step_id
      WHERE st.session_id = _session_id;
  END IF;
  IF s.rpe IS NOT NULL THEN rpe_eff := s.rpe;
  ELSIF s.day_type <> 'training' THEN
    rpe_eff := CASE s.day_type
      WHEN 'race' THEN 9 WHEN 'recovery' THEN 2
      WHEN 'cross_training' THEN 4 WHEN 'rest' THEN 0 ELSE 4 END;
  ELSE
    rpe_eff := CASE s.intent
      WHEN 'easy' THEN 3 WHEN 'aerobic' THEN 5 WHEN 'tempo' THEN 6
      WHEN 'threshold' THEN 7 WHEN 'vo2' THEN 8 WHEN 'anaerobic' THEN 8
      WHEN 'speed' THEN 8 ELSE 4 END;
  END IF;
  RETURN ROUND(rpe_eff * duration_min, 2);
END $function$;

-- Re-key adjustment rules. Wipe + reseed (test data only).
DELETE FROM public.session_adjustment_rules;
ALTER TABLE public.session_adjustment_rules DROP COLUMN category;
ALTER TABLE public.session_adjustment_rules ADD COLUMN intent public.session_intent NOT NULL;
ALTER TABLE public.session_adjustment_rules
  ADD CONSTRAINT session_adjustment_rules_intent_status_key UNIQUE (intent, readiness_status);

INSERT INTO public.session_adjustment_rules (intent, readiness_status, adjustment_type, adjusted_summary, reason) VALUES
  ('easy'::public.session_intent,'amber'::public.readiness_status,'none','Keep as planned','Easy already low-stress'),
  ('easy'::public.session_intent,'red'::public.readiness_status,'swap','Swap to rest or 20 min walk','High fatigue/injury risk'),
  ('aerobic'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut 20% of distance','Protect quality on tired legs'),
  ('aerobic'::public.session_intent,'red'::public.readiness_status,'swap','Swap to 30 min easy','High fatigue'),
  ('tempo'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut tempo block by 25% or drop pace 5s/km','Maintain stimulus without overreach'),
  ('tempo'::public.session_intent,'red'::public.readiness_status,'swap','Swap to easy run','High fatigue — no quality today'),
  ('threshold'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut reps by 25% or extend recovery 30s','Preserve quality, reduce volume'),
  ('threshold'::public.session_intent,'red'::public.readiness_status,'swap','Swap to easy run','High fatigue — threshold not productive'),
  ('vo2'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut reps by 33%','VO2 needs freshness'),
  ('vo2'::public.session_intent,'red'::public.readiness_status,'swap','Swap to easy run or rest','VO2 needs freshness; postpone'),
  ('anaerobic'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut reps by 33% and add 60s recovery','Anaerobic needs full freshness'),
  ('anaerobic'::public.session_intent,'red'::public.readiness_status,'swap','Swap to easy run or rest','Anaerobic needs full freshness; postpone'),
  ('speed'::public.session_intent,'amber'::public.readiness_status,'reduce','Cut reps by 33%','Speed needs freshness'),
  ('speed'::public.session_intent,'red'::public.readiness_status,'swap','Swap to easy run or rest','Speed needs freshness; postpone');
