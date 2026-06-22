# Build plan — Phases 1.6, 1.7, 2.0

This is ~6 weeks of work in one ask. I'll build it, but I need you to confirm scope and a few open questions first so I don't waste credits on the wrong shape. Reply **"go"** to start, or correct anything below.

## Confirmations needed before I build

1. **Push notifications** — you asked for "web push". I'll use the browser **Web Push API + service worker + VAPID keys** (no third-party like FCM/OneSignal). That means:
   - I'll generate VAPID keys and store the private key as a secret
   - Push works only on browsers where the athlete has granted permission and the PWA/site is open or installed
   - **No iOS push** unless the user installs the site to home screen (Apple limitation)
   - If you want true native push, that's Phase 3 (native app)
2. **Realtime messaging** — Supabase Realtime on a `direct_messages` table with RLS scoped to participants. Read receipts via `read_at` column. Confirmed approach per your brief.
3. **Altitude load modifier** — you flagged this for approval. Proposed: when a session falls inside a `phase_type='altitude'` phase, multiply its training_load by **1.12** (mid of 1.10–1.15) before it feeds CTL/ATL. Surface an "Altitude block" badge on readiness so the coach knows why scores shift. OK?
4. **Race Tactics AI** — same Lovable AI Gateway / Gemini 2.5 Pro stack as Phase 1.5. Output shape: JSON with 3 strategies, each having `lap_plan[]`, `predicted_finish_s`, `decision_points[]`, `risks[]`, `cues[]`. Stored in new `race_tactics` table. OK?
5. **Calendar planning** — drag-and-drop reschedule via `@dnd-kit/core` (already common). Acceptable?

## Phase 1.6 — Noticeboard, Notifications, Messaging, Attendance

**Schema (one migration)**
- `noticeboard_posts` (squad_id nullable for now → posts visible to all athletes of the coach), `post_type` enum, `pinned`, `event_date` for race/training posts, `link_url`
- `noticeboard_reactions` (post_id, user_id, emoji)
- `notifications` (user_id, kind, title, body, link, read_at, delivery_channels jsonb) — channel-agnostic so email slots in later
- `push_subscriptions` (user_id, endpoint, p256dh, auth)
- `direct_messages` (sender_id, recipient_id, body, read_at) + Realtime publication
- `message_broadcasts` (coach_id, body, sent_at) — fans out to `notifications` per athlete
- `session_attendance` (session_id, athlete_id, source enum: auto_gps/manual, confirmed_by)
- `training_locations` (name, address, lat, lng, surface, altitude_m, notes, created_by)
- Add `location_id` + `altitude_m` to `sessions`
- DB triggers fire `notifications` rows on: session edit, session complete, noticeboard post, new DM, daily readiness=red digest (via pg_cron)

**Server fns**
- `subscribePush`, `sendPushToUser` (web-push lib, VAPID), `markNotificationRead`, `createPost`, `reactToPost`, `sendDirectMessage`, `markThreadRead`, `broadcastMessage`, `detectSquadAttendance` (200m / 30min match against `raw_session_points` start), `markAttendance`

**UI**
- `/app/noticeboard` — feed + composer (coach-only), type filter, reactions
- Bell icon in app shell with unread badge + dropdown notification centre
- `/app/messages` — thread list + chat panel, realtime subscription, read receipts, broadcast composer for coaches
- Session detail: "Attended" chip row
- Service worker for push (`public/sw.js`)

## Phase 1.7 — Training Plans, Calendar, Goals

**Schema**
- `training_plans`, `training_phases` (with phase_type enum incl. `altitude`), `goals` (kind: season/race/fitness)
- `weekly_patterns` (coach_id, name, pattern jsonb {mon: template_id, tue: …})
- `sessions.plan_id`, `sessions.phase_id` (both nullable)
- Altitude load modifier wired into `session_training_load()` SQL fn

**UI**
- Upgrade existing calendar: click date → quick-add modal (template or scratch), click week → bulk-apply pattern, "Copy week →", "Copy month →", drag to reschedule (`@dnd-kit`)
- `/app/plans/:planId` — horizontal phase timeline (colour-coded), per-phase CTL/ATL bars, planned vs actual count, dominant intent. Add/edit/delete phases.
- Goals widgets on athlete profile + dashboard
- **Folded: Calculators** `/app/calculators` — McMillan equivalency, VDOT training paces, intensity/effort, Hansons paces. Pre-fill from athlete PBs + zone profile.
- **Folded: Environment section** in session builder (temp/humidity/wind/weather/time-of-day/terrain multi-select/altitude)
- **Folded: Terrain breakdown chart** in analytics
- **Folded: Analytics 7-day + custom date range picker**
- **Folded: GCT** — add `ground_contact_time_ms` to interval_results form + analysis chart + biomechanics summary (column already exists in schema per memory of earlier migration; will verify)
- **Folded: External load expansion** — new activity types, duration, subjective_effort, recovery_benefit flag; update `combined_load` trigger
- **Folded: Notes & Resources** — `athlete_notes` (private/shared), `squad_resources` (files in new `resources` bucket)

## Phase 2.0 — Race Tactics Planner

**Schema**: `race_tactics` (athlete_id, race_date, race_name, distance_m, venue, conditions jsonb, field_notes, lane, goal, constraints, payload jsonb, chosen_option, generated_at, actual_result_id nullable)

**Server fn**: `generateRaceTactics(athleteId, raceInput)` — builds payload (readiness trend, physio profile, threshold, PBs, CTL/ATL on race day from plan), calls Lovable AI Gateway with strict JSON schema, persists row.

**UI**: `/app/athletes/:id/race-tactics` — input form + 3-option side-by-side card layout with lap tables, decision points, risks, cues. "Select this strategy" persists chosen_option. Post-race: link to actual session for comparison.

## Out of scope (per your brief)
Email delivery, Strava/Garmin/Coros API, Terra/Spike, native app, iOS push beyond PWA.

## Order of build
1.6 schema → 1.6 backend → 1.6 UI → 1.7 schema → 1.7 calendar/plans → folded extras → 2.0.

Reply **"go"** (and answer Q1–Q5 above, especially the altitude multiplier and push approach) and I'll start with the 1.6 migration.
