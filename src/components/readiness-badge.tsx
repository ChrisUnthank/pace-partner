import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ReadinessBadge({
  status,
  score,
  confidence,
}: {
  status?: "green" | "amber" | "red" | null;
  score?: number | null;
  confidence?: string | null;
}) {
  if (!status) {
    return (
      <Badge variant="outline" title={confidence === "insufficient" ? "Building baseline — need a few days of data" : undefined}>
        {confidence === "insufficient" ? "Baseline…" : "—"}
      </Badge>
    );
  }
  const map = {
    green: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    amber: { label: "Caution", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
    red: { label: "Recover", cls: "bg-red-500/15 text-red-700 border-red-500/30" },
  } as const;
  const s = map[status];
  const lowConf = confidence === "low" || confidence === "medium";
  return (
    // Muted and dashed when the score has little behind it, matching the
    // hollow dot on the calendar.
    //
    // It was an asterisk and a tooltip, which is easy to miss on a dashboard
    // card — and after the confidence fix this is the common case, not the
    // exception: an athlete with no check-in now caps at 'medium' however
    // long their load history. A badge that reads the same either way invites
    // a coach to trust labels-and-duration as though it were a felt reading.
    <Badge
      variant="outline"
      className={cn(s.cls, lowConf && "opacity-70 border-dashed")}
      title={
        lowConf
          ? `Confidence: ${confidence} — no check-in, so this is from session labels and duration only`
          : undefined
      }
    >
      {s.label}
      {score != null ? ` · ${Math.round(score)}` : ""}
      {lowConf ? "*" : ""}
    </Badge>
  );
}
