-- ============================================================================
-- Athletes can SEE their campaign; only its author can change it.
--
-- The original policy was FOR ALL gated on can_access_athlete, which reads
-- correctly for viewing and is wrong for writing: it let an athlete edit or
-- delete a season their coach had built for them. Not malice — an athlete
-- opening the page and adjusting a week would silently overwrite the coach's
-- plan, and neither would know until they disagreed about what it said.
--
-- THE RULE
--   SELECT  anyone who can access the athlete — the athlete, their coach, a
--           manager, a linked parent. Seeing your own season is the point.
--   WRITE   coaches and managers, or the athlete IF THEY CREATED IT.
--
-- That last clause matters: a self-coached athlete builds their own campaigns
-- and must be able to edit them. created_by is what separates "my plan" from
-- "my coach's plan", and it is set by default on insert.
--
-- Child tables follow the parent rather than carrying their own rule, so
-- there is one place the answer lives.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_write_campaign(_user_id uuid, _campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = _campaign_id
      AND (
        c.created_by = _user_id
        OR public.has_role(_user_id, 'coach')
        OR public.has_role(_user_id, 'manager')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_write_campaign(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_campaign(uuid, uuid) TO authenticated;

-- ---- campaigns -------------------------------------------------------------
DROP POLICY IF EXISTS "campaigns access" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns select" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns insert" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns update" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns delete" ON public.campaigns;

CREATE POLICY "campaigns select" ON public.campaigns
  FOR SELECT TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id));

CREATE POLICY "campaigns insert" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_athlete(auth.uid(), athlete_id)
    AND (
      created_by = auth.uid()
      OR public.has_role(auth.uid(), 'coach')
      OR public.has_role(auth.uid(), 'manager')
    )
  );

CREATE POLICY "campaigns update" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coach')
    OR public.has_role(auth.uid(), 'manager')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coach')
    OR public.has_role(auth.uid(), 'manager')
  );

CREATE POLICY "campaigns delete" ON public.campaigns
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coach')
    OR public.has_role(auth.uid(), 'manager')
  );

-- ---- children: read with the parent, write only if the parent is writable --
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_targets', 'campaign_blocks', 'campaign_weeks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'campaign ' || replace(t, 'campaign_', '') || ' access', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' write', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM public.campaigns c
                       WHERE c.id = campaign_id
                         AND public.can_access_athlete(auth.uid(), c.athlete_id)))
    $f$, t || ' select', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (public.can_write_campaign(auth.uid(), campaign_id))
        WITH CHECK (public.can_write_campaign(auth.uid(), campaign_id))
    $f$, t || ' write', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately. Expect four policies on campaigns, two per child.
-- ============================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname='public' AND tablename LIKE 'campaign%' ORDER BY tablename, cmd;
