// Shared timezone options for any dropdown that sets an IANA timezone
// (athletes.timezone, profiles.timezone). Values are real IANA zone names
// — what's actually stored and what Intl.DateTimeFormat/getLocalDateAndHour
// expect — labels are just for display. Grouped roughly by region, with
// Australia listed first since it covers most of this app's current athletes.
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  // Australia
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
  { value: "Australia/Brisbane", label: "Brisbane (AEST, no DST)" },
  { value: "Australia/Adelaide", label: "Adelaide (ACST/ACDT)" },
  { value: "Australia/Perth", label: "Perth (AWST)" },
  { value: "Australia/Hobart", label: "Hobart (AEST/AEDT)" },
  { value: "Australia/Darwin", label: "Darwin (ACST, no DST)" },
  // New Zealand / Pacific
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
  { value: "Pacific/Fiji", label: "Fiji" },
  // Asia
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Shanghai", label: "Shanghai / Beijing" },
  { value: "Asia/Kolkata", label: "Mumbai / Delhi" },
  { value: "Asia/Dubai", label: "Dubai" },
  // Europe
  { value: "Europe/London", label: "London" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Europe/Amsterdam", label: "Amsterdam" },
  { value: "Europe/Zurich", label: "Zurich" },
  { value: "Europe/Athens", label: "Athens" },
  { value: "Europe/Moscow", label: "Moscow" },
  // Africa
  { value: "Africa/Johannesburg", label: "Johannesburg" },
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Africa/Nairobi", label: "Nairobi" },
  // Americas
  { value: "America/New_York", label: "New York (Eastern)" },
  { value: "America/Chicago", label: "Chicago (Central)" },
  { value: "America/Denver", label: "Denver (Mountain)" },
  { value: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "America/Mexico_City", label: "Mexico City" },
  // UTC fallback — last, since it's the "something's wrong" default, not a
  // real preference anyone should deliberately pick.
  { value: "UTC", label: "UTC (no local adjustment)" },
];

// Best-effort guess at the browser's own timezone, for defaulting a new
// dropdown to something reasonable rather than blank/UTC. Falls back to
// Melbourne (the most common case for this app's current roster) if the
// browser API is unavailable for any reason.
export function guessLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne";
  } catch {
    return "Australia/Melbourne";
  }
}
