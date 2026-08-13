-- ============================================================================
-- Training locations: personal vs squad.
--
-- Supersedes 20260813140000. If you ran that one, this replaces its policies
-- outright — no need to undo it first.
--
-- THE MODEL
--
--   owner_athlete_id IS NULL   -> SQUAD location. Created by a coach. Visible
--                                 to every signed-in user, editable by any
--                                 coach or manager. This is exactly the
--                                 existing behaviour, so nothing already in
--                                 the table changes meaning.
--
--   owner_athlete_id = <id>    -> PERSONAL location. Created by an athlete.
--                                 Visible to that athlete and to anyone who
--                                 can already access them (their coach, a
--                                 manager, a linked parent). Editable and
--                                 deletable ONLY by the athlete who owns it —
--                                 a coach can see it but not change it.
--                                 Invisible to every other athlete, including
--                                 other athletes of the same coach.
--
-- Visibility for personal locations deliberately reuses can_access_athlete(),
-- the same helper the rest of the app uses for "who may see this athlete's
-- data". Reimplementing the rule here would drift from it — that mistake
-- already cost a round on the gear-media storage policies, where an inlined
-- copy silently missed the manager role.
--
-- BACKFILL: none. Every existing row stays NULL, i.e. squad — which is what
-- they are, since only coaches could create them until now.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.training_locations
  ADD COLUMN IF NOT EXISTS owner_athlete_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_locations_owner_athlete_id_fkey'
  ) THEN
    ALTER TABLE public.training_locations
      ADD CONSTRAINT training_locations_owner_athlete_id_fkey
      FOREIGN KEY (owner_athlete_id)
      REFERENCES public.athletes (id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.training_locations.owner_athlete_id IS
  'NULL = squad location (coach-created, visible to all, coach-editable). Set = personal to that athlete: visible to them and whoever can access them, editable only by them.';

CREATE INDEX IF NOT EXISTS training_locations_owner_idx
  ON public.training_locations (owner_athlete_id) WHERE owner_athlete_id IS NOT NULL;

ALTER TABLE public.training_locations
  ALTER COLUMN created_by SET DEFAULT auth.uid();


-- ---------------------------------------------------------------------------
-- Helper: is this user the athlete who owns the location?
--
-- SECURITY DEFINER so the policy doesn't depend on the caller's own RLS on
-- public.athletes resolving the same way — a policy that quietly depends on
-- another table's policy is fragile even when it happens to work.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_athlete_profile(_user_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = _athlete_id AND a.user_id = _user_id
  );
$function$;

REVOKE ALL ON FUNCTION public.owns_athlete_profile(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_athlete_profile(uuid, uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "coaches can manage locations" ON public.training_locations;
DROP POLICY IF EXISTS "locations readable by authenticated" ON public.training_locations;
DROP POLICY IF EXISTS "locations insert own" ON public.training_locations;
DROP POLICY IF EXISTS "locations update own or coach" ON public.training_locations;
DROP POLICY IF EXISTS "locations delete own or coach" ON public.training_locations;
DROP POLICY IF EXISTS "locations select" ON public.training_locations;
DROP POLICY IF EXISTS "locations insert" ON public.training_locations;
DROP POLICY IF EXISTS "locations update" ON public.training_locations;
DROP POLICY IF EXISTS "locations delete" ON public.training_locations;

-- SELECT: squad locations to everyone; personal ones to the owner and to
-- anyone who can already access that athlete.
CREATE POLICY "locations select" ON public.training_locations
  FOR SELECT TO authenticated
  USING (
    owner_athlete_id IS NULL
    OR public.owns_athlete_profile(auth.uid(), owner_athlete_id)
    OR public.can_access_athlete(auth.uid(), owner_athlete_id)
  );

-- INSERT: an athlete may create a personal location for their own profile.
-- A coach or manager may create a squad location (owner_athlete_id NULL) or
-- one on behalf of an athlete they can access.
CREATE POLICY "locations insert" ON public.training_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      owner_athlete_id IS NOT NULL
      AND public.owns_athlete_profile(auth.uid(), owner_athlete_id)
    )
    OR public.has_role(auth.uid(), 'coach')
    OR public.has_role(auth.uid(), 'manager')
  );

-- UPDATE: a personal location is the owning athlete's alone — a coach can see
-- it but not change it, which is the point of the distinction. Squad
-- locations stay coach/manager-managed.
CREATE POLICY "locations update" ON public.training_locations
  FOR UPDATE TO authenticated
  USING (
    CASE
      WHEN owner_athlete_id IS NOT NULL THEN public.owns_athlete_profile(auth.uid(), owner_athlete_id)
      ELSE public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager')
    END
  )
  WITH CHECK (
    CASE
      WHEN owner_athlete_id IS NOT NULL THEN public.owns_athlete_profile(auth.uid(), owner_athlete_id)
      ELSE public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager')
    END
  );

-- DELETE: same rule. sessions.location_id and gear_items.default_location_id
-- are both ON DELETE SET NULL, so removing a location detaches rather than
-- destroys.
CREATE POLICY "locations delete" ON public.training_locations
  FOR DELETE TO authenticated
  USING (
    CASE
      WHEN owner_athlete_id IS NOT NULL THEN public.owns_athlete_profile(auth.uid(), owner_athlete_id)
      ELSE public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager')
    END
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately. Expect four policies.
-- ============================================================================
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'training_locations'
-- ORDER BY cmd, policyname;

-- Ownership overview — everything should currently read 'squad':
-- SELECT tl.name,
--        CASE WHEN tl.owner_athlete_id IS NULL THEN 'squad' ELSE 'personal' END AS kind,
--        a.name AS owner
-- FROM public.training_locations tl
-- LEFT JOIN public.athletes a ON a.id = tl.owner_athlete_id
-- ORDER BY kind, tl.name;
