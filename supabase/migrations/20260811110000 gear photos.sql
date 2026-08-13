-- ============================================================================
-- Gear photos.
--
-- Two parts: the column on gear_items, and a storage bucket to put the files
-- in.
--
-- The bucket IS created here rather than through the Supabase dashboard tool.
-- Every other media bucket in this project (profiles, coach-media,
-- event-entries, noticeboard-media) was created by hand and never written
-- into a migration, which is why none of them appear anywhere in
-- supabase/migrations — rebuild from the repo and the uploads silently break.
-- This one is in the repo from the start.
--
-- Path convention: <athlete_id>/<timestamp>-<random>.<ext>
--
-- Access model, matching the `profiles` bucket: anyone signed in can READ
-- (a coach needs to see their athlete's gear), but only the owning athlete
-- or their coach can write or delete in that athlete's folder. The folder
-- name is the athlete_id, so ownership is checked by joining back to
-- public.athletes / coach_athletes — an athlete row's id is not a user id,
-- so it can't just be compared to auth.uid().
-- ============================================================================

ALTER TABLE public.gear_items
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.gear_items.image_url IS
  'Public URL of a photo of this item, stored in the gear-media bucket under <athlete_id>/.';

-- ----------------------------------------------------------------------------
-- Bucket
-- ----------------------------------------------------------------------------
-- public = true so getPublicUrl() works without signing, same as the other
-- media buckets this app already uses. Nothing sensitive lives here — it's a
-- photo of a shoe.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gear-media',
  'gear-media',
  true,
  5242880, -- 5 MB; a phone photo of a shoe has no business being larger
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- Policies
-- ----------------------------------------------------------------------------
-- Read: any signed-in user. Coaches, parents and managers all legitimately
-- need to see an athlete's gear, and a shoe photo is not sensitive. The gear
-- ROW itself is still protected by the RLS already on public.gear_items.
DROP POLICY IF EXISTS "gear-media read" ON storage.objects;
CREATE POLICY "gear-media read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gear-media');

-- Write/delete: only into a folder named after an athlete this user owns,
-- created, or coaches.
--
-- Deliberately NOT using public.can_access_athlete() here, even though it's
-- the helper the rest of the app uses. EXECUTE on it was revoked from
-- `authenticated` and PUBLIC in an early migration. That's fine for policies
-- on tables owned by postgres, but storage.objects is owned by
-- supabase_storage_admin, so a policy on it calling that function risks a
-- permission-denied at upload time rather than a clean policy failure. The
-- EXISTS clauses below inline the same logic using tables the role can read.
--
-- The regex guard runs before the ::uuid cast on purpose: a path whose first
-- folder isn't a UUID would otherwise raise a cast error instead of simply
-- failing the policy.
DROP POLICY IF EXISTS "gear-media insert own" ON storage.objects;
CREATE POLICY "gear-media insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gear-media'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (
      EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = ((storage.foldername(name))[1])::uuid
          AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.athlete_id = ((storage.foldername(name))[1])::uuid
          AND ca.coach_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "gear-media update own" ON storage.objects;
CREATE POLICY "gear-media update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gear-media'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (
      EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = ((storage.foldername(name))[1])::uuid
          AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.athlete_id = ((storage.foldername(name))[1])::uuid
          AND ca.coach_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "gear-media delete own" ON storage.objects;
CREATE POLICY "gear-media delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gear-media'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (
      EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = ((storage.foldername(name))[1])::uuid
          AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.athlete_id = ((storage.foldername(name))[1])::uuid
          AND ca.coach_user_id = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT id, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'gear-media';
--
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'gear-media%';
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='gear_items' AND column_name='image_url';
