## Root cause

`user_roles` has only a SELECT policy. The client-side `supabase.from("user_roles").upsert(...)` on sign-up (`auth.tsx`) and the dashboard role chooser silently fail RLS, so every new user — including chris — ends up with `role = NULL`. Both real users currently have no role, confirming this. A secondary bug: `ensureRole` doesn't check the upsert result, so sign-up toasts "Account created" even when the role write was rejected.

## Fix

### 1. Migration — add Manager role, RLS, backfill

- Add `manager` to the `public.app_role` enum.
- Add policy on `public.user_roles` letting an authenticated user **INSERT** a row for themselves where role IN ('athlete','coach','manager'). `admin` stays locked to service_role.
- Add matching **DELETE** policy for the same three roles so a user can flip role later.
- Treat `manager` as coach-equivalent everywhere access is gated. Concretely: extend the `is_coach_of(_user, _athlete)` security-definer function so a user with the `manager` role passes for **every** athlete (managers get a roster-wide view). Coach checks elsewhere in the app are client-side role checks against `useMyRoles()` — those become `isCoach || isManager` (see step 3).
- Backfill: `chris@unthank.me` → `coach`, `amanda@unthank.me` → `manager`.

### 2. Sign-up flow (`src/routes/auth.tsx`)

- Surface the upsert error (throw on error) so silent RLS rejections stop happening.
- Add `Manager` as a third option in the "I am a…" radio group.

### 3. Role gating across the app

Introduce a single derived flag `hasCoachAccess = roles.includes("coach") || roles.includes("manager")` and use it wherever the current code checks `isCoach`:

- `src/components/app-shell.tsx` — sidebar items (Athletes, Templates, etc.).
- `src/routes/_authenticated/app.index.tsx` — dashboard branching ("Coach view" label becomes "Coach view" / "Manager view" as appropriate), coach roster query.
- Any other `roles.includes("coach")` call sites I find on implementation.

Manager-specific roster scope is handled by the updated `is_coach_of` DB function — a manager sees every athlete via the same `coach_athletes`-based queries that already exist (the policy check passes for them regardless of an explicit link row), so no query rewrites needed.

### 4. Profile screen — role management (`src/routes/_authenticated/app.profile.tsx`)

Add a **"Role" card** above the Athlete details card:

- Three checkboxes: **Athlete**, **Coach**, **Manager** (multi-select — a user can be more than one).
- Reflects current `user_roles` rows; toggling inserts/deletes immediately and invalidates `my-roles` so the sidebar updates without a refresh.
- Enabling Athlete also auto-creates the `athletes` row if missing.
- Disabling Athlete leaves existing training data intact, just hides athlete-only views (note this in the card description).
- `admin` is not exposed in the UI.

## Out of scope

- No separate admin/back-office "create user" screen.
- No invite flow changes.
- No data scoping difference between Coach and Manager beyond "Manager sees the full roster, Coach sees their linked athletes" (already the existing coach behaviour, just widened for manager via `is_coach_of`).

## Files touched

- New migration (enum value, RLS policies, `is_coach_of` update, backfill for chris + amanda).
- `src/routes/auth.tsx`
- `src/routes/_authenticated/app.profile.tsx`
- `src/components/app-shell.tsx`
- `src/routes/_authenticated/app.index.tsx`
- Any other `roles.includes("coach")` call sites discovered during implementation.
