## Required evidence gathered

1. **Actual browser console error when the page crashes**

```text
Error: {"requestedAttributes":{"antialias":false,"preserveDrawingBuffer":false,"powerPreference":"high-performance","failIfMajorPerformanceCaveat":false,"desynchronized":false,"alpha":true,"depth":true,"stencil":true,"premultipliedAlpha":true},"statusMessage":"Could not create a WebGL context, VENDOR = 0xffff, DEVICE = 0xffff, GL_VENDOR = Disabled, GL_RENDERER = Disabled, Sandboxed = yes, Optimus = no, AMD switchable = no, Reset notification strategy = 0x0000, ErrorMessage = BindToCurrentSequence failed: .","type":"webglcontextcreationerror","message":"Failed to initialize WebGL"}
```

React reports this occurred in `<MapPanel>`:

```text
The above error occurred in the <MapPanel> component.
```

The stack points to MapLibre construction in the analysis route:

```text
at ds._setupPainter (.../maplibre-gl.js:33277:33)
at new ds (.../maplibre-gl.js:32660:1433)
at .../src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx?tsr-split=component:1291:15
```

2. **Current `computeContinuousFatigue` export in `@/lib/ai.functions`**

It exists and is exported at `src/lib/ai.functions.ts:228`:

```ts
export const computeContinuousFatigue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: sess } = await sb.from("sessions").select("athlete_id, structure").eq("id", data.sessionId).single();
    if (!sess) return null;
    const { data: pts } = await sb.from("raw_session_points").select("elapsed_s, hr, pace_sec_per_km").eq("session_id", data.sessionId).order("elapsed_s");
    if (!pts || pts.length < 60) return null;
    const mid = pts[pts.length - 1].elapsed_s / 2;
    const first = pts.filter((p) => p.elapsed_s <= mid);
    const second = pts.filter((p) => p.elapsed_s > mid);
    const mean = (arr: any[], k: string) => {
      const xs = arr.map((a) => a[k]).filter((x) => x != null) as number[];
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const hr1 = mean(first, "hr"); const hr2 = mean(second, "hr");
    const p1 = mean(first, "pace_sec_per_km"); const p2 = mean(second, "pace_sec_per_km");
    if (hr1 == null || hr2 == null || p1 == null || p2 == null) return null;
    const hrDriftBpm = hr2 - hr1;
    const paceDriftPct = ((p2 - p1) / p1) * 100;
    const score = Math.max(0, Math.min(100, Math.round(100 - hrDriftBpm - paceDriftPct * 3)));
    await sb.from("session_fatigue").delete().eq("session_id", data.sessionId).eq("method", "continuous_drift");
    const { data: row, error } = await sb.from("session_fatigue").insert({
      session_id: data.sessionId, athlete_id: sess.athlete_id, method: "continuous_drift",
      hr_drift_bpm: hrDriftBpm, pace_drift_pct: paceDriftPct, efficiency_score: score, rep_count: pts.length,
    } as any).select().maybeSingle();
    if (error) console.error(error);
    return row;
  });
```

Signature check: it matches `useServerFn` usage because it is a `createServerFn({ method: "POST" })` export with `.inputValidator((d: { sessionId: string }) => d)`, so the client should call it as `computeFatigue({ data: { sessionId } })`.

3. **Exact analysis-file references and import resolution**

Import at `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx:25`:

```ts
import { computeContinuousFatigue } from "@/lib/ai.functions";
```

Usage at `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx:170`:

```ts
const computeFatigue = useServerFn(computeContinuousFatigue);
```

Invocation at `src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx:517`:

```tsx
onClick={() => computeFatigue({ data: { sessionId } }).then(() => window.location.reload())}
```

Import path resolution is valid: `tsconfig.json` defines `"@/*": ["./src/*"]`, so `@/lib/ai.functions` resolves to `src/lib/ai.functions.ts`.

## Plan to fix

1. **Fix the actual crash source: `MapPanel` WebGL failure**
   - Wrap MapLibre map creation in a safe `try/catch` inside `MapPanel`.
   - Listen for MapLibre `error` events.
   - If WebGL/map creation fails, set a local error state and render a non-crashing route fallback instead of throwing into the route boundary.
   - Ensure cleanup only calls `map.remove()` when a map was successfully created.

2. **Keep graph modes intact**
   - Do not change the existing trace/rep/empty chart logic unless a compile/runtime issue appears during validation.
   - Leave `computeContinuousFatigue` exported and called through `useServerFn` with `{ data: { sessionId } }`.

3. **Validate before calling it fixed**
   - Run a TypeScript check after the edit.
   - Navigate to `/app/sessions/2c70323f-b02c-4980-95bb-146600a17107/analysis` in the preview with Playwright.
   - Report the observed loaded page state, specifically whether the Session Analysis page renders, whether the graph/empty state appears, and whether the Map panel falls back cleanly instead of crashing.
   - Only then state that it is fixed.