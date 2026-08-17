# Fix the build: stray extensionless duplicate of campaign-generator

## The actual compiler output

```text
[PARSE_ERROR] Unexpected token
    ╭─[ src/lib/campaign-generator:26:8 ]
    │
 26 │ export type Phase = "reset" | "base" | "build" | "peak" | "taper" | "transition" | "race_week";
    │        ──┬─
    │          ╰───
────╯
✗ Build failed in 13.52s
```

## What is wrong

There are two copies of the same module:

- `src/lib/campaign-generator.ts` — the real TypeScript module
- `src/lib/campaign-generator` — a byte-identical copy with **no file extension** (confirmed identical via `diff`)

Both `src/components/campaign-timeline.tsx` and `src/routes/_authenticated/app.campaign.tsx` import `@/lib/campaign-generator`. The bundler resolves the exact extensionless file first, treats it as plain JavaScript, and dies on the first `export type`. That single parse error is the whole build failure — nothing else fails the build.

`src/lib/campaign-generator` is the only extensionless file under `src/`.

## The fix

Delete `src/lib/campaign-generator` (the extensionless duplicate). No import changes needed — `@/lib/campaign-generator` then resolves to the `.ts` file.

## Verification

Run the production build and confirm it completes and prerenders pages.

## Not in scope

- The deleted `/app/coaching-hub` and `/app/campaigns` routes: the only remaining mentions in `src/` are two explanatory code comments (`src/components/dashboard/dashboard-widgets.tsx`, `src/components/app-shell.tsx`). No live import or `<Link to>` targets them, so nothing there breaks the build.
- Pre-existing typecheck-only errors (`app-shell.tsx` NavHeading `to`, `app.maps.tsx`, `app.sessions.$sessionId.index.tsx` merge symbols, etc.) do not fail the build and are left alone unless you want them tackled separately.
