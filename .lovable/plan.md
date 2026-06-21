## Redesign: Performance Dark Grid

Picking **v2 — Performance dark grid** as the default. Reason: tightest information density, reserves red #FF004C for active/critical states only (matches your "live/alert accent" convention), and the dashboard sidebar pattern survives best when content panels are data-heavy (zones, charts, session lists) rather than display-heavy.

### Visual tokens (locked from your choices)
- **Background**: near-black `#0a0a0a` (zinc-950) / panels `#18181b` (zinc-900) / borders `#27272a` (zinc-800)
- **Text**: white primary, zinc-400 secondary, zinc-500 labels (uppercase + tracked)
- **Accent**: `#FF004C` — reserved for active nav item, live/critical status, key data peaks, primary CTA hover. Never as a fill on neutral surfaces.
- **Type**: Sora 700–800 for headings + numeric displays; Manrope 400–600 for body; uppercase tracked micro-labels at 10px/bold
- **Radius**: tight (`rounded-md` / `rounded-xl` on panels, sharp inputs)

### Structural changes
1. **App shell** (`src/components/app-shell.tsx`): replace top header + horizontal nav with a persistent left sidebar (collapsible to icons), top bar reduced to breadcrumb + user actions. Existing nav items unchanged (Home, Today, Sessions, Analytics, Athletes, Templates, Profile). Active item: left-edge red bar + zinc-900 fill.
2. **CSS tokens** (`src/styles.css`): swap `:root` color tokens to the dark palette by default (no light mode toggle — single dark theme); add `--accent: #FF004C` + shades; register Sora/Manrope via `<link>` in `__root.tsx` and `--font-display: Sora`, `--font-sans: Manrope` in `@theme`.
3. **Card defaults**: dark panel surfaces, thin zinc borders, no shadow.
4. **Athlete detail page**: re-skin existing IdentityCard / PhysiologyCard / ZoneBoundariesCard / weekly distance / sessions list to dark panels with numeric tabular treatment. Zone bars: zinc-800 track, accent fill only on currently-highlighted zone.
5. **Other pages** (Today, Sessions, Analytics, Athletes roster, Templates, Profile, Auth): inherit new tokens automatically. No structural reshuffling — only visual.

### Out of scope
- No data/logic changes. No new features. No removal of fields.
- No light mode.
- Charts (recharts) get re-themed via CSS vars only, not rewritten.

### Technical notes
- Tailwind v4: edit `@theme` block in `src/styles.css`; load Sora + Manrope via `<link>` tags in `src/routes/__root.tsx` head (NOT `@import` in CSS).
- Keep `.dark` variant working but make dark the default by adding `class="dark"` to `<html>` in `__root.tsx` (or invert :root values).
- shadcn components stay; they pick up the new tokens automatically.

### Verification
- Headless screenshot of `/app/athletes/<id>` to confirm dark shell, sidebar, accent usage.
- Spot-check `/app/today` and `/app/sessions` for token inheritance.
