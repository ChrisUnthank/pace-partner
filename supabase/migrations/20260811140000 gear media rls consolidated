-- ============================================================================
-- gear-media upload fix — CONSOLIDATED. Run this whole file in one go.
--
-- Unlike the diagnostic files, this one is safe to select-all and Run: every
-- statement is DDL, so there are no query results to lose. (The SQL Editor
-- only displays the LAST statement's result, which is why the diagnostic
-- files had to be run block by block — that doesn't matter here.)
--
-- Supersedes 20260811120000 and 20260811130000. Running those first isn't
-- necessary; running them afterwards isn't harmful either.
--
-- Everything below is idempotent — safe to re-run if anything errors midway.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Helper
--
-- Wraps the app's own can_access_athlete() rather than reimplementing it.
-- That matters: is_coach_of() was extended in 20260621050115 so anyone with
-- the 'manager' role can see every athlete without a coach_athletes row. My
-- first attempt inlined the ownership check and missed that entirely.
--
-- SECURITY DEFINER so it runs as its owner — which lets it call
-- can_access_athlete (EXECUTE on that was revoked from `authenticated` in an
-- early migration) and read the underlying tables without their RLS applying
-- inside a storage policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_gear_media(_user_id uuid, _folder text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL OR _folder IS NULL THEN
    RETURN false;
  END IF;

  -- Checked BEFORE the cast: a first folder that isn't a UUID would
  -- otherwise raise invalid-input rather than cleanly failing the policy.
  IF _folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;

  RETURN public.can_access_athlete(_user_id, _folder::uuid);
END;
$function$;


-- ---------------------------------------------------------------------------
-- 2. Grants
--
-- storage.objects is owned by supabase_storage_admin, not postgres, so the
-- role that needs EXECUTE here may be that one rather than `authenticated`.
-- Granting to both removes the guesswork — a missing EXECUTE surfaces as a
-- policy failure, indistinguishable from the access check simply returning
-- false, which is what made this hard to see.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_write_gear_media(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_gear_media(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_gear_media(uuid, text) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.can_write_gear_media(uuid, text) TO supabase_storage_admin';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 3. Bucket (no-op if it already exists — yours does)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gear-media',
  'gear-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 4. Policies — replacing the original four, which are still the ones live
--    on your project (that's why uploads are refused).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "gear-media read" ON storage.objects;
CREATE POLICY "gear-media read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gear-media');

DROP POLICY IF EXISTS "gear-media insert own" ON storage.objects;
CREATE POLICY "gear-media insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gear-media'
    AND public.can_write_gear_media(auth.uid(), (storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "gear-media update own" ON storage.objects;
CREATE POLICY "gear-media update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gear-media'
    AND public.can_write_gear_media(auth.uid(), (storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'gear-media'
    AND public.can_write_gear_media(auth.uid(), (storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "gear-media delete own" ON storage.objects;
CREATE POLICY "gear-media delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gear-media'
    AND public.can_write_gear_media(auth.uid(), (storage.foldername(name))[1])
  );

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- 5. VERIFY — run this SEPARATELY afterwards (it returns rows, so it needs to
-- be the only thing selected when you hit Run).
--
-- Expect one row per athlete-linked user, all with can_write = true.
-- ============================================================================
-- SELECT
--   u.email,
--   a.id AS athlete_id,
--   (storage.foldername(a.id || '/test-file.jpg'))[1] AS folder_extracted,
--   public.can_write_gear_media(u.id, (storage.foldername(a.id || '/test-file.jpg'))[1]) AS can_write
-- FROM auth.users u
-- JOIN public.athletes a ON a.user_id = u.id
-- ORDER BY u.email;

-- And confirm the policies now reference the helper rather than the old
-- inlined EXISTS:
--
-- SELECT policyname, cmd, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'gear-media%'
-- ORDER BY policyname;
