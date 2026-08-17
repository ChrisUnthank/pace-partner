-- ============================================================================
-- Taper depth and shape, per campaign.
--
-- The generator drove every taper down to a hardcoded 55% in race week. That
-- suits an athlete who sharpens on a deep taper and is wrong for one who
-- detrains on it — a real and well-known split, and not something a campaign
-- can infer.
--
-- Two settings rather than one, because they answer different questions:
--
--   taper_floor_pct   HOW LOW it goes in race week. 55 is the deep end; an
--                     athlete who loses fitness on two light weeks might sit
--                     at 70. At a 90km baseline that is 63km in race week
--                     rather than 50km — a difference no coach would call
--                     cosmetic.
--
--   taper_shape       HOW IT GETS THERE.
--                       linear  even steps down
--                       gentle  holds load into the second-last week, then
--                               drops late — for athletes who need the work
--                               and sharpen quickly
--                       steep   sheds early and coasts in — for athletes who
--                               arrive tired and need the time
--
-- A 2-week taper from a 115% peak, to show the range these produce:
--     linear / 55   85 -> 55
--     linear / 70   93 -> 70
--     gentle / 70  101 -> 70
--     steep  / 55   72 -> 55
--
-- ON WHAT THIS STILL DOESN'T MODEL
-- A taper is not only less volume — it is usually less volume with intensity
-- held or raised. load_pct is a VOLUME figure and carries no intensity, so a
-- campaign cannot express "60% of the distance but keep the reps sharp." That
-- belongs at the session level, in what actually fills the week, and this
-- migration deliberately doesn't pretend otherwise. Modelling intensity here
-- would produce a number that looks authoritative and isn't.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS taper_floor_pct integer NOT NULL DEFAULT 55
    CHECK (taper_floor_pct BETWEEN 30 AND 95),
  ADD COLUMN IF NOT EXISTS taper_shape text NOT NULL DEFAULT 'linear'
    CHECK (taper_shape IN ('linear', 'gentle', 'steep'));

COMMENT ON COLUMN public.campaigns.taper_floor_pct IS
  'Load in race week as a percentage of a normal loading week. Lower sharpens harder; higher protects an athlete who detrains on a deep taper.';
COMMENT ON COLUMN public.campaigns.taper_shape IS
  'linear = even steps. gentle = holds load then drops late. steep = sheds early and coasts in.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, taper_weeks, taper_floor_pct, taper_shape FROM public.campaigns;
