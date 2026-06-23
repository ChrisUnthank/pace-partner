
-- Athletes: reminders toggle + last-log timestamp
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_log_at timestamptz;

-- Coach-level defaults for squad-wide reminder times
CREATE TABLE IF NOT EXISTS public.coach_settings (
  coach_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_reminder_morning_local time NOT NULL DEFAULT '08:00',
  default_reminder_evening_local time NOT NULL DEFAULT '20:00',
  reminders_enabled_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_settings TO authenticated;
GRANT ALL ON public.coach_settings TO service_role;
ALTER TABLE public.coach_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach settings self" ON public.coach_settings FOR ALL TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());
CREATE TRIGGER coach_settings_touch BEFORE UPDATE ON public.coach_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- AI reviews on demand
CREATE TABLE IF NOT EXISTS public.ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('weekly','monthly','phase','yearly','custom')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  content_md text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reviews TO authenticated;
GRANT ALL ON public.ai_reviews TO service_role;
ALTER TABLE public.ai_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_reviews coach read" ON public.ai_reviews FOR SELECT TO authenticated
  USING (
    coach_id = auth.uid()
    OR athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid())
    OR athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid())
  );
CREATE POLICY "ai_reviews coach insert" ON public.ai_reviews FOR INSERT TO authenticated
  WITH CHECK (coach_id = auth.uid());
CREATE POLICY "ai_reviews coach modify" ON public.ai_reviews FOR UPDATE TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());
CREATE POLICY "ai_reviews coach delete" ON public.ai_reviews FOR DELETE TO authenticated
  USING (coach_id = auth.uid());
CREATE INDEX IF NOT EXISTS ai_reviews_athlete_idx ON public.ai_reviews(athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_reviews_coach_idx ON public.ai_reviews(coach_id, created_at DESC);

-- Trigger to bump athletes.last_log_at whenever a daily_vitals, daily_checkins or session_insights row is written
CREATE OR REPLACE FUNCTION public.trg_touch_athlete_last_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.athletes SET last_log_at = now()
   WHERE id = COALESCE(NEW.athlete_id, OLD.athlete_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS daily_vitals_touch_log ON public.daily_vitals;
CREATE TRIGGER daily_vitals_touch_log AFTER INSERT OR UPDATE ON public.daily_vitals
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_athlete_last_log();

DROP TRIGGER IF EXISTS daily_checkins_touch_log ON public.daily_checkins;
CREATE TRIGGER daily_checkins_touch_log AFTER INSERT OR UPDATE ON public.daily_checkins
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_athlete_last_log();

DROP TRIGGER IF EXISTS session_insights_touch_log ON public.session_insights;
CREATE TRIGGER session_insights_touch_log AFTER INSERT OR UPDATE ON public.session_insights
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_athlete_last_log();
