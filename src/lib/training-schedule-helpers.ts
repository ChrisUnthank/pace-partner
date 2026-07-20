// Pure client-side helpers — no server function needed for either of
// these. ICS generation happens entirely in the browser (a calendar file
// is just a text format), and the map/Google Calendar links are just URLs.

export type OccurrenceForExport = {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM, null = all-day / no fixed time
  durationMinutes?: number; // defaults to 60
  location: string | null;
  notes: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Local date+time -> UTC "YYYYMMDDTHHMMSSZ" the ICS format expects.
function toICSDateTime(date: string, time: string): string {
  const d = new Date(`${date}T${time}:00`);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Builds a single-event .ics file for one specific occurrence (reflects
// any override already applied by the caller — this function doesn't know
// or care whether the values came from the base slot or an override).
// Deliberately a single VEVENT, not a recurring RRULE — encoding
// exceptions/cancellations correctly into an RRULE+EXDATE+RECURRENCE-ID
// structure is a lot of complexity for what's meant to be a quick "add
// this session to my calendar" action, not an ongoing subscription.
export function buildICS(occ: OccurrenceForExport): string {
  const duration = occ.durationMinutes ?? 60;
  const hasTime = !!occ.startTime;
  const start = hasTime ? occ.startTime! : "09:00";
  const startISO = toICSDateTime(occ.date, start);
  const endDate = new Date(`${occ.date}T${start}:00`);
  endDate.setMinutes(endDate.getMinutes() + duration);
  const endISO =
    endDate.getUTCFullYear() +
    pad(endDate.getUTCMonth() + 1) +
    pad(endDate.getUTCDate()) +
    "T" +
    pad(endDate.getUTCHours()) +
    pad(endDate.getUTCMinutes()) +
    pad(endDate.getUTCSeconds()) +
    "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Strider//Training Schedule//EN",
    "BEGIN:VEVENT",
    `UID:${occ.date}-${Math.random().toString(36).slice(2)}@strider`,
    `DTSTAMP:${toICSDateTime(new Date().toISOString().slice(0, 10), "00:00")}`,
    `DTSTART:${startISO}`,
    `DTEND:${endISO}`,
    `SUMMARY:${escapeICS(occ.title)}`,
  ];
  if (occ.location) lines.push(`LOCATION:${escapeICS(occ.location)}`);
  if (occ.notes) lines.push(`DESCRIPTION:${escapeICS(occ.notes)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

// Triggers a browser download of the .ics file — works for Apple
// Calendar, Outlook, and most Android calendar apps via "import".
export function downloadICS(occ: OccurrenceForExport) {
  const ics = buildICS(occ);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${occ.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${occ.date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Google Calendar's "quick add" URL scheme — opens a pre-filled event in
// a new tab, one click to save. Separate from the .ics download since
// some people specifically want the Google Calendar web flow rather than
// a file to import.
export function googleCalendarLink(occ: OccurrenceForExport): string {
  const duration = occ.durationMinutes ?? 60;
  const hasTime = !!occ.startTime;
  const start = hasTime ? occ.startTime! : "09:00";
  const startISO = toICSDateTime(occ.date, start);
  const endDate = new Date(`${occ.date}T${start}:00`);
  endDate.setMinutes(endDate.getMinutes() + duration);
  const endISO =
    endDate.getUTCFullYear() +
    pad(endDate.getUTCMonth() + 1) +
    pad(endDate.getUTCDate()) +
    "T" +
    pad(endDate.getUTCHours()) +
    pad(endDate.getUTCMinutes()) +
    pad(endDate.getUTCSeconds()) +
    "Z";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: occ.title,
    dates: `${startISO}/${endISO}`,
  });
  if (occ.location) params.set("location", occ.location);
  if (occ.notes) params.set("details", occ.notes);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

// Resolves a training_locations row (with real lat/lng) to a precise
// Google Maps pin, or falls back to a text search for free-text locations
// that were never linked to a saved location.
export function mapLink(opts: { lat?: number | null; lng?: number | null; text?: string | null }): string | null {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps?q=${opts.lat},${opts.lng}`;
  }
  if (opts.text) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.text)}`;
  }
  return null;
}
