# Build is green — nothing is failing the compiler

## Actual output

```text
✓ built in 2.13s
[nitro] ℹ Using auto generated worker name: tanstack-start-ts
ℹ Generated dist/server/wrangler.json
ℹ Generated .wrangler/deploy/config.json
ℹ Generated dist/client/_headers
ℹ Generated dist/nitro.json
[nitro] ✔ You can preview this build using npx vite preview
```

The earlier `[PARSE_ERROR] src/lib/campaign-generator:26:8` is gone: only `src/lib/campaign-generator.ts` remains on disk, the extensionless duplicate no longer exists.

The dev server also answers `200` on `http://localhost:8080/`.

## What the dev-server log does show

Repeating, but not build-breaking:

```text
Error: aborted ... code: 'ECONNRESET'
Error: h3 swallowed SSR error: {"status":500,"unhandled":true,"message":"HTTPError"}
    at normalizeCatastrophicSsrResponse (src/server.ts:33)
```

These are aborted in-flight requests (browser navigating/reloading away mid-SSR) being re-thrown as a generic 500 by the SSR error wrapper. They are a symptom of a client that disconnects, not of a compile failure.

## Proposed next step (needs your go-ahead)

1. Load `/` and one authenticated route headlessly and capture console + network, to see whether the preview is actually broken for a real visit or only stale in your tab.
2. If reproducible, make `src/server.ts` treat an aborted request (`ECONNRESET` / client abort) as a non-error instead of a catastrophic 500, so genuine SSR errors stand out in the log.
3. No other files touched.

If the preview looks stale on your side only, a hard reload is likely all that's needed — the build artefacts are current.
