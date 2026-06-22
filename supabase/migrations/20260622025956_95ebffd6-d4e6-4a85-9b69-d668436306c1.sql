
-- daily_vitals
CREATE TABLE public.daily_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  vitals_date date NOT NULL,
  sleep_hours numeric(3,1),
  resting_hr int,
  weight_kg numeric(4,1),
  hydration smallint CHECK (hydration BETWEEN 1 AND 5),
  recovery_modalities text[],
  external_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, vitals_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_vitals TO authenticated;
GRANT ALL ON public.daily_vitals TO service_role;

ALTER TABLE public.daily_vitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vitals access via athlete" ON public.daily_vitals
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

CREATE TRIGGER daily_vitals_touch_updated_at
  BEFORE UPDATE ON public.daily_vitals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- session_insights
CREATE TABLE public.session_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  feel_score smallint CHECK (feel_score BETWEEN 1 AND 10),
  went_well text,
  was_difficult text,
  niggles text,
  end_of_day_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_insights TO authenticated;
GRANT ALL ON public.session_insights TO service_role;

ALTER TABLE public.session_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insights access via athlete" ON public.session_insights
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

CREATE TRIGGER session_insights_touch_updated_at
  BEFORE UPDATE ON public.session_insights
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
