## Diagnosis

Two issues introduced in Phase 1.6 push delivery:

### 1. `web-push` import breaks the server bundle (primary suspect)
`src/routes/api/public/hooks/dispatch-push.ts` has a top-level `import webpush from "web-push"`. Route files are part of the client/SSR module graph — only handler bodies are stripped. `web-push` is a Node-only package (uses `child_process`, native crypto bindings) that the Cloudflare Worker bundler cannot handle, so SSR fails on every route and the catastrophic-error fallback (`renderErrorPage`) is what the user sees on every page. The "Try again" / "Go home" buttons don't recover because every navigation re-triggers the same SSR failure.

### 2. Service worker registration has no preview guard
`NotificationBell` registers `/sw.js` whenever `Notification.permission === "granted"`. Per Lovable PWA guidance, service workers must not register in the Lovable preview/iframe context — and once registered, a stale `sw.js` can keep serving cached HTML. If the user clicked "Enable push" earlier, that SW is now live in preview and may compound the white-screen.

## Fix

### A. Make `dispatch-push.ts` Worker-safe
- Move `import webpush from "web-push"` to a dynamic `await import("web-push")` inside the POST handler so it never enters the SSR/client graph.
- If `web-push` itself proves Worker-incompatible at runtime (it relies on Node crypto + http agents), fall back to a hand-rolled VAPID fetch using Web Crypto (`crypto.subtle`) directly against each subscription's endpoint. We'll try the dynamic import first; if the Worker rejects it, swap to the Web Crypto path in a follow-up.

### B. Guard service worker registration + add kill-switch
In `src/components/notification-bell.tsx`:
- Refuse to register `/sw.js` when running in dev, inside an iframe, or on a Lovable preview/project hostname (`id-preview--*`, `preview--*`, `*.lovableproject.com`, `*.lovableproject-dev.com`, `beta.lovable.dev`), or when URL has `?sw=off`.
- In any refused context, actively `unregister()` any existing `/sw.js` registration so previously-installed workers stop intercepting requests for current preview users.
- Keep the registration path for production only, gated behind `import.meta.env.PROD` plus the hostname checks.

### C. Replace `public/sw.js` with the kill-switch-compatible messaging worker
- Keep the push + notificationclick handlers (these are messaging-only, not an app-shell cache), but ensure `install` calls `skipWaiting()` and `activate` claims clients without caching navigations. It already does this — no behavioral change needed beyond confirming no `fetch` handler is added.

### D. Verify
1. Reload `/` and `/app/noticeboard` in preview — both should render normally (no error fallback).
2. Confirm in DevTools → Application → Service Workers that no `/sw.js` is active in preview.
3. Confirm `/_serverFn/*` requests return 200 and the notification bell loads.
4. Only after the app is confirmed loading, optionally test the production push path by calling the `/api/public/hooks/dispatch-push` URL on the published deploy.

## Scope guard

No other Phase 1.6/1.7/2.0 work in this change — strictly a recovery patch.
