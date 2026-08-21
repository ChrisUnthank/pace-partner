-- ============================================================================
-- FINISHED CHATS SHOULD BECOME HISTORY, NOT BE DELETED.
--
-- Two behaviours combine badly today.
--
-- getOrCreateAthleteThread returns the SAME thread for a coach/athlete pair
-- forever. There is no way to end a conversation, so every question ever
-- asked about an athlete accumulates in one thread — and because the mirror
-- into ai_reviews is one row per thread, the whole lot shows up in AI History
-- as a single ever-growing entry rather than as the separate conversations
-- they were.
--
-- clearAthleteThread then DELETES the thread, which cascades to
-- ai_chat_messages and to the mirrored ai_reviews row. So the only way to
-- start a fresh conversation is to destroy the record of the previous one.
-- Clearing the chat panel silently removes it from Reports too.
--
-- ARCHIVING RATHER THAN DELETING
--
-- archived_at closes a thread without touching it. The chat panel starts a
-- new conversation because getOrCreateAthleteThread now ignores archived
-- threads; the ai_reviews row stays exactly where it is, and AI History gains
-- one entry per conversation instead of one per athlete.
--
-- Deliberately a timestamp rather than a boolean: when a conversation was
-- closed is worth knowing when reading a history list back, and a boolean
-- would have to be paired with a date column anyway.
-- ============================================================================

ALTER TABLE public.ai_chat_threads
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.ai_chat_threads.archived_at IS
  'When this conversation was closed. Archived threads are skipped by getOrCreateAthleteThread so the next message starts a fresh one, while their mirrored ai_reviews row survives as history.';

-- getOrCreateAthleteThread looks up the one OPEN thread per coach/athlete on
-- every message, so it wants an index — and a partial one, because archived
-- threads are never the target of that lookup however many accumulate.
CREATE INDEX IF NOT EXISTS ai_chat_threads_open_idx
  ON public.ai_chat_threads (coach_id, athlete_id)
  WHERE archived_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='ai_chat_threads'
--    AND column_name='archived_at';
--
-- Existing threads are all open, which is correct — nothing has been closed:
-- SELECT COUNT(*) FILTER (WHERE archived_at IS NULL) AS open,
--        COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived
--   FROM public.ai_chat_threads;
