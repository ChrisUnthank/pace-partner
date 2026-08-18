-- ============================================================================
-- Overload blocks: several per campaign, placed BEFORE the taper rather than
-- against it.
--
-- WHAT WAS WRONG
--
-- The generator placed exactly one overload week per peak race, immediately
-- before its taper. Two things wrong with that:
--
--   1. ONCE PER CAMPAIGN. A season has several performances worth peaking
--      for, and each wants its own hard block. Only the season's single
--      target got one.
--
--   2. TOO LATE. An overload creates fatigue that has to be absorbed before
--      it becomes fitness. Sitting it directly against the taper means the
--      taper is doing two jobs at once — shedding the overload's fatigue AND
--      sharpening — and the athlete arrives flat. The block wants to land
--      two to four weeks out, with normal training between it and the taper
--      to absorb the work.
--
-- NEW SETTINGS
--
--   overload_weeks_before_race   how far out the block sits, default 3
--   overload_block_weeks         how long it runs, default 1
--   overload_before_key          whether key races get one too, default true
--
-- All settings rather than constants, for the same reason taper depth is: how
-- much overload an athlete absorbs, and how long they need to absorb it,
-- varies enough that a fixed answer would be wrong for someone.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS overload_weeks_before_race integer NOT NULL DEFAULT 3
    CHECK (overload_weeks_before_race BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS overload_block_weeks integer NOT NULL DEFAULT 1
    CHECK (overload_block_weeks BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS overload_before_key boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.campaigns.overload_weeks_before_race IS
  'Weeks between the overload block and the race. Counted from the race, not from the taper, because the point is how long the athlete has to absorb the work.';
COMMENT ON COLUMN public.campaigns.overload_block_weeks IS
  'Length of the overload block. 0 switches overload blocks off entirely.';
COMMENT ON COLUMN public.campaigns.overload_before_key IS
  'Whether key races get their own overload block, or only peaks.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, overload_weeks_before_race, overload_block_weeks, overload_before_key
-- FROM public.campaigns ORDER BY starts_on DESC;
