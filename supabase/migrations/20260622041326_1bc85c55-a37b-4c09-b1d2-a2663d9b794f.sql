
CREATE TABLE public.session_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  mapped_step_id uuid REFERENCES public.steps(id) ON DELETE SET NULL,
  file_kind text NOT NULL CHECK (file_kind IN ('fit','gpx')),
  storage_path text NOT NULL,
  original_filename text,
  activity_type text,
  started_at timestamptz,
  total_distance_m numeric,
  total_time_s numeric,
  parse_error text,
  parsed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_files TO authenticated;
GRANT ALL ON public.session_files TO service_role;
ALTER TABLE public.session_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_files athlete self" ON public.session_files FOR ALL TO authenticated
  USING (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid()))
  WITH CHECK (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid()));
CREATE POLICY "session_files coach read" ON public.session_files FOR SELECT TO authenticated
  USING (athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid()));
CREATE INDEX session_files_athlete_idx ON public.session_files(athlete_id, started_at DESC);
CREATE INDEX session_files_session_idx ON public.session_files(session_id);
CREATE TRIGGER session_files_touch BEFORE UPDATE ON public.session_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.raw_session_points (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.steps(id) ON DELETE SET NULL,
  file_id uuid REFERENCES public.session_files(id) ON DELETE CASCADE,
  segment_type text CHECK (segment_type IN ('warmup','work','recovery','cooldown')),
  elapsed_s numeric NOT NULL,
  lat double precision, lng double precision,
  hr smallint, pace_sec_per_km numeric, cadence smallint,
  elevation_m numeric, vertical_oscillation_cm numeric, ground_contact_time_ms smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_session_points TO authenticated;
GRANT ALL ON public.raw_session_points TO service_role;
ALTER TABLE public.raw_session_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_points athlete self" ON public.raw_session_points FOR ALL TO authenticated
  USING (session_id IN (SELECT s.id FROM public.sessions s JOIN public.athletes a ON a.id=s.athlete_id WHERE a.user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT s.id FROM public.sessions s JOIN public.athletes a ON a.id=s.athlete_id WHERE a.user_id = auth.uid()));
CREATE POLICY "raw_points coach read" ON public.raw_session_points FOR SELECT TO authenticated
  USING (session_id IN (SELECT s.id FROM public.sessions s JOIN public.coach_athletes ca ON ca.athlete_id=s.athlete_id WHERE ca.coach_user_id = auth.uid()));
CREATE INDEX raw_points_session_elapsed_idx ON public.raw_session_points(session_id, elapsed_s);
CREATE INDEX raw_points_step_idx ON public.raw_session_points(step_id);

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'manual' CHECK (data_source IN ('manual','fit_upload','gpx_upload')),
  ADD COLUMN IF NOT EXISTS work_distance_m numeric,
  ADD COLUMN IF NOT EXISTS work_time_s numeric,
  ADD COLUMN IF NOT EXISTS work_avg_hr integer,
  ADD COLUMN IF NOT EXISTS work_avg_pace_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS work_avg_cadence integer,
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS reminder_morning_local time DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS reminder_evening_local time DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS last_checkout_at timestamptz;

CREATE TABLE public.pending_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL,
  kind text NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_reminders TO authenticated;
GRANT ALL ON public.pending_reminders TO service_role;
ALTER TABLE public.pending_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders coach manage" ON public.pending_reminders FOR ALL TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());
CREATE POLICY "reminders athlete read" ON public.pending_reminders FOR SELECT TO authenticated
  USING (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid()));

CREATE TABLE public.ai_chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_threads TO authenticated;
GRANT ALL ON public.ai_chat_threads TO service_role;
ALTER TABLE public.ai_chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_threads coach owns" ON public.ai_chat_threads FOR ALL TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());
CREATE INDEX ai_threads_coach_idx ON public.ai_chat_threads(coach_id, athlete_id, updated_at DESC);
CREATE TRIGGER ai_threads_touch BEFORE UPDATE ON public.ai_chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ai_chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_messages TO authenticated;
GRANT ALL ON public.ai_chat_messages TO service_role;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_messages via thread" ON public.ai_chat_messages FOR ALL TO authenticated
  USING (thread_id IN (SELECT id FROM public.ai_chat_threads WHERE coach_id = auth.uid()))
  WITH CHECK (thread_id IN (SELECT id FROM public.ai_chat_threads WHERE coach_id = auth.uid()));
CREATE INDEX ai_messages_thread_idx ON public.ai_chat_messages(thread_id, created_at);

CREATE TABLE public.ai_weekly_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  summary_md text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, week_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_weekly_summaries TO authenticated;
GRANT ALL ON public.ai_weekly_summaries TO service_role;
ALTER TABLE public.ai_weekly_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_weekly read" ON public.ai_weekly_summaries FOR SELECT TO authenticated
  USING (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid())
      OR athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid()));
CREATE POLICY "ai_weekly coach write" ON public.ai_weekly_summaries FOR INSERT TO authenticated
  WITH CHECK (athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid()));

CREATE TABLE public.ai_athlete_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  note_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('daily','session')),
  session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_athlete_notes TO authenticated;
GRANT ALL ON public.ai_athlete_notes TO service_role;
ALTER TABLE public.ai_athlete_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_notes read" ON public.ai_athlete_notes FOR SELECT TO authenticated
  USING (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid())
      OR athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid()));
CREATE POLICY "ai_notes insert" ON public.ai_athlete_notes FOR INSERT TO authenticated
  WITH CHECK (athlete_id IN (SELECT id FROM public.athletes WHERE user_id = auth.uid())
           OR athlete_id IN (SELECT athlete_id FROM public.coach_athletes WHERE coach_user_id = auth.uid()));
CREATE INDEX ai_notes_athlete_idx ON public.ai_athlete_notes(athlete_id, note_date DESC);
