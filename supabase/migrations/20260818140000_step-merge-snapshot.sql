-- ============================================================================
-- Make a block merge reversible.
--
-- Merging deletes the other blocks and moves their recorded reps onto the
-- survivor. That is the right outcome when it's deliberate and unrecoverable
-- when it isn't — and "select seven blocks and press merge" is easy to get
-- wrong by one block.
--
-- A snapshot of everything the merge consumed is written onto the surviving
-- step, so it can be put back exactly:
--
--   * the full rows of every removed step
--   * the interval_results that belonged to each of them — including the
--     RECOVERY blocks' results, which the merge drops entirely (their
--     distance is recovery, not work, and folding it into the set would
--     inflate the work total). Dropped is fine; unrecoverable is not.
--   * the survivor's own pre-merge values, since the merge overwrites its
--     reps, set_count and recovery fields
--
-- jsonb rather than a side table: a snapshot is only ever read as a whole, by
-- the one step that owns it, and a table would need its own lifecycle,
-- policies and cleanup for no gain.
--
-- Cleared on unmerge. A step can only hold one, because merging a block that
-- already carries a snapshot would need nesting, and the honest answer there
-- is to unmerge first.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS merge_snapshot jsonb;

COMMENT ON COLUMN public.steps.merge_snapshot IS
  'What this block absorbed when it was merged: the removed steps, their interval_results, and this step''s own pre-merge values. Present = this block can be unmerged. Cleared when it is.';

CREATE INDEX IF NOT EXISTS steps_merge_snapshot_idx
  ON public.steps (session_id) WHERE merge_snapshot IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately. Blocks that can currently be unmerged:
-- ============================================================================
-- SELECT s.session_date, s.title, st.kind, st.reps,
--        jsonb_array_length(st.merge_snapshot -> 'removedSteps') AS blocks_absorbed
-- FROM public.steps st
-- JOIN public.sessions s ON s.id = st.session_id
-- WHERE st.merge_snapshot IS NOT NULL
-- ORDER BY s.session_date DESC;
