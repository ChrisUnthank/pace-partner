-- ============================================================================
-- Linking a campaign to the rest of the app.
--
-- Until now a campaign's races were typed in by hand, duplicating races that
-- already exist as goals or in the race schedule. Three places holding the
-- same race date is three places to update when it moves, and two of them
-- will be forgotten.
--
--   athlete_goal_id            already existed but nothing populated it
--   race_schedule_entry_id     new — a race picked from the squad calendar
--
-- Both nullable: a coach pencilling in a race that isn't yet a goal or on any
-- calendar must still be able to. The link is an improvement when available,
-- not a requirement.
--
-- ON DELETE SET NULL rather than CASCADE, on purpose. Removing a goal should
-- not silently delete the race from a season that was built around it — the
-- campaign keeps its own date and name, and simply stops being linked.
--
-- NOT DONE HERE: plans filling blocks. campaign_blocks would take an
-- athlete_plan_id, but a plan carries its own start_date and duration_weeks
-- and reconciling those with a block's dates is a real piece of design rather
-- than a column. Left until the rest is in use.
-- ============================================================================

ALTER TABLE public.campaign_targets
  ADD COLUMN IF NOT EXISTS race_schedule_entry_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_targets_race_entry_fkey') THEN
    ALTER TABLE public.campaign_targets
      ADD CONSTRAINT campaign_targets_race_entry_fkey
      FOREIGN KEY (race_schedule_entry_id)
      REFERENCES public.race_schedule_entries (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.campaign_targets.race_schedule_entry_id IS
  'The race in the squad schedule this target came from, when it was picked rather than typed. Nullable — a pencilled-in race has no entry yet.';

CREATE INDEX IF NOT EXISTS campaign_targets_goal_idx
  ON public.campaign_targets (athlete_goal_id) WHERE athlete_goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_targets_entry_idx
  ON public.campaign_targets (race_schedule_entry_id) WHERE race_schedule_entry_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Actual volume per campaign week, from completed sessions.
--
-- Read-only and derived — nothing is stored. A campaign says what was planned;
-- sessions record what happened, and the comparison is the interesting part.
-- Storing an "actual" column would mean keeping it in step with every session
-- edit, which is a recompute trigger nobody needs when the query is cheap.
--
-- Weeks are Monday-based here to match campaign_weeks.week_start.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_campaign_actuals(_campaign_id uuid)
RETURNS TABLE (
  week_start   date,
  sessions     integer,
  actual_m     numeric,
  actual_km    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_athlete uuid;
  v_from date;
  v_to date;
BEGIN
  SELECT c.athlete_id, c.starts_on, c.ends_on INTO v_athlete, v_from, v_to
  FROM public.campaigns c WHERE c.id = _campaign_id;

  IF v_athlete IS NULL THEN
    RETURN;
  END IF;

  -- Same access rule as reading the campaign itself.
  IF NOT public.can_access_athlete(auth.uid(), v_athlete) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;

  RETURN QUERY
  SELECT
    (s.session_date - ((EXTRACT(ISODOW FROM s.session_date)::int - 1) || ' days')::interval)::date AS wk,
    COUNT(*)::int,
    COALESCE(SUM(s.total_distance_m), 0)::numeric,
    ROUND(COALESCE(SUM(s.total_distance_m), 0)::numeric / 1000.0, 1)
  FROM public.sessions s
  WHERE s.athlete_id = v_athlete
    AND s.completed_at IS NOT NULL
    AND s.session_date BETWEEN v_from AND (v_to + 6)
  GROUP BY 1
  ORDER BY 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_campaign_actuals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_actuals(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT * FROM public.get_campaign_actuals('PASTE_CAMPAIGN_ID');
