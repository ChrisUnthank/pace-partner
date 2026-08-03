import { supabase } from "@/integrations/supabase/client";

// Best-effort logging for the Account page's new system log — a
// logging failure should never block or surface an error for the
// actual action (password change, preference save, etc.) it's
// attached to, so this deliberately swallows its own errors rather
// than throwing back into the caller.
export async function logAccountActivity(
  userId: string,
  action: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await supabase.from("account_activity_log" as any).insert({
      user_id: userId,
      action,
      description,
      metadata: metadata ?? null,
    });
  } catch {
    // intentionally swallowed — see comment above
  }
}
