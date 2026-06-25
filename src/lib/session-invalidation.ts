import type { QueryClient } from "@tanstack/react-query";

/**
 * Single shared invalidation helper so every screen that reads from
 * sessions / interval_results / derived tables refreshes after a rep,
 * totals, RPE, or delete operation.
 */
export function invalidateSession(
  qc: QueryClient,
  sessionId: string,
  athleteId?: string | null,
) {
  // Session row + nested data
  qc.invalidateQueries({ queryKey: ["session", sessionId] });
  qc.invalidateQueries({ queryKey: ["steps", sessionId] });
  qc.invalidateQueries({ queryKey: ["results", sessionId] });
  qc.invalidateQueries({ queryKey: ["zone-time", sessionId] });
  qc.invalidateQueries({ queryKey: ["fatigue", sessionId] });
  qc.invalidateQueries({ queryKey: ["fuel-events", sessionId] });
  qc.invalidateQueries({ queryKey: ["session_insights", sessionId] });
  qc.invalidateQueries({ queryKey: ["raw-points", sessionId] });
  qc.invalidateQueries({ queryKey: ["session-files", sessionId] });

  // Lists / dashboards / analytics that aggregate sessions
  qc.invalidateQueries({ queryKey: ["sessions-list"] });
  qc.invalidateQueries({ queryKey: ["roster-readiness"] });
  qc.invalidateQueries({ queryKey: ["home-next-session"] });
  qc.invalidateQueries({ queryKey: ["daily-log-sessions"] });

  if (athleteId) {
    qc.invalidateQueries({ queryKey: ["athlete-sessions", athleteId] });
    qc.invalidateQueries({ queryKey: ["weekly-distance", athleteId] });
    qc.invalidateQueries({ queryKey: ["volume-by-date", athleteId] });
    qc.invalidateQueries({ queryKey: ["analytics-weekly-distance", athleteId] });
    qc.invalidateQueries({ queryKey: ["analytics-zone-time", athleteId] });
    qc.invalidateQueries({ queryKey: ["analytics-load", athleteId] });
    qc.invalidateQueries({ queryKey: ["analytics-readiness", athleteId] });
    qc.invalidateQueries({ queryKey: ["readiness", athleteId] });
  }

  // Broad fallbacks for anything keyed loosely
  qc.invalidateQueries({ predicate: (q) => {
    const k = q.queryKey;
    if (!Array.isArray(k) || typeof k[0] !== "string") return false;
    const key = k[0] as string;
    return key.startsWith("analytics-") || key === "fatigue" || key === "zone-time" || key === "results";
  }});
}
