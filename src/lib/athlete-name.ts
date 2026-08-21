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
