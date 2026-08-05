// Builds a downloadable/emailable race schedule for one athlete — text
// for reading/emailing, .ics for importing into an actual calendar app.
// Deliberately scoped to only races that athlete has actually flagged
// (has an athlete_race_selections row for) — this is a personal export
// of what they're doing, not a dump of every race merely listed on the
// group's shared calendar.
//
// "Email" opens a mailto: link pre-filled with the text body rather than
// sending anything server-side — this app doesn't have working email
// delivery yet (the Resend sending domain isn't verified), so a mailto:
// link is the honest version of this feature: it hands off to the
// person's own email client instead of quietly failing or pretending to
// send something it can't.

export type ExportRaceEntry = {
  id: string;
  name: string;
  event_date: string;
  location: string | null;
  training_locations: { name: string } | null;
  entry_opens: string | null;
  entry_closes: string | null;
  entry_url: string | null;
};

export type ExportSelection = {
  race_schedule_entry_id: string;
  selected_event: string | null;
};

export type ExportStatus = "entered" | "assigned" | "tbc";

const STATUS_LABEL: Record<ExportStatus, string> = {
  entered: "Entered",
  assigned: "Assigned",
  tbc: "TBC — event not yet picked",
};

function resolveStatus(hasEnteredEntry: boolean, selectedEvent: string | null): ExportStatus {
  if (hasEnteredEntry) return "entered";
  if (!selectedEvent) return "tbc";
  return "assigned";
}

function entryLocation(entry: ExportRaceEntry): string | null {
  return entry.training_locations?.name ?? entry.location;
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export type ScheduleRow = {
  entry: ExportRaceEntry;
  selectedEvent: string | null;
  status: ExportStatus;
};

/** Builds the flagged-only, sorted row list shared by both the text and .ics builders. */
export function buildScheduleRows(
  entries: ExportRaceEntry[],
  selections: ExportSelection[],
  hasEnteredEntry: (raceScheduleEntryId: string) => boolean,
): ScheduleRow[] {
  const selByEntry = new Map(selections.map((s) => [s.race_schedule_entry_id, s]));
  const rows: ScheduleRow[] = [];
  for (const entry of entries) {
    const sel = selByEntry.get(entry.id);
    if (!sel) continue; // not flagged — excluded from every export format
    rows.push({ entry, selectedEvent: sel.selected_event, status: resolveStatus(hasEnteredEntry(entry.id), sel.selected_event) });
  }
  rows.sort((a, b) => a.entry.event_date.localeCompare(b.entry.event_date));
  return rows;
}

export function buildScheduleText(athleteName: string, rows: ScheduleRow[]): string {
  if (rows.length === 0) return `${athleteName}'s race schedule\n\nNo races flagged yet.`;
  const lines: string[] = [`${athleteName}'s race schedule`, ""];
  for (const { entry, selectedEvent, status } of rows) {
    const heading = selectedEvent ? `${entry.name} — ${selectedEvent}` : entry.name;
    lines.push(`${fmtDate(entry.event_date)} — ${heading} — ${STATUS_LABEL[status]}`);
    const loc = entryLocation(entry);
    if (loc) lines.push(`  ${loc}`);
    if (entry.entry_opens || entry.entry_closes) {
      const parts: string[] = [];
      if (entry.entry_opens) parts.push(`open ${fmtDateTime(entry.entry_opens)}`);
      if (entry.entry_closes) parts.push(`close ${fmtDateTime(entry.entry_closes)}`);
      lines.push(`  Entries ${parts.join(", ")}`);
    }
    if (entry.entry_url) lines.push(`  Enter: ${entry.entry_url}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export function buildScheduleIcs(athleteName: string, rows: ScheduleRow[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const events = rows.map(({ entry, selectedEvent, status }) => {
    const summary = selectedEvent ? `${entry.name} — ${selectedEvent}` : entry.name;
    const descParts = [`Status: ${STATUS_LABEL[status]}`];
    if (entry.entry_closes) descParts.push(`Entries close ${fmtDateTime(entry.entry_closes)}`);
    if (entry.entry_url) descParts.push(`Enter: ${entry.entry_url}`);
    const loc = entryLocation(entry);
    return [
      "BEGIN:VEVENT",
      `UID:${entry.id}@strider`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(entry.event_date)}`,
      `SUMMARY:${icsEscape(summary)}`,
      loc ? `LOCATION:${icsEscape(loc)}` : null,
      `DESCRIPTION:${icsEscape(descParts.join("\\n"))}`,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Strider//Race Schedule//EN", ...events, "END:VCALENDAR"].join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openMailtoWithSchedule(athleteName: string, text: string) {
  const subject = encodeURIComponent(`${athleteName}'s race schedule`);
  const body = encodeURIComponent(text);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
