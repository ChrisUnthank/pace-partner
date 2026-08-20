-- ============================================================================
-- EXPECTED RESOLUTION.
--
-- An injury or illness that is still going on has no resolved_date, so on a
-- calendar it runs forward forever — a strained calf logged in March marks
-- every day of next December. That is not just untidy: it makes the marker
-- useless, because a symbol that appears on every future day carries no
-- information about any of them.
--
-- WHY A SECOND DATE RATHER THAN JUST USING resolved_date
--
-- They mean different things and conflating them would destroy the more
-- valuable one. resolved_date is a FACT: this ended, on this day. An expected
-- date is a FORECAST: two more weeks, probably. Writing a forecast into
-- resolved_date would tell every downstream reader — availability, campaign
-- interruption, the injury history — that something has ended when it has
-- not, and there would be no way afterwards to tell which records were
-- observed and which were guessed.
--
-- Keeping them apart also lets the two be compared later, which is worth
-- having: a coach whose four-week estimates routinely run to seven weeks
-- learns something from that.
--
-- The UI renders days past today as an EXPECTATION rather than as fact, so
-- the distinction survives all the way to the screen instead of being
-- flattened at the last step.
-- ============================================================================

ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS expected_resolved_date date;

COMMENT ON COLUMN public.injuries.expected_resolved_date IS
  'When this is expected to clear. A forecast, never a fact — resolved_date remains the only record that something actually ended. Used to stop an unresolved record marking every future day on the calendar.';

-- A forecast that precedes the onset is a typo, not a plan. Deliberately NOT
-- compared against resolved_date: an injury that resolved earlier than
-- expected is the normal happy case and must stay saveable.
DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_expected_after_onset_check
      CHECK (expected_resolved_date IS NULL OR expected_resolved_date >= onset_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='injuries'
--    AND column_name IN ('resolved_date','expected_resolved_date');
-- Expect: both date, both nullable.
