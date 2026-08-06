# Fix: preview screens render blank

## What's happening

Every page loads a 200 response with valid server-rendered HTML, then goes blank the moment the browser takes over. The browser console shows one error on every route:

```text
TypeError: Cannot read properties of undefined (reading 'get')
    at hydrateStart (@tanstack/start-client-core/.../hydrateStart.js:27)
```

## Confirmed root cause

This is not app code — it's a version mismatch between two framework packages that were installed with loose (`^`) version ranges:

- `@tanstack/start-client-core` (1.170.14) calls `router.stores.matchesId.get()`
- the installed `@tanstack/router-core` (1.171.16) renamed that store from `matchesId` to `ids`

So `router.stores.matchesId` is `undefined`, `.get()` throws, hydration aborts, and React never mounts the app — a blank screen on every route, including `/` and `/auth`.

Installed versions confirmed on disk:

```text
@tanstack/react-router        1.170.19
@tanstack/router-core         1.171.16   <- pulled in by ^ range, breaking change
@tanstack/react-start         1.168.34
@tanstack/react-start-client  1.168.16
@tanstack/start-client-core   1.170.14
```

## The fix

1. Pin the TanStack Router/Start packages in `package.json` to an exact, mutually compatible set instead of `^` ranges, so `router-core` and `start-client-core` agree on the store API.
2. Reinstall so the lockfile resolves the pinned set, and verify the resolved `@tanstack/router-core` version is the one `start-client-core` declares.
3. Reload `/` and `/auth` headlessly and confirm zero page errors and rendered content in the body (currently empty).
4. Regression check a couple of authenticated routes to be sure hydration works past the root.

## Technical notes

- Both `bun.lock` and `package-lock.json` exist in the project; the install must go through the same package manager the sandbox uses (bun) so the lockfile stays authoritative.
- If pinning forward (upgrading `@tanstack/react-start` to a build whose `start-client-core` uses `ids`) is cleaner than pinning back, that's the preferred direction — a forward pin keeps the newer router-core already installed and avoids downgrading the router.
- No application source changes are expected. If a route file needs touching afterwards it will only be because of an unrelated pre-existing error, not this crash.
