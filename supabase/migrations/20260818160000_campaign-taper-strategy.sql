-- ============================================================================
-- Taper strategy: a named archetype, plus the two things volume can't express.
--
-- The numeric settings already cover half of it:
--
--   Duration          taper_days            14-21 vs 7-10
--   Volume reduction  taper_floor_pct       how deep
--                     taper_shape           'linear' steps down; 'gentle'
--                                           holds load and drops late, which
--                                           IS the high-response profile
--
-- The other half is not volume at all, and load_pct cannot carry it:
--
--   TRAINING FREQUENCY   A traditional taper cuts days per week. A short
--                        taper keeps every day and shortens each session.
--                        Same weekly volume, entirely different week.
--
--   NEUROMUSCULAR TONE   Traditional lets tone relax; short tapers keep it
--                        with frequent, very brief speed inputs.
--
-- Both are decisions about WHAT FILLS THE WEEK, so they are stored as
-- intent and shown on the taper weeks rather than being folded into a
-- number. A single figure that claimed to represent "60% volume but keep the
-- strides sharp" would look authoritative and mean nothing.
--
-- taper_strategy is a label, not a lock: picking an archetype sets the
-- numbers, and changing any number afterwards moves it to 'custom'. The
-- campaign is a starting point, and an athlete who wants an 11-day taper
-- shouldn't have to pretend it's one of two categories.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS taper_strategy text NOT NULL DEFAULT 'traditional'
    CHECK (taper_strategy IN ('traditional', 'high_response', 'custom')),
  ADD COLUMN IF NOT EXISTS taper_frequency_mode text NOT NULL DEFAULT 'fewer_days'
    CHECK (taper_frequency_mode IN ('fewer_days', 'same_days_shorter')),
  ADD COLUMN IF NOT EXISTS taper_neuromuscular boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.campaigns.taper_strategy IS
  'traditional = long, stepped, tone allowed to relax. high_response = short, load held then dropped, tone kept up. custom = the numbers have been changed by hand.';
COMMENT ON COLUMN public.campaigns.taper_frequency_mode IS
  'fewer_days = cut sessions from the week. same_days_shorter = keep every day, shorten each one. Guidance for whoever fills the block — the campaign models volume, not session structure.';
COMMENT ON COLUMN public.campaigns.taper_neuromuscular IS
  'Keep neuromuscular tone through the taper with frequent, very short speed inputs.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, taper_strategy, taper_days, taper_floor_pct, taper_shape,
--        taper_frequency_mode, taper_neuromuscular
-- FROM public.campaigns ORDER BY starts_on DESC;
