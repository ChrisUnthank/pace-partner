
-- Add delivery tracking for push notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_attempts smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS notifications_undelivered_idx
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL AND push_attempts < 3;

-- ============ BIRTHDAY AUTO-POST ============
CREATE OR REPLACE FUNCTION public.create_birthday_posts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (a.id, ca.coach_user_id)
      a.id AS athlete_id, a.name, ca.coach_user_id
    FROM public.athletes a
    JOIN public.coach_athletes ca ON ca.athlete_id = a.id
    WHERE a.dob IS NOT NULL
      AND EXTRACT(MONTH FROM a.dob) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(DAY   FROM a.dob) = EXTRACT(DAY   FROM CURRENT_DATE)
  LOOP
    -- Skip if already posted today for this athlete by this coach
    IF EXISTS (
      SELECT 1 FROM public.noticeboard_posts p
      WHERE p.post_type = 'birthday'
        AND p.author_id = rec.coach_user_id
        AND (p.meta->>'athlete_id')::uuid = rec.athlete_id
        AND p.created_at::date = CURRENT_DATE
    ) THEN CONTINUE; END IF;

    INSERT INTO public.noticeboard_posts(author_id, post_type, title, body, pinned, event_date, meta)
    VALUES (
      rec.coach_user_id,
      'birthday',
      '🎉 Happy birthday ' || rec.name || '!',
      'Wishing ' || rec.name || ' a great day from the squad.',
      true,
      CURRENT_DATE,
      jsonb_build_object('athlete_id', rec.athlete_id, 'auto', true)
    );
  END LOOP;
END $$;

-- Schedule cron jobs
DO $$ BEGIN
  PERFORM cron.unschedule('birthday-auto-posts');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'birthday-auto-posts',
  '5 6 * * *', -- daily 06:05 UTC
  $$ SELECT public.create_birthday_posts(); $$
);
