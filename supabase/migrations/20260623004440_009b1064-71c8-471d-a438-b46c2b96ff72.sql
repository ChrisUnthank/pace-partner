
-- 1. profile_image_url columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_image_url text;
ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS profile_image_url text;

-- 2. Broaden profile read access so coaches/managers can see avatars of users they interact with
DROP POLICY IF EXISTS "profiles self read" ON public.profiles;
CREATE POLICY "profiles read self or related" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.has_role(auth.uid(), 'manager')
    OR EXISTS (
      SELECT 1 FROM public.coach_athletes ca
      JOIN public.athletes a ON a.id = ca.athlete_id
      WHERE (
        (ca.coach_user_id = auth.uid() AND a.user_id = profiles.id)
        OR (a.user_id = auth.uid() AND ca.coach_user_id = profiles.id)
      )
    )
  );

-- 3. alert_dismissals
CREATE TABLE IF NOT EXISTS public.alert_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  dismissed_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_user_id, athlete_id, alert_type, dismissed_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_dismissals TO authenticated;
GRANT ALL ON public.alert_dismissals TO service_role;

ALTER TABLE public.alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_dismissals owner all" ON public.alert_dismissals
  FOR ALL TO authenticated
  USING (coach_user_id = auth.uid())
  WITH CHECK (coach_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS alert_dismissals_lookup
  ON public.alert_dismissals(coach_user_id, dismissed_date);

-- 4. Storage policies for the 'profiles' bucket (bucket itself created via tool).
-- Path convention: <user_id>/<filename>. Anyone signed in can read; only owner can write.
DROP POLICY IF EXISTS "profiles bucket read" ON storage.objects;
CREATE POLICY "profiles bucket read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'profiles');

DROP POLICY IF EXISTS "profiles bucket insert own" ON storage.objects;
CREATE POLICY "profiles bucket insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "profiles bucket update own" ON storage.objects;
CREATE POLICY "profiles bucket update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "profiles bucket delete own" ON storage.objects;
CREATE POLICY "profiles bucket delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
