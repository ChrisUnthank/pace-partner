## Plan

1. **Normalize all analysis inputs before use**
   - Convert `rawPoints`, `steps`, `results`, `zoneTime`, and `fatigue` into safe arrays with `Array.isArray(...) ? ... : []`.
   - Replace every graph-related `.length`, `.map`, `.filter`, and helper call with these safe arrays so undefined/null data cannot crash the page.

2. **Make graph mode detection explicit and safe**
   - `trace`: raw points array has enough samples.
   - `rep`: no trace, but interval results array has at least one result.
   - `empty`: neither data source is graphable.
   - Ensure the chart only renders when its computed series has rows and at least one enabled/available metric.

3. **Harden chart rendering**
   - Add a safe graph card component/guard around the Recharts block so it always returns either a valid graph or a clean empty state.
   - Prevent `ReferenceArea` from using distance keys in rep mode incorrectly.
   - Use rep X-axis ranges only in rep mode and time/distance ranges only in trace mode.
   - Handle null metric values without formatting crashes in tooltips.

4. **Keep the three user-facing modes clear**
   - FIT/GPX: show high-resolution trace with HR, pace, cadence, elevation when available.
   - Manual intervals: show rep-based graph using `hr_avg`/`hr_end`, `actual_pace_sec_per_km`, and cadence.
   - Totals-only: show `No detailed trace available for this session` with a short context-specific explanation.

5. **Fix FIT/GPX upload refresh**
   - Replace the manual three-query invalidation after upload with the shared `invalidateSession(...)` helper so `raw-points`, files, session, steps, results, fatigue, zones, and aggregate views refetch immediately.

6. **Verify the result**
   - Run a strict TypeScript check or targeted validation after edits.
   - Use the analysis route to confirm it no longer crashes when graph data is absent and that the graph code has no unsafe data access.