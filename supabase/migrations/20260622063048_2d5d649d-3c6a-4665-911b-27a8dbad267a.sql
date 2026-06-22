
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.noticeboard_post_type AS ENUM ('announcement','result','upcoming_race','training_event','birthday','resource');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.attendance_source AS ENUM ('auto_gps','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TRAINING LOCATIONS ============
CREATE TABLE IF NOT EXISTS public.training_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  surface text,
  altitude_m integer,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_locations TO authenticated;
GRANT ALL ON public.training_locations TO service_role;
ALTER TABLE public.training_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locations readable by authenticated" ON public.training_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "coaches can manage locations" ON public.training_locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER training_locations_touch BEFORE UPDATE ON public.training_locations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- sessions extensions
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.training_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS altitude_m integer;

-- ============ NOTICEBOARD ============
CREATE TABLE IF NOT EXISTS public.noticeboard_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_type public.noticeboard_post_type NOT NULL DEFAULT 'announcement',
  title text NOT NULL,
  body text,
  link_url text,
  event_date date,
  pinned boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.noticeboard_posts TO authenticated;
GRANT ALL ON public.noticeboard_posts TO service_role;
ALTER TABLE public.noticeboard_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posts readable by authenticated" ON public.noticeboard_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "coaches can write posts" ON public.noticeboard_posts FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'manager')) AND author_id = auth.uid());
CREATE POLICY "authors can update own posts" ON public.noticeboard_posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "authors can delete own posts" ON public.noticeboard_posts FOR DELETE TO authenticated USING (author_id = auth.uid());
CREATE TRIGGER noticeboard_posts_touch BEFORE UPDATE ON public.noticeboard_posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX IF NOT EXISTS noticeboard_posts_created_idx ON public.noticeboard_posts (created_at DESC);

CREATE TABLE IF NOT EXISTS public.noticeboard_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.noticeboard_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);
GRANT SELECT, INSERT, DELETE ON public.noticeboard_reactions TO authenticated;
GRANT ALL ON public.noticeboard_reactions TO service_role;
ALTER TABLE public.noticeboard_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions readable" ON public.noticeboard_reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "users react as themselves" ON public.noticeboard_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "users remove own reactions" ON public.noticeboard_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_channels jsonb NOT NULL DEFAULT '["inapp"]'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own push subs" ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ DIRECT MESSAGES ============
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm participants read" ON public.direct_messages FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "dm send as self" ON public.direct_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
CREATE POLICY "dm recipient marks read" ON public.direct_messages FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
CREATE INDEX IF NOT EXISTS dm_pair_idx ON public.direct_messages (
  LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC
);
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.message_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.message_broadcasts TO authenticated;
GRANT ALL ON public.message_broadcasts TO service_role;
ALTER TABLE public.message_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own broadcasts" ON public.message_broadcasts FOR ALL TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());

-- ============ ATTENDANCE ============
CREATE TABLE IF NOT EXISTS public.session_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  source public.attendance_source NOT NULL DEFAULT 'manual',
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, athlete_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_attendance TO authenticated;
GRANT ALL ON public.session_attendance TO service_role;
ALTER TABLE public.session_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance readable by coach or athlete" ON public.session_attendance FOR SELECT TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id));
CREATE POLICY "coach manages attendance" ON public.session_attendance FOR ALL TO authenticated
  USING (public.is_coach_of(auth.uid(), athlete_id))
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

-- ============ NOTIFICATION TRIGGERS ============
-- Notify coach when athlete completes a session
CREATE OR REPLACE FUNCTION public.trg_notify_session_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE coach_uid uuid; athlete_name text;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL) THEN
    SELECT name INTO athlete_name FROM public.athletes WHERE id = NEW.athlete_id;
    FOR coach_uid IN SELECT coach_user_id FROM public.coach_athletes WHERE athlete_id = NEW.athlete_id LOOP
      INSERT INTO public.notifications(user_id, kind, title, body, link, data)
      VALUES (coach_uid, 'session_completed',
              COALESCE(athlete_name,'Athlete') || ' completed a session',
              COALESCE(NEW.title,'Session') || ' on ' || NEW.session_date::text,
              '/app/sessions/' || NEW.id::text,
              jsonb_build_object('session_id', NEW.id, 'athlete_id', NEW.athlete_id));
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_session_completed ON public.sessions;
CREATE TRIGGER trg_notify_session_completed AFTER UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_session_completed();

-- Notify athlete when coach updates a planned session
CREATE OR REPLACE FUNCTION public.trg_notify_session_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE athlete_uid uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.completed_at IS NULL
     AND (OLD.title IS DISTINCT FROM NEW.title
       OR OLD.session_date IS DISTINCT FROM NEW.session_date
       OR OLD.intent IS DISTINCT FROM NEW.intent
       OR OLD.notes IS DISTINCT FROM NEW.notes) THEN
    SELECT user_id INTO athlete_uid FROM public.athletes WHERE id = NEW.athlete_id;
    IF athlete_uid IS NOT NULL AND athlete_uid <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications(user_id, kind, title, body, link, data)
      VALUES (athlete_uid, 'session_updated', 'Session updated',
              COALESCE(NEW.title,'Session') || ' on ' || NEW.session_date::text,
              '/app/sessions/' || NEW.id::text,
              jsonb_build_object('session_id', NEW.id));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_session_updated ON public.sessions;
CREATE TRIGGER trg_notify_session_updated AFTER UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_session_updated();

-- Notify all athletes coached by author when a noticeboard post is created
CREATE OR REPLACE FUNCTION public.trg_notify_noticeboard_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT a.user_id AS uid
    FROM public.coach_athletes ca
    JOIN public.athletes a ON a.id = ca.athlete_id
    WHERE ca.coach_user_id = NEW.author_id AND a.user_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications(user_id, kind, title, body, link, data)
    VALUES (rec.uid, 'noticeboard_post', NEW.title, LEFT(COALESCE(NEW.body,''), 240),
            '/app/noticeboard', jsonb_build_object('post_id', NEW.id, 'post_type', NEW.post_type));
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_noticeboard_post ON public.noticeboard_posts;
CREATE TRIGGER trg_notify_noticeboard_post AFTER INSERT ON public.noticeboard_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_noticeboard_post();

-- Notify recipient on new DM
CREATE OR REPLACE FUNCTION public.trg_notify_direct_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_name text;
BEGIN
  SELECT full_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
  INSERT INTO public.notifications(user_id, kind, title, body, link, data)
  VALUES (NEW.recipient_id, 'direct_message',
          'New message from ' || COALESCE(sender_name,'a user'),
          LEFT(NEW.body, 240), '/app/messages',
          jsonb_build_object('message_id', NEW.id, 'sender_id', NEW.sender_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_direct_message ON public.direct_messages;
CREATE TRIGGER trg_notify_direct_message AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_direct_message();

-- Realtime for notifications too
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
