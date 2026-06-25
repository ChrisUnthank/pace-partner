ALTER TYPE public.session_structure ADD VALUE IF NOT EXISTS 'intervals';

ALTER TABLE public.session_files
  ADD COLUMN IF NOT EXISTS block_type text NOT NULL DEFAULT 'unknown' CHECK (block_type IN ('warmup', 'work', 'cooldown', 'unknown')),
  ADD COLUMN IF NOT EXISTS lap_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_lap_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_lap_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lap_intensity_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interval_auto_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_primary_workout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zone_time_rebuilt_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS parse_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS session_files_one_primary_workout_per_session
  ON public.session_files(session_id)
  WHERE is_primary_workout;

CREATE INDEX IF NOT EXISTS session_files_session_block_idx
  ON public.session_files(session_id, block_type, started_at);

CREATE INDEX IF NOT EXISTS raw_session_points_session_file_elapsed_idx
  ON public.raw_session_points(session_id, file_id, elapsed_s);

CREATE INDEX IF NOT EXISTS raw_session_points_session_elapsed_idx
  ON public.raw_session_points(session_id, elapsed_s);