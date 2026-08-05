// Computes an entry open/close timestamp from a race date and a saved
// rule (see race_entry_rules) — "the Wednesday before, at 12 noon" is
// really "the most recent occurrence of a given weekday that's at least
// N days before race day, at a given time". Pure date math, no timezone
// conversion — times are interpreted in whoever's browser is running
// this, which for a coach managing their own region's competition
// calendar is the correct behavior without needing full IANA timezone
// handling.

export type RaceEntryRule = {
  id: string;
  name: string;
  closes_weekday: number; // 0 = Sunday .. 6 = Saturday
  closes_time: string; // "HH:MM" or "HH:MM:SS"
  opens_weekday: number | null;
  opens_time: string | null;
  opens_min_days_before: number | null;
};

function lastWeekdayAtLeastDaysBefore(raceDate: Date, targetWeekday: number, minDaysBefore: number): Date {
  const d = new Date(raceDate);
  d.setDate(d.getDate() - minDaysBefore);
  while (d.getDay() !== targetWeekday) d.setDate(d.getDate() - 1);
  return d;
}

function combineDateTime(date: Date, time: string): Date {
  const [h, m] = time.split(":").map((n) => Number(n));
  const out = new Date(date);
  out.setHours(h || 0, m || 0, 0, 0);
  return out;
}

/** eventDateISO is a plain "YYYY-MM-DD" race date. Returns ISO datetime strings (or null for opens, if the rule has none). */
export function computeEntryWindow(eventDateISO: string, rule: RaceEntryRule): { opens: string | null; closes: string | null } {
  const race = new Date(`${eventDateISO}T00:00:00`);
  // Always strictly before race day (minDaysBefore=1), even if the rule's
  // weekday happens to match race day itself.
  const closesDay = lastWeekdayAtLeastDaysBefore(race, rule.closes_weekday, 1);
  const closes = combineDateTime(closesDay, rule.closes_time);

  let opens: Date | null = null;
  if (rule.opens_weekday != null) {
    const opensDay = lastWeekdayAtLeastDaysBefore(race, rule.opens_weekday, rule.opens_min_days_before ?? 1);
    opens = combineDateTime(opensDay, rule.opens_time ?? "00:00");
  }

  return { opens: opens ? opens.toISOString() : null, closes: closes.toISOString() };
}

/** For a <input type="datetime-local"> value from an ISO string, or "" if null. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
