/**
 * The display name for a self-created athlete record.
 *
 * One implementation because there were three, and they disagreed:
 *
 *   auth.tsx          fullName || email.split("@")[0]   -> "Poppy" or "poppy"
 *   app.account.tsx   email || "Athlete"                -> "amanda@unthank.me"
 *   athletes page     whatever the coach typed
 *
 * The middle one is why athlete records exist named after email addresses.
 * A name is what a coach reads down a roster; an email address in that column
 * is a record nobody recognises, and it also hid duplicates — a search for
 * two athletes with the SAME name never found the pair where one was called
 * "Amanda Unthank" and the other "amanda@unthank.me".
 *
 * Falls back through the full name, then the local part of the email with
 * separators tidied, then a plain label. Never the whole address.
 */
export function athleteDisplayName(fullName?: string | null, email?: string | null): string {
  const name = (fullName ?? "").trim();
  if (name) return name;

  const local = (email ?? "").split("@")[0].trim();
  if (local) {
    // "poppy.nivarovich" and "poppy_n" read as names once the separators go.
    const tidied = local
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
      .join(" ");
    if (tidied) return tidied;
  }

  return "Athlete";
}


/**
 * What to call someone in a greeting.
 *
 * Order: an explicitly chosen preferred name, then the first word of their
 * full name, then nothing.
 *
 * Returns "" rather than a placeholder when there is no usable name, so the
 * caller can fall back to a greeting that needs one ("Welcome back") instead
 * of printing "Hello there" or, worse, "Hello chris@unthank.me".
 *
 * Email addresses are refused outright. athleteDisplayName above stops NEW
 * records being named after one, but older profiles still are, and an address
 * in a greeting reads as a mail-merge that went wrong.
 */
export function greetingName(
  preferredName?: string | null,
  fullName?: string | null,
): string {
  const preferred = (preferredName ?? "").trim();
  if (preferred && !preferred.includes("@")) return preferred;

  const full = (fullName ?? "").trim();
  if (!full || full.includes("@")) return "";

  // First word only. "Hello Chris Unthank" reads like a letter from a bank.
  return full.split(/\s+/)[0] ?? "";
}

/**
 * The greeting name someone would get if they set no preference — used as
 * the placeholder in the account field, so the box shows what it will do
 * rather than sitting empty.
 */
export function derivedGreetingName(fullName?: string | null): string {
  return greetingName(null, fullName);
}
