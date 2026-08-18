-- ============================================================================
-- Let a single week's phase be changed after the campaign is generated.
--
-- A week's phase currently comes from the block it belongs to, so changing one
-- week means editing blocks — and the case that prompted this can't be
-- expressed at all: a campaign that follows straight on from another doesn't
-- start from a standing start. If the previous season ended with a down week,
-- week 1 of the new one might reasonably be an overload, not base.
--
-- phase_override is per-week and wins over the block's phase when set.
--
-- WHY NOT EDIT THE BLOCKS
--
-- Blocks are contiguous runs of the same phase — that's all they are. Changing
-- one week in the middle of a base block means splitting it into three, which
-- is bookkeeping the coach shouldn't have to think about, and the split would
-- need undoing if they changed it back.
--
-- Instead the weeks are authoritative and the blocks are derived from them at
-- render time. Overriding a week resplits the blocks automatically, and
-- clearing the override merges them back.
-- ============================================================================

ALTER TABLE public.campaign_weeks
  ADD COLUMN IF NOT EXISTS phase_override text
    CHECK (phase_override IS NULL OR phase_override IN
      ('reset', 'base', 'build', 'peak', 'taper', 'transition', 'race_week'));

COMMENT ON COLUMN public.campaign_weeks.phase_override IS
  'Set when a coach changes this single week''s phase. Wins over the block''s phase. NULL means the week follows its block.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT c.name, w.week_number, w.week_start, w.phase_override
-- FROM public.campaign_weeks w
-- JOIN public.campaigns c ON c.id = w.campaign_id
-- WHERE w.phase_override IS NOT NULL
-- ORDER BY c.name, w.week_number;
