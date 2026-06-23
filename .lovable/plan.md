## What's happening

After Josh signed up as an Athlete, the app correctly tried to send him to **/app/daily-log** (sign-up → /app → auto-redirect for athletes → /app/today → redirects to /app/daily-log), but the page rendered as **404 Page not found** even though `src/routes/_authenticated/app.daily-log.tsx` exists and is registered in the generated route tree.

The runtime-error feed for this preview showed `Failed to fetch dynamically imported module: /@id/virtual:tanstack-start-client-entry` just before the 404 — a classic symptom of the preview holding onto a stale bundle from before `app.daily-log.tsx` was added. The route file is correct; the live preview tab is out of sync.

## Fix steps

1. **Restart the dev server** so Vite rebuilds the route tree and serves fresh client modules to the preview (clears the stale `virtual:tanstack-start-client-entry` chunk causing the 404).
2. **Drive a quick Playwright check** against `http://localhost:8080`:
   - Restore Josh's Supabase session (from sandbox env if available, otherwise just hit `/app/daily-log` while signed-in via the test creds).
   - Navigate to `/app/daily-log` and screenshot. Expect either the Daily Log UI or the "No athlete profile linked" fallback — anything but 404.
3. **If 404 still appears after restart**, inspect:
   - Browser console for any module-load error on `app.daily-log.tsx`.
   - `routeTree.gen.ts` to confirm `/_authenticated/app/daily-log` is wired into `AuthenticatedAppRouteChildren` (it currently is).
   - Whether the user landed at a typo'd URL like `/app/daily -log` (with a space). If so, harden by also accepting `/app/daily_log` → redirect, but only if reproduced.
4. **Tell the user** to hard-refresh their preview tab (Cmd/Ctrl+Shift+R) — the stale-bundle 404 only clears once the browser fetches the new client entry.

No code changes to the route itself are expected; this is a preview-bundle staleness issue confirmed by the route tree and the runtime error pattern. If the Playwright check reproduces the 404 on a freshly built server, I'll dig into `app.daily-log.tsx`'s imports (likely culprit: a server-only symbol leaking into a client chunk).
