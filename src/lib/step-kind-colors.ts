// Shared step-kind visual language — one place so every session block
// builder in the app (New Session, Session Overview's structure editor,
// and anywhere else a Warmup/Work/Recovery/Cooldown/Strides block gets
// rendered) colors a block's kind identically, rather than each screen
// inventing its own.
//
// Mirrors the "colored left bar" pattern calendar-day-cell.tsx already
// uses for session pills on the calendar — same visual language, applied
// here to a block's own kind within a session rather than the session's
// overall intent/day_type. Different vocabulary (a session doesn't have a
// "warmup" intent), so this is a fresh, dedicated mapping rather than
// reusing that one directly. Two of the five deliberately reuse the exact
// same color as their session-level counterpart where the concepts
// genuinely overlap: recovery matches calendar-day-cell's DAYTYPE_BAR.recovery
// (teal-500), and strides matches its INTENT_BAR.speed (fuchsia-500).

export type StepKind = "warmup" | "work" | "recovery" | "cooldown" | "strides";

export const STEP_KIND_BAR: Record<StepKind, string> = {
  warmup: "bg-sky-400",
  work: "bg-orange-500",
  recovery: "bg-teal-500",
  cooldown: "bg-emerald-400",
  strides: "bg-fuchsia-500",
};

export const STEP_KIND_TEXT: Record<StepKind, string> = {
  warmup: "text-sky-600",
  work: "text-orange-600",
  recovery: "text-teal-600",
  cooldown: "text-emerald-600",
  strides: "text-fuchsia-600",
};

export function stepKindBarClass(kind: string): string {
  return STEP_KIND_BAR[kind as StepKind] ?? "bg-muted-foreground/40";
}

export function stepKindTextClass(kind: string): string {
  return STEP_KIND_TEXT[kind as StepKind] ?? "text-muted-foreground";
}
