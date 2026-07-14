import { Angry, Frown, Meh, Smile, Laugh } from "lucide-react";
import { cn } from "@/lib/utils";

// Discrete 5-point "how did you feel" scale, matching TrainingPeaks' own
// Very Weak/Weak/Normal/Strong/Very Strong face picker. Values are chosen on
// the same 1–10 feel_score scale session_insights already used (a continuous
// slider before this), so existing saved values stay comparable — just
// presented as five picks instead of a free slider. "Strong" = 7 matches the
// slider's old default value, so nothing that already felt like a sensible
// baseline changes meaning.
export const FEEL_LEVELS = [
  { value: 1, label: "Very Weak", Icon: Angry, color: "text-red-500" },
  { value: 3, label: "Weak", Icon: Frown, color: "text-orange-500" },
  { value: 5, label: "Normal", Icon: Meh, color: "text-slate-500" },
  { value: 7, label: "Strong", Icon: Smile, color: "text-teal-500" },
  { value: 10, label: "Very Strong", Icon: Laugh, color: "text-emerald-500" },
] as const;

export function FeelFaces({
  value,
  onChange,
  size = "default",
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  size?: "sm" | "default";
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      {FEEL_LEVELS.map((lvl) => {
        const selected = value === lvl.value;
        const Icon = lvl.Icon;
        return (
          <button
            key={lvl.value}
            type="button"
            onClick={() => onChange(lvl.value)}
            className={cn(
              "flex flex-col items-center gap-1 px-1.5 py-1 rounded-md transition-colors",
              selected ? "bg-accent" : "hover:bg-accent/50",
            )}
            aria-label={lvl.label}
            aria-pressed={selected}
            title={lvl.label}
          >
            <Icon
              className={cn(
                size === "sm" ? "h-5 w-5" : "h-6 w-6",
                selected ? lvl.color : "text-muted-foreground/40",
              )}
            />
            <span className={cn("text-[10px]", selected ? "font-medium text-foreground" : "text-muted-foreground")}>
              {lvl.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
