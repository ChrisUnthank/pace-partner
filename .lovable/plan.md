
## Confirmations (plain English)

**Older sessions without `rep_trace`:** The screen will never be empty or broken. It walks a three-tier fallback per metric:

1. **Best case** — `interval_results.rep_trace` jsonb exists → render a true high-resolution line chart (HR/pace/cadence/elevation samples plotted at their real timestamps or distances).
2. **Middle case** — no `rep_trace`, but `interval_results` has per-rep summary values (avg HR, avg pace, cadence, etc.) → render a step-chart connecting one point per rep, with a small "summary view — no high-res trace recorded" caption above the graph.
3. **Worst case** — no `interval_results` rows at all (manually-logged session with only session totals) → hide the graph panel entirely and show a single info card: "No per-rep data was recorded for this session. See the session detail for logged totals." with a link back to the detail screen.

Each metric line is independently subject to this fallback — e.g. HR may have a full trace while cadence has only rep averages; both render appropriately on the same chart.

**Not a replacement:** This is a *new* route at `/app/sessions/$sessionId/analysis`. The existing `/app/sessions/$sessionId` detail screen (rep tables, per-step fatigue cards, edit/save-as-template actions) is untouched. Both are reachable:

- From the session list / calendar / dashboard: clicking a session still opens the detail screen (unchanged default).
- From the detail screen: a new "View analysis" button (visible only when `completed_at IS NOT NULL`) navigates to the analysis route.
- From the analysis screen: a "Back to details" link returns.

No data on either screen is recalculated — analysis reads `interval_results`, `session_fatigue`, `session_zone_time`, and `sessions` as-is.

---

## Scope

### Route
- New file `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx` (under existing `app.sessions.tsx` Outlet layout). Auth-gated like its siblings.
- Add "View analysis" button on `app.sessions.$sessionId.tsx` for completed sessions only.

### Layout (mobile-first, stacks on narrow viewport)
1. Header: session title, date, athlete, completion badge, back-to-details link.
2. **Time-series chart panel** (centerpiece).
3. **Map panel** (conditional — only rendered if any GPS points exist).
4. **Summary panel**: totals (distance, time, avg HR, RPE, completion %) + per-step fatigue + zone-time bars (read from `session_fatigue`, `session_zone_time`).

### Time-series chart
- Library: **Recharts** (already in the project via shadcn `chart.tsx` — no new dep).
- X-axis: time by default; toggle button switches to distance if every plotted sample has a distance value.
- Metric toggles (chips above chart): HR, Pace, Cadence, Elevation. Each independently on/off; HR + Pace default on. Disabled chip + tooltip "no data" when neither rep_trace nor rep-summary value exists for that metric.
- Step/set boundaries: vertical reference lines (`<ReferenceArea>`) shaded by step kind — warm-up/work/recovery/cool-down/strides — using existing semantic colors from `session-categories.ts` palette. Legend below chart.
- Data assembly happens client-side in a `useMemo` over the loaded `interval_results` rows, flattening `rep_trace` arrays into `{ t, d, hr, pace, cadence, elev, stepId, repNumber }[]`. When `rep_trace` is null for a rep, synthesize one point at the rep's midpoint using rep-summary columns.

### Map
- Library proposal: **MapLibre GL JS + free OSM raster tiles** (no token, no signup, no per-project secret to manage).
  - Rationale vs Mapbox: Mapbox needs a `MAPBOX_TOKEN` secret per project and has a usage cap that can silently break the map for end users. MapLibre is the open-source fork of Mapbox GL JS with the same API, and OSM tiles are free for low-volume use — exactly the load profile of a coach reviewing a handful of sessions. If usage ever grows beyond OSM's fair-use, swapping to a tiled provider (MapTiler, Stadia, Mapbox) is a one-line style URL change.
  - If you'd rather use Mapbox, say so and I'll switch — the rest of the plan is identical.
- Render the GPS trace as a single GeoJSON LineString from concatenated `rep_trace` lat/lng samples; fit bounds to the trace. Color-code by step kind using the same palette as the chart bands.
- Panel renders only when `points.length >= 2`; otherwise omitted (no empty map, no placeholder).

### Summary panel
- Reads `session_fatigue` and `session_zone_time` directly — same queries already used on the detail screen, no new server work.
- Compact cards: distance, duration, avg HR, RPE, completion %, then a list of per-step fatigue (efficiency score, drifts) and a stacked horizontal bar for zone-time.

### Data fetching
- One `useQuery` per source (session, interval_results for the session, session_fatigue, session_zone_time) using the browser supabase client — same pattern as the existing detail route. No server functions needed; all tables are RLS-gated by athlete/coach already.

### Out of scope (this build)
- No new DB columns or migrations.
- No new calculations (drifts, zones, fatigue are read as-is).
- No editing from this screen.
- No PDF/share export.
- No comparison-across-sessions view.

---

## Technical notes

- `rep_trace` jsonb shape assumed to be an array of `{ t?: number, d?: number, hr?: number, pace?: number, cadence?: number, elev?: number, lat?: number, lng?: number }`. The route reads defensively — missing keys are skipped per-sample, not per-rep.
- Recharts `ComposedChart` with multiple `<YAxis yAxisId>` for HR (bpm) vs pace (sec/km, inverted) vs cadence (spm) vs elevation (m).
- MapLibre loaded via `maplibre-gl` package + its CSS; client-only render (`useEffect` mount) so SSR isn't an issue under `_authenticated/` (which is already `ssr: false`).
- New deps: `maplibre-gl` only.

## Verification
- Open a session with `rep_trace` → all four metric lines render, toggling works, step bands visible, map shows route.
- Open a session with only per-rep summaries → step-chart fallback renders with caption; map panel hidden if no lat/lng.
- Open a manually-logged session with no `interval_results` → graph panel hidden, info card shown, summary panel still renders totals.
- Detail screen still loads identically; "View analysis" button appears only when completed.
