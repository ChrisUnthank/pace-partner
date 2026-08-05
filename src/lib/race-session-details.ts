// Builds the title/notes for the planned session auto-created when a
// race gets assigned. Previously the session title was just the bare
// selected event ("8km") with nothing else — on an athlete's actual
// calendar, next to their other named sessions, that's not enough to
// know what it even is. Title now leads with the event and names the
// race; notes carries the logistics (location, entry deadline, link)
// that would otherwise only exist back on the Race Schedule page.
//
// Deliberately only used at session CREATION, never on update/re-sync —
// notes is free text the athlete or coach may have already added to
// after the session was created, and overwriting it on every re-sync
// would silently destroy that. See the two call sites (Race Schedule and
// My Race Schedule) for how that split is enforced.

export function buildRaceSessionTitle(entryName: string, selectedEvent: string): string {
  return `${selectedEvent} — ${entryName}`;
}

export function buildRaceSessionNotes(entry: {
  entry_opens?: string | null;
  entry_closes?: string | null;
  entry_url?: string | null;
}, locationLabel: string | null): string {
  const lines: string[] = [];
  if (locationLabel) lines.push(locationLabel);
  if (entry.entry_opens || entry.entry_closes) {
    const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const parts: string[] = [];
    if (entry.entry_opens) parts.push(`open ${fmt(entry.entry_opens)}`);
    if (entry.entry_closes) parts.push(`close ${fmt(entry.entry_closes)}`);
    lines.push(`Entries ${parts.join(", ")}`);
  }
  if (entry.entry_url) lines.push(`Enter: ${entry.entry_url}`);
  return lines.join("\n");
}
