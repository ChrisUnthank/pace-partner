## What currently exists for training history

The only training-history surface today is `/app/sessions` (`app.sessions.index.tsx`) — a flat reverse-chronological **list** of the 100 most recent sessions across visible athletes, showing title, date, athlete name, classification label, distance/time, and a Done/Planned badge. There is no calendar view anywhere, and the athlete profile screen has no calendar either. The only existing `Calendar` import in the codebase is the shadcn date-picker primitive used inside forms — not a training calendar.

So this is **additive**, not a replacement. The list stays useful for "what's the last 100 things in order?"; the calendar answers "what does this month/week look like in shape?".

## How this fits

### New route
- `/app/sessions/calendar` — the calendar view. Reached from a new "Calendar" tab in the sessions area (a small Month/List toggle near the "New session" button on the existing list page, plus a direct link).
- Coach access from athlete context: on `app.athletes.$athleteId.tsx` (athlete profile) add a "View calendar" button that deep-links to `/app/sessions/calendar?athleteId=<id>`. On the athletes roster (`app.athletes.index.tsx`) add a small calendar icon on each row that does the same.
- Athletes land on their own calendar by default (their athlete id auto-selected). Coaches get a small athlete-picker dropdown at the top (defaults to whatever athlete they came from, or "first athlete" if they navigated directly).

### Default view
- **Month** is the primary view. A simple `View: Month | Week` segmented toggle at the top. Week view reuses the same day-cell component, just laid out as a single horizontal strip — cheap to add once the cell exists.
- Month-nav: ‹ Today › with the month/year label, same pattern as common calendars.

### Day-cell content — fitting detail without clutter

Each cell follows a strict visual hierarchy so a glance reads "what kind of day" first, details second:

```text
┌──────────────────────┐
│ 14  ●readiness       │   ← date + small readiness dot (top-right)
│ ▌Threshold           │   ← left color bar = intent/day_type; label
│ 6×800m @ 3:20        │   ← session title (truncated, 1 line)
│ 52 TL · ⚡88          │   ← training load + fatigue/efficiency (if any)
└──────────────────────┘
```

- **Left color bar (4px)** encodes intent (easy/aerobic/tempo/threshold/vo2/anaerobic/speed) or day_type (race/recovery/cross_training/rest) using the palette already established in `src/lib/session-categories.ts` / `STEP_COLORS` so it matches the rest of the app.
- **Readiness dot** (top-right, 8px) uses the existing `ReadinessBadge` color scheme (green/amber/red), tooltip shows score. Hidden if no readiness for that date.
- **One-line session title**, truncated.
- **Footer row**: training load contribution (from `athlete_load_daily.training_load`) and, if the session had reps, the efficiency score from `session_fatigue` (averaged across work steps, same as the detail screen already does). Both omitted gracefully if absent.
- **Planned future sessions**: same color bar + title, but rendered with a dashed outline and muted text; no readiness/fatigue/load footer (those don't exist yet). A small "planned" affix appears next to the title.
- **Multiple sessions same day**: stack up to 2 compact rows; if >2, show "+N more". Rare but supported.
- **Empty days**: just the date number, no bar.

On mobile (≤640px), cells collapse to: date number + color bar + a single dot per session (still color-coded by intent). Tap the day to open a bottom sheet listing that day's sessions with the full detail. This keeps the month view readable on a 390px screen (matching the user's current viewport) without dropping the visual-pattern benefit.

### Click behavior

Tapping a day:
- **One session on that day** → opens the existing session detail screen (`/app/sessions/$sessionId`). That screen already has the "View analysis" button for completed sessions, so both surfaces remain reachable from one click.
- **Multiple sessions** → opens a small popover/bottom-sheet listing them; each row links to its detail screen.
- **Planned session** → same detail screen; it already handles the planned state.
- **Empty day** → (coach only) a "+ New session on this date" affordance that links to `/app/sessions/new?date=YYYY-MM-DD&athleteId=...`. Athletes see nothing on empty days.

## Data — fully reused, no new calculations

This screen is a pure visualization layer over data the app already computes:

| Cell element | Source |
|---|---|
| Sessions for the month | `sessions` table, filtered by `athlete_id` + date range |
| Intent / day_type / title | `sessions.intent`, `sessions.day_type`, `sessions.title` |
| Completion status | `sessions.completed_at` |
| Readiness band + score | `athlete_load_daily.readiness_status`, `readiness_score`, `confidence` (per date) |
| Training load contribution | `athlete_load_daily.training_load` (per date) |
| Within-session fatigue (efficiency) | `session_fatigue.efficiency_score`, averaged across work steps for that session (same aggregation the session detail screen does today) |

One query per month load: a single date-range fetch for sessions, one for `athlete_load_daily` rows in the range, one for `session_fatigue` rows joined by session ids. All three are indexed reads. No schema changes, no new RPCs, no recompute calls.

### Reuse of existing UI tokens

- Intent/day_type colors: pulled from the same `session-categories` / `STEP_COLORS` palette already used in the session builder and analysis screen — so coaches see the same color = same thing everywhere.
- Readiness dot uses the same green/amber/red mapping as `ReadinessBadge`.
- Classification label uses `sessionClassificationLabel()`.

## Files

- **New**: `src/routes/_authenticated/app.sessions.calendar.tsx` — the route (Month/Week toggle, month grid, day cells, popover for multi-session days, athlete picker for coaches).
- **New**: `src/components/calendar-day-cell.tsx` — the day cell component (shared between month and week views, responsive).
- **Edited**: `src/routes/_authenticated/app.sessions.index.tsx` — add a small `List | Calendar` toggle.
- **Edited**: `src/routes/_authenticated/app.athletes.$athleteId.tsx` — add "View calendar" button.
- **Edited**: `src/routes/_authenticated/app.athletes.index.tsx` — add calendar-icon link per row.
- **Edited**: `src/components/app-shell.tsx` — (optional) make the existing "Sessions" nav item still go to `/app/sessions` (list); calendar is reached via the in-page toggle, so no new top-level nav clutter.

## Out of scope (call out explicitly)

- No drag-to-reschedule. Calendar is read + open-detail only this build.
- No multi-athlete overlay calendar for coaches (one athlete at a time, via the picker). Cross-athlete planning view is a separate feature.
- No iCal/Google Calendar export.
