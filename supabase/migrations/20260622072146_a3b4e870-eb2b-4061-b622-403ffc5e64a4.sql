
-- Profile: BYO Anthropic API key (athlete opt-in for AI access)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anthropic_api_key text,
  ADD COLUMN IF NOT EXISTS anthropic_api_key_last4 text;

-- Noticeboard: track edits
ALTER TABLE public.noticeboard_posts
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Allow authors to update their own posts
DROP POLICY IF EXISTS "author updates own post" ON public.noticeboard_posts;
CREATE POLICY "author updates own post" ON public.noticeboard_posts
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Direct messages: edit tracking
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Allow senders to edit their own messages within 24h
DROP POLICY IF EXISTS "sender edits within 24h" ON public.direct_messages;
CREATE POLICY "sender edits within 24h" ON public.direct_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND created_at > now() - interval '24 hours')
  WITH CHECK (sender_id = auth.uid());

-- Broadcasts: edit tracking + UPDATE policy (coach edits own anytime)
ALTER TABLE public.message_broadcasts
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- AI usage rate limiting
CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_date date NOT NULL DEFAULT CURRENT_DATE,
  call_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_date)
);
GRANT SELECT ON public.ai_usage_daily TO authenticated;
GRANT ALL    ON public.ai_usage_daily TO service_role;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own ai usage" ON public.ai_usage_daily
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Increment helper (security definer so user-scoped fns can call it under their own RLS)
CREATE OR REPLACE FUNCTION public.ai_consume_quota(_user_id uuid, _limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE current_count int;
BEGIN
  INSERT INTO public.ai_usage_daily(user_id, used_date, call_count)
  VALUES (_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, used_date)
    DO UPDATE SET call_count = public.ai_usage_daily.call_count + 1
  RETURNING call_count INTO current_count;
  RETURN current_count <= _limit;
END $$;
