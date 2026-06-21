## Bug: "View analysis" navigates but renders session detail instead of analysis

### What's actually happening
`src/routes/_authenticated/app.sessions.$sessionId.analysis.tsx` is registered as a **child** of `app.sessions.$sessionId.tsx` in `routeTree.gen.ts` (because TanStack's flat dot-routing nests `$sessionId.analysis` under `$sessionId` when both files exist). For a child route to render, the parent component must include `<Outlet />`. `SessionDetail` does not — it just renders the detail page directly. So the URL changes to `/analysis`, the route matches, and the parent's detail UI is shown again with no analysis content. Verified by hitting the URL directly in a headless browser: URL is `/analysis`, body is the detail page, no console errors.

This is unrelated to the earlier button-inside-link nesting fix and unrelated to rep-data completeness. Adding rep data would not have changed anything.

### Fix (canonical TanStack layout-route pattern)

Convert `$sessionId` into a layout and move its current content into an `index` leaf:

1. **Create** `src/routes/_authenticated/app.sessions.$sessionId.index.tsx` containing the current `SessionDetail` body (everything currently in `app.sessions.$sessionId.tsx`), with `createFileRoute("/_authenticated/app/sessions/$sessionId/")`.
2. **Replace** `src/routes/_authenticated/app.sessions.$sessionId.tsx` with a minimal layout:
   ```tsx
   import { createFileRoute, Outlet } from "@tanstack/react-router";
   export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId")({
     component: () => <Outlet />,
   });
   ```
3. Leave `app.sessions.$sessionId.analysis.tsx` unchanged — it now correctly renders inside the parent's `<Outlet />` at `/app/sessions/$sessionId/analysis`, while `/app/sessions/$sessionId` renders the new `index` leaf.
4. No code changes needed to the "View analysis" link itself, the analysis page, or any link that points at `/app/sessions/$sessionId` — both URLs continue to work, routeTree regenerates on save.

### Verification
- Reload the detail page for the 2026-06-21 Elena Voss "Long Run 12km" session — same UI as before.
- Click "View analysis" — now shows the Session Analysis page (graph + totals + zones) instead of re-rendering the detail page.
- Headless reload of `/app/sessions/<id>/analysis` directly returns the analysis page body ("← Back to details", Session graph card, etc.).

### Out of scope
Not touching data-gating, error states, or the analysis page's own rendering — those weren't the cause. If you want a graceful "not enough data" message in additional edge cases later, that's a separate change.