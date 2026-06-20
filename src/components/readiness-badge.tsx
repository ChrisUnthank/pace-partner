import { Badge } from "@/components/ui/badge";

export function ReadinessBadge({ status }: { status?: "green" | "amber" | "red" | null }) {
  if (!status) return <Badge variant="outline">—</Badge>;
  const map = {
    green: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    amber: { label: "Caution", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
    red: { label: "Recover", cls: "bg-red-500/15 text-red-700 border-red-500/30" },
  } as const;
  const s = map[status];
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}