import { Badge } from "@/components/ui/badge";

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
    <Badge variant="outline" className={s.cls} title={lowConf ? `Confidence: ${confidence}` : undefined}>
      {s.label}{score != null ? ` · ${Math.round(score)}` : ""}{lowConf ? "*" : ""}
    </Badge>
  );
}