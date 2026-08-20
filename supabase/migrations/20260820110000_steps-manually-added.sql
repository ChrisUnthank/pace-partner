-- ============================================================================
-- HAND-ADDED BLOCKS: making them count, and making them survive.
--
-- THE PROBLEM
--
-- "Add / reorder blocks" lets a coach add any of warmup / strides / work /
-- recovery / cooldown to an existing session. That is the right answer to a
-- race the watch missed, or a warmup nobody remembered to record. But on a
-- session built from uploaded files, the numbers typed into those blocks go
-- nowhere:
--
--   if (session.source !== "fit_import") {
--     sessionPatch.total_distance_m = totalDistance;   -- skipped for imports
--   }
--
-- That guard is correct in its original setting. For a file-based session the
-- files are the truth, rep results are corrections WITHIN that truth, and
-- recomputing the total from reps would understate a session whose warmup and
-- cooldown laps carry no rep rows at all.
--
-- It stopped being correct once blocks could be added that have no file
-- behind them. A hand-entered 5km race updates work_distance_m and then never
-- reaches total_distance_m, so the session still reads as warmup plus
-- cooldown and the race is invisible in every weekly total.
--
-- The missing piece is knowing WHICH steps came from a file and which a human
-- typed. Nothing recorded that, so the aggregate had to choose one rule for
-- all of them and picked the one that was safe before this feature existed.
--
--
-- WHY THIS ALSO FIXES THE RECOMPUTE PROBLEM
--
-- rebuildSessionFromAllFiles deletes every step and regenerates from the
-- files, so a hand-added race was discarded by "Recompute from files" — the
-- confirmation dialog warned about it, but the warning was the whole defence.
--
-- One flag answers both questions, because they are the same question:
-- a step nothing generated is a step nothing should regenerate over.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS manually_added boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.steps.manually_added IS
  'True when a person added this block by hand rather than it being derived from an uploaded file. Its distance is added to the session total on top of the file-derived figure, and it is preserved rather than regenerated when the session is rebuilt from its files.';

-- Existing rows are all false, which is correct: every step in the database
-- before now was either generated from a file or created with the session
-- itself. Nothing to backfill.

-- Cheap lookup for the two places that need to separate the two kinds.
CREATE INDEX IF NOT EXISTS steps_manually_added_idx
  ON public.steps (session_id)
  WHERE manually_added = true;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='steps' AND column_name='manually_added';
-- Expect: boolean, default false, NOT NULL.
--
-- SELECT COUNT(*) FROM public.steps WHERE manually_added; -- expect 0 initially
