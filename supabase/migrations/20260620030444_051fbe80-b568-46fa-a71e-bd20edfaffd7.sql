
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('coach','athlete','admin');
CREATE TYPE public.session_category AS ENUM ('easy','long','tempo','threshold','intervals','reps','race','recovery','cross_training','rest');
CREATE TYPE public.step_kind AS ENUM ('warmup','work','recovery','cooldown');
CREATE TYPE public.recovery_mode AS ENUM ('standing','walk','jog','float');
CREATE TYPE public.target_kind AS ENUM ('time','distance');
CREATE TYPE public.readiness_status AS ENUM ('green','amber','red');
CREATE TYPE public.session_source AS ENUM ('manual','synced');
CREATE TYPE public.zone_basis AS ENUM ('hr','pace','none');
CREATE TYPE public.external_load_kind AS ENUM ('work','gym','other_sport','school','travel','other');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ ATHLETES ============
CREATE TABLE public.athletes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, -- nullable: coach can create athlete shell before invite accepted
  name TEXT NOT NULL,
  dob DATE,
  training_age_years NUMERIC,
  primary_event TEXT,
  sex TEXT,
  hr_max INTEGER,
  hr_rest INTEGER,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athletes TO authenticated;
GRANT ALL ON public.athletes TO service_role;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;

-- ============ COACH-ATHLETE LINKS ============
CREATE TABLE public.coach_athletes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(coach_user_id, athlete_id)
);
GRANT SELECT, INSERT, DELETE ON public.coach_athletes TO authenticated;
GRANT ALL ON public.coach_athletes TO service_role;
ALTER TABLE public.coach_athletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach sees own links" ON public.coach_athletes FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.user_id = auth.uid()));
CREATE POLICY "coach creates own links" ON public.coach_athletes FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = auth.uid() AND public.has_role(auth.uid(),'coach'));
CREATE POLICY "coach deletes own links" ON public.coach_athletes FOR DELETE TO authenticated
  USING (coach_user_id = auth.uid());

-- helper: is this user a coach of this athlete
CREATE OR REPLACE FUNCTION public.is_coach_of(_user_id UUID, _athlete_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.coach_athletes WHERE coach_user_id = _user_id AND athlete_id = _athlete_id)
$$;

-- helper: can this user see this athlete (is the athlete OR coach of them)
CREATE OR REPLACE FUNCTION public.can_access_athlete(_user_id UUID, _athlete_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.athletes a WHERE a.id = _athlete_id AND (a.user_id = _user_id OR a.created_by = _user_id)
  ) OR public.is_coach_of(_user_id, _athlete_id)
$$;

-- athletes RLS (now that helpers exist)
CREATE POLICY "athlete read self/coach" ON public.athletes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR created_by = auth.uid() OR public.is_coach_of(auth.uid(), id));
CREATE POLICY "athlete insert by coach or self" ON public.athletes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "athlete update self/coach" ON public.athletes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_coach_of(auth.uid(), id));
CREATE POLICY "athlete delete by coach creator" ON public.athletes FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- ============ COACH INVITES ============
CREATE TABLE public.athlete_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_invites TO authenticated;
GRANT ALL ON public.athlete_invites TO service_role;
ALTER TABLE public.athlete_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach manages own invites" ON public.athlete_invites FOR ALL TO authenticated
  USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());
CREATE POLICY "invitee reads by email" ON public.athlete_invites FOR SELECT TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ============ PERFORMANCES (PBs / race results) ============
CREATE TABLE public.performances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  performance_date DATE NOT NULL,
  distance_m INTEGER NOT NULL,
  time_seconds NUMERIC NOT NULL,
  is_pb BOOLEAN NOT NULL DEFAULT false,
  context TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performances TO authenticated;
GRANT ALL ON public.performances TO service_role;
ALTER TABLE public.performances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "performances access" ON public.performances FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ ATHLETE ZONE PROFILES (paces + HR zones) ============
CREATE TABLE public.athlete_zone_profiles (
  athlete_id UUID PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  hr_max INTEGER,
  hr_z1_max INTEGER, hr_z2_max INTEGER, hr_z3_max INTEGER, hr_z4_max INTEGER, hr_z5_max INTEGER,
  pace_1500_sec_per_km NUMERIC,
  pace_5k_sec_per_km NUMERIC,
  pace_threshold_sec_per_km NUMERIC,
  pace_easy_sec_per_km NUMERIC,
  pace_rep_sec_per_km NUMERIC,
  auto_derived BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_zone_profiles TO authenticated;
GRANT ALL ON public.athlete_zone_profiles TO service_role;
ALTER TABLE public.athlete_zone_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zones access" ON public.athlete_zone_profiles FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ SESSIONS ============
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  session_date DATE NOT NULL,
  title TEXT NOT NULL,
  category public.session_category NOT NULL DEFAULT 'easy',
  notes TEXT,
  -- planned vs executed
  is_planned BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMPTZ,
  source public.session_source NOT NULL DEFAULT 'manual',
  zone_basis public.zone_basis NOT NULL DEFAULT 'pace',
  -- session totals (computed/entered)
  total_distance_m NUMERIC,
  total_time_seconds NUMERIC,
  avg_hr INTEGER,
  rpe SMALLINT,
  completion_pct NUMERIC,
  pace_decay_pct NUMERIC,
  hr_drift_pct NUMERIC,
  weather TEXT,
  terrain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions access" ON public.sessions FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));
CREATE INDEX idx_sessions_athlete_date ON public.sessions(athlete_id, session_date DESC);

-- ============ STEPS (warmup / work / recovery / cooldown) ============
CREATE TABLE public.steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  kind public.step_kind NOT NULL,
  reps INTEGER NOT NULL DEFAULT 1,
  -- targets (for work step): distance OR time
  target_kind public.target_kind,
  target_distance_m NUMERIC,
  target_time_seconds NUMERIC,
  target_pace_sec_per_km NUMERIC,
  -- recovery-specific (only for kind='recovery')
  recovery_mode public.recovery_mode,
  recovery_target_kind public.target_kind,
  recovery_target_seconds NUMERIC,
  recovery_target_distance_m NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.steps TO authenticated;
GRANT ALL ON public.steps TO service_role;
ALTER TABLE public.steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "steps access" ON public.steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.can_access_athlete(auth.uid(), s.athlete_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.can_access_athlete(auth.uid(), s.athlete_id)));
CREATE INDEX idx_steps_session_order ON public.steps(session_id, step_order);

-- ============ INTERVAL RESULTS (one row per rep, work AND recovery) ============
CREATE TABLE public.interval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES public.steps(id) ON DELETE CASCADE,
  rep_number INTEGER NOT NULL,
  actual_distance_m NUMERIC,
  actual_time_seconds NUMERIC,
  actual_pace_sec_per_km NUMERIC,
  hr_avg INTEGER,
  hr_max INTEGER,
  hr_end INTEGER,             -- HR at end of the WORK rep
  hr_end_recovery INTEGER,    -- HR at end of the recovery that follows
  cadence INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(step_id, rep_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interval_results TO authenticated;
GRANT ALL ON public.interval_results TO service_role;
ALTER TABLE public.interval_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "results access" ON public.interval_results FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
    WHERE st.id = step_id AND public.can_access_athlete(auth.uid(), s.athlete_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
    WHERE st.id = step_id AND public.can_access_athlete(auth.uid(), s.athlete_id)
  ));

-- ============ DAILY CHECK-INS ============
CREATE TABLE public.daily_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  sleep_hours NUMERIC,
  sleep_quality SMALLINT,   -- 1..5
  soreness SMALLINT,        -- 1..5
  stress SMALLINT,
  motivation SMALLINT,
  energy SMALLINT,
  fuel_score SMALLINT,
  injury_flag BOOLEAN NOT NULL DEFAULT false,
  injury_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, checkin_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_checkins TO authenticated;
GRANT ALL ON public.daily_checkins TO service_role;
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkins access" ON public.daily_checkins FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ EXTERNAL LOAD (life activities) ============
CREATE TABLE public.external_load (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  load_date DATE NOT NULL,
  load_kind public.external_load_kind NOT NULL,
  intensity SMALLINT,       -- 1..5
  duration_minutes INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_load TO authenticated;
GRANT ALL ON public.external_load TO service_role;
ALTER TABLE public.external_load ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external load access" ON public.external_load FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ ATHLETE DAILY LOAD (computed) ============
CREATE TABLE public.athlete_load_daily (
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  load_date DATE NOT NULL,
  training_load NUMERIC DEFAULT 0,
  external_load_total NUMERIC DEFAULT 0,
  combined_load NUMERIC DEFAULT 0,
  ctl NUMERIC,   -- chronic (42d EWMA)
  atl NUMERIC,   -- acute  (7d  EWMA)
  tsb NUMERIC,   -- ctl - atl
  readiness_score NUMERIC,
  readiness_status public.readiness_status,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, load_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_load_daily TO authenticated;
GRANT ALL ON public.athlete_load_daily TO service_role;
ALTER TABLE public.athlete_load_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "load access" ON public.athlete_load_daily FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ SESSION ADJUSTMENT RULES + LOG ============
CREATE TABLE public.session_adjustment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.session_category NOT NULL,
  readiness_status public.readiness_status NOT NULL,
  adjustment_type TEXT NOT NULL,    -- e.g. 'reduce_volume','reduce_intensity','swap_easy','rest'
  adjusted_summary TEXT NOT NULL,
  reason TEXT,
  UNIQUE(category, readiness_status)
);
GRANT SELECT ON public.session_adjustment_rules TO authenticated;
GRANT ALL ON public.session_adjustment_rules TO service_role;
ALTER TABLE public.session_adjustment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rules readable" ON public.session_adjustment_rules FOR SELECT TO authenticated USING (true);

CREATE TABLE public.session_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.session_adjustment_rules(id),
  original JSONB,
  adjusted JSONB,
  reason TEXT,
  is_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_adjustments TO authenticated;
GRANT ALL ON public.session_adjustments TO service_role;
ALTER TABLE public.session_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adjustments access" ON public.session_adjustments FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- ============ PROFILE TRIGGER on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ updated_at helpers ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_athletes_updated BEFORE UPDATE ON public.athletes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Seed adjustment rules ============
INSERT INTO public.session_adjustment_rules (category, readiness_status, adjustment_type, adjusted_summary, reason) VALUES
  ('intervals','amber','reduce_volume','Cut reps by ~30%, hold target paces','Amber readiness — preserve quality, reduce volume'),
  ('intervals','red','swap_easy','Replace with easy 30–40min Z2 run','Red readiness — protect recovery'),
  ('threshold','amber','reduce_volume','Drop one tempo block or shorten by 20%','Amber readiness — reduce stress'),
  ('threshold','red','swap_easy','Replace with easy 30min Z2','Red readiness — recover'),
  ('long','amber','reduce_volume','Cut long run by 20%, keep easy pace','Amber readiness'),
  ('long','red','swap_easy','Short easy run or rest','Red readiness'),
  ('tempo','amber','reduce_intensity','Hold low end of tempo range','Amber readiness'),
  ('tempo','red','swap_easy','Easy Z2 only','Red readiness'),
  ('reps','amber','reduce_volume','Cut reps 25–30%','Amber readiness'),
  ('reps','red','rest','Rest day','Red readiness'),
  ('easy','amber','reduce_volume','Shorten by 20%','Amber readiness'),
  ('easy','red','rest','Rest day','Red readiness');
