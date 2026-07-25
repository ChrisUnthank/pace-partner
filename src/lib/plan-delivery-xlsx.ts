import ExcelJS from "exceljs";
import { summarizeDraftSteps, classifiedTitle, type DraftStep } from "@/lib/calendar-copy";
import { tidyStepForTemplate } from "@/lib/templates";

/**
 * Excel export for the Deliver Program flow. Uses exceljs rather than the
 * xlsx (SheetJS) package — SheetJS's free/community edition can READ cell
 * styling but silently strips it on WRITE, so color-coded cells are not
 * possible with it. exceljs supports writing fills in its free version.
 *
 * Colors are copied directly from app.sessions.calendar.tsx's own
 * Legend() component (Tailwind 500/600/400/300 shades → their real hex
 * values) so this genuinely matches the calendar rather than inventing a
 * separate palette.
 *
 * Distances/times are run through tidyStepForTemplate (the same snapping
 * already used for "save a real session as a template") before display —
 * a planned session's steps table can carry precise, irregular numbers
 * inherited from whatever real FIT-derived session it was copied from
 * (5437m, not a clean 5.4km); this export is a hand-off document for a
 * plan, so it should always read like one, not like a GPS recording.
 */

export type PlanDeliverySession = {
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  is_long_run: boolean;
  steps: DraftStep[];
};

// Snaps every distance/time-bearing field on every step to a plan-friendly
// number via the same tidyStepForTemplate logic already used when saving a
// real session as a template — reused rather than re-derived.
function tidySession(s: PlanDeliverySession): PlanDeliverySession {
  return { ...s, steps: s.steps.map((st) => tidyStepForTemplate(st) as DraftStep) };
}

const INTENT_COLOR_HEX: Record<string, string> = {
  easy: "10B981", // emerald-500
  aerobic: "14B8A6", // teal-500
  tempo: "F59E0B", // amber-500
  threshold: "F97316", // orange-500
  vo2: "EF4444", // red-500
  anaerobic: "E11D48", // rose-600
  speed: "D946EF", // fuchsia-500
  recovery: "38BDF8", // sky-400
};

const DAY_TYPE_COLOR_HEX: Record<string, string> = {
  race: "9333EA", // purple-600
  cross_training: "94A3B8", // slate-400
  rest: "D6D3D1", // stone-300
};

const FALLBACK_COLOR_HEX = "E2E8F0"; // slate-200 — anything unrecognized

function colorForSession(s: PlanDeliverySession): string {
  return DAY_TYPE_COLOR_HEX[s.day_type] ?? (s.intent ? INTENT_COLOR_HEX[s.intent] : undefined) ?? FALLBACK_COLOR_HEX;
}

// Simple luminance check so text stays legible against both light fills
// (stone-300) and dark ones (rose-600) rather than hardcoding white.
function readableTextHex(bgHex: string): string {
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "1F2937" : "FFFFFF"; // slate-800 vs white
}

function targetLabel(s: DraftStep): string {
  if (s.kind === "recovery") {
    return s.recovery_mode ? s.recovery_mode.charAt(0).toUpperCase() + s.recovery_mode.slice(1) : "";
  }
  if (s.target_mode === "pace" && s.target_pace_sec_per_km != null) {
    const m = Math.floor(s.target_pace_sec_per_km / 60);
    const sec = Math.round(s.target_pace_sec_per_km % 60);
    return `${m}:${String(sec).padStart(2, "0")}/km`;
  }
  if (s.target_mode === "threshold_pace_pct" && s.target_threshold_pace_pct != null) return `${s.target_threshold_pace_pct}% thr pace`;
  if (s.target_mode === "threshold_hr_pct" && s.target_threshold_hr_pct != null) return `${s.target_threshold_hr_pct}% thr HR`;
  if (s.target_mode === "zone" && s.target_zone) return s.target_zone.toUpperCase();
  if (s.target_mode === "rpe" && s.target_rpe != null) return `RPE ${s.target_rpe}`;
  return "";
}

function amountLabel(s: DraftStep): string {
  // Standalone "recovery" steps store their duration on
  // recovery_target_kind/recovery_target_seconds/recovery_target_distance_m
  // — a separate set of fields from every other step kind's target_kind/
  // target_distance_m/target_time_seconds. Reading the wrong pair here was
  // why a recovery row showed a blank Amount.
  if (s.kind === "recovery") {
    if (s.recovery_target_kind === "distance" && s.recovery_target_distance_m != null) {
      return s.recovery_target_distance_m >= 1000
        ? `${(s.recovery_target_distance_m / 1000).toFixed(1)}km`
        : `${s.recovery_target_distance_m}m`;
    }
    if (s.recovery_target_kind === "time" && s.recovery_target_seconds != null) {
      return `${Math.round(s.recovery_target_seconds / 60)}min`;
    }
    return "";
  }
  if (s.target_kind === "distance" && s.target_distance_m != null) {
    return s.target_distance_m >= 1000 ? `${(s.target_distance_m / 1000).toFixed(1)}km` : `${s.target_distance_m}m`;
  }
  if (s.target_kind === "time" && s.target_time_seconds != null) {
    return `${Math.round(s.target_time_seconds / 60)}min`;
  }
  return "";
}

// The between-reps/between-sets recovery embedded inside a work step
// (e.g. "90s jog" between each of 6×400m) — distinct from a standalone
// recovery-kind step, and previously not shown anywhere in the export.
function recoveryLabel(s: DraftStep): string {
  const parts: string[] = [];
  if (s.reps > 1 && (s.recovery_between_reps_seconds != null || s.recovery_between_reps_mode)) {
    const bits = [
      s.recovery_between_reps_seconds != null ? `${s.recovery_between_reps_seconds}s` : null,
      s.recovery_between_reps_mode,
    ].filter(Boolean);
    parts.push(`${bits.join(" ")} between reps`.trim());
  }
  if ((s.set_count ?? 1) > 1 && (s.recovery_between_sets_seconds != null || s.recovery_between_sets_mode)) {
    const bits = [
      s.recovery_between_sets_seconds != null ? `${s.recovery_between_sets_seconds}s` : null,
      s.recovery_between_sets_mode,
    ].filter(Boolean);
    parts.push(`${bits.join(" ")} between sets`.trim());
  }
  return parts.join("; ");
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }; // slate-800
  });
}

function fillRow(row: ExcelJS.Row, session: PlanDeliverySession) {
  const bgHex = colorForSession(session);
  const textHex = readableTextHex(bgHex);
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bgHex}` } };
    cell.font = { color: { argb: `FF${textHex}` } };
  });
}

function addSimpleSheet(wb: ExcelJS.Workbook, sessions: PlanDeliverySession[]) {
  const ws = wb.addWorksheet("Program");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Session", key: "session", width: 28 },
    { header: "Type", key: "type", width: 12 },
    { header: "Structure", key: "structure", width: 55 },
  ];
  styleHeaderRow(ws.getRow(1));

  for (const raw of sessions) {
    const s = tidySession(raw);
    const row = ws.addRow({
      date: s.session_date,
      session: classifiedTitle(s, s.steps),
      type: s.intent ?? s.day_type,
      structure: summarizeDraftSteps(s.steps) || "—",
    });
    fillRow(row, s);
  }
}

function addDetailedSheet(wb: ExcelJS.Workbook, sessions: PlanDeliverySession[]) {
  const ws = wb.addWorksheet("Program (detailed)");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Session", key: "session", width: 28 },
    { header: "Step", key: "step", width: 10 },
    { header: "Reps", key: "reps", width: 8 },
    { header: "Amount", key: "amount", width: 10 },
    { header: "Target", key: "target", width: 18 },
    { header: "Recovery", key: "recovery", width: 24 },
  ];
  styleHeaderRow(ws.getRow(1));

  for (const raw of sessions) {
    const s = tidySession(raw);
    const steps = s.steps.length > 0 ? s.steps : [null];
    for (const st of steps) {
      const row = ws.addRow({
        date: s.session_date,
        session: classifiedTitle(s, s.steps),
        step: st ? st.kind : "—",
        reps: st && st.reps > 1 ? st.reps : "",
        amount: st ? amountLabel(st) : "",
        target: st ? targetLabel(st) : "",
        recovery: st ? recoveryLabel(st) : "",
      });
      fillRow(row, s);
    }
  }
}

function filenameFor(rangeStart: string, rangeEnd: string, athleteName?: string): string {
  const rangeLabel = `${rangeStart}_to_${rangeEnd}`;
  if (!athleteName) return `${rangeLabel}.xlsx`;
  const safeName = athleteName.replace(/[^a-z0-9]+/gi, "-").replace(/(^-+|-+$)/g, "").toLowerCase();
  return `${safeName || "athlete"}-${rangeLabel}.xlsx`;
}

export async function buildPlanDeliveryWorkbook(
  athleteName: string,
  sessions: PlanDeliverySession[],
  detailLevel: "simple" | "detailed" | "both",
  rangeStart: string,
  rangeEnd: string,
): Promise<{ blob: Blob; base64: string; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Strider";

  if (detailLevel === "simple" || detailLevel === "both") addSimpleSheet(wb, sessions);
  if (detailLevel === "detailed" || detailLevel === "both") addDetailedSheet(wb, sessions);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  return { blob, base64, filename: filenameFor(rangeStart, rangeEnd, athleteName) };
}

export async function downloadPlanDeliveryWorkbook(
  athleteName: string,
  sessions: PlanDeliverySession[],
  detailLevel: "simple" | "detailed" | "both",
  rangeStart: string,
  rangeEnd: string,
) {
  const { blob, filename } = await buildPlanDeliveryWorkbook(athleteName, sessions, detailLevel, rangeStart, rangeEnd);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
