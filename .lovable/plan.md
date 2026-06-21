I found the live roster request is failing with backend permission errors, not missing links:

- `chris@unthank.me` has the `coach` role and 5 linked athletes.
- The `/app/athletes` request returns `403` because the roster query hits backend policies/functions without the required Data API permissions.
- One invite policy also reads from the auth user table directly, which causes `permission denied for table users` during embedded roster queries.

Plan:

1. Add a targeted backend migration to restore app access without changing Chris’s data:
   - Grant authenticated app users access to the existing roster-related public tables, still protected by their existing row-level rules.
   - Grant app users permission to execute the role/access helper functions used inside those row-level rules, especially `is_coach_of` and `has_role`.
   - Replace the invitee email policy so it checks the signed-in user’s email from their auth token instead of querying the protected auth users table.

2. Keep the existing coach-athlete links intact:
   - No changes to test athletes.
   - No reassignment or duplicate test data.

3. Verify after approval:
   - Confirm Chris still has 5 linked athletes in the backend.
   - Confirm the roster request no longer returns `403`.
   - Confirm `/app/athletes` shows the 5 `[TEST]` athletes.

Technical details:

```sql
-- Fix function/table permission path used by RLS and embedded roster queries.
-- Rewrite athlete_invites policy to avoid reading auth.users from RLS.
```

This is a backend permissions fix for the already-planned roster work; I’ll avoid any optional tooling or generation work.