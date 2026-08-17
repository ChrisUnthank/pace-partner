# Preview not updating — verify, then force a clean re-push

## What I checked (read-only)

- Dev server is healthy: `/` returns 200, `/app/campaign` returns 200.
- The stray extensionless `src/lib/campaign-generator` file is gone; only `campaign-generator.ts` remains.
- Vite is still hot-reloading: last HMR update at 09:30 for `src/styles.css` and `src/components/campaign-edit.tsx`.

So there is no build failure and no stalled write. The most likely cause is a stale browser tab holding an old client bundle (the console also shows a hydration mismatch, which happens when the loaded JS no longer matches the server HTML).

## Plan

1. Load `/app/campaign` headlessly against the running server and capture console errors, network failures and a screenshot — this settles whether the page is genuinely broken or only stale in your tab.
2. If the headless load is correct and current: nothing in the code needs changing; force a fresh bundle by touching the router entry so Vite emits a full-page reload rather than a partial HMR patch, and confirm the reload lands.
3. If the headless load reproduces a broken/old page: fix the specific error found on that route, then re-verify.
4. Separately (small, optional): make `src/server.ts` treat client aborts (`ECONNRESET`) as non-errors so the SSR log stops filling with false 500s and real errors are visible.

No other files touched, no refactors.
