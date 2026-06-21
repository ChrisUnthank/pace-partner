## What's reused vs. what's new

Confirmed by inspecting the schema and existing routes — every widget pulls from data already computed by the readiness engine, physio engine, or existing views. Only **one** widget needs a new aggregation; everything else is pure presentation.

| Widget | Source | New work? |
|---|---|---|
| **PMC chart** (CTL / ATL / TSB over time) | `athlete_load_daily.ctl / atl / tsb` (one row per athlete per day, already maintained by `recompute_readiness`) | None — direct read |
| Current readiness band | `athlete_load_daily.readiness_status / score / confidence` (latest row) — reuses `<ReadinessBadge>` already in `src/components/readiness-badge.tsx` | None |
| Weekly training load trend | `athlete_load_daily.training_load` aggregated by ISO week (simple client-side `groupBy`) | None |
| **Within-session fatigue trend** | `session_fatigue.efficiency_score` joined to `sessions.session_date`, averaged per session, then trended over recent weeks | **Yes — new aggregation** (single query, no schema change, no new RPC). This is the only new logic on the page. |
| Physiological profile card | `athlete_physio_profile` (aerobic/anaerobic, archetype, speed reserve) — reuses the donut already on the athlete profile | None |
| Weekly distance | `athlete_weekly_distance` view (already exists) | None |
| Time-in-zone summary | `athlete_zone_time_weekly` view (already exists) | None |
| **Coach roster row**: readiness band + PMC trend direction | `athlete_load_daily` — latest `readiness_status` per athlete + a simple slope of `ctl` over the last 14 days (improving / stable / declining via threshold on the slope) | **Yes — trivial derived calc** done client-side from the same `athlete_load_daily` rows already fetched. No new DB work. |

So: **two** pieces involve new logic, both are pure client-side aggregations over data the app already has. No migrations, no new RPCs, no new tables.

## Route & access

- New route: `/app/analytics` (file `src/routes/_authenticated/app.analytics.tsx`).
- Athlete (has `athlete` role, no `coach` role): lands on **their own** dashboard; their `athlete_id` is auto-resolved via `useMyAthlete()`. No athlete picker shown.
- Coach (has `coach` role): lands on the **roster overview** by default. Selecting an athlete deep-links to `/app/analytics?athleteId=<id>` which renders the same single-athlete dashboard the athlete sees, with a small "← Back to roster" affordance.
- App-shell nav: add an "Analytics" entry alongside Sessions / Athletes (icon: `LineChart` from `lucide-react`).
- URL search params validated with `zodValidator` + `fallback`: `athleteId?`, `range` (one of `4w | 3m | 6m | all`, default `3m`).

## Page layout — single athlete view

```text
┌─────────────────────────────────────────────────────────────┐
│  Header: athlete name · current readiness badge · range tabs│
│                                  [4W] [3M] [6M] [All]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ███████  PMC — Fitness / Fatigue / Form  ███████          │
│   (full-width, ~360px tall, the visual anchor)              │
│   Three lines:  CTL (fitness, solid),  ATL (fatigue,        │
│   dashed),  TSB (form, area-tinted around 0)                │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│  Weekly training load    │  Within-session fatigue trend    │
│  (bar chart by ISO wk)   │  (line — avg efficiency / week)  │
├──────────────────────────┼──────────────────────────────────┤
│  Weekly distance         │  Time in zone (stacked bar)      │
│  (reuses weekly view)    │  (reuses weekly zone view)       │
├──────────────────────────┴──────────────────────────────────┤
│  Physiological profile card  (aerobic/anaerobic donut +     │
│  archetype + speed reserve · same component as profile pg)  │
└─────────────────────────────────────────────────────────────┘
```

Mobile (≤640px): the PMC stays full-width; the 2-column grid collapses to a single column; chart heights reduce; range tabs become a `Select`.

Charts use Recharts via the existing `src/components/ui/chart.tsx` wrappers so they pick up the design tokens (no hardcoded colors). Readiness band reuses `<ReadinessBadge>` for the green/amber/red mapping.

## Page layout — coach roster view

```text
┌─────────────────────────────────────────────────────────────┐
│  Roster overview                              [3M] range    │
├─────────────────────────────────────────────────────────────┤
│  Athlete       Readiness   PMC trend (14d)    Last session  │
│  ───────────   ─────────   ───────────────    ───────────   │
│  J. Smith      ● Ready     ↗ Improving        Thu — Tempo   │
│  M. Lee        ● Caution   → Stable           Wed — Long    │
│  A. Patel      ● Recover   ↘ Declining ⚠      Sun — VO2     │
│  …                                                          │
│  (sortable by readiness severity then by trend direction —  │
│   "needs attention" floats to top)                          │
└─────────────────────────────────────────────────────────────┘
```

Each row links to `/app/analytics?athleteId=<id>` (the full single-athlete dashboard). Trend direction is computed from the slope of `ctl` over the last 14 days: `|slope| < ε → stable`, positive → improving, negative → declining. A small warning glyph appears on declining + red-band combinations only (no over-alerting).

## Queries (one set per athlete, all indexed reads)

```ts
// PMC + readiness + weekly load: one fetch covers four widgets
supabase.from('athlete_load_daily')
  .select('load_date, ctl, atl, tsb, training_load, readiness_status, readiness_score, confidence')
  .eq('athlete_id', id)
  .gte('load_date', rangeStart)
  .order('load_date');

// Fatigue trend (the one new aggregation): join fatigue → sessions for dates
supabase.from('session_fatigue')
  .select('efficiency_score, sessions!inner(session_date, athlete_id)')
  .eq('sessions.athlete_id', id)
  .gte('sessions.session_date', rangeStart)
  .not('efficiency_score', 'is', null);
// → groupBy ISO week → average → line chart

// Weekly distance & weekly zone time: direct view reads
supabase.from('athlete_weekly_distance').select('*').eq('athlete_id', id)…
supabase.from('athlete_zone_time_weekly').select('*').eq('athlete_id', id)…

// Physio card: single-row read
supabase.from('athlete_physio_profile').select('*').eq('athlete_id', id).maybeSingle();
```

Coach roster uses one bulk fetch: the latest ~14 `athlete_load_daily` rows for every athlete visible via `coach_athletes`, grouped client-side.

All reads go through TanStack Query with `queryOptions` + `ensureQueryData` in the loader and `useSuspenseQuery` in the components (matches the rest of the app).

## Empty / low-data states

- New athlete with `confidence = 'insufficient'`: PMC shows a muted "Building baseline — keep logging" panel instead of a near-empty chart.
- No `session_fatigue` rows yet: fatigue-trend card shows "Complete a few interval sessions to see this trend" instead of an empty axis.
- No physio profile yet (`status = 'insufficient_pbs'`): card shows the existing `coaching_note` prompt to log PBs.
- Empty weekly distance / zone time: cards hide gracefully rather than render zero-height charts.

## Files

**New**
- `src/routes/_authenticated/app.analytics.tsx` — the route (handles role split, range tabs, athlete vs roster mode).
- `src/components/analytics/pmc-chart.tsx` — the CTL/ATL/TSB chart.
- `src/components/analytics/fatigue-trend-chart.tsx` — the new weekly-efficiency line.
- `src/components/analytics/weekly-load-chart.tsx`, `weekly-distance-chart.tsx`, `zone-time-chart.tsx` — small wrappers around `ui/chart`.
- `src/components/analytics/physio-summary-card.tsx` — extracted reusable card (or imported from the profile page if already self-contained — will reuse rather than fork).
- `src/components/analytics/coach-roster-table.tsx` — roster overview with trend arrows.

**Edited**
- `src/components/app-shell.tsx` — add "Analytics" nav entry.
- `src/routeTree.gen.ts` — regenerated by the plugin (don't hand-edit).

## Out of scope (call out explicitly)

- No new DB tables, columns, views, RPCs, or migrations.
- No cross-athlete comparison overlays (e.g. plotting two athletes' CTL on one chart).
- No export to PDF / CSV.
- No notifications when a roster row turns red — surfacing only, not alerting.
- No editable thresholds for the "improving/declining" classifier (uses sensible defaults — slope of CTL over 14 days, ε = 0.3 CTL units/day).

## Confirmation back to you, in plain English

You were right: only the **within-session fatigue trend over time** needs new logic, and even that is just a `GROUP BY week` over `session_fatigue.efficiency_score` joined to `sessions.session_date` — no recompute, no migration. The coach roster's "trend direction" arrow is a trivial slope over the same `athlete_load_daily.ctl` series that powers the PMC, so it's effectively free. Everything else (PMC, readiness band, weekly load, weekly distance, zone time, physio profile) is direct reads from rows the engines already maintain.