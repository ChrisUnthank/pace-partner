import * as XLSX from "xlsx";
import { summarizeDraftSteps, type DraftStep } from "@/lib/calendar-copy";

/**
 * Excel export for the Deliver Program flow — for coaches whose athletes
 * work "old school" without the app. Reuses summarizeDraftSteps from the
 * Copy Period engine for the Simple sheet's structure column, since a real
 * `steps` row already has the same field shape as calendar-copy.ts's
 * DraftStep (kind/target_kind/target_mode/etc.) — no re-derivation needed.
 */

export type PlanDeliverySession = {
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  steps: DraftStep[];
};

function simpleRows(sessions: PlanDeliverySession[]) {
  return sessions.map((s) => ({
    Date: s.session_date,
    Session: s.title,
    Type: s.intent ?? s.day_type,
    Structure: summarizeDraftSteps(s.steps) || "—",
  }));
}

function targetLabel(s: DraftStep): string {
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
  if (s.target_kind === "distance" && s.target_distance_m != null) {
    return s.target_distance_m >= 1000 ? `${(s.target_distance_m / 1000).toFixed(1)}km` : `${s.target_distance_m}m`;
  }
  if (s.target_kind === "time" && s.target_time_seconds != null) {
    return `${Math.round(s.target_time_seconds / 60)}min`;
  }
  return "";
}

function detailedRows(sessions: PlanDeliverySession[]) {
  const rows: Record<string, string | number>[] = [];
  for (const s of sessions) {
    const orderedSteps = [...s.steps];
    if (orderedSteps.length === 0) {
      rows.push({ Date: s.session_date, Session: s.title, Step: "—", Reps: "", Amount: "", Target: "" });
      continue;
    }
    for (const st of orderedSteps) {
      rows.push({
        Date: s.session_date,
        Session: s.title,
        Step: st.kind,
        Reps: st.reps > 1 ? st.reps : "",
        Amount: amountLabel(st),
        Target: targetLabel(st),
      });
    }
  }
  return rows;
}

export function buildPlanDeliveryWorkbook(
  athleteName: string,
  sessions: PlanDeliverySession[],
  detailLevel: "simple" | "detailed" | "both",
): { blob: Blob; base64: string; filename: string } {
  const wb = XLSX.utils.book_new();

  if (detailLevel === "simple" || detailLevel === "both") {
    const ws = XLSX.utils.json_to_sheet(simpleRows(sessions));
    ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, ws, "Program");
  }
  if (detailLevel === "detailed" || detailLevel === "both") {
    const ws = XLSX.utils.json_to_sheet(detailedRows(sessions));
    ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Program (detailed)");
  }

  const wbArray = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([wbArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  // Base64 for the email attachment, built from the same array buffer
  // rather than re-serializing the workbook a second time.
  const bytes = new Uint8Array(wbArray);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const safeName = athleteName.replace(/[^a-z0-9]+/gi, "-").replace(/(^-+|-+$)/g, "").toLowerCase();
  const filename = `${safeName || "athlete"}-program.xlsx`;

  return { blob, base64, filename };
}

export function downloadPlanDeliveryWorkbook(
  athleteName: string,
  sessions: PlanDeliverySession[],
  detailLevel: "simple" | "detailed" | "both",
) {
  const { blob, filename } = buildPlanDeliveryWorkbook(athleteName, sessions, detailLevel);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
