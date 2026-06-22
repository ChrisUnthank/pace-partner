# Build plan — Phases 1.5, 1.5b, 1.5c

You asked me to skip the Anthropic key step and keep building. The only AI path that doesn't need that key is **Lovable AI Gateway** (no key, billed via Lovable credits, Gemini/GPT models). I'll use it instead of Claude. Everything else stays as briefed.

## Phase order
Migrations → 1.5b backend (FIT/GPX parsing, raw_session_points) → 1.5c analysis rebuild → 1.5 AI surfaces (chat + proactive cards + athlete notes) → 1.5b UI (checkout + reminders + coach roster).

I'm front-loading 1.5b's data layer because both 1.5c (chart) and 1.5 (AI payload summary) read from it.

## Phase 1.5b — Daily Checkout & FIT/GPX upload

**Schema**
- `raw_session_points` — `session_id`, `step_id`, `file_id`, `segment_type` (warmup/work/recovery/cooldown), `elapsed_s`, `lat`, `lng`, `hr`, `pace_sec_per_km`, `cadence`, `elevation_m`, `vertical_oscillation_cm`, `ground_contact_time_ms`. Indexed on `(session_id, elapsed_s)` and `(step_id)`.
- `session_files` — uploaded file metadata: `athlete_id`, `session_id` (nullable until mapped), `file_kind` (fit/gpx), `storage_path`, `activity_type`, `started_at`, `total_distance_m`, `total_time_s`, `parsed_at`, `mapped_step_id`.
- `sessions` — add `data_source` (manual/fit_upload/gpx_upload), `work_distance_m`, `work_time_s`, `work_avg_hr`, `work_avg_pace_sec_per_km`, `work_avg_cadence`, `last_checkout_at`, `needs_review` (bool for unreviewed uploads).
- `athletes` — add `reminder_morning_local` (default `08:00`), `reminder_evening_local` (default `20:00`), `last_checkout_at`.
- Storage bucket: `session-files` (private, RLS scoped to athlete).

**Server functions**
- `uploadSessionFiles` — accepts file blobs, stores in bucket, returns file IDs.
- `parseSessionFile` — server-side FIT (`fit-file-parser`) and GPX (XML) parsing → writes session-level + `raw_session_points`. Detects lap markers → creates `interval_results` rows with `segment_type='work'`, gaps between laps get `segment_type='recovery'`.
- `groupFilesForDate` — same-date files grouped, matched against planned sessions by activity type. Returns suggested mapping for athlete confirmation.
- `confirmFileMapping` — assigns file → step (warm-up = first, work = middle, cooldown = last; manual override supported). Recomputes `work_*` aggregates from work-step files only.
- `submitCheckout` — writes `session_insights`, `last_checkout_at`, end-of-day note.

**UI**
- `/app/checkout` route — multi-file uploader (drag/drop, bulk), grouping confirmation modal, per-session insight form, end-of-day textarea. Submittable with note only on rest days.
- Per-segment summary table on session detail (warm-up/work/cool-down rows from `raw_session_points`).
- Coach dashboard: "Last checkout" column on roster, "Unreviewed uploads" queue card, per-athlete "Send reminder" button (writes a row to a `pending_reminders` table for now — push infra is future work).
- Reminder config inputs on athlete profile (coach-editable).

## Phase 1.5c — Session Analysis rebuild

**Read from `raw_session_points`** instead of `interval_results.rep_trace`. Lines: HR, Pace, Elevation, Cadence, Vertical Oscillation, GCT — toggle chips, recharts ComposedChart. Color-coded shaded bands per `segment_type` (warm-up / work / recovery / cool-down). GPS polyline stays on MapLibre+OSM.

**Continuous fatigue**: new `compute_continuous_fatigue(session_id)` server fn — for sessions with `structure='continuous'` and trace data, split first/second half by elapsed_s, compute HR drift (Δ mean HR for same pace bucket) and pace decline (Δ mean pace), produce `efficiency_score` 0–100 stored in `session_fatigue` with `method='continuous_drift'` and `step_id=NULL`. Render alongside existing per-step panel labelled "Overall run fatigue". Return null if insufficient data.

Empty-state message unchanged ("Detailed analysis available after device sync") for sessions with no `raw_session_points`.

## Phase 1.5 — AI Coaching Assistant (Lovable AI Gateway)

**Schema**
- `ai_chat_threads` — `coach_id`, `athlete_id`, `created_at`.
- `ai_chat_messages` — `thread_id`, `role` (user/assistant), `content`, `tokens`, `created_at`.
- `ai_weekly_summaries` — `athlete_id`, `week_start`, `summary_md`, `generated_at` (lazy, cached 7 days).
- `ai_athlete_notes` — `athlete_id`, `note_date`, `kind` (daily/session), `session_id` (nullable), `content`.

**Server functions** (all use `createServerFn` + Lovable AI Gateway via `@ai-sdk/openai-compatible`, model `google/gemini-2.5-pro`, max_tokens 1000, system prompt = experienced middle-distance running coach):
- `buildAthletePayload(athleteId)` — compact summary: 28d session list (date/title/intent/RPE/completion), readiness + CTL/ATL/TSB trend (last 14d), fatigue scores avg, physio profile, vitals trend (sleep/RHR/weight last 14d means), zone time % last 14d, recent adjustments, recent insights. Never raw rows.
- `coachChatSend(threadId, message)` — appends to thread, fetches payload, streams response, persists assistant reply.
- `generateWeeklySummary(athleteId)` — lazy; checks `ai_weekly_summaries` for current week, generates if missing.
- `generateDailyAthleteNote(athleteId)` — called after vitals submit.
- `generateSessionNote(sessionId)` — called after session marked complete or after FIT upload parses.
- `findProactiveFlags()` — rules-based (not AI): readiness=red OR ATL > rolling 28d ATL mean + 1σ. Returns flagged athletes for dashboard card.

**UI**
- `<CoachChat athleteId>` component — embedded on athlete profile, also on dashboard as a thread switcher. AI Elements (Conversation/Message/PromptInput/Shimmer). Per-athlete thread persists.
- Dashboard "Needs attention today" card (proactive flags) and "Weekly summaries" grid (lazy-generated on click).
- Athlete-facing: AI daily note shown on `/app/today` after vitals submit; AI session note shown on session detail for athlete view.

## Technical details (you can skim)

- `data_source` enum-like CHECK column.
- FIT parsing runs in TanStack server fn (Worker runtime supports `fit-file-parser`). Files >5MB rejected client-side.
- Recovery-between-laps detection: any non-lap gap >5s with HR/pace data tagged `segment_type='recovery'` and excluded from rep averages.
- Multi-file same-date: server fn returns proposed mapping, athlete confirms via dropdown per file before persistence.
- AI payloads serialized to <3KB to keep token cost predictable.
- All new tables: RLS scoped to athlete/coach via existing `coach_athletes` and `auth.uid()` patterns + service_role grants.
- No third-party sync — fully self-contained as briefed.

## Out of scope (explicitly deferred)
- Push notification delivery infra (FCM/APNs). Reminder config is stored and surfaced; actual push goes in a later phase.
- Strava/Garmin sync.
- Switching to Claude/Anthropic — would need the API key step you skipped.
- Mapbox migration (keeping MapLibre+OSM).

## Confirmation requested
Reply **"go"** to start building. If you'd rather have Claude instead of Lovable AI after all, say so and I'll request the key first.
